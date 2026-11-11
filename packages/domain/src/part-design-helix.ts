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

/**
 * A section of axial size `s`, normal to the helix tangent, spans `s / cos(lead angle)` in the
 * meridian plane. Adjacent turns stay apart only when the pitch exceeds that span.
 */
export function minimumHelixPitch(radius: number, axialSectionSize: number) {
  const circumference = 2 * Math.PI * radius
  if (axialSectionSize >= circumference) return Number.POSITIVE_INFINITY
  return (axialSectionSize * circumference) / Math.sqrt(circumference ** 2 - axialSectionSize ** 2)
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
