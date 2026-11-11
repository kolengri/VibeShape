import {
  DRAWING_ANGULAR_TOLERANCE_RAD,
  DRAWING_CHORD_TOLERANCE_MM,
  type DrawingCurve,
  type DrawingEdge,
  MAX_DRAWING_CURVE_POINTS,
  MAX_DRAWING_VIEW_EDGES,
} from "@vibeshape/protocol"
import { DrawingBudgetError } from "./drawing-budget"
import { type CoverageStats, CurveIndex, curvesExtent } from "./drawing-curve-index"
import { complement, type Interval, uncoveredPolylineRuns } from "./drawing-segment-coverage"

type Point = readonly [number, number]
type Line = Extract<DrawingCurve, { kind: "line" }>
type Round = Extract<DrawingCurve, { kind: "circle" | "arc" }>
type Polyline = Extract<DrawingCurve, { kind: "polyline" }>
type CoveringPiece = Readonly<{ start: Point; end: Point }>

/** Distance within which projected edges are treated as the same drawn line. */
const COINCIDENCE_TOLERANCE_MM = 1e-4
/**
 * Two samplings of the same projected curve each stay within the chordal tolerance of it, so a
 * sampled point or chord midpoint of one lies within twice that tolerance of the other.
 */
const SAMPLED_COVERAGE_TOLERANCE_MM = 2 * DRAWING_CHORD_TOLERANCE_MM + COINCIDENCE_TOLERANCE_MM
/**
 * Every sampled chord, HLR's and the cleanup's own circle chords alike, stays within the angular
 * tolerance of the curve's tangent, so two samplings of one curve differ in direction by at most
 * twice that where they overlap. A covering segment turned further than this crosses the curve;
 * how long it stays within the distance tolerance only depends on the crossing angle.
 */
const CROSSING_ANGLE_RAD = 2 * DRAWING_ANGULAR_TOLERANCE_RAD + 0.02
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
 * keeps exactly its uncovered pieces. Sampled polylines are clipped continuously against the
 * tolerance capsules of near-parallel covering segments (see `uncoveredPolyline`). `stats`
 * receives work counters for complexity checks.
 */
export function suppressCoincidentEdges(
  edges: readonly DrawingEdge[],
  stats?: CoverageStats,
): DrawingEdge[] {
  const extent = curvesExtent(edges.map(({ curve }) => curve))
  const options = {
    margin: SAMPLED_COVERAGE_TOLERANCE_MM + COINCIDENCE_TOLERANCE_MM,
    chords: { radius: SAMPLED_COVERAGE_TOLERANCE_MM, turn: 2 * DRAWING_ANGULAR_TOLERANCE_RAD },
    stats,
  }
  const visible = new CurveIndex(extent, options)
  for (const edge of edges) if (edge.visibility === "visible") visible.add(edge.curve)
  const keptVisible = new CurveIndex(extent, options)
  const keptHidden = new CurveIndex(extent, options)
  const kept: DrawingEdge[] = []
  // Splitting can add edges, so the view budget also applies to the cleaned result.
  const keep = (edge: DrawingEdge, curve: DrawingCurve) => {
    if (kept.length >= MAX_DRAWING_VIEW_EDGES)
      throw new DrawingBudgetError(
        `A drawing view has more than ${MAX_DRAWING_VIEW_EDGES.toLocaleString("en-US")} edges after hidden-line cleanup; draw fewer parts or views.`,
      )
    kept.push({ ...edge, curve })
  }
  for (const edge of edges) {
    if (edge.visibility !== "visible") continue
    for (const curve of uncoveredPieces(edge.curve, [keptVisible], stats)) {
      keptVisible.add(curve)
      keep(edge, curve)
    }
  }
  for (const edge of edges) {
    if (edge.visibility !== "hidden") continue
    for (const curve of uncoveredPieces(edge.curve, [visible, keptHidden], stats)) {
      keptHidden.add(curve)
      keep(edge, curve)
    }
  }
  return kept
}

function uncoveredPieces(
  curve: DrawingCurve,
  covers: readonly CurveIndex[],
  stats: CoverageStats | undefined,
): DrawingCurve[] {
  if (curve.kind === "polyline") return uncoveredPolyline(curve, covers, stats)
  if (curve.kind === "line")
    return uncoveredLine(
      curve,
      covers.flatMap((index) =>
        index.nearSegments(curve.start, curve.end).filter(({ chord }) => !chord),
      ),
    )
  return uncoveredRound(
    curve,
    covers.flatMap((index) => index.concentric(curve.center, COINCIDENCE_TOLERANCE_MM)),
  )
}

function uncoveredLine(line: Line, candidates: readonly CoveringPiece[]): DrawingCurve[] {
  const dx = line.end[0] - line.start[0]
  const dy = line.end[1] - line.start[1]
  const length = Math.hypot(dx, dy)
  if (length <= COINCIDENCE_TOLERANCE_MM) return []
  const direction: Point = [dx / length, dy / length]
  const parameter = (point: Point) =>
    (point[0] - line.start[0]) * direction[0] + (point[1] - line.start[1]) * direction[1]
  const intervals = candidates.flatMap((candidate): Interval[] => {
    if (!collinear(line, direction, candidate)) return []
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

/**
 * Symmetric collinearity: the candidate lies on the line's extension, or the line lies on the
 * candidate's extension. Checking only one side misses a short, slightly tilted segment on a long
 * covering line.
 */
function collinear(line: Line, direction: Point, candidate: CoveringPiece) {
  const near = (point: Point, origin: Point, axis: Point) =>
    lineDistance(point, origin, axis) <= COINCIDENCE_TOLERANCE_MM
  if (near(candidate.start, line.start, direction) && near(candidate.end, line.start, direction))
    return true
  const length = Math.hypot(
    candidate.end[0] - candidate.start[0],
    candidate.end[1] - candidate.start[1],
  )
  if (length <= COINCIDENCE_TOLERANCE_MM) return false
  const axis: Point = [
    (candidate.end[0] - candidate.start[0]) / length,
    (candidate.end[1] - candidate.start[1]) / length,
  ]
  return near(line.start, candidate.start, axis) && near(line.end, candidate.start, axis)
}

function sameRound(left: Round, right: Round) {
  return (
    Math.hypot(left.center[0] - right.center[0], left.center[1] - right.center[1]) <=
      COINCIDENCE_TOLERANCE_MM && Math.abs(left.radius - right.radius) <= COINCIDENCE_TOLERANCE_MM
  )
}

function uncoveredRound(round: Round, candidates: readonly Round[]): DrawingCurve[] {
  const range: Interval = round.kind === "arc" ? [round.startAngle, round.endAngle] : [0, FULL_TURN]
  const intervals = candidates.flatMap((candidate): Interval[] => {
    if (!sameRound(round, candidate)) return []
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

/**
 * Continuous coverage of a sampled polyline: each segment is clipped against the tolerance
 * capsules of nearby near-parallel covering segments (lines, polyline segments, and the cached
 * chords of circles and arcs), and only the uncovered runs remain, stitched across vertices.
 * Crossing edges remove nothing.
 */
function uncoveredPolyline(
  polyline: Polyline,
  covers: readonly CurveIndex[],
  stats: CoverageStats | undefined,
): DrawingCurve[] {
  const radius = SAMPLED_COVERAGE_TOLERANCE_MM
  const runs = uncoveredPolylineRuns(polyline.points, {
    near: (start, end) =>
      covers.flatMap((index) =>
        index.nearSegments(start, end).map((piece): [Point, Point] => [piece.start, piece.end]),
      ),
    radius,
    maximumAngle: CROSSING_ANGLE_RAD,
    // A near-parallel graze shorter than a few tolerances is contact, not a shared stretch.
    minimumCovered: 4 * radius,
    dust: radius,
    stats,
  })
  return runs === null ? [polyline] : runs.flatMap(splitPolyline)
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
