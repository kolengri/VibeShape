import { z } from "zod"
import type { FeatureParameterResolution, TrustedFeatureTypeHandler } from "./feature-type-registry"
import { referenceAxisSchema } from "./reference-frame"
import {
  angleQuantitySchema,
  lengthQuantitySchema,
  type Quantity,
  scalarQuantitySchema,
} from "./units"
import { resolveQuantityExpression } from "./variables"

/** Resource bound for exact pipe-shell construction along one helical spine. */
export const HELIX_MAX_TURNS = 50
export const HELIX_MIN_TURNS = 0.05
const MAX_HELIX_LENGTH = 10_000

export const helixRadiusSchema = lengthQuantitySchema.refine(
  ({ value }) => value >= 0.01 && value <= MAX_HELIX_LENGTH,
  "Helix radius must be between 0.01 and 10,000 mm.",
)
export const helixPitchSchema = lengthQuantitySchema.refine(
  ({ value }) => value >= 0.01 && value <= MAX_HELIX_LENGTH,
  "Helix pitch must be between 0.01 and 10,000 mm.",
)
export const helixTurnsSchema = scalarQuantitySchema.refine(
  ({ value }) => value >= HELIX_MIN_TURNS && value <= HELIX_MAX_TURNS,
  `Helix turns must be between ${HELIX_MIN_TURNS} and ${HELIX_MAX_TURNS}.`,
)
export const helixHeightSchema = lengthQuantitySchema.refine(
  ({ value }) => value > 0 && value <= 100_000,
  "Helix height must be positive and no greater than 100,000 mm.",
)
export const helixStartAngleSchema = angleQuantitySchema.refine(
  ({ value }) => Math.abs(value) <= 2 * Math.PI,
  "Helix start angle must remain within one revolution.",
)
export const helixExtentSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("turns"), turns: helixTurnsSchema }).strict(),
  z.object({ kind: z.literal("height"), height: helixHeightSchema }).strict(),
])
export type HelixExtent = Readonly<z.infer<typeof helixExtentSchema>>

/** Common helix intent shared by Coil and helical Sweep paths. */
export const helixFields = {
  axis: referenceAxisSchema,
  handedness: z.enum(["right", "left"]),
  radius: helixRadiusSchema,
  pitch: helixPitchSchema,
  extent: helixExtentSchema,
  startAngle: helixStartAngleSchema,
}
export type HelixParameters = Readonly<{
  [Key in keyof typeof helixFields]: z.infer<(typeof helixFields)[Key]>
}>

/** Height is the axial travel of the helix centerline; turns derive from it and the pitch. */
export function helixTurns(extent: HelixExtent, pitch: number) {
  return extent.kind === "turns" ? extent.turns.value : extent.height.value / pitch
}

/** Centered coil section in millimeters: width is radial, height is axial. */
export type CoilSectionSize = Readonly<
  { kind: "circular"; diameter: number } | { kind: "rectangular"; width: number; height: number }
>

/**
 * Axial position at which a section point (`inward` along the principal normal, `binormal` along
 * the binormal) crosses the start meridian half-plane. The point sits at radial R − inward,
 * tangential −binormal·p/L and axial binormal·2πR/L (L = √((2πR)² + p²)); the screw motion
 * carries it back by its polar angle, so points nearer the axis climb faster than `s / cos α`.
 * Mirrors `helixMeridianAxial` in the worker protocol.
 */
function sectionPointMeridianAxial(
  radius: number,
  pitch: number,
  inward: number,
  binormal: number,
) {
  const radial = radius - inward
  if (!(radial > 0)) return Number.POSITIVE_INFINITY
  const circumference = 2 * Math.PI * radius
  const length = Math.hypot(circumference, pitch)
  const angle = Math.atan2((-binormal * pitch) / length, radial)
  return (binormal * circumference) / length - (pitch * angle) / (2 * Math.PI)
}

function largestOnHalfTurn(f: (angle: number) => number) {
  const samples = 96
  let best = 0
  for (let index = 1; index <= samples; index += 1) {
    const angle = (Math.PI * index) / samples
    if (f(angle) > f(best)) best = angle
  }
  let low = Math.max(0, best - Math.PI / samples)
  let high = Math.min(Math.PI, best + Math.PI / samples)
  const golden = (Math.sqrt(5) - 1) / 2
  for (let iteration = 0; iteration < 60; iteration += 1) {
    const left = high - golden * (high - low)
    const right = low + golden * (high - low)
    if (f(left) < f(right)) low = left
    else high = right
  }
  return Math.max(f(best), f((low + high) / 2))
}

/**
 * Exact axial span of the coil's meridian cross-section. The section is symmetric in the
 * binormal, so the span is twice the highest crossing; adjacent turns are disjoint exactly when
 * the pitch exceeds it (see ADR-0155).
 */
export function coilMeridianSpan(radius: number, pitch: number, section: CoilSectionSize) {
  if (section.kind === "rectangular")
    return 2 * sectionPointMeridianAxial(radius, pitch, section.width / 2, section.height / 2)
  const half = section.diameter / 2
  return (
    2 *
    largestOnHalfTurn((angle) =>
      sectionPointMeridianAxial(radius, pitch, half * Math.cos(angle), half * Math.sin(angle)),
    )
  )
}

/** Smallest clear pitch found by bisection, or Infinity when the section reaches the axis. */
export function minimumCoilPitch(radius: number, section: CoilSectionSize) {
  const radialHalf = (section.kind === "circular" ? section.diameter : section.width) / 2
  if (radialHalf >= radius) return Number.POSITIVE_INFINITY
  const isClear = (pitch: number) => pitch > coilMeridianSpan(radius, pitch, section)
  let clear = Math.max(section.kind === "circular" ? section.diameter : section.height, 1e-6)
  while (!isClear(clear)) {
    clear *= 2
    if (clear > 1e7) return Number.POSITIVE_INFINITY
  }
  let blocked = 0
  for (let iteration = 0; iteration < 80; iteration += 1) {
    const middle = (blocked + clear) / 2
    if (isClear(middle)) clear = middle
    else blocked = middle
  }
  return clear
}

export function addHelixExtentIssues(
  parameters: Pick<HelixParameters, "extent" | "pitch">,
  context: z.RefinementCtx,
  path: readonly (string | number)[] = [],
) {
  const turns = helixTurns(parameters.extent, parameters.pitch.value)
  if (turns < HELIX_MIN_TURNS || turns > HELIX_MAX_TURNS)
    context.addIssue({
      code: "custom",
      path: [...path, "extent"],
      message: `The helix height must produce between ${HELIX_MIN_TURNS} and ${HELIX_MAX_TURNS} turns at the selected pitch.`,
    })
}

type Variables = Parameters<NonNullable<TrustedFeatureTypeHandler["resolveParameters"]>>[1]
type Failure = Extract<FeatureParameterResolution, { ok: false }>

export function resolveHelixQuantity<Q extends Quantity>(
  quantity: Q,
  schema: z.ZodType<Q>,
  path: string,
  variables: Variables,
  code: string,
): { ok: true; quantity: Q } | Failure {
  const expression = resolveQuantityExpression(quantity, variables)
  const parsed = expression.ok ? schema.safeParse(expression.quantity) : null
  if (expression.ok && parsed?.success) return { ok: true, quantity: parsed.data }
  return {
    ok: false,
    diagnostic: {
      code: expression.ok ? code : expression.diagnostic.code,
      message: "A helix parameter expression is invalid.",
      issues: [
        {
          path,
          message: expression.ok
            ? (parsed?.error?.issues[0]?.message ??
              "The expression must resolve to a bounded value of the required dimension.")
            : expression.diagnostic.message,
        },
      ],
    },
  }
}

/** Resolves every expression-capable helix field; non-helix fields are returned unchanged. */
export function resolveHelixParameters<T extends HelixParameters>(
  parameters: T,
  variables: Variables,
  code: string,
  prefix = "",
): { ok: true; parameters: T } | Failure {
  const radius = resolveHelixQuantity(
    parameters.radius,
    helixRadiusSchema,
    `${prefix}radius`,
    variables,
    code,
  )
  if (!radius.ok) return radius
  const pitch = resolveHelixQuantity(
    parameters.pitch,
    helixPitchSchema,
    `${prefix}pitch`,
    variables,
    code,
  )
  if (!pitch.ok) return pitch
  const startAngle = resolveHelixQuantity(
    parameters.startAngle,
    helixStartAngleSchema,
    `${prefix}startAngle`,
    variables,
    code,
  )
  if (!startAngle.ok) return startAngle
  const extent =
    parameters.extent.kind === "turns"
      ? resolveHelixQuantity(
          parameters.extent.turns,
          helixTurnsSchema,
          `${prefix}extent.turns`,
          variables,
          code,
        )
      : resolveHelixQuantity(
          parameters.extent.height,
          helixHeightSchema,
          `${prefix}extent.height`,
          variables,
          code,
        )
  if (!extent.ok) return extent
  return {
    ok: true,
    parameters: {
      ...parameters,
      radius: radius.quantity,
      pitch: pitch.quantity,
      startAngle: startAngle.quantity,
      extent:
        parameters.extent.kind === "turns"
          ? { kind: "turns", turns: extent.quantity }
          : { kind: "height", height: extent.quantity },
    },
  }
}

/** Unit-free helix content; the axis is resolved separately by the document worker. */
export function helixContentFields(parameters: HelixParameters) {
  return {
    handedness: parameters.handedness,
    radius: parameters.radius.value,
    pitch: parameters.pitch.value,
    turns: helixTurns(parameters.extent, parameters.pitch.value),
    startAngle: parameters.startAngle.value,
  }
}
