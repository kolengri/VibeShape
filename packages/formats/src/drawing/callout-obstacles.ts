import type { DrawingViewProjection } from "@vibeshape/protocol"
import type { SheetPoint } from "./sheet"
import type { SheetBox } from "./text-metrics"

export type SheetSegment = readonly [start: SheetPoint, end: SheetPoint]

/** Liang–Barsky clipping test: does segment start→end touch `box`? */
export function segmentCrossesBox(start: SheetPoint, end: SheetPoint, box: SheetBox) {
  const dx = end[0] - start[0]
  const dy = end[1] - start[1]
  const sides: readonly (readonly [number, number])[] = [
    [-dx, start[0] - box[0]],
    [dx, box[2] - start[0]],
    [-dy, start[1] - box[1]],
    [dy, box[3] - start[1]],
  ]
  let from = 0
  let to = 1
  for (const [p, q] of sides) {
    if (p === 0) {
      if (q < 0) return false
    } else if (p < 0) from = Math.max(from, q / p)
    else to = Math.min(to, q / p)
  }
  return from <= to
}

const GRID_CELLS = 32
/** Arc chords deviate from the arc by at most this share of the view's larger extent. */
const ARC_SAGITTA_SHARE = 1e-3

type Obstacle =
  | Readonly<{ kind: "segment"; segment: SheetSegment }>
  | Readonly<{ kind: "circle"; center: SheetPoint; radius: number }>

/** True when the circle's curve passes through `box`, not merely around or inside it. */
function boxCrossesCircle(box: SheetBox, center: SheetPoint, radius: number) {
  const [cx, cy] = center
  const nearest = Math.hypot(
    Math.max(box[0] - cx, 0, cx - box[2]),
    Math.max(box[1] - cy, 0, cy - box[3]),
  )
  const farthest = Math.hypot(
    Math.max(cx - box[0], box[2] - cx),
    Math.max(cy - box[1], box[3] - cy),
  )
  return nearest <= radius && radius <= farthest
}

/**
 * The drawn curves of a view (lines, polyline segments, arc chords and full circles; hidden ones
 * only when hidden lines are drawn) in projection coordinates, bucketed in a uniform grid over the
 * view bounds so a label box tests only nearby curves, however many holes the view has.
 */
class ViewObstacles {
  readonly #items: Obstacle[] = []
  readonly #cells = new Map<number, number[]>()
  readonly #stamps: number[] = []
  readonly #origin: SheetPoint
  readonly #cell: number
  #stamp = 0

  constructor(view: DrawingViewProjection, hidden: boolean) {
    const { min, max } = view.bounds
    const span = Math.max(max[0] - min[0], max[1] - min[1], 1e-6)
    this.#origin = [min[0], min[1]]
    this.#cell = span / GRID_CELLS
    for (const edge of view.edges) {
      if (!hidden && edge.visibility !== "visible") continue
      const { curve } = edge
      if (curve.kind === "circle") {
        const [cx, cy] = curve.center
        const r = curve.radius
        this.#add({ kind: "circle", center: curve.center, radius: r }, [
          cx - r,
          cy - r,
          cx + r,
          cy + r,
        ])
      } else
        for (const segment of curveSegments(curve, span * ARC_SAGITTA_SHARE))
          this.#add({ kind: "segment", segment }, segmentBounds(segment))
    }
  }

  /** True when a drawn curve touches `box` (projection coordinates). */
  crosses(box: SheetBox) {
    const stamp = ++this.#stamp
    for (const key of this.#keys(box))
      for (const index of this.#cells.get(key) ?? []) {
        if (this.#stamps[index] === stamp) continue
        this.#stamps[index] = stamp
        const item = this.#items[index]
        if (item && touches(item, box)) return true
      }
    return false
  }

  #add(item: Obstacle, bounds: SheetBox) {
    const index = this.#items.push(item) - 1
    for (const key of this.#keys(bounds)) {
      const bucket = this.#cells.get(key)
      if (bucket) bucket.push(index)
      else this.#cells.set(key, [index])
    }
  }

  /** Grid cells overlapping `box`, clamped to the grid around the view bounds. */
  *#keys(box: SheetBox) {
    const cell = (value: number, origin: number) =>
      Math.min(GRID_CELLS, Math.max(0, Math.floor((value - origin) / this.#cell)))
    const [x0, x1] = [cell(box[0], this.#origin[0]), cell(box[2], this.#origin[0])]
    const [y0, y1] = [cell(box[1], this.#origin[1]), cell(box[3], this.#origin[1])]
    for (let x = x0; x <= x1; x += 1)
      for (let y = y0; y <= y1; y += 1) yield x * (GRID_CELLS + 1) + y
  }
}

function touches(item: Obstacle, box: SheetBox) {
  return item.kind === "segment"
    ? segmentCrossesBox(item.segment[0], item.segment[1], box)
    : boxCrossesCircle(box, item.center, item.radius)
}

function segmentBounds([start, end]: SheetSegment): SheetBox {
  return [
    Math.min(start[0], end[0]),
    Math.min(start[1], end[1]),
    Math.max(start[0], end[0]),
    Math.max(start[1], end[1]),
  ]
}

function curveSegments(
  curve: Exclude<DrawingViewProjection["edges"][number]["curve"], { kind: "circle" }>,
  sagitta: number,
) {
  if (curve.kind === "line") return [[curve.start, curve.end] as SheetSegment]
  if (curve.kind === "polyline")
    return curve.points
      .slice(1)
      .map((end, index): SheetSegment => [curve.points[index] ?? end, end])
  const step = curve.radius <= sagitta ? Math.PI / 2 : 2 * Math.acos(1 - sagitta / curve.radius)
  const count = Math.max(1, Math.ceil((curve.endAngle - curve.startAngle) / step))
  const at = (index: number): SheetPoint => {
    const angle = curve.startAngle + ((curve.endAngle - curve.startAngle) * index) / count
    return [
      curve.center[0] + curve.radius * Math.cos(angle),
      curve.center[1] + curve.radius * Math.sin(angle),
    ]
  }
  return Array.from({ length: count }, (_, index): SheetSegment => [at(index), at(index + 1)])
}

const cache = new WeakMap<DrawingViewProjection, Map<boolean, ViewObstacles>>()

/** Drawn curves of a view, indexed once per projection and reused across scale attempts. */
export function viewObstacles(view: DrawingViewProjection, hidden: boolean) {
  const built = cache.get(view) ?? new Map<boolean, ViewObstacles>()
  cache.set(view, built)
  const cached = built.get(hidden)
  if (cached) return cached
  const obstacles = new ViewObstacles(view, hidden)
  built.set(hidden, obstacles)
  return obstacles
}
