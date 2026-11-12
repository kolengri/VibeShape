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

/**
 * The drawn straight pieces of a view (lines, polyline segments, arc chords; hidden ones only when
 * hidden lines are drawn) in projection coordinates, bucketed in a uniform grid over the view
 * bounds so label boxes test only nearby pieces. Full circles are excluded: callout placement
 * tests them exactly as rings.
 */
class ViewLines {
  readonly #segments: SheetSegment[] = []
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
    for (const edge of view.edges)
      if (hidden || edge.visibility === "visible")
        for (const segment of curveSegments(edge.curve, span * ARC_SAGITTA_SHARE))
          this.#add(segment)
  }

  /** True when a visible piece touches `box` (projection coordinates). */
  crosses(box: SheetBox) {
    const stamp = ++this.#stamp
    for (const key of this.#keys(box))
      for (const index of this.#cells.get(key) ?? []) {
        if (this.#stamps[index] === stamp) continue
        this.#stamps[index] = stamp
        const segment = this.#segments[index]
        if (segment && segmentCrossesBox(segment[0], segment[1], box)) return true
      }
    return false
  }

  #add(segment: SheetSegment) {
    const index = this.#segments.push(segment) - 1
    const [start, end] = segment
    const box: SheetBox = [
      Math.min(start[0], end[0]),
      Math.min(start[1], end[1]),
      Math.max(start[0], end[0]),
      Math.max(start[1], end[1]),
    ]
    for (const key of this.#keys(box)) {
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

function curveSegments(curve: DrawingViewProjection["edges"][number]["curve"], sagitta: number) {
  if (curve.kind === "line") return [[curve.start, curve.end] as SheetSegment]
  if (curve.kind === "polyline")
    return curve.points
      .slice(1)
      .map((end, index): SheetSegment => [curve.points[index] ?? end, end])
  if (curve.kind === "circle") return []
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

const cache = new WeakMap<DrawingViewProjection, Map<boolean, ViewLines>>()

/** Drawn line pieces of a view, built once per projection and reused across scale attempts. */
export function viewLines(view: DrawingViewProjection, hidden: boolean) {
  const built = cache.get(view) ?? new Map<boolean, ViewLines>()
  cache.set(view, built)
  const cached = built.get(hidden)
  if (cached) return cached
  const lines = new ViewLines(view, hidden)
  built.set(hidden, lines)
  return lines
}
