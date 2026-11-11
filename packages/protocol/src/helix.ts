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
 * A section of axial size `s`, normal to the helix tangent, spans `s / cos(lead angle)` in the
 * meridian plane; adjacent turns stay apart only when the pitch exceeds that span.
 */
export function minimumHelixPitchForSection(radius: number, axialSectionSize: number) {
  const circumference = 2 * Math.PI * radius
  if (axialSectionSize >= circumference) return Number.POSITIVE_INFINITY
  return (axialSectionSize * circumference) / Math.sqrt(circumference ** 2 - axialSectionSize ** 2)
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
    if (helix.pitch <= minimumHelixPitchForSection(helix.radius, extent.axial))
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
