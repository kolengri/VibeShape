import { type DrawingCurve, type DrawingEdge, MAX_DRAWING_CURVE_POINTS } from "@vibeshape/protocol"

type Point = readonly [number, number]
type Line = Extract<DrawingCurve, { kind: "line" }>
type Round = Extract<DrawingCurve, { kind: "circle" | "arc" }>
type Polyline = Extract<DrawingCurve, { kind: "polyline" }>
type Interval = readonly [start: number, end: number]
type Box = readonly [minX: number, minY: number, maxX: number, maxY: number]

/** Distance within which projected edges are treated as the same drawn line. */
const COINCIDENCE_TOLERANCE_MM = 1e-4
const FULL_TURN = 2 * Math.PI

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

/** Straight samples become one exact line; others become chained polylines within the budget. */
export function splitPolyline(points: readonly Point[]): DrawingCurve[] {
  const curve = straightenPolyline(points)
  if (curve?.kind !== "polyline") return curve ? [curve] : []
  const pieces: DrawingCurve[] = []
  const step = MAX_DRAWING_CURVE_POINTS - 1
  for (let start = 0; start < points.length - 1; start += step)
    pieces.push({ kind: "polyline", points: curve.points.slice(start, start + step + 1) })
  return pieces
}

/**
 * HLR reports hidden copies of edges that lie exactly behind visible ones (box back edges, the far
 * rim of a through-hole) and repeats edges shared by faces. Drawing conventions show a visible line
 * once and dash only what no visible line covers. Lines are compared with collinear lines and
 * circles/arcs with concentric equal-radius curves by merged parameter intervals, so a hidden edge
 * keeps exactly its uncovered pieces. Polylines are only dropped when they duplicate one covering
 * polyline point for point; partial polyline overlaps are kept rather than guessed.
 */
export function suppressCoincidentEdges(edges: readonly DrawingEdge[]): DrawingEdge[] {
  const cellSize = indexCellSize(edges)
  const visible = new CurveIndex(cellSize)
  for (const edge of edges) if (edge.visibility === "visible") visible.add(edge.curve)
  const keptVisible = new CurveIndex(cellSize)
  const keptHidden = new CurveIndex(cellSize)
  const kept: DrawingEdge[] = []
  for (const edge of edges) {
    if (edge.visibility !== "visible") continue
    for (const curve of uncoveredPieces(edge.curve, [keptVisible])) {
      keptVisible.add(curve)
      kept.push({ ...edge, curve })
    }
  }
  for (const edge of edges) {
    if (edge.visibility !== "hidden") continue
    for (const curve of uncoveredPieces(edge.curve, [visible, keptHidden])) {
      keptHidden.add(curve)
      kept.push({ ...edge, curve })
    }
  }
  return kept
}

function uncoveredPieces(curve: DrawingCurve, covers: readonly CurveIndex[]): DrawingCurve[] {
  const candidates = covers.flatMap((index) => index.near(curveBox(curve)))
  if (curve.kind === "line") return uncoveredLine(curve, candidates)
  if (curve.kind === "polyline") return polylineCovered(curve, candidates) ? [] : [curve]
  return uncoveredRound(curve, candidates)
}

function uncoveredLine(line: Line, candidates: readonly DrawingCurve[]): DrawingCurve[] {
  const dx = line.end[0] - line.start[0]
  const dy = line.end[1] - line.start[1]
  const length = Math.hypot(dx, dy)
  if (length <= COINCIDENCE_TOLERANCE_MM) return []
  const direction: Point = [dx / length, dy / length]
  const parameter = (point: Point) =>
    (point[0] - line.start[0]) * direction[0] + (point[1] - line.start[1]) * direction[1]
  const onLine = (point: Point) =>
    lineDistance(point, line.start, direction) <= COINCIDENCE_TOLERANCE_MM
  const intervals = candidates.flatMap((candidate): Interval[] => {
    if (candidate.kind !== "line" || !onLine(candidate.start) || !onLine(candidate.end)) return []
    const a = parameter(candidate.start)
    const b = parameter(candidate.end)
    return [[Math.min(a, b), Math.max(a, b)]]
  })
  return complement([0, length], intervals, COINCIDENCE_TOLERANCE_MM).map(([from, to]) => ({
    kind: "line",
    start: [line.start[0] + direction[0] * from, line.start[1] + direction[1] * from],
    end: [line.start[0] + direction[0] * to, line.start[1] + direction[1] * to],
  }))
}

function sameRound(left: Round, right: Round) {
  return (
    Math.hypot(left.center[0] - right.center[0], left.center[1] - right.center[1]) <=
      COINCIDENCE_TOLERANCE_MM && Math.abs(left.radius - right.radius) <= COINCIDENCE_TOLERANCE_MM
  )
}

function uncoveredRound(round: Round, candidates: readonly DrawingCurve[]): DrawingCurve[] {
  const range: Interval = round.kind === "arc" ? [round.startAngle, round.endAngle] : [0, FULL_TURN]
  const intervals = candidates.flatMap((candidate): Interval[] => {
    if ((candidate.kind !== "circle" && candidate.kind !== "arc") || !sameRound(round, candidate))
      return []
    if (candidate.kind === "circle") return [range]
    // Shift the covering arc by whole turns so every overlap with the range is represented.
    return [-2, -1, 0, 1, 2].map(
      (turn): Interval => [
        candidate.startAngle + turn * FULL_TURN,
        candidate.endAngle + turn * FULL_TURN,
      ],
    )
  })
  const pieces = complement(range, intervals, COINCIDENCE_TOLERANCE_MM / round.radius)
  if (round.kind === "circle") return circlePieces(round, pieces)
  return pieces.map(([from, to]) => ({ ...round, startAngle: from, endAngle: to }))
}

/** Rejoins the piece that wraps through angle zero so a circle never splits at its seam. */
function circlePieces(circle: Round, pieces: readonly Interval[]): DrawingCurve[] {
  const first = pieces[0]
  const last = pieces.at(-1)
  if (!first || !last) return []
  if (first[0] === 0 && first[1] === FULL_TURN) return [circle]
  const wrapped: readonly Interval[] =
    pieces.length > 1 && first[0] === 0 && last[1] === FULL_TURN
      ? [...pieces.slice(1, -1), [last[0], first[1] + FULL_TURN]]
      : pieces
  return wrapped.map(([from, to]) => ({
    kind: "arc",
    center: circle.center,
    radius: circle.radius,
    startAngle: from,
    endAngle: to,
  }))
}

function samePoints(left: readonly Point[], right: readonly Point[]) {
  return (
    left.length === right.length &&
    left.every((point, index) => {
      const other = right[index]
      return (
        other !== undefined &&
        Math.hypot(point[0] - other[0], point[1] - other[1]) <= COINCIDENCE_TOLERANCE_MM
      )
    })
  )
}

function polylineCovered(polyline: Polyline, candidates: readonly DrawingCurve[]) {
  return candidates.some(
    (candidate) =>
      candidate.kind === "polyline" &&
      (samePoints(polyline.points, candidate.points) ||
        samePoints(polyline.points, [...candidate.points].reverse())),
  )
}

/** Parts of `range` not covered by the merged intervals, ignoring slivers within `tolerance`. */
function complement(range: Interval, intervals: readonly Interval[], tolerance: number) {
  const clipped = intervals
    .map(([from, to]): Interval => [Math.max(from, range[0]), Math.min(to, range[1])])
    .filter(([from, to]) => to - from > 0)
    .sort((left, right) => left[0] - right[0])
  const pieces: Interval[] = []
  let cursor = range[0]
  for (const [from, to] of clipped) {
    if (from - cursor > tolerance) pieces.push([cursor, from])
    cursor = Math.max(cursor, to)
  }
  if (range[1] - cursor > tolerance) pieces.push([cursor, range[1]])
  return pieces
}

function indexCellSize(edges: readonly DrawingEdge[]) {
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
  return Number.isFinite(span) ? Math.max(span / 32, 0.01) : 1
}

/** Uniform grid over curve bounds so coverage queries stay near-linear for large views. */
class CurveIndex {
  readonly #curves: DrawingCurve[] = []
  readonly #cells = new Map<string, number[]>()
  readonly #cellSize: number

  constructor(cellSize: number) {
    this.#cellSize = cellSize
  }

  add(curve: DrawingCurve) {
    const index = this.#curves.push(curve) - 1
    this.#visitCells(curveBox(curve), (key) => {
      const bucket = this.#cells.get(key)
      if (bucket) bucket.push(index)
      else this.#cells.set(key, [index])
    })
  }

  /** Curves whose bounds touch `box` expanded by the coincidence tolerance, in insertion order. */
  near(box: Box): DrawingCurve[] {
    const found = new Set<number>()
    const expanded: Box = [
      box[0] - COINCIDENCE_TOLERANCE_MM,
      box[1] - COINCIDENCE_TOLERANCE_MM,
      box[2] + COINCIDENCE_TOLERANCE_MM,
      box[3] + COINCIDENCE_TOLERANCE_MM,
    ]
    this.#visitCells(expanded, (key) => {
      for (const index of this.#cells.get(key) ?? []) found.add(index)
    })
    return [...found]
      .sort((left, right) => left - right)
      .flatMap((index) => {
        const curve = this.#curves[index]
        return curve && boxesTouch(curveBox(curve), expanded) ? [curve] : []
      })
  }

  #visitCells(box: Box, visit: (key: string) => void) {
    const cell = (value: number) => Math.floor(value / this.#cellSize)
    for (let x = cell(box[0]); x <= cell(box[2]); x += 1)
      for (let y = cell(box[1]); y <= cell(box[3]); y += 1) visit(`${x}:${y}`)
  }
}

function boxesTouch(left: Box, right: Box) {
  return left[0] <= right[2] && right[0] <= left[2] && left[1] <= right[3] && right[1] <= left[3]
}

function curveBox(curve: DrawingCurve): Box {
  const points: readonly Point[] =
    curve.kind === "line"
      ? [curve.start, curve.end]
      : curve.kind === "polyline"
        ? curve.points
        : [
            [curve.center[0] - curve.radius, curve.center[1] - curve.radius],
            [curve.center[0] + curve.radius, curve.center[1] + curve.radius],
          ]
  const xs = points.map((point) => point[0])
  const ys = points.map((point) => point[1])
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]
}

/** Perpendicular distance from `point` to the infinite line through `origin` along unit `direction`. */
function lineDistance(point: Point, origin: Point, direction: Point) {
  return Math.abs((point[0] - origin[0]) * direction[1] - (point[1] - origin[1]) * direction[0])
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
