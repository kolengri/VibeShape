import { z } from "zod"
import { bodyReferenceSchema } from "./body-reference"
import type { FeatureRecord } from "./feature-graph"
import { featureTypeDescriptorSchema, featureTypeKey } from "./feature-type-contracts"
import type { TrustedFeatureTypeHandler } from "./feature-type-registry"
import { sketchEntityIdSchema, sketchIdSchema } from "./identifiers"
import { referenceFrameSupportFeatureId, referencePlaneSchema } from "./reference-frame"
import { angleQuantitySchema, lengthQuantitySchema } from "./units"
import { resolveQuantityExpression } from "./variables"

export const FDM_KINDS = [
  "web",
  "corner-relief",
  "seam-groove",
  "teardrop-hole",
  "hex-seat",
  "crush-ribs",
  "flexible-sleeve",
  "nut-pocket",
  "insert-pocket",
  "enclosure-joint",
  "membrane",
  "calibration-coupon",
] as const
const length = lengthQuantitySchema.refine(
  ({ value }) => value > 0 && value <= 1000,
  "FDM dimensions must be positive and at most 1,000 mm.",
)
const allowance = lengthQuantitySchema.refine(
  ({ value }) => value >= 0 && value <= 1000,
  "FDM allowances must be between zero and 1,000 mm.",
)
const coordinate = lengthQuantitySchema.refine(
  ({ value }) => Math.abs(value) <= 100_000,
  "FDM origins must be within 100,000 mm.",
)
const roofAngle = angleQuantitySchema.refine(
  ({ value }) => value >= Math.PI / 12 && value <= (5 * Math.PI) / 12,
  "Roof angles must be between 15 and 75 degrees.",
)
const boundedCount = z.number().int().min(1).max(32)

/** Local profiles lie in XY and extend along positive Z before their authored axis placement. */
function primitiveVariants<L extends z.ZodType, C extends z.ZodType, A extends z.ZodType>(
  positive: L,
  nonnegative: L,
  coord: C,
  angle: A,
) {
  const common = {
    axis: z.enum(["X", "Y", "Z"]),
    origin: z.object({ x: coord, y: coord, z: coord }).strict(),
  }
  return [
    z
      .object({ ...common, kind: z.literal("corner-relief"), radius: positive, depth: positive })
      .strict(),
    z
      .object({
        ...common,
        kind: z.literal("seam-groove"),
        width: positive,
        depth: positive,
        length: positive,
      })
      .strict(),
    z
      .object({
        ...common,
        kind: z.literal("teardrop-hole"),
        diameter: positive,
        depth: positive,
        roofAngle: angle,
        flatTop: z.boolean(),
      })
      .strict(),
    z
      .object({
        ...common,
        kind: z.literal("hex-seat"),
        acrossFlats: positive,
        depth: positive,
        compliance: positive,
        slotWidth: positive,
      })
      .strict(),
    z
      .object({
        ...common,
        kind: z.literal("crush-ribs"),
        holeDiameter: positive,
        ribHeight: positive,
        ribWidth: positive,
        depth: positive,
        count: boundedCount,
      })
      .strict(),
    z
      .object({
        ...common,
        kind: z.literal("flexible-sleeve"),
        outerDiameter: positive,
        innerDiameter: positive,
        length: positive,
        slotWidth: positive,
        slotLength: positive,
        count: boundedCount,
      })
      .strict(),
    z
      .object({
        ...common,
        kind: z.literal("nut-pocket"),
        acrossFlats: positive,
        depth: positive,
        clearance: nonnegative,
      })
      .strict(),
    z
      .object({
        ...common,
        kind: z.literal("insert-pocket"),
        diameter: positive,
        depth: positive,
        clearance: nonnegative,
        bossDiameter: positive.optional(),
        bossHeight: positive.optional(),
      })
      .strict(),
    z
      .object({
        ...common,
        kind: z.literal("enclosure-joint"),
        width: positive,
        length: positive,
        wall: positive,
        height: positive,
        clearance: nonnegative,
        mode: z.enum(["lip", "groove"]),
      })
      .strict(),
    z
      .object({
        ...common,
        kind: z.literal("membrane"),
        width: positive,
        length: positive,
        thickness: positive,
        mode: z.enum(["sheet", "bridges"]),
        bridgeCount: boundedCount.optional(),
        bridgeWidth: positive.optional(),
      })
      .strict(),
    z
      .object({
        ...common,
        kind: z.literal("calibration-coupon"),
        diameterStart: positive,
        diameterStep: positive,
        holeCount: boundedCount,
        spacing: positive,
        thickness: positive,
        margin: positive,
      })
      .strict(),
  ] as const
}
const authoredPrimitives = primitiveVariants(length, allowance, coordinate, roofAngle)
const [corner, groove, teardrop, seat, ribs, sleeve, nut, insert, joint, membrane, coupon] =
  authoredPrimitives
const target = { targetBody: bodyReferenceSchema }
const uniqueLines = z
  .array(sketchEntityIdSchema)
  .min(1)
  .max(64)
  .refine((ids) => new Set(ids).size === ids.length, "Web line IDs must be distinct.")
  .overwrite((ids) => [...ids].sort())
const web = z
  .object({
    kind: z.literal("web"),
    ...target,
    sketchId: sketchIdSchema,
    lineIds: uniqueLines,
    thickness: length,
    depth: length,
    direction: z.enum(["forward", "reverse"]),
    style: z.enum(["web", "rib"]),
    extendToWalls: z.boolean(),
    stopPlane: referencePlaneSchema.optional(),
  })
  .strict()

const uncheckedFdmParametersSchema = z.discriminatedUnion("kind", [
  web,
  corner.extend(target),
  groove.extend(target),
  teardrop.extend(target),
  seat.extend(target),
  ribs.extend(target),
  sleeve.extend({ targetBody: bodyReferenceSchema.optional() }),
  nut.extend(target),
  insert.extend(target),
  joint.extend(target),
  membrane.extend(target),
  coupon,
])

type Unchecked = z.infer<typeof uncheckedFdmParametersSchema>
type Issue = (path: string, message: string) => void
function validateSleeve(p: Extract<Unchecked, { kind: "flexible-sleeve" }>, issue: Issue) {
  if (p.innerDiameter.value >= p.outerDiameter.value)
    issue("innerDiameter", "A sleeve must retain positive radial wall thickness.")
  if (p.slotLength.value >= p.length.value)
    issue("slotLength", "Sleeve slots must leave an uncut root band.")
  if (p.slotWidth.value * p.count >= Math.PI * p.innerDiameter.value)
    issue("slotWidth", "Sleeve slots must leave material between fingers.")
}
function validateInsert(p: Extract<Unchecked, { kind: "insert-pocket" }>, issue: Issue) {
  if (Boolean(p.bossDiameter) !== Boolean(p.bossHeight))
    issue("bossDiameter", "An insert boss requires both diameter and height.")
  if (p.bossDiameter && p.bossDiameter.value <= p.diameter.value + 2 * p.clearance.value)
    issue("bossDiameter", "An insert boss must retain positive radial wall thickness.")
}
function validateBridges(p: Extract<Unchecked, { kind: "membrane" }>, issue: Issue) {
  if (p.mode !== "bridges") return
  if (!p.bridgeCount || !p.bridgeWidth) issue("bridgeCount", "Bridges require a count and width.")
  else if (p.bridgeWidth.value * p.bridgeCount >= p.width.value)
    issue("bridgeWidth", "Segmented bridges require positive gaps.")
}
function validateCoupon(p: Extract<Unchecked, { kind: "calibration-coupon" }>, issue: Issue) {
  const largest = p.diameterStart.value + (p.holeCount - 1) * p.diameterStep.value
  if (largest > 1000) issue("diameterStep", "The largest coupon hole must be at most 1,000 mm.")
  if (p.holeCount > 1 && p.spacing.value <= largest)
    issue("spacing", "Coupon holes must retain material between them.")
  if ((p.holeCount - 1) * p.spacing.value + largest + 2 * p.margin.value > 1000)
    issue("spacing", "Coupon width must be at most 1,000 mm.")
}
function validateWeb(p: Extract<Unchecked, { kind: "web" }>, issue: Issue) {
  if (p.style !== "rib") return
  if (p.stopPlane)
    issue("stopPlane", "Triangular ribs use authored depth rather than plane termination.")
  if (p.extendToWalls) issue("extendToWalls", "Automatic wall extension is supported for Web only.")
}
function validateRadial(p: Unchecked, issue: Issue) {
  if (p.kind === "crush-ribs" && p.ribHeight.value >= p.holeDiameter.value / 2)
    issue("ribHeight", "Crush ribs must leave a positive central opening.")
  if (p.kind === "hex-seat" && p.slotWidth.value >= p.acrossFlats.value / 3)
    issue("slotWidth", "Compliant seats must retain material between slots.")
  if (
    p.kind === "enclosure-joint" &&
    2 * (p.wall.value + p.clearance.value) >= Math.min(p.width.value, p.length.value)
  )
    issue("wall", "Enclosure joints must retain a positive interior opening.")
}
export const fdmFeatureParametersSchema = uncheckedFdmParametersSchema.superRefine((p, context) => {
  const issue: Issue = (path, message) =>
    context.addIssue({ code: "custom", path: [path], message })
  switch (p.kind) {
    case "flexible-sleeve":
      return validateSleeve(p, issue)
    case "insert-pocket":
      return validateInsert(p, issue)
    case "membrane":
      return validateBridges(p, issue)
    case "calibration-coupon":
      return validateCoupon(p, issue)
    case "web":
      return validateWeb(p, issue)
    default:
      return validateRadial(p, issue)
  }
})
export type FdmFeatureParameters = Readonly<z.infer<typeof fdmFeatureParametersSchema>>

export const fdmFeatureType = featureTypeDescriptorSchema.parse({
  schemaVersion: 0,
  type: {
    moduleId: "org.vibeshape.core.part-design",
    moduleVersion: "0.1.0",
    typeId: "org.vibeshape.feature.part-design.fdm",
    schemaVersion: 1,
  },
  classification: "solid",
  dependencies: { min: 0, max: 3 },
  references: { min: 0, max: 1 },
})

export function readFdmFeatureParameters(
  feature: Pick<FeatureRecord, "type" | "parameters">,
): FdmFeatureParameters | null {
  if (featureTypeKey(feature.type) !== featureTypeKey(fdmFeatureType.type)) return null
  const parsed = fdmFeatureParametersSchema.safeParse(feature.parameters)
  return parsed.success ? parsed.data : null
}
export function fdmDependencyIds(
  parameters: FdmFeatureParameters,
  sketchSupportFeatureId: import("./identifiers").FeatureId | null = null,
) {
  const ids =
    "targetBody" in parameters && parameters.targetBody ? [parameters.targetBody.featureId] : []
  if (parameters.kind === "web" && sketchSupportFeatureId && !ids.includes(sketchSupportFeatureId))
    ids.push(sketchSupportFeatureId)
  const support =
    parameters.kind === "web" && parameters.stopPlane
      ? referenceFrameSupportFeatureId(parameters.stopPlane)
      : null
  if (support && !ids.includes(support)) ids.push(support)
  return ids
}
export function fdmContentParameters(parameters: FdmFeatureParameters) {
  const { targetBody: _target, ...values } =
    "targetBody" in parameters ? parameters : { ...parameters, targetBody: undefined }
  return Object.fromEntries(
    Object.entries(values).map(([key, value]) => [
      key,
      key === "origin" && parameters.kind !== "web"
        ? {
            x: parameters.origin.x.value,
            y: parameters.origin.y.value,
            z: parameters.origin.z.value,
          }
        : value && typeof value === "object" && "value" in value
          ? value.value
          : value,
    ]),
  )
}
type Variables = Parameters<NonNullable<TrustedFeatureTypeHandler["resolveParameters"]>>[1]
function expressionFailure(path: string, code: string, message: string) {
  return {
    ok: false as const,
    diagnostic: {
      code,
      message: "An FDM dimension expression is invalid.",
      issues: [{ path, message }],
    },
  }
}
function resolveFdmOrigin(
  origin: Exclude<FdmFeatureParameters, { kind: "web" }>["origin"],
  variables: Variables,
) {
  const resolved = { ...origin }
  for (const axis of ["x", "y", "z"] as const) {
    const expression = resolveQuantityExpression(origin[axis], variables)
    if (!expression.ok)
      return expressionFailure(
        `origin.${axis}`,
        expression.diagnostic.code,
        expression.diagnostic.message,
      )
    resolved[axis] = lengthQuantitySchema.parse(expression.quantity)
  }
  return { ok: true as const, origin: resolved }
}
function resolveFdmParameters(parameters: unknown, variables: Variables) {
  const parsed = fdmFeatureParametersSchema.safeParse(parameters)
  if (!parsed.success) return { ok: true as const, parameters }
  const resolved: Record<string, unknown> = { ...parsed.data }
  if (parsed.data.kind !== "web") {
    const origin = resolveFdmOrigin(parsed.data.origin, variables)
    if (!origin.ok) return origin
    resolved.origin = origin.origin
  }
  for (const [key, value] of Object.entries(parsed.data)) {
    const quantity = lengthQuantitySchema.or(angleQuantitySchema).safeParse(value)
    if (!quantity.success) continue
    const expression = resolveQuantityExpression(quantity.data, variables)
    if (!expression.ok)
      return expressionFailure(key, expression.diagnostic.code, expression.diagnostic.message)
    resolved[key] = expression.quantity
  }
  const valid = fdmFeatureParametersSchema.safeParse(resolved)
  return valid.success
    ? { ok: true as const, parameters: valid.data }
    : {
        ok: false as const,
        diagnostic: {
          code: "invalid-fdm-dimension",
          message: "FDM expressions violate a geometry bound.",
          issues: valid.error.issues.map((issue) => ({
            path: issue.path.join("."),
            message: issue.message,
          })),
        },
      }
}
function targetsConstituentSupport(parameters: FdmFeatureParameters, support: string | undefined) {
  return (
    parameters.kind === "web" &&
    support === parameters.targetBody.featureId &&
    parameters.targetBody.outputRole !== "result"
  )
}
export const fdmFeatureTypeHandler: TrustedFeatureTypeHandler = {
  type: fdmFeatureType.type,
  parametersSchema: fdmFeatureParametersSchema,
  contentParameters(parameters) {
    return fdmContentParameters(fdmFeatureParametersSchema.parse(parameters))
  },
  validateFeature(feature) {
    const parameters = fdmFeatureParametersSchema.parse(feature.parameters)
    const sketchSupport = parameters.kind === "web" ? feature.references[0]?.featureId : undefined
    const expected = fdmDependencyIds(parameters, sketchSupport ?? null)
    if (targetsConstituentSupport(parameters, sketchSupport))
      return [
        {
          path: "parameters.targetBody.outputRole",
          message:
            "A constituent target cannot share its exact input slot with whole sketch support.",
        },
      ]
    return JSON.stringify(feature.dependencies) === JSON.stringify(expected) &&
      (parameters.kind === "web" || feature.references.length === 0)
      ? []
      : [
          {
            path: "dependencies",
            message:
              "FDM features require their exact target followed by distinct stop-plane and sketch supports.",
          },
        ]
  },
  resolveParameters: resolveFdmParameters,
}
