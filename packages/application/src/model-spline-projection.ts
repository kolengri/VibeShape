import type { SketchPoint2 } from "@vibeshape/domain"
import { projectWorldPointToSupport, type SupportFrame } from "./support-frame"

type Vector3 = readonly [number, number, number]

/**
 * A non-analytical model edge projects only when it lies in a plane parallel to the support, so the
 * orthogonal projection is an isometry and preserves the published fitting tolerance.
 */
export const MODEL_SPLINE_PARALLEL_TOLERANCE_MM = 1e-4

export type ModelSplineProjection =
  | Readonly<{ ok: true; poles: readonly SketchPoint2[]; segmentCount: number }>
  | Readonly<{
      ok: false
      reason: "ambiguous-ends" | "degenerate" | "not-parallel" | "segment-count"
    }>

function supportHeight(frame: SupportFrame, point: Vector3) {
  return (
    (point[0] - frame.origin[0]) * frame.normal[0] +
    (point[1] - frame.origin[1]) * frame.normal[1] +
    (point[2] - frame.origin[2]) * frame.normal[2]
  )
}

function lerp(a: SketchPoint2, b: SketchPoint2, t: number): SketchPoint2 {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }
}

/** Exact de Casteljau split of one cubic at `t`. */
function splitCubic(poles: readonly SketchPoint2[], t: number) {
  const [p0, p1, p2, p3] = poles as readonly [
    SketchPoint2,
    SketchPoint2,
    SketchPoint2,
    SketchPoint2,
  ]
  const a = lerp(p0, p1, t)
  const b = lerp(p1, p2, t)
  const c = lerp(p2, p3, t)
  const d = lerp(a, b, t)
  const e = lerp(b, c, t)
  const f = lerp(d, e, t)
  return { left: [p0, a, d, f], right: [f, e, c, p3] } as const
}

/** Splits one cubic into `pieces` equal-parameter cubics that trace exactly the same curve. */
function subdivideCubic(poles: readonly SketchPoint2[], pieces: number): SketchPoint2[] {
  const result: SketchPoint2[] = [poles[0] as SketchPoint2]
  let remainder: readonly SketchPoint2[] = poles
  for (let remaining = pieces; remaining > 1; remaining -= 1) {
    const { left, right } = splitCubic(remainder, 1 / remaining)
    result.push(left[1], left[2], left[3])
    remainder = right
  }
  result.push(
    remainder[1] as SketchPoint2,
    remainder[2] as SketchPoint2,
    remainder[3] as SketchPoint2,
  )
  return result
}

/**
 * Expands a published chain to exactly `segmentCount` segments. Earlier segments receive the
 * remainder, so the split is deterministic; subdivision never changes the traced curve.
 */
export function expandBezierChain(
  poles: readonly SketchPoint2[],
  segmentCount: number,
): readonly SketchPoint2[] | null {
  const published = (poles.length - 1) / 3
  if (!Number.isInteger(published) || published < 1 || segmentCount < published) return null
  const base = Math.floor(segmentCount / published)
  const extra = segmentCount % published
  const result: SketchPoint2[] = [poles[0] as SketchPoint2]
  for (let segment = 0; segment < published; segment += 1) {
    const pieces = subdivideCubic(
      poles.slice(segment * 3, segment * 3 + 4),
      base + (segment < extra ? 1 : 0),
    )
    result.push(...pieces.slice(1))
  }
  return result
}

export type ModelSplineEndpointAnchors = readonly [Vector3, Vector3]

function distance(a: Vector3, b: Vector3) {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])
}

/**
 * Orients a published chain so its ends correspond to the stored start and end anchors, choosing
 * the pairing with the smaller summed displacement. A published orientation is never trusted: the
 * source parameterization or a canonical rule can flip it after any small edit. A closed chain
 * needs no pairing because both ends are its seam. When both pairings are within one thousandth of
 * the chord (at least 1e-6 mm) of each other, the correspondence is ambiguous and fails closed.
 */
export function orientChainToAnchors(
  worldPoles: readonly Vector3[],
  anchors: ModelSplineEndpointAnchors,
): readonly Vector3[] | null {
  const start = worldPoles[0] as Vector3
  const end = worldPoles.at(-1) as Vector3
  const chord = distance(start, end)
  if (chord <= 1e-9) return worldPoles
  const direct = distance(start, anchors[0]) + distance(end, anchors[1])
  const swapped = distance(end, anchors[0]) + distance(start, anchors[1])
  if (Math.abs(direct - swapped) <= Math.max(1e-6, chord * 1e-3)) return null
  return direct < swapped ? worldPoles : [...worldPoles].reverse()
}

/**
 * Projects a published world-space cubic Bezier chain onto a parallel sketch support and expands it
 * to the persisted segment count. Tilted or spatial edges and chains that now need more segments
 * than the persisted identities provide fail closed.
 */
export function projectWorldBezierChainToSupport(
  frame: SupportFrame,
  publishedPoles: readonly Vector3[],
  segmentCount: number = (publishedPoles.length - 1) / 3,
  anchors?: ModelSplineEndpointAnchors,
): ModelSplineProjection {
  const worldPoles = anchors ? orientChainToAnchors(publishedPoles, anchors) : publishedPoles
  if (!worldPoles) return { ok: false, reason: "ambiguous-ends" }
  const heights = worldPoles.map((pole) => supportHeight(frame, pole))
  if (Math.max(...heights) - Math.min(...heights) > MODEL_SPLINE_PARALLEL_TOLERANCE_MM) {
    return { ok: false, reason: "not-parallel" }
  }
  const projected = worldPoles.map((pole) => projectWorldPointToSupport(frame, pole))
  const [first] = projected
  if (!first || projected.every((pole) => Math.hypot(pole.x - first.x, pole.y - first.y) <= 1e-9)) {
    return { ok: false, reason: "degenerate" }
  }
  const poles = expandBezierChain(projected, segmentCount)
  return poles ? { ok: true, poles, segmentCount } : { ok: false, reason: "segment-count" }
}

/** Disposable display samples for candidate highlighting; never solver or kernel input. */
export function sampleBezierChain(poles: readonly SketchPoint2[], samplesPerSegment = 16) {
  const result: SketchPoint2[] = []
  const segments = (poles.length - 1) / 3
  for (let segment = 0; segment < segments; segment += 1) {
    const [p0, p1, p2, p3] = poles.slice(segment * 3, segment * 3 + 4) as [
      SketchPoint2,
      SketchPoint2,
      SketchPoint2,
      SketchPoint2,
    ]
    for (let sample = segment === 0 ? 0 : 1; sample <= samplesPerSegment; sample += 1) {
      const t = sample / samplesPerSegment
      const s = 1 - t
      const weights = [s * s * s, 3 * s * s * t, 3 * s * t * t, t * t * t] as const
      result.push({
        x: weights[0] * p0.x + weights[1] * p1.x + weights[2] * p2.x + weights[3] * p3.x,
        y: weights[0] * p0.y + weights[1] * p1.y + weights[2] * p2.y + weights[3] * p3.y,
      })
    }
  }
  return result
}
