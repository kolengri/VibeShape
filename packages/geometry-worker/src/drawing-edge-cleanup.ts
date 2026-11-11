import type { DrawingCurve, DrawingEdge } from "@vibeshape/protocol"

type Point = readonly [number, number]
const COINCIDENCE_TOLERANCE_MM = 1e-4

/** Replaces straight sampled curves, such as circles seen edge-on, by exact lines. */
export function straightenPolyline(points: readonly Point[]): DrawingCurve | null {
  const start = points[0]
  const end = points.at(-1)
  if (!start || !end) return null
  const length = Math.hypot(end[0] - start[0], end[1] - start[1])
  const copied = points.map((point): [number, number] => [point[0], point[1]])
  if (length <= 1e-9) return points.length > 2 ? { kind: "polyline", points: copied } : null
  const straight = points.every(
    (point) => segmentDistance(point, start, end) <= COINCIDENCE_TOLERANCE_MM * 1e-2,
  )
  return straight
    ? { kind: "line", start: [start[0], start[1]], end: [end[0], end[1]] }
    : { kind: "polyline", points: copied }
}

/**
 * HLR reports hidden copies of edges that lie exactly behind visible ones (box back edges, the far
 * rim of a through-hole). Drawing conventions show only the visible line, so a hidden edge is
 * dropped when all of its samples lie on visible geometry or on an earlier identical hidden edge.
 */
export function suppressCoincidentEdges(edges: readonly DrawingEdge[]): DrawingEdge[] {
  const extent = edges.reduce<[number, number, number, number]>(
    (total, { curve }) => {
      const [minX, minY, maxX, maxY] = curveBox(curve)
      return [
        Math.min(total[0], minX),
        Math.min(total[1], minY),
        Math.max(total[2], maxX),
        Math.max(total[3], maxY),
      ]
    },
    [
      Number.POSITIVE_INFINITY,
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
    ],
  )
  const span = Math.max(extent[2] - extent[0], extent[3] - extent[1])
  // About 32 cells across the view keeps buckets small without exploding long diagonal lines.
  const cellSize = Number.isFinite(span) ? Math.max(span / 32, 0.01) : 1
  const visible = new CurveIndex(cellSize)
  for (const edge of edges) if (edge.visibility === "visible") visible.add(edge.curve)
  const keptVisible = new CurveIndex(cellSize)
  const keptHidden = new CurveIndex(cellSize)
  const kept: DrawingEdge[] = []
  for (const edge of edges) {
    if (edge.visibility === "visible") {
      if (keptVisible.containsSameCurve(edge.curve)) continue
      keptVisible.add(edge.curve)
      kept.push(edge)
      continue
    }
    if (visible.covers(edge.curve) || keptHidden.covers(edge.curve)) continue
    keptHidden.add(edge.curve)
    kept.push(edge)
  }
  return kept
}

/** Uniform grid over curve bounds so coincidence checks stay near-linear for large views. */
class CurveIndex {
  readonly #curves: DrawingCurve[] = []
  readonly #cells = new Map<string, number[]>()
  readonly #cellSize: number

  constructor(cellSize: number) {
    this.#cellSize = cellSize
  }

  add(curve: DrawingCurve) {
    const index = this.#curves.push(curve) - 1
    const [minX, minY, maxX, maxY] = curveBox(curve)
    for (let x = this.#cell(minX); x <= this.#cell(maxX); x += 1)
      for (let y = this.#cell(minY); y <= this.#cell(maxY); y += 1) {
        const key = `${x}:${y}`
        const bucket = this.#cells.get(key)
        if (bucket) bucket.push(index)
        else this.#cells.set(key, [index])
      }
  }

  covers(curve: DrawingCurve) {
    return curveSamples(curve).every((sample) =>
      this.#near(sample).some((candidate) => onCurve(sample, candidate)),
    )
  }

  containsSameCurve(curve: DrawingCurve) {
    const samples = curveSamples(curve)
    const first = samples[0]
    if (!first) return false
    return this.#near(first).some(
      (candidate) =>
        samples.every((sample) => onCurve(sample, candidate)) &&
        curveSamples(candidate).every((sample) => onCurve(sample, curve)),
    )
  }

  #cell(value: number) {
    return Math.floor(value / this.#cellSize)
  }

  #near(point: Point) {
    const bucket = this.#cells.get(`${this.#cell(point[0])}:${this.#cell(point[1])}`) ?? []
    const neighbours = new Set(bucket)
    for (const dx of [-1, 0, 1])
      for (const dy of [-1, 0, 1])
        for (const index of this.#cells.get(
          `${this.#cell(point[0]) + dx}:${this.#cell(point[1]) + dy}`,
        ) ?? [])
          neighbours.add(index)
    return [...neighbours]
      .sort((left, right) => left - right)
      .flatMap((index) => this.#curves[index] ?? [])
  }
}

function curveBox(curve: DrawingCurve): [number, number, number, number] {
  const points =
    curve.kind === "line"
      ? [curve.start, curve.end]
      : curve.kind === "polyline"
        ? curve.points
        : [
            [curve.center[0] - curve.radius, curve.center[1] - curve.radius] as const,
            [curve.center[0] + curve.radius, curve.center[1] + curve.radius] as const,
          ]
  const xs = points.map((point) => point[0])
  const ys = points.map((point) => point[1])
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]
}

function curveSamples(curve: DrawingCurve): Point[] {
  if (curve.kind === "line")
    return [0, 0.25, 0.5, 0.75, 1].map((t) => [
      curve.start[0] + (curve.end[0] - curve.start[0]) * t,
      curve.start[1] + (curve.end[1] - curve.start[1]) * t,
    ])
  if (curve.kind === "polyline") {
    const midpoints = curve.points.slice(1).map((point, index): Point => {
      const previous = curve.points[index] ?? point
      return [(previous[0] + point[0]) / 2, (previous[1] + point[1]) / 2]
    })
    return [...curve.points, ...midpoints]
  }
  const start = curve.kind === "arc" ? curve.startAngle : 0
  const sweep = curve.kind === "arc" ? curve.endAngle - curve.startAngle : 2 * Math.PI
  const count = curve.kind === "arc" ? 9 : 12
  return Array.from({ length: count }, (_, index) => {
    const angle = start + (sweep * index) / (curve.kind === "arc" ? count - 1 : count)
    return [
      curve.center[0] + curve.radius * Math.cos(angle),
      curve.center[1] + curve.radius * Math.sin(angle),
    ]
  })
}

function onCurve(point: Point, curve: DrawingCurve): boolean {
  const tolerance = COINCIDENCE_TOLERANCE_MM
  if (curve.kind === "line") return segmentDistance(point, curve.start, curve.end) <= tolerance
  if (curve.kind === "polyline")
    return curve.points
      .slice(1)
      .some((end, index) => segmentDistance(point, curve.points[index] ?? end, end) <= tolerance)
  const radial = Math.hypot(point[0] - curve.center[0], point[1] - curve.center[1])
  if (Math.abs(radial - curve.radius) > tolerance) return false
  if (curve.kind === "circle") return true
  const angle = Math.atan2(point[1] - curve.center[1], point[0] - curve.center[0])
  const angularTolerance = tolerance / curve.radius
  for (const turn of [-2, -1, 0, 1, 2]) {
    const candidate = angle + turn * 2 * Math.PI
    if (
      candidate >= curve.startAngle - angularTolerance &&
      candidate <= curve.endAngle + angularTolerance
    )
      return true
  }
  return false
}

function segmentDistance(point: Point, start: Point, end: Point) {
  const dx = end[0] - start[0]
  const dy = end[1] - start[1]
  const lengthSquared = dx * dx + dy * dy
  const t =
    lengthSquared === 0
      ? 0
      : Math.max(
          0,
          Math.min(1, ((point[0] - start[0]) * dx + (point[1] - start[1]) * dy) / lengthSquared),
        )
  return Math.hypot(point[0] - (start[0] + dx * t), point[1] - (start[1] + dy * t))
}
