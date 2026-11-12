type Point = readonly [number, number]
export type Interval = readonly [start: number, end: number]

const EPSILON = 1e-12

/** Parts of `range` not covered by the merged intervals, ignoring slivers within `tolerance`. */
export function complement(range: Interval, intervals: readonly Interval[], tolerance: number) {
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

/** Parameters t on `origin + t·direction` satisfying lower ≤ a0 + t·a1 ≤ upper. */
function linearRange(a0: number, a1: number, lower: number, upper: number): Interval | null {
  if (Math.abs(a1) < EPSILON) return a0 >= lower && a0 <= upper ? [-Infinity, Infinity] : null
  const first = (lower - a0) / a1
  const second = (upper - a0) / a1
  return [Math.min(first, second), Math.max(first, second)]
}

function intersect(left: Interval | null, right: Interval | null): Interval | null {
  if (!left || !right) return null
  const from = Math.max(left[0], right[0])
  const to = Math.min(left[1], right[1])
  return from <= to ? [from, to] : null
}

function discRange(
  origin: Point,
  direction: Point,
  center: Point,
  radius: number,
): Interval | null {
  const wx = origin[0] - center[0]
  const wy = origin[1] - center[1]
  const b = direction[0] * wx + direction[1] * wy
  const discriminant = b * b - (wx * wx + wy * wy - radius * radius)
  if (discriminant < 0) return null
  const root = Math.sqrt(discriminant)
  return [-b - root, -b + root]
}

/**
 * Parameters of the line `origin + t·direction` (unit direction) inside the capsule of radius
 * `radius` around segment start→end: the segment's slab plus the discs at both ends. The capsule
 * is convex, so the result is one interval.
 */
function capsuleRange(
  origin: Point,
  direction: Point,
  start: Point,
  end: Point,
  radius: number,
): Interval | null {
  const parts = [
    discRange(origin, direction, start, radius),
    discRange(origin, direction, end, radius),
  ]
  const length = Math.hypot(end[0] - start[0], end[1] - start[1])
  if (length > EPSILON) {
    const axis: Point = [(end[0] - start[0]) / length, (end[1] - start[1]) / length]
    const offset: Point = [origin[0] - start[0], origin[1] - start[1]]
    const along = linearRange(
      offset[0] * axis[0] + offset[1] * axis[1],
      direction[0] * axis[0] + direction[1] * axis[1],
      0,
      length,
    )
    const across = linearRange(
      offset[1] * axis[0] - offset[0] * axis[1],
      direction[1] * axis[0] - direction[0] * axis[1],
      -radius,
      radius,
    )
    parts.push(intersect(along, across))
  }
  const present = parts.filter((part): part is Interval => part !== null)
  if (present.length === 0) return null
  return [Math.min(...present.map(([from]) => from)), Math.max(...present.map(([, to]) => to))]
}

export type PolylineCoverage = Readonly<{
  /** Covering segments near segment start→end. */
  near: (start: Point, end: Point) => readonly (readonly [Point, Point])[]
  /** Capsule radius around each covering segment. */
  radius: number
  /** Covering segments turned further than this from a polyline segment only cross it. */
  maximumAngle: number
  /** Covered stretches no longer than this only graze the curve and hide nothing. */
  minimumCovered: number
  /** Uncovered runs no longer than this are dropped. */
  dust: number
}>

/**
 * Continuous coverage of a sampled polyline, measured along its arc length. Each segment is
 * clipped against the capsules of the near-parallel covering segments `near` returns for it;
 * steeper covering segments cross the curve rather than follow it, however long they stay inside
 * the tolerance, and cover nothing. Covered stretches are merged across vertices. The uncovered
 * stretches become point runs that reuse the original vertices. Returns null when nothing is
 * covered.
 */
export function uncoveredPolylineRuns(
  points: readonly Point[],
  coverage: PolylineCoverage,
): [number, number][][] | null {
  const offsets = [0]
  const covered: Interval[] = []
  for (let index = 0; index < points.length - 1; index += 1) {
    const start = points[index] ?? [0, 0]
    const end = points[index + 1] ?? start
    const offset = offsets[index] ?? 0
    const length = Math.hypot(end[0] - start[0], end[1] - start[1])
    offsets.push(offset + length)
    for (const [from, to] of segmentCoverage(start, end, length, coverage))
      covered.push([offset + from, offset + to])
  }
  const total = offsets.at(-1) ?? 0
  const stretches = mergeIntervals(covered, [0, total]).filter(
    ([from, to]) => to - from > coverage.minimumCovered,
  )
  if (stretches.length === 0) return null
  return complement([0, total], stretches, coverage.dust).map(([from, to]) =>
    pointsBetween(points, offsets, from, to),
  )
}

/** Parameter intervals of segment start→end inside the capsules of near-parallel covering pieces. */
function segmentCoverage(
  start: Point,
  end: Point,
  length: number,
  { near, radius, maximumAngle }: PolylineCoverage,
): Interval[] {
  if (length <= EPSILON) return []
  const direction: Point = [(end[0] - start[0]) / length, (end[1] - start[1]) / length]
  const steep = Math.sin(maximumAngle)
  return near(start, end).flatMap(([from, to]): Interval[] => {
    const span = Math.hypot(to[0] - from[0], to[1] - from[1])
    const sine = Math.abs(direction[0] * (to[1] - from[1]) - direction[1] * (to[0] - from[0]))
    if (span <= EPSILON || sine > steep * span) return []
    const range = capsuleRange(start, direction, from, to, radius)
    return range ? [[Math.max(range[0], 0), Math.min(range[1], length)]] : []
  })
}

function pointsBetween(
  points: readonly Point[],
  offsets: readonly number[],
  from: number,
  to: number,
) {
  const at = (distance: number): [number, number] => {
    const index = Math.max(0, offsets.findIndex((offset) => offset >= distance) - 1)
    const start = points[index] ?? [0, 0]
    const end = points[index + 1] ?? start
    const length = (offsets[index + 1] ?? 0) - (offsets[index] ?? 0)
    const t = length > EPSILON ? (distance - (offsets[index] ?? 0)) / length : 0
    return [start[0] + (end[0] - start[0]) * t, start[1] + (end[1] - start[1]) * t]
  }
  const inner = points.flatMap((point, index): [number, number][] => {
    const offset = offsets[index] ?? 0
    return offset > from && offset < to ? [[point[0], point[1]]] : []
  })
  const first = offsets.indexOf(from)
  const last = offsets.lastIndexOf(to)
  const startPoint = first >= 0 ? points[first] : undefined
  const endPoint = last >= 0 ? points[last] : undefined
  return [
    startPoint ? [startPoint[0], startPoint[1]] : at(from),
    ...inner,
    endPoint ? [endPoint[0], endPoint[1]] : at(to),
  ] as [number, number][]
}

/** Union of overlapping intervals clipped to `range`, sorted by start. */
function mergeIntervals(intervals: readonly Interval[], range: Interval): Interval[] {
  const sorted = intervals
    .map(([from, to]): [number, number] => [Math.max(from, range[0]), Math.min(to, range[1])])
    .filter(([from, to]) => to > from)
    .sort((left, right) => left[0] - right[0])
  const merged: [number, number][] = []
  for (const [from, to] of sorted) {
    const last = merged.at(-1)
    if (last && from <= last[1]) last[1] = Math.max(last[1], to)
    else merged.push([from, to])
  }
  return merged
}
