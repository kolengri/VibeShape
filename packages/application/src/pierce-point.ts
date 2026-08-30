import { projectWorldPointToSupport, type SupportFrame, type SupportPoint2 } from "./support-frame"

export type WorldPoint3 = readonly [number, number, number]

const PIERCE_TOLERANCE = 1e-9

/** Intersects a finite world-space segment with a support plane, failing closed on non-transverse input. */
export function intersectBoundedLineWithSupportPlane(
  start: WorldPoint3,
  end: WorldPoint3,
  target: SupportFrame,
): SupportPoint2 | null {
  if (![...start, ...end, ...target.origin, ...target.normal].every(Number.isFinite)) return null
  const direction: WorldPoint3 = [end[0] - start[0], end[1] - start[1], end[2] - start[2]]
  const length = Math.hypot(...direction)
  if (!Number.isFinite(length) || length <= PIERCE_TOLERANCE) return null
  const offset: WorldPoint3 = [
    start[0] - target.origin[0],
    start[1] - target.origin[1],
    start[2] - target.origin[2],
  ]
  const denominator =
    direction[0] * target.normal[0] +
    direction[1] * target.normal[1] +
    direction[2] * target.normal[2]
  if (!Number.isFinite(denominator) || Math.abs(denominator) <= PIERCE_TOLERANCE * length)
    return null
  const numerator = -(
    offset[0] * target.normal[0] +
    offset[1] * target.normal[1] +
    offset[2] * target.normal[2]
  )
  const parameter = numerator / denominator
  if (
    !Number.isFinite(parameter) ||
    parameter < -PIERCE_TOLERANCE ||
    parameter > 1 + PIERCE_TOLERANCE
  )
    return null
  const clamped = Math.min(1, Math.max(0, parameter))
  return projectWorldPointToSupport(target, [
    start[0] + direction[0] * clamped,
    start[1] + direction[1] * clamped,
    start[2] + direction[2] * clamped,
  ])
}
