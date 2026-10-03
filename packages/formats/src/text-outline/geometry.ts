import type { SketchTextOutlinePoint, SketchTextOutlineSegment } from "./contracts"

export function elevateQuadratic(
  start: SketchTextOutlinePoint,
  control: SketchTextOutlinePoint,
  end: SketchTextOutlinePoint,
): SketchTextOutlineSegment {
  return {
    kind: "cubic-bezier",
    start,
    control1: [
      start[0] + (2 / 3) * (control[0] - start[0]),
      start[1] + (2 / 3) * (control[1] - start[1]),
    ],
    control2: [end[0] + (2 / 3) * (control[0] - end[0]), end[1] + (2 / 3) * (control[1] - end[1])],
    end,
  }
}

function stationaryParameters(p0: number, p1: number, p2: number, p3: number): number[] {
  const a = -p0 + 3 * p1 - 3 * p2 + p3
  const b = 2 * (p0 - 2 * p1 + p2)
  const c = p1 - p0
  if (a === 0) return b === 0 ? [] : [-c / b]
  const discriminant = b * b - 4 * a * c
  if (discriminant < 0) return []
  if (discriminant === 0) return [-b / (2 * a)]
  const q = -0.5 * (b + (b < 0 ? -1 : 1) * Math.sqrt(discriminant))
  return [q / a, c / q]
}

function cubicCoordinate(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const u = 1 - t
  return u * u * u * p0 + 3 * u * u * t * p1 + 3 * u * t * t * p2 + t * t * t * p3
}

function axisExtrema(segment: SketchTextOutlineSegment, axis: 0 | 1): number[] {
  const values = [segment.start[axis], segment.end[axis]]
  if (segment.kind === "line") return values
  for (const t of stationaryParameters(
    segment.start[axis],
    segment.control1[axis],
    segment.control2[axis],
    segment.end[axis],
  )) {
    if (t > 0 && t < 1)
      values.push(
        cubicCoordinate(
          segment.start[axis],
          segment.control1[axis],
          segment.control2[axis],
          segment.end[axis],
          t,
        ),
      )
  }
  return values
}

export function outlineBounds(segments: readonly SketchTextOutlineSegment[]): {
  min: SketchTextOutlinePoint
  max: SketchTextOutlinePoint
} {
  const min: SketchTextOutlinePoint = [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY]
  const max: SketchTextOutlinePoint = [Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY]
  for (const segment of segments) {
    for (const axis of [0, 1] as const) {
      const values = axisExtrema(segment, axis)
      min[axis] = Math.min(min[axis], ...values)
      max[axis] = Math.max(max[axis], ...values)
    }
  }
  return { min, max }
}

export function translateOutlineSegment(
  segment: SketchTextOutlineSegment,
  offset: SketchTextOutlinePoint,
): SketchTextOutlineSegment {
  const move = (point: SketchTextOutlinePoint): SketchTextOutlinePoint => [
    point[0] + offset[0] || 0,
    point[1] + offset[1] || 0,
  ]
  if (segment.kind === "line")
    return { kind: "line", start: move(segment.start), end: move(segment.end) }
  return {
    kind: "cubic-bezier",
    start: move(segment.start),
    control1: move(segment.control1),
    control2: move(segment.control2),
    end: move(segment.end),
  }
}
