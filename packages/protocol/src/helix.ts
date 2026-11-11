import { isError } from "is-what"
import { z } from "zod"
import { analyticalProfileSchema } from "./sweep-loft"

type Vector = readonly [number, number, number]
const coordinate = z.number().finite().min(-100_000).max(100_000)
const component = z.number().finite().min(-1).max(1)
const LINEAR_TOLERANCE = 1e-6
/** Matches the analytical Sweep start-frame tolerance. */
const PARALLEL_TOLERANCE = 1e-8

export const HELIX_CONTENT_MAX_TURNS = 50
export const helixContentSchema = z
  .object({
    origin: z.tuple([coordinate, coordinate, coordinate]),
    direction: z
      .tuple([component, component, component])
      .refine(
        (direction) => Math.abs(Math.hypot(...direction) - 1) <= 1e-8,
        "Helix axis directions must be normalized.",
      ),
    handedness: z.enum(["right", "left"]),
    radius: z.number().finite().min(0.01).max(10_000),
    pitch: z.number().finite().min(0.01).max(10_000),
    turns: z.number().finite().min(0.05).max(HELIX_CONTENT_MAX_TURNS),
    startAngle: z
      .number()
      .finite()
      .min(-2 * Math.PI)
      .max(2 * Math.PI),
  })
  .strict()
export type HelixContent = Readonly<z.infer<typeof helixContentSchema>>

/** Right-handed vector product, written component-cyclically. */
function cross(a: Vector, b: Vector): Vector {
  const component = (i: 0 | 1 | 2) => {
    const j = ((i + 1) % 3) as 0 | 1 | 2
    const k = ((i + 2) % 3) as 0 | 1 | 2
    return a[j] * b[k] - a[k] * b[j]
  }
  return [component(0), component(1), component(2)]
}
function dot(a: Vector, b: Vector) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}
function combine(a: Vector, ka: number, b: Vector, kb: number): Vector {
  return [a[0] * ka + b[0] * kb, a[1] * ka + b[1] * kb, a[2] * ka + b[2] * kb]
}

/**
 * Right-handed helix frame. The zero-angle radial direction projects a cyclic seed axis
 * (X:+Y, Y:+Z, Z:+X), matching the modeled Thread phase convention; the start angle then
 * rotates it about the axis. `radial` and `tangential` span the plane normal to `axis`.
 */
export function helixFrame(helix: Pick<HelixContent, "direction" | "startAngle">) {
  const axis = helix.direction
  const seed: Vector =
    Math.abs(axis[0]) >= 0.8 ? [0, 1, 0] : Math.abs(axis[1]) >= 0.8 ? [0, 0, 1] : [1, 0, 0]
  const projected = combine(seed, 1, axis, -dot(seed, axis))
  const length = Math.hypot(...projected)
  const zero: Vector = [projected[0] / length, projected[1] / length, projected[2] / length]
  const quarter = cross(axis, zero)
  const cos = Math.cos(helix.startAngle)
  const sin = Math.sin(helix.startAngle)
  const radial = combine(zero, cos, quarter, sin)
  return { axis, radial, tangential: cross(axis, radial) }
}

/** Point and unit tangent at the helix start; the tangent follows authored handedness. */
export function helixStart(helix: HelixContent) {
  const frame = helixFrame(helix)
  const sign = helix.handedness === "right" ? 1 : -1
  const circumference = 2 * Math.PI * helix.radius
  const length = Math.hypot(circumference, helix.pitch)
  const tangent = combine(
    frame.tangential,
    (sign * circumference) / length,
    frame.axis,
    helix.pitch / length,
  )
  return { frame, point: combine(helix.origin, 1, frame.radial, helix.radius), tangent }
}

/** Point at a parameter measured in turns from the start. */
export function helixPoint(helix: HelixContent, turns: number): Vector {
  const frame = helixFrame(helix)
  const angle = (helix.handedness === "right" ? 1 : -1) * 2 * Math.PI * turns
  const radial = combine(frame.radial, Math.cos(angle), frame.tangential, Math.sin(angle))
  return combine(combine(helix.origin, 1, radial, helix.radius), 1, frame.axis, helix.pitch * turns)
}

export function helixLength(helix: Pick<HelixContent, "radius" | "pitch" | "turns">) {
  return helix.turns * Math.hypot(2 * Math.PI * helix.radius, helix.pitch)
}

/**
 * Axial coordinate, in the start meridian half-plane, of a point given in the local helix frame
 * (x radial, y tangential, a axial). The screw motion carries the point back to angle zero:
 * `z = a - sign·(p/2π)·atan2(y, x)`. Points must stay on the positive radial side of the axis.
 */
export function helixMeridianAxial(
  point: Readonly<{ x: number; y: number; a: number }>,
  pitch: number,
  handedness: HelixContent["handedness"],
) {
  if (!(point.x > 0)) throw new Error("The helical section must not reach the helix axis.")
  const sign = handedness === "right" ? 1 : -1
  return point.a - (sign * pitch * Math.atan2(point.y, point.x)) / (2 * Math.PI)
}

/** Meridian span of boundary points; adjacent turns stay apart only when the pitch exceeds it. */
export function helixMeridianSpan(
  points: readonly Readonly<{ x: number; y: number; a: number }>[],
  pitch: number,
  handedness: HelixContent["handedness"],
) {
  let minimum = Number.POSITIVE_INFINITY
  let maximum = Number.NEGATIVE_INFINITY
  for (const point of points) {
    const z = helixMeridianAxial(point, pitch, handedness)
    minimum = Math.min(minimum, z)
    maximum = Math.max(maximum, z)
  }
  return maximum - minimum
}

/**
 * A right-handed section point `n` along the inward principal normal and `b` along the binormal
 * lies at x = R − n, y = −b·p/L, a = b·2πR/L in the local frame, where L = √((2πR)² + p²).
 * Points nearer the axis have a steeper local lead, so the span exceeds `s / cos(lead angle)`.
 */
function coilMeridianAxial(radius: number, pitch: number, n: number, b: number) {
  const circumference = 2 * Math.PI * radius
  const length = Math.hypot(circumference, pitch)
  return helixMeridianAxial(
    { x: radius - n, y: (-b * pitch) / length, a: (b * circumference) / length },
    pitch,
    "right",
  )
}

/** Maximizes a function on [low, high] by dense sampling then golden-section refinement. */
function maximizeOnInterval(f: (value: number) => number, low: number, high: number) {
  const samples = 96
  let best = low
  for (let index = 1; index <= samples; index += 1) {
    const value = low + ((high - low) * index) / samples
    if (f(value) > f(best)) best = value
  }
  const step = (high - low) / samples
  let [left, right] = [Math.max(low, best - step), Math.min(high, best + step)]
  const ratio = (Math.sqrt(5) - 1) / 2
  for (let iteration = 0; iteration < 60; iteration += 1) {
    const first = right - ratio * (right - left)
    const second = left + ratio * (right - left)
    if (f(first) < f(second)) left = first
    else right = second
  }
  return Math.max(f(best), f((left + right) / 2))
}

/** Exact meridian span of a centered coil section; the section is symmetric in the binormal. */
export function coilSectionMeridianSpan(
  radius: number,
  pitch: number,
  section: CoilSectionContent,
) {
  if (section.kind === "rectangular")
    return 2 * coilMeridianAxial(radius, pitch, section.width / 2, section.height / 2)
  const r = section.diameter / 2
  return (
    2 *
    maximizeOnInterval(
      (angle) => coilMeridianAxial(radius, pitch, r * Math.cos(angle), r * Math.sin(angle)),
      0,
      Math.PI,
    )
  )
}

/** Smallest accepted pitch (to bisection precision), or Infinity when none exists. */
export function minimumCoilPitch(radius: number, section: CoilSectionContent) {
  if (coilSectionExtent(section).radial / 2 >= radius) return Number.POSITIVE_INFINITY
  const clear = (pitch: number) => pitch > coilSectionMeridianSpan(radius, pitch, section)
  let high = Math.max(coilSectionExtent(section).axial, 1e-6)
  while (!clear(high)) {
    high *= 2
    if (high > 1e7) return Number.POSITIVE_INFINITY
  }
  let low = 0
  for (let iteration = 0; iteration < 80; iteration += 1) {
    const middle = (low + high) / 2
    if (clear(middle)) high = middle
    else low = middle
  }
  return high
}

const sectionSize = z.number().finite().min(0.001).max(10_000)
export const coilSectionContentSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("circular"), diameter: sectionSize }).strict(),
  z.object({ kind: z.literal("rectangular"), width: sectionSize, height: sectionSize }).strict(),
])
export type CoilSectionContent = Readonly<z.infer<typeof coilSectionContentSchema>>
export function coilSectionExtent(section: CoilSectionContent) {
  return section.kind === "circular"
    ? { radial: section.diameter, axial: section.diameter }
    : { radial: section.width, axial: section.height }
}

const supportInputIndex = z.number().int().min(0).max(16)
export const coilFeatureContentParametersSchema = z
  .object({
    helix: helixContentSchema,
    section: coilSectionContentSchema,
    operation: z.enum(["new", "add", "remove", "intersect"]),
    supportInputIndex: supportInputIndex.optional(),
  })
  .strict()
  .superRefine(({ helix, section }, context) => {
    const extent = coilSectionExtent(section)
    if (extent.radial / 2 >= helix.radius)
      context.addIssue({
        code: "custom",
        path: ["section"],
        message: "The coil section must not reach the helix axis.",
      })
    else if (helix.pitch <= coilSectionMeridianSpan(helix.radius, helix.pitch, section))
      context.addIssue({
        code: "custom",
        path: ["helix", "pitch"],
        message: "Adjacent coil turns would intersect at this pitch and section size.",
      })
  })
export type CoilFeatureContentParameters = Readonly<
  z.infer<typeof coilFeatureContentParametersSchema>
>

/** The authored profile plane must contain the helix start and be normal to its tangent. */
export function validateHelicalSweepGeometry(
  profile: Readonly<{ frame: Readonly<{ origin: Vector; normal: Vector }> }>,
  helix: HelixContent,
) {
  const start = helixStart(helix)
  const planeDistance = dot(profile.frame.normal, combine(start.point, 1, profile.frame.origin, -1))
  const parallel = Math.abs(dot(profile.frame.normal, start.tangent))
  if (Math.abs(planeDistance) > LINEAR_TOLERANCE || parallel < 1 - PARALLEL_TOLERANCE)
    throw new Error(
      "Sweep profile plane must pass through the helix start and be normal to its tangent.",
    )
}

export const sweepFeatureContentParametersV2Schema = z
  .object({
    profile: analyticalProfileSchema,
    helix: helixContentSchema,
    supportInputIndex: supportInputIndex.optional(),
  })
  .strict()
  .superRefine(({ profile, helix }, context) => {
    try {
      validateHelicalSweepGeometry(profile, helix)
    } catch (error) {
      context.addIssue({
        code: "custom",
        message: isError(error) ? error.message : "Invalid helical sweep.",
      })
    }
  })
export type SweepFeatureContentParametersV2 = Readonly<
  z.infer<typeof sweepFeatureContentParametersV2Schema>
>
