import { chamferFeatureTypeHandlerV3 } from "./part-design-chamfer"

export {
  type ChamferFeatureParametersV3,
  chamferEdgeRefSchema,
  chamferFeatureParametersV3Schema,
  chamferFeatureTypeV3,
  chamferTargetSchema,
  readChamferFeatureParametersV3,
} from "./part-design-chamfer"

import { z } from "zod"
import { type BodyReference, bodyReferenceSchema } from "./body-reference"
import { bodyFaceRefSchema } from "./body-topology-reference"
import { booleanFeatureTypeHandlerV2 } from "./part-design-subtract"

export {
  booleanFeatureParametersV2Schema,
  booleanFeatureTypeV2,
  readBooleanFeatureParametersV2,
} from "./part-design-subtract"

import { canonicalJson } from "./canonical-json"
import type { FeatureRecord } from "./feature-graph"
import { featureTypeDescriptorSchema } from "./feature-type-contracts"
import type { TrustedFeatureTypeHandler } from "./feature-type-registry"
import { type FeatureId, sketchEntityIdSchema, sketchIdSchema } from "./identifiers"
import {
  compoundFeatureTypeHandler,
  compoundFeatureTypeV2Handler,
  unionFeatureTypeHandler,
  unionFeatureTypeV2Handler,
} from "./part-design-body-combination"
import { fdmFeatureTypeHandler } from "./part-design-fdm"
import {
  holeFeatureTypeHandler,
  holeFeatureTypeHandlerV2,
  holeFeatureTypeHandlerV3,
} from "./part-design-hole"
import { importedFeatureTypeHandler } from "./part-design-import"
import { loftFeatureTypeHandler, loftFeatureTypeHandlerV2 } from "./part-design-loft"
import { loftFeatureTypeHandlerV3 } from "./part-design-loft-v3"
import { meshImportFeatureTypeHandler } from "./part-design-mesh-import"
import {
  mirrorFeatureTypeHandler,
  mirrorFeatureTypeHandlerV2,
  mirrorFeatureTypeHandlerV3,
} from "./part-design-mirror"
import { patternFeatureTypeHandler, patternFeatureTypeHandlerV2 } from "./part-design-pattern"
import { placementFeatureTypeHandler } from "./part-design-placement"
import { shellFeatureTypeHandler, shellFeatureTypeHandlerV2 } from "./part-design-shell"
import { splitFeatureTypeHandler, splitFeatureTypeHandlerV2 } from "./part-design-split"
import { sweepFeatureTypeHandler } from "./part-design-sweep"
import { threadFeatureTypeHandler, threadFeatureTypeHandlerV2 } from "./part-design-thread"
import {
  createSketchProfileSet,
  sketchProfileSelectorSchema,
  sketchProfileSetSchema,
} from "./sketch-profile-selector"
import { edgeTopoRefSchema } from "./topology"
import { angleQuantitySchema, createLengthQuantity, lengthQuantitySchema } from "./units"
import {
  type EvaluatedVariable,
  type ExpressionValue,
  resolveQuantityExpression,
} from "./variables"

const MAX_PRIMITIVE_LENGTH_MM = 1_000_000
const MAX_PRIMITIVE_POSITION_MM = 100_000

const primitiveLengthSchema = lengthQuantitySchema.refine(
  ({ value }) => value > 0 && value <= MAX_PRIMITIVE_LENGTH_MM,
  `Primitive lengths must be greater than zero and at most ${MAX_PRIMITIVE_LENGTH_MM} mm.`,
)

const primitiveContentLengthSchema = z.number().finite().positive().max(MAX_PRIMITIVE_LENGTH_MM)

const primitivePositionSchema = lengthQuantitySchema.refine(
  ({ value }) => Math.abs(value) <= MAX_PRIMITIVE_POSITION_MM,
  `Primitive placement coordinates must be at most ${MAX_PRIMITIVE_POSITION_MM} mm from the origin.`,
)

const primitiveContentPositionSchema = z
  .number()
  .finite()
  .min(-MAX_PRIMITIVE_POSITION_MM)
  .max(MAX_PRIMITIVE_POSITION_MM)

export const primitiveOriginSchema = z
  .object({
    x: primitivePositionSchema,
    y: primitivePositionSchema,
    z: primitivePositionSchema,
  })
  .strict()

const primitiveOriginWithDefaultSchema = primitiveOriginSchema.default({
  x: createLengthQuantity(0),
  y: createLengthQuantity(0),
  z: createLengthQuantity(0),
})

const primitiveContentOriginSchema = z
  .tuple([
    primitiveContentPositionSchema,
    primitiveContentPositionSchema,
    primitiveContentPositionSchema,
  ])
  .default([0, 0, 0])

export const boxFeatureParametersSchema = z
  .object({
    width: primitiveLengthSchema,
    depth: primitiveLengthSchema,
    height: primitiveLengthSchema,
    centered: z.boolean(),
    origin: primitiveOriginWithDefaultSchema,
  })
  .strict()

export const cylinderFeatureParametersSchema = z
  .object({
    radius: primitiveLengthSchema,
    height: primitiveLengthSchema,
    centered: z.boolean(),
    origin: primitiveOriginWithDefaultSchema,
  })
  .strict()

export const boxFeatureContentParametersSchema = z
  .object({
    width: primitiveContentLengthSchema,
    depth: primitiveContentLengthSchema,
    height: primitiveContentLengthSchema,
    centered: z.boolean(),
    origin: primitiveContentOriginSchema,
  })
  .strict()

export const cylinderFeatureContentParametersSchema = z
  .object({
    radius: primitiveContentLengthSchema,
    height: primitiveContentLengthSchema,
    centered: z.boolean(),
    origin: primitiveContentOriginSchema,
  })
  .strict()

const radialPrimitiveLengthSchema = primitiveLengthSchema.refine(
  ({ value }) => value >= 0.001,
  "Radial primitive dimensions must be at least 0.001 mm.",
)
const radialPrimitiveContentLengthSchema = primitiveContentLengthSchema.min(0.001)

function radialPrimitiveWithinWorkspace(
  origin: readonly [number, number, number],
  radius: number,
  minimumZ: number,
  maximumZ: number,
) {
  return [
    Math.abs(origin[0]) + radius,
    Math.abs(origin[1]) + radius,
    Math.abs(minimumZ),
    Math.abs(maximumZ),
  ].every((value) => value <= MAX_PRIMITIVE_POSITION_MM)
}

function quantityOrigin(origin: z.infer<typeof primitiveOriginSchema>): [number, number, number] {
  return [origin.x.value, origin.y.value, origin.z.value]
}

export const sphereFeatureParametersSchema = z
  .object({ radius: radialPrimitiveLengthSchema, origin: primitiveOriginWithDefaultSchema })
  .strict()
  .refine(
    ({ radius, origin }) =>
      radialPrimitiveWithinWorkspace(
        quantityOrigin(origin),
        radius.value,
        origin.z.value - radius.value,
        origin.z.value + radius.value,
      ),
    "Sphere dimensions and placement must remain within the 100000 mm workspace.",
  )

export const coneFeatureParametersSchema = z
  .object({
    radius: radialPrimitiveLengthSchema,
    height: radialPrimitiveLengthSchema,
    centered: z.boolean(),
    origin: primitiveOriginWithDefaultSchema,
  })
  .strict()
  .refine(({ radius, height, centered, origin }) => {
    const minimumZ = origin.z.value - (centered ? height.value / 2 : 0)
    return (
      height.value <= MAX_PRIMITIVE_POSITION_MM &&
      radialPrimitiveWithinWorkspace(
        quantityOrigin(origin),
        radius.value,
        minimumZ,
        minimumZ + height.value,
      )
    )
  }, "Cone dimensions and placement must remain within the 100000 mm workspace.")

export const pyramidFeatureParametersSchema = z
  .object({
    sides: z.number().int().min(3).max(64),
    radius: radialPrimitiveLengthSchema,
    height: radialPrimitiveLengthSchema,
    centered: z.boolean(),
    origin: primitiveOriginWithDefaultSchema,
  })
  .strict()
  .refine(({ radius, height, centered, origin }) => {
    const minimumZ = origin.z.value - (centered ? height.value / 2 : 0)
    return (
      height.value <= MAX_PRIMITIVE_POSITION_MM &&
      radialPrimitiveWithinWorkspace(
        quantityOrigin(origin),
        radius.value,
        minimumZ,
        minimumZ + height.value,
      )
    )
  }, "Pyramid dimensions and placement must remain within the 100000 mm workspace.")

export const torusFeatureParametersSchema = z
  .object({
    majorRadius: radialPrimitiveLengthSchema,
    minorRadius: radialPrimitiveLengthSchema,
    origin: primitiveOriginWithDefaultSchema,
  })
  .strict()
  .refine(({ majorRadius, minorRadius }) => majorRadius.value > minorRadius.value, {
    path: ["minorRadius"],
    message: "A ring torus requires majorRadius greater than minorRadius.",
  })
  .refine(
    ({ majorRadius, minorRadius, origin }) =>
      radialPrimitiveWithinWorkspace(
        quantityOrigin(origin),
        majorRadius.value + minorRadius.value,
        origin.z.value - minorRadius.value,
        origin.z.value + minorRadius.value,
      ),
    "Torus dimensions and placement must remain within the 100000 mm workspace.",
  )

export const sphereFeatureContentParametersSchema = z
  .object({ radius: radialPrimitiveContentLengthSchema, origin: primitiveContentOriginSchema })
  .strict()
  .refine(
    ({ radius, origin }) =>
      radialPrimitiveWithinWorkspace(origin, radius, origin[2] - radius, origin[2] + radius),
    "Sphere dimensions and placement must remain within the 100000 mm workspace.",
  )

export const coneFeatureContentParametersSchema = z
  .object({
    radius: radialPrimitiveContentLengthSchema,
    height: radialPrimitiveContentLengthSchema,
    centered: z.boolean(),
    origin: primitiveContentOriginSchema,
  })
  .strict()
  .refine(({ radius, height, centered, origin }) => {
    const minimumZ = origin[2] - (centered ? height / 2 : 0)
    return (
      height <= MAX_PRIMITIVE_POSITION_MM &&
      radialPrimitiveWithinWorkspace(origin, radius, minimumZ, minimumZ + height)
    )
  }, "Cone dimensions and placement must remain within the 100000 mm workspace.")

export const pyramidFeatureContentParametersSchema = z
  .object({
    sides: z.number().int().min(3).max(64),
    radius: radialPrimitiveContentLengthSchema,
    height: radialPrimitiveContentLengthSchema,
    centered: z.boolean(),
    origin: primitiveContentOriginSchema,
  })
  .strict()
  .refine(({ radius, height, centered, origin }) => {
    const minimumZ = origin[2] - (centered ? height / 2 : 0)
    return (
      height <= MAX_PRIMITIVE_POSITION_MM &&
      radialPrimitiveWithinWorkspace(origin, radius, minimumZ, minimumZ + height)
    )
  }, "Pyramid dimensions and placement must remain within the 100000 mm workspace.")

export const torusFeatureContentParametersSchema = z
  .object({
    majorRadius: radialPrimitiveContentLengthSchema,
    minorRadius: radialPrimitiveContentLengthSchema,
    origin: primitiveContentOriginSchema,
  })
  .strict()
  .refine(({ majorRadius, minorRadius }) => majorRadius > minorRadius, {
    path: ["minorRadius"],
    message: "A ring torus requires majorRadius greater than minorRadius.",
  })
  .refine(
    ({ majorRadius, minorRadius, origin }) =>
      radialPrimitiveWithinWorkspace(
        origin,
        majorRadius + minorRadius,
        origin[2] - minorRadius,
        origin[2] + minorRadius,
      ),
    "Torus dimensions and placement must remain within the 100000 mm workspace.",
  )

export const booleanFeatureParametersSchema = z
  .object({ operation: z.literal("subtract"), keepTools: z.boolean().optional() })
  .strict()

export const booleanFeatureContentParametersSchema = booleanFeatureParametersSchema.omit({
  keepTools: true,
})

const edgeTreatmentLengthSchema = lengthQuantitySchema.refine(
  ({ value }) => value > 0 && value <= MAX_PRIMITIVE_LENGTH_MM,
  `Edge treatment dimensions must be greater than zero and at most ${MAX_PRIMITIVE_LENGTH_MM} mm.`,
)

export const filletFeatureParametersSchema = z
  .object({ radius: edgeTreatmentLengthSchema })
  .strict()

export const chamferFeatureParametersSchema = z
  .object({ distance: edgeTreatmentLengthSchema })
  .strict()

function durableEdgeKeys(reference: FeatureRecord["references"][number]): string[] {
  const keys: string[] = []
  if (reference.semanticRole !== undefined) keys.push(`role:${reference.semanticRole}`)
  if (reference.lineageToken !== undefined) keys.push(`lineage:${reference.lineageToken}`)
  return keys.length ? keys : [`reference:${canonicalJson(reference)}`]
}

function selectedEdgeTreatmentInvariant(feature: FeatureRecord) {
  const issues: { path: string; message: string }[] = []
  const seen = new Set<string>()
  for (const [index, reference] of feature.references.entries()) {
    if (reference.kind !== "edge") {
      issues.push({
        path: `references.${index}.kind`,
        message: "Selected edge treatment references must target edges.",
      })
      continue
    }
    const keys = durableEdgeKeys(reference)
    if (keys.some((key) => seen.has(key))) {
      issues.push({
        path: `references.${index}`,
        message: "Selected edge treatment references must identify distinct durable edges.",
      })
    }
    for (const key of keys) seen.add(key)
  }
  return issues
}

export const extrusionOperationSchema = z.enum(["new", "add", "remove", "intersect"])

const legacyExtrusionFeatureParametersSchema = z
  .object({
    profile: sketchProfileSelectorSchema,
    distance: primitiveLengthSchema,
    symmetric: z.boolean(),
    operation: z.literal("new"),
  })
  .strict()

export const extrusionFeatureParametersSchema = z
  .object({
    profile: sketchProfileSelectorSchema,
    distance: primitiveLengthSchema,
    symmetric: z.boolean(),
    operation: extrusionOperationSchema,
  })
  .strict()

export const extrusionFeatureAuthoredContentParametersSchema = z
  .object({
    profile: sketchProfileSelectorSchema,
    distance: primitiveContentLengthSchema,
    symmetric: z.boolean(),
    operation: extrusionOperationSchema,
  })
  .strict()

function profilesShareSketch(profiles: readonly { sketchId: string }[]) {
  return profiles.every((profile) => profile.sketchId === profiles[0]?.sketchId)
}

const multiProfileSetSchema = sketchProfileSetSchema.refine(
  ({ profiles }) => profilesShareSketch(profiles),
  "All selected profiles must belong to the same sketch.",
)

export const extrusionFeatureParametersV3Schema = z
  .object({
    profiles: multiProfileSetSchema,
    distance: primitiveLengthSchema,
    symmetric: z.boolean(),
    operation: z.literal("new"),
  })
  .strict()
export const multiProfileExtrusionFeatureParametersSchema = extrusionFeatureParametersV3Schema

export const extrusionFeatureParametersV4Schema = z
  .object({
    profiles: multiProfileSetSchema,
    distance: primitiveLengthSchema,
    symmetric: z.boolean(),
    operation: z.enum(["add", "remove", "intersect"]),
  })
  .strict()

export const extrusionFeatureAuthoredContentParametersV3Schema = z
  .object({
    profiles: sketchProfileSetSchema,
    distance: primitiveContentLengthSchema,
    symmetric: z.boolean(),
    operation: z.literal("new"),
  })
  .strict()

export const extrusionFeatureAuthoredContentParametersV4Schema = z
  .object({
    profiles: sketchProfileSetSchema,
    distance: primitiveContentLengthSchema,
    symmetric: z.boolean(),
    operation: z.enum(["add", "remove", "intersect"]),
  })
  .strict()

const extrusionDepthV5Schema = lengthQuantitySchema.refine(
  ({ value }) => value >= 0.001 && value <= 100_000,
  "Extrusion depths must be between 0.001 and 100,000 mm.",
)

function symmetricExtrusionDepthAllowed(parameters: {
  symmetric: boolean
  secondDistance: unknown | null
}) {
  return !parameters.symmetric || parameters.secondDistance === null
}

const symmetricExtrusionDepthIssue = {
  path: ["secondDistance"],
  message: "Symmetric extrusion cannot enable a second depth.",
}

export const extrusionFeatureParametersV5Schema = z
  .object({
    profiles: multiProfileSetSchema,
    distance: extrusionDepthV5Schema,
    symmetric: z.boolean(),
    reversed: z.boolean(),
    secondDistance: extrusionDepthV5Schema.nullable(),
    operation: extrusionOperationSchema,
  })
  .strict()
  .refine(symmetricExtrusionDepthAllowed, symmetricExtrusionDepthIssue)
  .refine(
    ({ distance, secondDistance }) => distance.value + (secondDistance?.value ?? 0) <= 100_000,
    {
      path: ["distance"],
      message: "The total extrusion span must be at most 100,000 mm.",
    },
  )

export const extrusionFeatureAuthoredContentParametersV5Schema = z
  .object({
    profiles: sketchProfileSetSchema,
    distance: z.number().finite().min(0.001).max(100_000),
    symmetric: z.boolean(),
    reversed: z.boolean(),
    secondDistance: z.number().finite().min(0.001).max(100_000).nullable(),
    operation: extrusionOperationSchema,
  })
  .strict()
  .refine(symmetricExtrusionDepthAllowed, symmetricExtrusionDepthIssue)
  .refine(({ distance, secondDistance }) => distance + (secondDistance ?? 0) <= 100_000, {
    path: ["distance"],
    message: "The total extrusion span must be at most 100,000 mm.",
  })

const extrusionSourceHashSchema = z.string().regex(/^[0-9a-f]{64}$/)
export const extrusionEndConditionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("distance") }).strict(),
  z
    .object({
      kind: z.literal("through-all"),
      targetBody: bodyReferenceSchema,
      sourceContentHash: extrusionSourceHashSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("up-to-body"),
      targetBody: bodyReferenceSchema,
      sourceContentHash: extrusionSourceHashSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("up-to-face"),
      targetBody: bodyReferenceSchema,
      sourceContentHash: extrusionSourceHashSchema,
      face: bodyFaceRefSchema.refine(
        ({ signature }) => signature.geometryClass === "PLANE",
        "Extrusion currently requires a planar end face.",
      ),
    })
    .strict(),
])
function validateExtrusionEndOwnership(
  target: BodyReference | null,
  end: Exclude<z.infer<typeof extrusionEndConditionSchema>, { kind: "distance" }>,
  context: z.RefinementCtx,
) {
  if (
    target?.featureId === end.targetBody.featureId &&
    target.outputRole !== end.targetBody.outputRole
  )
    context.addIssue({
      code: "custom",
      path: ["endCondition"],
      message: "A shared target and end-support producer must use the same body output.",
    })
  if (
    end.kind === "up-to-face" &&
    (end.face.featureId !== end.targetBody.featureId ||
      end.face.outputRole !== end.targetBody.outputRole)
  )
    context.addIssue({
      code: "custom",
      path: ["endCondition", "face"],
      message: "The end face must belong to the selected exact body.",
    })
}
export const extrusionFeatureParametersV6Schema = extrusionFeatureParametersV5Schema
  .safeExtend({
    targetBody: bodyReferenceSchema.nullable(),
    startOffset: lengthQuantitySchema.refine(
      ({ value }) => Math.abs(value) <= 100_000,
      "Extrusion start offset must remain within 100,000 mm.",
    ),
    draftAngle: angleQuantitySchema.refine(
      ({ value }) => Math.abs(value) <= Math.PI / 4,
      "Extrusion draft must remain within 45 degrees.",
    ),
    endCondition: extrusionEndConditionSchema,
  })
  .superRefine((parameters, context) => {
    if ((parameters.operation === "new") !== (parameters.targetBody === null))
      context.addIssue({
        code: "custom",
        path: ["targetBody"],
        message: "Modifying extrusion requires an exact body target; New must not consume one.",
      })
    const end = parameters.endCondition
    if (end.kind === "distance") return
    if (parameters.symmetric || parameters.secondDistance !== null)
      context.addIssue({
        code: "custom",
        path: ["endCondition"],
        message: "Dynamic end conditions require one directional extent.",
      })
    validateExtrusionEndOwnership(parameters.targetBody, end, context)
  })
export type ExtrusionFeatureParametersV6 = Readonly<
  z.infer<typeof extrusionFeatureParametersV6Schema>
>
export const extrusionFaceEndConditionV7Schema = z
  .object({
    kind: z.literal("up-to-face"),
    targetBody: bodyReferenceSchema,
    sourceContentHash: extrusionSourceHashSchema,
    face: bodyFaceRefSchema,
  })
  .strict()
export const extrusionFeatureParametersV7Schema = extrusionFeatureParametersV6Schema.safeExtend({
  endCondition: extrusionFaceEndConditionV7Schema,
})
export type ExtrusionFeatureParametersV7 = Readonly<
  z.infer<typeof extrusionFeatureParametersV7Schema>
>
/** Each selected sketch retains its own resolved support frame. */
export const extrusionFeatureParametersV8Schema = extrusionFeatureParametersV6Schema.safeExtend({
  profiles: sketchProfileSetSchema,
  endCondition: z.union([extrusionEndConditionSchema, extrusionFaceEndConditionV7Schema]),
})
export type ExtrusionFeatureParametersV8 = Readonly<
  z.infer<typeof extrusionFeatureParametersV8Schema>
>
export function expectedExtrusionV8DependencyIds(
  target: FeatureId | null,
  supports: readonly FeatureId[],
  end: FeatureId | null,
) {
  return [target, ...supports, end].filter(
    (id, index, ids): id is FeatureId => id !== null && ids.indexOf(id) === index,
  )
}
export function expectedExtrusionV6DependencyIds(
  target: FeatureId | null,
  support: FeatureId | null,
  end: FeatureId | null,
) {
  return [target, support, end].filter(
    (id, index, ids): id is FeatureId => id !== null && ids.indexOf(id) === index,
  )
}
function extrusionSupportUsesNamedBody(
  support: FeatureId | null,
  parameters: ExtrusionFeatureParametersV6,
) {
  const end =
    parameters.endCondition.kind === "distance" ? null : parameters.endCondition.targetBody
  return [parameters.targetBody, end].some(
    (body) => body?.featureId === support && body?.outputRole !== "result",
  )
}
function extrusionV6Invariant(
  feature: FeatureRecord,
  schema:
    | typeof extrusionFeatureParametersV6Schema
    | typeof extrusionFeatureParametersV7Schema = extrusionFeatureParametersV6Schema,
) {
  const parameters = schema.parse(feature.parameters)
  const support = feature.references[0]?.featureId ?? null
  const end =
    parameters.endCondition.kind === "distance"
      ? null
      : parameters.endCondition.targetBody.featureId
  return advancedExtrusionDependencyIssues(
    feature,
    parameters,
    expectedExtrusionV6DependencyIds(parameters.targetBody?.featureId ?? null, support, end),
  )
}
function extrusionV8Invariant(feature: FeatureRecord) {
  const parameters = extrusionFeatureParametersV8Schema.parse(feature.parameters)
  return advancedExtrusionDependencyIssues(
    feature,
    parameters,
    expectedExtrusionV8DependencyIds(
      parameters.targetBody?.featureId ?? null,
      feature.references.map(({ featureId }) => featureId),
      parameters.endCondition.kind === "distance"
        ? null
        : parameters.endCondition.targetBody.featureId,
    ),
  )
}
function advancedExtrusionDependencyIssues(
  feature: FeatureRecord,
  parameters: ExtrusionFeatureParametersV6,
  expected: readonly FeatureId[],
) {
  const issues =
    JSON.stringify(feature.dependencies) === JSON.stringify(expected)
      ? []
      : [
          {
            path: "dependencies",
            message:
              "Extrusion requires its exact target first, ordered sketch supports, and distinct end support.",
          },
        ]
  if (
    feature.references.some(({ featureId }) => extrusionSupportUsesNamedBody(featureId, parameters))
  )
    issues.push({
      path: "references",
      message: "A sketch support must retain its whole result slot.",
    })
  return issues
}
function resolveExtrusionV6Parameters(
  parameters: unknown,
  variables: VariableValues,
  schema:
    | typeof extrusionFeatureParametersV6Schema
    | typeof extrusionFeatureParametersV7Schema
    | typeof extrusionFeatureParametersV8Schema = extrusionFeatureParametersV6Schema,
) {
  const parsed = schema.safeParse(parameters)
  if (!parsed.success) return { ok: true as const, parameters }
  const resolved = { ...parsed.data }
  for (const key of ["distance", "secondDistance", "startOffset", "draftAngle"] as const) {
    const quantity = parsed.data[key]
    if (quantity === null) continue
    const value = resolveQuantityExpression(quantity, variables)
    if (!value.ok) return expressionFailure(key, value.diagnostic.message, value.diagnostic.code)
    Object.assign(resolved, { [key]: value.quantity })
  }
  const valid = schema.safeParse(resolved)
  return valid.success
    ? { ok: true as const, parameters: valid.data }
    : expressionFailure(
        valid.error.issues[0]?.path.join(".") ?? "distance",
        valid.error.issues[0]?.message ?? "Invalid extrusion extent.",
        "invalid-range",
      )
}

const revolveAngleSchema = angleQuantitySchema.refine(
  ({ value }) => value > 0 && value <= Math.PI * 2,
  "Revolve angles must be greater than zero and at most 360 degrees.",
)

const legacyRevolveFeatureParametersSchema = z
  .object({
    profile: sketchProfileSelectorSchema,
    axis: z.enum(["x", "y"]),
    angle: revolveAngleSchema,
    operation: z.literal("new"),
  })
  .strict()

const legacyRevolveFeatureParametersV2Schema = legacyRevolveFeatureParametersSchema.extend({
  operation: extrusionOperationSchema,
})

const legacyRevolveAxisV3Schema = z.union([
  z.object({ kind: z.literal("origin-axis"), axis: z.enum(["x", "y"]) }).strict(),
  z
    .object({
      kind: z.literal("sketch-line"),
      sketchId: sketchIdSchema,
      entityId: sketchEntityIdSchema,
    })
    .strict(),
])

export const revolveAxisSchema = z.union([
  ...legacyRevolveAxisV3Schema.options,
  z.object({ kind: z.literal("model-edge"), reference: edgeTopoRefSchema }).strict(),
])

const legacyRevolveFeatureParametersV3Schema = z
  .object({
    profile: sketchProfileSelectorSchema,
    axis: legacyRevolveAxisV3Schema,
    angle: revolveAngleSchema,
    operation: extrusionOperationSchema,
  })
  .strict()

export const revolveFeatureParametersSchema = z
  .object({
    profile: sketchProfileSelectorSchema,
    axis: revolveAxisSchema,
    angle: revolveAngleSchema,
    operation: extrusionOperationSchema,
  })
  .strict()

export const revolveFeatureParametersV5Schema = z
  .object({
    profiles: multiProfileSetSchema,
    axis: revolveAxisSchema,
    angle: revolveAngleSchema,
    operation: z.literal("new"),
  })
  .strict()
export const multiProfileRevolveFeatureParametersSchema = revolveFeatureParametersV5Schema

export const revolveFeatureParametersV6Schema = z
  .object({
    profiles: multiProfileSetSchema,
    axis: revolveAxisSchema,
    angle: revolveAngleSchema,
    operation: z.enum(["add", "remove", "intersect"]),
  })
  .strict()

export const revolveFeatureParametersV7Schema = revolveFeatureParametersV6Schema
  .extend({ targetBody: bodyReferenceSchema })
  .strict()
export type RevolveFeatureParametersV7 = Readonly<z.infer<typeof revolveFeatureParametersV7Schema>>

type NormalizedExtrusionParameters = z.infer<typeof extrusionFeatureParametersSchema> & {
  profiles?: z.infer<typeof sketchProfileSetSchema>
  reversed: boolean
  secondDistance: z.infer<typeof lengthQuantitySchema> | null
  targetBody?: BodyReference | null
  startOffset?: z.infer<typeof lengthQuantitySchema>
  draftAngle?: z.infer<typeof angleQuantitySchema>
  endCondition?: z.infer<typeof extrusionEndConditionSchema>
}
type NormalizedRevolveParameters = z.infer<typeof revolveFeatureParametersSchema> & {
  targetBody?: z.infer<typeof bodyReferenceSchema>
  profiles?: z.infer<typeof sketchProfileSetSchema>
}

function parseRevolveParameters<T>(schema: z.ZodType<T>, parameters: unknown): T | null {
  const parsed = schema.safeParse(parameters)
  return parsed.success ? parsed.data : null
}

function normalizeLegacyOriginAxisRevolveParameters(
  parameters:
    | z.infer<typeof legacyRevolveFeatureParametersSchema>
    | z.infer<typeof legacyRevolveFeatureParametersV2Schema>
    | null,
): NormalizedRevolveParameters | null {
  return parameters ? { ...parameters, axis: { kind: "origin-axis", axis: parameters.axis } } : null
}

function normalizeMultiProfileRevolveParameters(
  parameters:
    | z.infer<typeof revolveFeatureParametersV5Schema>
    | z.infer<typeof revolveFeatureParametersV6Schema>
    | z.infer<typeof revolveFeatureParametersV7Schema>
    | null,
): NormalizedRevolveParameters | null {
  if (!parameters) return null
  const profile = parameters.profiles.profiles[0]
  return profile ? { ...parameters, profile } : null
}

type VariableValues = ReadonlyMap<string, ExpressionValue | EvaluatedVariable>

function expressionFailure(path: string, message: string, code: string) {
  return {
    ok: false,
    diagnostic: {
      code,
      message: "A part-design parameter expression is invalid.",
      issues: [{ path, message }],
    },
  } as const
}

function resolveLengthParameter(
  path: string,
  quantity: z.infer<typeof lengthQuantitySchema>,
  variables: VariableValues,
) {
  const resolved = resolveQuantityExpression(quantity, variables)
  if (!resolved.ok) {
    return expressionFailure(path, resolved.diagnostic.message, resolved.diagnostic.code)
  }
  const length = lengthQuantitySchema.safeParse(resolved.quantity)
  return length.success
    ? ({ ok: true, quantity: length.data } as const)
    : expressionFailure(path, "The expression did not resolve to a length.", "dimension-mismatch")
}

function resolveEdgeTreatmentParameters(
  schema: typeof filletFeatureParametersSchema | typeof chamferFeatureParametersSchema,
  parameter: "radius" | "distance",
) {
  return (parameters: unknown, variables: VariableValues) => {
    const parsed = schema.safeParse(parameters)
    if (!parsed.success) return { ok: true as const, parameters }
    const quantity = "radius" in parsed.data ? parsed.data.radius : parsed.data.distance
    const resolved = resolveLengthParameter(parameter, quantity, variables)
    return resolved.ok
      ? { ok: true as const, parameters: { ...parsed.data, [parameter]: resolved.quantity } }
      : resolved
  }
}

function resolvePrimitiveOrigin(
  origin: z.infer<typeof primitiveOriginSchema>,
  variables: VariableValues,
) {
  const x = resolveLengthParameter("origin.x", origin.x, variables)
  if (!x.ok) return x
  const y = resolveLengthParameter("origin.y", origin.y, variables)
  if (!y.ok) return y
  const z = resolveLengthParameter("origin.z", origin.z, variables)
  if (!z.ok) return z
  return {
    ok: true,
    origin: { x: x.quantity, y: y.quantity, z: z.quantity },
  } as const
}

function resolveBoxParameters(parameters: unknown, variables: VariableValues) {
  const parsed = boxFeatureParametersSchema.safeParse(parameters)
  if (!parsed.success) return { ok: true as const, parameters }
  const width = resolveLengthParameter("width", parsed.data.width, variables)
  if (!width.ok) return width
  const depth = resolveLengthParameter("depth", parsed.data.depth, variables)
  if (!depth.ok) return depth
  const height = resolveLengthParameter("height", parsed.data.height, variables)
  if (!height.ok) return height
  const origin = resolvePrimitiveOrigin(parsed.data.origin, variables)
  if (!origin.ok) return origin
  return {
    ok: true,
    parameters: {
      width: width.quantity,
      depth: depth.quantity,
      height: height.quantity,
      centered: parsed.data.centered,
      origin: origin.origin,
    },
  } as const
}

function resolveCylinderParameters(parameters: unknown, variables: VariableValues) {
  const parsed = cylinderFeatureParametersSchema.safeParse(parameters)
  if (!parsed.success) return { ok: true as const, parameters }
  const radius = resolveLengthParameter("radius", parsed.data.radius, variables)
  if (!radius.ok) return radius
  const height = resolveLengthParameter("height", parsed.data.height, variables)
  if (!height.ok) return height
  const origin = resolvePrimitiveOrigin(parsed.data.origin, variables)
  if (!origin.ok) return origin
  return {
    ok: true,
    parameters: {
      radius: radius.quantity,
      height: height.quantity,
      centered: parsed.data.centered,
      origin: origin.origin,
    },
  } as const
}

function resolvedPrimitiveParameters(schema: z.ZodType, parameters: unknown) {
  const parsed = schema.safeParse(parameters)
  if (parsed.success) return { ok: true as const, parameters: parsed.data }
  const issue = parsed.error.issues[0]
  return expressionFailure(
    issue?.path.join(".") ?? "",
    issue?.message ?? "Resolved primitive parameters are invalid.",
    "invalid-primitive-parameters",
  )
}

function resolveRadialPrimitiveParameters(
  schema:
    | typeof sphereFeatureParametersSchema
    | typeof coneFeatureParametersSchema
    | typeof pyramidFeatureParametersSchema
    | typeof torusFeatureParametersSchema,
  lengthParameters: readonly ("radius" | "height" | "majorRadius" | "minorRadius")[],
) {
  return (parameters: unknown, variables: VariableValues) => {
    const parsed = schema.safeParse(parameters)
    if (!parsed.success) return { ok: true as const, parameters }
    const resolvedParameters: Record<string, unknown> = { ...parsed.data }
    for (const parameter of lengthParameters) {
      const quantity = lengthQuantitySchema.safeParse(Reflect.get(parsed.data, parameter))
      if (!quantity.success)
        return expressionFailure(parameter, "Expected a primitive length.", "dimension-mismatch")
      const resolved = resolveLengthParameter(parameter, quantity.data, variables)
      if (!resolved.ok) return resolved
      resolvedParameters[parameter] = resolved.quantity
    }
    const origin = resolvePrimitiveOrigin(parsed.data.origin, variables)
    if (!origin.ok) return origin
    return resolvedPrimitiveParameters(schema, { ...resolvedParameters, origin: origin.origin })
  }
}

const legacyExtrusionExpressionParametersSchema = z.union([
  extrusionFeatureParametersV3Schema,
  extrusionFeatureParametersV4Schema,
  z
    .object({
      profile: sketchProfileSelectorSchema,
      distance: lengthQuantitySchema,
      symmetric: z.boolean(),
      operation: extrusionOperationSchema,
    })
    .strict(),
])

function resolveExtrusionExtentParameters(
  parameters: z.infer<typeof extrusionFeatureParametersV5Schema>,
  variables: VariableValues,
) {
  const distance = resolveLengthParameter("distance", parameters.distance, variables)
  if (!distance.ok) return distance
  const secondDistance =
    parameters.secondDistance === null
      ? ({ ok: true, quantity: null } as const)
      : resolveLengthParameter("secondDistance", parameters.secondDistance, variables)
  if (!secondDistance.ok) return secondDistance
  const resolved = extrusionFeatureParametersV5Schema.safeParse({
    ...parameters,
    distance: distance.quantity,
    secondDistance: secondDistance.quantity,
  })
  if (!resolved.success) {
    const issue = resolved.error.issues[0]
    return expressionFailure(
      issue?.path.join(".") ?? "distance",
      issue?.message ?? "Invalid extrusion extent.",
      "invalid-range",
    )
  }
  return { ok: true, parameters: resolved.data } as const
}

function resolveExtrusionParameters(parameters: unknown, variables: VariableValues) {
  const extent = extrusionFeatureParametersV5Schema.safeParse(parameters)
  if (extent.success) return resolveExtrusionExtentParameters(extent.data, variables)
  const parsed = legacyExtrusionExpressionParametersSchema.safeParse(parameters)
  if (!parsed.success) return { ok: true as const, parameters }
  const distance = resolveLengthParameter("distance", parsed.data.distance, variables)
  if (!distance.ok) return distance
  return {
    ok: true,
    parameters: { ...parsed.data, distance: distance.quantity },
  } as const
}

export const boxFeatureType = featureTypeDescriptorSchema.parse({
  schemaVersion: 0,
  type: {
    moduleId: "org.vibeshape.core.part-design",
    moduleVersion: "0.1.0",
    typeId: "org.vibeshape.feature.part-design.box",
    schemaVersion: 1,
  },
  classification: "solid",
  dependencies: { min: 0, max: 0 },
  references: { min: 0, max: 0 },
})

export const cylinderFeatureType = featureTypeDescriptorSchema.parse({
  schemaVersion: 0,
  type: {
    moduleId: "org.vibeshape.core.part-design",
    moduleVersion: "0.1.0",
    typeId: "org.vibeshape.feature.part-design.cylinder",
    schemaVersion: 1,
  },
  classification: "solid",
  dependencies: { min: 0, max: 0 },
  references: { min: 0, max: 0 },
})

export const sphereFeatureType = featureTypeDescriptorSchema.parse({
  schemaVersion: 0,
  type: {
    moduleId: "org.vibeshape.core.part-design",
    moduleVersion: "0.1.0",
    typeId: "org.vibeshape.feature.part-design.sphere",
    schemaVersion: 1,
  },
  classification: "solid",
  dependencies: { min: 0, max: 0 },
  references: { min: 0, max: 0 },
})

export const coneFeatureType = featureTypeDescriptorSchema.parse({
  schemaVersion: 0,
  type: {
    moduleId: "org.vibeshape.core.part-design",
    moduleVersion: "0.1.0",
    typeId: "org.vibeshape.feature.part-design.cone",
    schemaVersion: 1,
  },
  classification: "solid",
  dependencies: { min: 0, max: 0 },
  references: { min: 0, max: 0 },
})

export const pyramidFeatureType = featureTypeDescriptorSchema.parse({
  schemaVersion: 0,
  type: {
    moduleId: "org.vibeshape.core.part-design",
    moduleVersion: "0.1.0",
    typeId: "org.vibeshape.feature.part-design.pyramid",
    schemaVersion: 1,
  },
  classification: "solid",
  dependencies: { min: 0, max: 0 },
  references: { min: 0, max: 0 },
})

export const torusFeatureType = featureTypeDescriptorSchema.parse({
  schemaVersion: 0,
  type: {
    moduleId: "org.vibeshape.core.part-design",
    moduleVersion: "0.1.0",
    typeId: "org.vibeshape.feature.part-design.torus",
    schemaVersion: 1,
  },
  classification: "solid",
  dependencies: { min: 0, max: 0 },
  references: { min: 0, max: 0 },
})

export const booleanFeatureType = featureTypeDescriptorSchema.parse({
  schemaVersion: 0,
  type: {
    moduleId: "org.vibeshape.core.part-design",
    moduleVersion: "0.1.0",
    typeId: "org.vibeshape.feature.part-design.boolean",
    schemaVersion: 1,
  },
  classification: "solid",
  dependencies: { min: 2, max: 2 },
  references: { min: 0, max: 0 },
})

export const filletFeatureType = featureTypeDescriptorSchema.parse({
  schemaVersion: 0,
  type: {
    moduleId: "org.vibeshape.core.part-design",
    moduleVersion: "0.1.0",
    typeId: "org.vibeshape.feature.part-design.fillet",
    schemaVersion: 1,
  },
  classification: "solid",
  dependencies: { min: 1, max: 1 },
  references: { min: 0, max: 0 },
})

export const chamferFeatureType = featureTypeDescriptorSchema.parse({
  schemaVersion: 0,
  type: {
    moduleId: "org.vibeshape.core.part-design",
    moduleVersion: "0.1.0",
    typeId: "org.vibeshape.feature.part-design.chamfer",
    schemaVersion: 1,
  },
  classification: "solid",
  dependencies: { min: 1, max: 1 },
  references: { min: 0, max: 0 },
})

export const filletFeatureTypeV2 = featureTypeDescriptorSchema.parse({
  schemaVersion: 0,
  type: {
    moduleId: "org.vibeshape.core.part-design",
    moduleVersion: "0.1.0",
    typeId: "org.vibeshape.feature.part-design.fillet",
    schemaVersion: 2,
  },
  classification: "solid",
  dependencies: { min: 1, max: 1 },
  references: { min: 1, max: 256 },
})

export const chamferFeatureTypeV2 = featureTypeDescriptorSchema.parse({
  schemaVersion: 0,
  type: {
    moduleId: "org.vibeshape.core.part-design",
    moduleVersion: "0.1.0",
    typeId: "org.vibeshape.feature.part-design.chamfer",
    schemaVersion: 2,
  },
  classification: "solid",
  dependencies: { min: 1, max: 1 },
  references: { min: 1, max: 256 },
})

export const legacyExtrusionFeatureType = featureTypeDescriptorSchema.parse({
  schemaVersion: 0,
  type: {
    moduleId: "org.vibeshape.core.part-design",
    moduleVersion: "0.1.0",
    typeId: "org.vibeshape.feature.part-design.extrusion",
    schemaVersion: 1,
  },
  classification: "solid",
  dependencies: { min: 0, max: 0 },
  references: { min: 0, max: 0 },
})

export const extrusionFeatureType = featureTypeDescriptorSchema.parse({
  schemaVersion: 0,
  type: {
    moduleId: "org.vibeshape.core.part-design",
    moduleVersion: "0.1.0",
    typeId: "org.vibeshape.feature.part-design.extrusion",
    schemaVersion: 2,
  },
  classification: "solid",
  dependencies: { min: 0, max: 2 },
  references: { min: 0, max: 1 },
})

export const extrusionFeatureTypeV3 = featureTypeDescriptorSchema.parse({
  schemaVersion: 0,
  type: {
    moduleId: "org.vibeshape.core.part-design",
    moduleVersion: "0.1.0",
    typeId: "org.vibeshape.feature.part-design.extrusion",
    schemaVersion: 3,
  },
  classification: "solid",
  dependencies: { min: 0, max: 2 },
  references: { min: 0, max: 1 },
})
export const multiProfileExtrusionFeatureType = extrusionFeatureTypeV3

export const extrusionFeatureTypeV4 = featureTypeDescriptorSchema.parse({
  schemaVersion: 0,
  type: {
    moduleId: "org.vibeshape.core.part-design",
    moduleVersion: "0.1.0",
    typeId: "org.vibeshape.feature.part-design.extrusion",
    schemaVersion: 4,
  },
  classification: "solid",
  dependencies: { min: 1, max: 2 },
  references: { min: 0, max: 1 },
})

export const extrusionFeatureTypeV5 = featureTypeDescriptorSchema.parse({
  schemaVersion: 0,
  type: {
    moduleId: "org.vibeshape.core.part-design",
    moduleVersion: "0.1.0",
    typeId: "org.vibeshape.feature.part-design.extrusion",
    schemaVersion: 5,
  },
  classification: "solid",
  dependencies: { min: 0, max: 2 },
  references: { min: 0, max: 1 },
})
export const extrusionFeatureTypeV6 = featureTypeDescriptorSchema.parse({
  ...extrusionFeatureTypeV5,
  type: { ...extrusionFeatureTypeV5.type, schemaVersion: 6 },
  dependencies: { min: 0, max: 3 },
})
export const extrusionFeatureTypeV7 = featureTypeDescriptorSchema.parse({
  ...extrusionFeatureTypeV6,
  type: { ...extrusionFeatureTypeV6.type, schemaVersion: 7 },
})
export const extrusionFeatureTypeV8 = featureTypeDescriptorSchema.parse({
  ...extrusionFeatureTypeV6,
  type: { ...extrusionFeatureTypeV6.type, schemaVersion: 8 },
  dependencies: { min: 0, max: 66 },
  references: { min: 0, max: 64 },
})

export const revolveFeatureType = featureTypeDescriptorSchema.parse({
  schemaVersion: 0,
  type: {
    moduleId: "org.vibeshape.core.part-design",
    moduleVersion: "0.1.0",
    typeId: "org.vibeshape.feature.part-design.revolve",
    schemaVersion: 4,
  },
  classification: "solid",
  dependencies: { min: 0, max: 3 },
  references: { min: 0, max: 1 },
})

export const revolveFeatureTypeV5 = featureTypeDescriptorSchema.parse({
  schemaVersion: 0,
  type: {
    moduleId: "org.vibeshape.core.part-design",
    moduleVersion: "0.1.0",
    typeId: "org.vibeshape.feature.part-design.revolve",
    schemaVersion: 5,
  },
  classification: "solid",
  dependencies: { min: 0, max: 3 },
  references: { min: 0, max: 1 },
})
export const multiProfileRevolveFeatureType = revolveFeatureTypeV5

export const revolveFeatureTypeV6 = featureTypeDescriptorSchema.parse({
  schemaVersion: 0,
  type: {
    moduleId: "org.vibeshape.core.part-design",
    moduleVersion: "0.1.0",
    typeId: "org.vibeshape.feature.part-design.revolve",
    schemaVersion: 6,
  },
  classification: "solid",
  dependencies: { min: 1, max: 3 },
  references: { min: 0, max: 1 },
})

export const revolveFeatureTypeV7 = featureTypeDescriptorSchema.parse({
  ...revolveFeatureTypeV6,
  type: { ...revolveFeatureTypeV6.type, schemaVersion: 7 },
})

export const legacyRevolveFeatureTypeV3 = featureTypeDescriptorSchema.parse({
  schemaVersion: 0,
  type: {
    moduleId: "org.vibeshape.core.part-design",
    moduleVersion: "0.1.0",
    typeId: "org.vibeshape.feature.part-design.revolve",
    schemaVersion: 3,
  },
  classification: "solid",
  dependencies: { min: 0, max: 2 },
  references: { min: 0, max: 1 },
})

export const legacyRevolveFeatureTypeV2 = featureTypeDescriptorSchema.parse({
  schemaVersion: 0,
  type: {
    moduleId: "org.vibeshape.core.part-design",
    moduleVersion: "0.1.0",
    typeId: "org.vibeshape.feature.part-design.revolve",
    schemaVersion: 2,
  },
  classification: "solid",
  dependencies: { min: 0, max: 2 },
  references: { min: 0, max: 1 },
})

export const legacyRevolveFeatureType = featureTypeDescriptorSchema.parse({
  schemaVersion: 0,
  type: {
    moduleId: "org.vibeshape.core.part-design",
    moduleVersion: "0.1.0",
    typeId: "org.vibeshape.feature.part-design.revolve",
    schemaVersion: 1,
  },
  classification: "solid",
  dependencies: { min: 0, max: 1 },
  references: { min: 0, max: 1 },
})

export function isExtrusionType(feature: Pick<FeatureRecord, "type">) {
  const type = feature.type
  if (!type) return false
  return [
    legacyExtrusionFeatureType.type,
    extrusionFeatureType.type,
    extrusionFeatureTypeV3.type,
    extrusionFeatureTypeV4.type,
    extrusionFeatureTypeV5.type,
    extrusionFeatureTypeV6.type,
    extrusionFeatureTypeV7.type,
    extrusionFeatureTypeV8.type,
  ].some(
    (expected) =>
      type.moduleId === expected.moduleId &&
      type.moduleVersion === expected.moduleVersion &&
      type.typeId === expected.typeId &&
      type.schemaVersion === expected.schemaVersion,
  )
}

type ExtrusionParameters =
  | z.infer<typeof extrusionFeatureParametersSchema>
  | z.infer<typeof extrusionFeatureParametersV3Schema>
  | z.infer<typeof extrusionFeatureParametersV4Schema>
  | z.infer<typeof extrusionFeatureParametersV5Schema>
  | z.infer<typeof extrusionFeatureParametersV6Schema>
  | z.infer<typeof extrusionFeatureParametersV7Schema>
  | z.infer<typeof extrusionFeatureParametersV8Schema>

const extrusionParameterSchemas = new Map<number, z.ZodType<ExtrusionParameters>>([
  [1, legacyExtrusionFeatureParametersSchema],
  [2, extrusionFeatureParametersSchema],
  [3, extrusionFeatureParametersV3Schema],
  [4, extrusionFeatureParametersV4Schema],
  [5, extrusionFeatureParametersV5Schema],
  [6, extrusionFeatureParametersV6Schema],
  [7, extrusionFeatureParametersV7Schema],
  [8, extrusionFeatureParametersV8Schema],
])

export function readExtrusionFeatureParameters(
  feature: Pick<FeatureRecord, "type" | "parameters">,
): NormalizedExtrusionParameters | null {
  if (!isExtrusionType(feature)) return null
  const schema = extrusionParameterSchemas.get(feature.type.schemaVersion)
  if (!schema) return null
  const parsed = schema.safeParse(feature.parameters)
  if (!parsed.success) return null
  const parameters = { reversed: false, secondDistance: null, ...parsed.data }
  if (!("profiles" in parameters)) return parameters
  const profile = parameters.profiles.profiles[0]
  return profile ? { ...parameters, profile } : null
}

export function readExtrusionProfileSet(feature: FeatureRecord) {
  const parameters = readExtrusionFeatureParameters(feature)
  return parameters
    ? createSketchProfileSet(parameters.profiles?.profiles ?? [parameters.profile])
    : null
}

export function isRevolveType(feature: FeatureRecord) {
  const type = feature.type
  return [
    legacyRevolveFeatureType.type,
    legacyRevolveFeatureTypeV2.type,
    legacyRevolveFeatureTypeV3.type,
    revolveFeatureType.type,
    revolveFeatureTypeV5.type,
    revolveFeatureTypeV6.type,
    revolveFeatureTypeV7.type,
  ].some(
    (expected) =>
      type.moduleId === expected.moduleId &&
      type.moduleVersion === expected.moduleVersion &&
      type.typeId === expected.typeId &&
      type.schemaVersion === expected.schemaVersion,
  )
}

export function readRevolveFeatureParameters(
  feature: FeatureRecord,
): NormalizedRevolveParameters | null {
  if (!isRevolveType(feature)) return null
  switch (feature.type.schemaVersion) {
    case 1:
      return normalizeLegacyOriginAxisRevolveParameters(
        parseRevolveParameters(legacyRevolveFeatureParametersSchema, feature.parameters),
      )
    case 2:
      return normalizeLegacyOriginAxisRevolveParameters(
        parseRevolveParameters(legacyRevolveFeatureParametersV2Schema, feature.parameters),
      )
    case 3:
      return parseRevolveParameters(legacyRevolveFeatureParametersV3Schema, feature.parameters)
    case 4:
      return parseRevolveParameters(revolveFeatureParametersSchema, feature.parameters)
    case 5:
      return normalizeMultiProfileRevolveParameters(
        parseRevolveParameters(revolveFeatureParametersV5Schema, feature.parameters),
      )
    case 6:
      return normalizeMultiProfileRevolveParameters(
        parseRevolveParameters(revolveFeatureParametersV6Schema, feature.parameters),
      )
    case 7:
      return normalizeMultiProfileRevolveParameters(
        parseRevolveParameters(revolveFeatureParametersV7Schema, feature.parameters),
      )
    default:
      return null
  }
}

export function readRevolveProfileSet(feature: FeatureRecord) {
  const parameters = readRevolveFeatureParameters(feature)
  return parameters
    ? createSketchProfileSet(parameters.profiles?.profiles ?? [parameters.profile])
    : null
}

export function revolveAxisSourceFeatureId(
  axis: z.infer<typeof revolveAxisSchema>,
): FeatureId | null {
  return axis.kind === "model-edge" ? axis.reference.featureId : null
}

export function expectedRevolveDependencyIds(
  parameters: z.infer<typeof revolveFeatureParametersSchema>,
  targetFeatureId: FeatureId | null,
  supportFeatureIds: readonly FeatureId[],
) {
  const axisSourceFeatureId = revolveAxisSourceFeatureId(parameters.axis)
  const ordered = [
    ...(parameters.operation === "new" ? [] : targetFeatureId ? [targetFeatureId] : []),
    ...supportFeatureIds,
    ...(axisSourceFeatureId ? [axisSourceFeatureId] : []),
  ]
  return ordered.filter((featureId, index) => ordered.indexOf(featureId) === index)
}

function resolveRevolveParameters(parameters: unknown, variables: VariableValues) {
  const parsed = z
    .union([
      legacyRevolveFeatureParametersSchema,
      legacyRevolveFeatureParametersV2Schema,
      legacyRevolveFeatureParametersV3Schema,
      revolveFeatureParametersSchema,
      revolveFeatureParametersV5Schema,
      revolveFeatureParametersV6Schema,
      revolveFeatureParametersV7Schema,
    ])
    .safeParse(parameters)
  if (!parsed.success) return { ok: true as const, parameters }
  const angle = resolveQuantityExpression(parsed.data.angle, variables)
  if (!angle.ok) return expressionFailure("angle", angle.diagnostic.message, angle.diagnostic.code)
  const resolved = revolveAngleSchema.safeParse(angle.quantity)
  return resolved.success
    ? ({ ok: true, parameters: { ...parsed.data, angle: resolved.data } } as const)
    : expressionFailure(
        "angle",
        "The expression did not resolve to a bounded angle.",
        "invalid-angle",
      )
}

function revolveFeatureInvariant(feature: FeatureRecord) {
  const parameters = readRevolveFeatureParameters(feature)
  if (!parameters) return []
  return [revolveSketchAxisIssue(parameters), revolveDependencyIssue(feature, parameters)].flatMap(
    (issue) => (issue ? [issue] : []),
  )
}

function revolveSketchAxisIssue(
  parameters: NonNullable<ReturnType<typeof readRevolveFeatureParameters>>,
) {
  if (
    parameters.axis.kind === "sketch-line" &&
    parameters.axis.sketchId !== parameters.profile.sketchId
  ) {
    return {
      path: "parameters.axis.sketchId",
      message: "A sketch-line revolve axis must belong to the selected profile sketch.",
    }
  }
  return null
}

function revolveTargetOwner(
  feature: FeatureRecord,
  parameters: NonNullable<ReturnType<typeof readRevolveFeatureParameters>>,
) {
  if (parameters.operation === "new") return null
  return parameters.targetBody?.featureId ?? feature.dependencies[0] ?? null
}
function revolveDependencyIssue(
  feature: FeatureRecord,
  parameters: NonNullable<ReturnType<typeof readRevolveFeatureParameters>>,
) {
  const expectedDependencies = expectedRevolveDependencyIds(
    parameters,
    revolveTargetOwner(feature, parameters),
    feature.references.map(({ featureId }) => featureId),
  )
  const matches =
    (parameters.operation === "new" || feature.dependencies.length > 0) &&
    feature.dependencies.length === expectedDependencies.length &&
    feature.dependencies.every(
      (dependencyId, index) => dependencyId === expectedDependencies[index],
    )
  if (!matches) {
    return {
      path: "dependencies",
      message:
        parameters.operation === "new"
          ? "New-body revolve dependencies must match its sketch support and model-edge axis source."
          : `${parameters.operation} revolve requires its target first, followed by distinct sketch-support and model-edge axis sources.`,
    }
  }
  return null
}

function modifyingMultiProfileExtrusionDependencyIssue(
  feature: FeatureRecord,
  operation: "add" | "remove" | "intersect",
) {
  const targetFeatureId = feature.dependencies[0]
  if (!targetFeatureId) {
    return {
      path: "dependencies",
      message: `${operation} multi-profile extrusion requires one explicit target dependency.`,
    }
  }
  const expectedDependencies = [
    targetFeatureId,
    ...feature.references.flatMap(({ featureId }) =>
      featureId === targetFeatureId ? [] : [featureId],
    ),
  ]
  const valid =
    feature.dependencies.length === expectedDependencies.length &&
    feature.dependencies.every(
      (dependencyId, index) => dependencyId === expectedDependencies[index],
    )
  return valid
    ? null
    : {
        path: "dependencies",
        message: `${operation} multi-profile extrusion requires its target first, followed by any distinct sketch-support dependency.`,
      }
}

function singleProfileExtrusionDependencyIssue(
  feature: FeatureRecord,
  supportDependencyCount: number,
  operation: "new" | "add" | "remove" | "intersect",
) {
  const minimumDependencyCount = operation === "new" ? supportDependencyCount : 1
  const maximumDependencyCount =
    operation === "new" ? supportDependencyCount : supportDependencyCount + 1
  const valid =
    feature.dependencies.length >= minimumDependencyCount &&
    feature.dependencies.length <= maximumDependencyCount
  return valid
    ? null
    : {
        path: "dependencies",
        message:
          operation === "new"
            ? "New-body extrusion dependencies must match its sketch-support references."
            : `${operation} extrusion requires one target plus any distinct sketch-support dependency.`,
      }
}

function extrusionDependencyIssue(feature: FeatureRecord) {
  const extent = extrusionFeatureParametersV5Schema.safeParse(feature.parameters)
  if (extent.success) {
    if (extent.data.operation !== "new") {
      return modifyingMultiProfileExtrusionDependencyIssue(feature, extent.data.operation)
    }
    const expected = feature.references.map(({ featureId }) => featureId)
    return feature.dependencies.length === expected.length &&
      feature.dependencies.every((id, index) => id === expected[index])
      ? null
      : {
          path: "dependencies",
          message: "New-body extrusion dependencies must match its sketch-support references.",
        }
  }
  const supportDependencyCount = new Set(feature.references.map(({ featureId }) => featureId)).size
  const modifyingMultiProfile = extrusionFeatureParametersV4Schema.safeParse(feature.parameters)
  if (modifyingMultiProfile.success) {
    return modifyingMultiProfileExtrusionDependencyIssue(
      feature,
      modifyingMultiProfile.data.operation,
    )
  }
  const multiProfile = extrusionFeatureParametersV3Schema.safeParse(feature.parameters)
  if (multiProfile.success) {
    return feature.dependencies.length === supportDependencyCount
      ? null
      : {
          path: "dependencies",
          message:
            "Multi-profile new-body extrusion dependencies must match sketch-support references.",
        }
  }
  const parameters = extrusionFeatureParametersSchema.safeParse(feature.parameters)
  if (!parameters.success) return null
  return singleProfileExtrusionDependencyIssue(
    feature,
    supportDependencyCount,
    parameters.data.operation,
  )
}

function extrusionFeatureInvariant(feature: FeatureRecord) {
  const issue = extrusionDependencyIssue(feature)
  return issue ? [issue] : []
}

function advancedExtrusionContentParameters(value: ExtrusionFeatureParametersV6) {
  return {
    ...value,
    distance: value.distance.value,
    secondDistance: value.secondDistance?.value ?? null,
    startOffset: value.startOffset.value,
    draftAngle: value.draftAngle.value,
  }
}

export const partDesignFeatureTypeHandlers: readonly TrustedFeatureTypeHandler[] = [
  {
    type: boxFeatureType.type,
    parametersSchema: boxFeatureParametersSchema,
    resolveParameters: resolveBoxParameters,
    contentParameters(parameters) {
      const box = boxFeatureParametersSchema.parse(parameters)
      return boxFeatureContentParametersSchema.parse({
        width: box.width.value,
        depth: box.depth.value,
        height: box.height.value,
        centered: box.centered,
        origin: [box.origin.x.value, box.origin.y.value, box.origin.z.value],
      })
    },
  },
  {
    type: cylinderFeatureType.type,
    parametersSchema: cylinderFeatureParametersSchema,
    resolveParameters: resolveCylinderParameters,
    contentParameters(parameters) {
      const cylinder = cylinderFeatureParametersSchema.parse(parameters)
      return cylinderFeatureContentParametersSchema.parse({
        radius: cylinder.radius.value,
        height: cylinder.height.value,
        centered: cylinder.centered,
        origin: [cylinder.origin.x.value, cylinder.origin.y.value, cylinder.origin.z.value],
      })
    },
  },
  {
    type: sphereFeatureType.type,
    parametersSchema: sphereFeatureParametersSchema,
    resolveParameters: resolveRadialPrimitiveParameters(sphereFeatureParametersSchema, ["radius"]),
    contentParameters(parameters) {
      const sphere = sphereFeatureParametersSchema.parse(parameters)
      return sphereFeatureContentParametersSchema.parse({
        radius: sphere.radius.value,
        origin: [sphere.origin.x.value, sphere.origin.y.value, sphere.origin.z.value],
      })
    },
  },
  {
    type: coneFeatureType.type,
    parametersSchema: coneFeatureParametersSchema,
    resolveParameters: resolveRadialPrimitiveParameters(coneFeatureParametersSchema, [
      "radius",
      "height",
    ]),
    contentParameters(parameters) {
      const cone = coneFeatureParametersSchema.parse(parameters)
      return coneFeatureContentParametersSchema.parse({
        radius: cone.radius.value,
        height: cone.height.value,
        centered: cone.centered,
        origin: [cone.origin.x.value, cone.origin.y.value, cone.origin.z.value],
      })
    },
  },
  {
    type: pyramidFeatureType.type,
    parametersSchema: pyramidFeatureParametersSchema,
    resolveParameters: resolveRadialPrimitiveParameters(pyramidFeatureParametersSchema, [
      "radius",
      "height",
    ]),
    contentParameters(parameters) {
      const pyramid = pyramidFeatureParametersSchema.parse(parameters)
      return pyramidFeatureContentParametersSchema.parse({
        sides: pyramid.sides,
        radius: pyramid.radius.value,
        height: pyramid.height.value,
        centered: pyramid.centered,
        origin: [pyramid.origin.x.value, pyramid.origin.y.value, pyramid.origin.z.value],
      })
    },
  },
  {
    type: torusFeatureType.type,
    parametersSchema: torusFeatureParametersSchema,
    resolveParameters: resolveRadialPrimitiveParameters(torusFeatureParametersSchema, [
      "majorRadius",
      "minorRadius",
    ]),
    contentParameters(parameters) {
      const torus = torusFeatureParametersSchema.parse(parameters)
      return torusFeatureContentParametersSchema.parse({
        majorRadius: torus.majorRadius.value,
        minorRadius: torus.minorRadius.value,
        origin: [torus.origin.x.value, torus.origin.y.value, torus.origin.z.value],
      })
    },
  },
  {
    type: booleanFeatureType.type,
    parametersSchema: booleanFeatureParametersSchema,
    contentParameters(parameters) {
      const { operation } = booleanFeatureParametersSchema.parse(parameters)
      return booleanFeatureContentParametersSchema.parse({ operation })
    },
  },
  {
    type: filletFeatureType.type,
    parametersSchema: filletFeatureParametersSchema,
    resolveParameters: resolveEdgeTreatmentParameters(filletFeatureParametersSchema, "radius"),
    contentParameters(parameters) {
      const fillet = filletFeatureParametersSchema.parse(parameters)
      return { radius: fillet.radius.value }
    },
  },
  {
    type: filletFeatureTypeV2.type,
    parametersSchema: filletFeatureParametersSchema,
    validateFeature: selectedEdgeTreatmentInvariant,
    resolveParameters: resolveEdgeTreatmentParameters(filletFeatureParametersSchema, "radius"),
    contentParameters(parameters) {
      const fillet = filletFeatureParametersSchema.parse(parameters)
      return { radius: fillet.radius.value }
    },
  },
  {
    type: chamferFeatureType.type,
    parametersSchema: chamferFeatureParametersSchema,
    resolveParameters: resolveEdgeTreatmentParameters(chamferFeatureParametersSchema, "distance"),
    contentParameters(parameters) {
      const chamfer = chamferFeatureParametersSchema.parse(parameters)
      return { distance: chamfer.distance.value }
    },
  },
  {
    type: chamferFeatureTypeV2.type,
    parametersSchema: chamferFeatureParametersSchema,
    validateFeature: selectedEdgeTreatmentInvariant,
    resolveParameters: resolveEdgeTreatmentParameters(chamferFeatureParametersSchema, "distance"),
    contentParameters(parameters) {
      const chamfer = chamferFeatureParametersSchema.parse(parameters)
      return { distance: chamfer.distance.value }
    },
  },
  chamferFeatureTypeHandlerV3,
  {
    type: legacyExtrusionFeatureType.type,
    parametersSchema: legacyExtrusionFeatureParametersSchema,
    resolveParameters: resolveExtrusionParameters,
    contentParameters(parameters) {
      const extrusion = legacyExtrusionFeatureParametersSchema.parse(parameters)
      return extrusionFeatureAuthoredContentParametersSchema.parse({
        profile: extrusion.profile,
        distance: extrusion.distance.value,
        symmetric: extrusion.symmetric,
        operation: extrusion.operation,
      })
    },
  },
  {
    type: extrusionFeatureType.type,
    parametersSchema: extrusionFeatureParametersSchema,
    validateFeature: extrusionFeatureInvariant,
    resolveParameters: resolveExtrusionParameters,
    contentParameters(parameters) {
      const extrusion = extrusionFeatureParametersSchema.parse(parameters)
      return extrusionFeatureAuthoredContentParametersSchema.parse({
        profile: extrusion.profile,
        distance: extrusion.distance.value,
        symmetric: extrusion.symmetric,
        operation: extrusion.operation,
      })
    },
  },
  {
    type: extrusionFeatureTypeV3.type,
    parametersSchema: extrusionFeatureParametersV3Schema,
    validateFeature: extrusionFeatureInvariant,
    resolveParameters: resolveExtrusionParameters,
    contentParameters(parameters) {
      const extrusion = extrusionFeatureParametersV3Schema.parse(parameters)
      return extrusionFeatureAuthoredContentParametersV3Schema.parse({
        profiles: extrusion.profiles,
        distance: extrusion.distance.value,
        symmetric: extrusion.symmetric,
        operation: extrusion.operation,
      })
    },
  },
  {
    type: extrusionFeatureTypeV4.type,
    parametersSchema: extrusionFeatureParametersV4Schema,
    validateFeature: extrusionFeatureInvariant,
    resolveParameters: resolveExtrusionParameters,
    contentParameters(parameters) {
      const extrusion = extrusionFeatureParametersV4Schema.parse(parameters)
      return extrusionFeatureAuthoredContentParametersV4Schema.parse({
        profiles: extrusion.profiles,
        distance: extrusion.distance.value,
        symmetric: extrusion.symmetric,
        operation: extrusion.operation,
      })
    },
  },
  {
    type: extrusionFeatureTypeV5.type,
    parametersSchema: extrusionFeatureParametersV5Schema,
    validateFeature: extrusionFeatureInvariant,
    resolveParameters: resolveExtrusionParameters,
    contentParameters(parameters) {
      const extrusion = extrusionFeatureParametersV5Schema.parse(parameters)
      return extrusionFeatureAuthoredContentParametersV5Schema.parse({
        ...extrusion,
        distance: extrusion.distance.value,
        secondDistance: extrusion.secondDistance?.value ?? null,
      })
    },
  },
  {
    type: legacyRevolveFeatureType.type,
    parametersSchema: legacyRevolveFeatureParametersSchema,
    validateFeature: revolveFeatureInvariant,
    resolveParameters: resolveRevolveParameters,
    contentParameters(parameters) {
      const revolve = legacyRevolveFeatureParametersSchema.parse(parameters)
      return {
        profile: revolve.profile,
        axis: { kind: "origin-axis", axis: revolve.axis } as const,
        angle: revolve.angle.value,
        operation: "new" as const,
      }
    },
  },
  {
    type: legacyRevolveFeatureTypeV2.type,
    parametersSchema: legacyRevolveFeatureParametersV2Schema,
    validateFeature: revolveFeatureInvariant,
    resolveParameters: resolveRevolveParameters,
    contentParameters(parameters) {
      const revolve = legacyRevolveFeatureParametersV2Schema.parse(parameters)
      return {
        profile: revolve.profile,
        axis: { kind: "origin-axis", axis: revolve.axis },
        angle: revolve.angle.value,
        operation: revolve.operation,
      }
    },
  },
  {
    type: legacyRevolveFeatureTypeV3.type,
    parametersSchema: legacyRevolveFeatureParametersV3Schema,
    validateFeature: revolveFeatureInvariant,
    resolveParameters: resolveRevolveParameters,
    contentParameters(parameters) {
      const revolve = legacyRevolveFeatureParametersV3Schema.parse(parameters)
      return {
        profile: revolve.profile,
        axis: revolve.axis,
        angle: revolve.angle.value,
        operation: revolve.operation,
      }
    },
  },
  {
    type: revolveFeatureType.type,
    parametersSchema: revolveFeatureParametersSchema,
    validateFeature: revolveFeatureInvariant,
    resolveParameters: resolveRevolveParameters,
    contentParameters(parameters) {
      const revolve = revolveFeatureParametersSchema.parse(parameters)
      return {
        profile: revolve.profile,
        axis: revolve.axis,
        angle: revolve.angle.value,
        operation: revolve.operation,
      }
    },
  },
  {
    type: revolveFeatureTypeV5.type,
    parametersSchema: revolveFeatureParametersV5Schema,
    validateFeature: revolveFeatureInvariant,
    resolveParameters: resolveRevolveParameters,
    contentParameters(parameters) {
      const revolve = revolveFeatureParametersV5Schema.parse(parameters)
      return {
        profiles: revolve.profiles,
        axis: revolve.axis,
        angle: revolve.angle.value,
        operation: revolve.operation,
      }
    },
  },
  {
    type: revolveFeatureTypeV6.type,
    parametersSchema: revolveFeatureParametersV6Schema,
    validateFeature: revolveFeatureInvariant,
    resolveParameters: resolveRevolveParameters,
    contentParameters(parameters) {
      const revolve = revolveFeatureParametersV6Schema.parse(parameters)
      return {
        profiles: revolve.profiles,
        axis: revolve.axis,
        angle: revolve.angle.value,
        operation: revolve.operation,
      }
    },
  },
  {
    type: revolveFeatureTypeV7.type,
    parametersSchema: revolveFeatureParametersV7Schema,
    validateFeature: revolveFeatureInvariant,
    resolveParameters: resolveRevolveParameters,
    contentParameters(parameters) {
      const revolve = revolveFeatureParametersV7Schema.parse(parameters)
      return {
        profiles: revolve.profiles,
        axis: revolve.axis,
        angle: revolve.angle.value,
        operation: revolve.operation,
      }
    },
  },
  booleanFeatureTypeHandlerV2,
  {
    type: extrusionFeatureTypeV6.type,
    parametersSchema: extrusionFeatureParametersV6Schema,
    validateFeature: extrusionV6Invariant,
    resolveParameters: resolveExtrusionV6Parameters,
    contentParameters(parameters) {
      return advancedExtrusionContentParameters(
        extrusionFeatureParametersV6Schema.parse(parameters),
      )
    },
  },
  {
    type: extrusionFeatureTypeV7.type,
    parametersSchema: extrusionFeatureParametersV7Schema,
    validateFeature: (feature) => extrusionV6Invariant(feature, extrusionFeatureParametersV7Schema),
    resolveParameters: (parameters, variables) =>
      resolveExtrusionV6Parameters(parameters, variables, extrusionFeatureParametersV7Schema),
    contentParameters(parameters) {
      return advancedExtrusionContentParameters(
        extrusionFeatureParametersV7Schema.parse(parameters),
      )
    },
  },
  {
    type: extrusionFeatureTypeV8.type,
    parametersSchema: extrusionFeatureParametersV8Schema,
    validateFeature: extrusionV8Invariant,
    resolveParameters: (parameters, variables) =>
      resolveExtrusionV6Parameters(parameters, variables, extrusionFeatureParametersV8Schema),
    contentParameters(parameters) {
      return advancedExtrusionContentParameters(
        extrusionFeatureParametersV8Schema.parse(parameters),
      )
    },
  },
  fdmFeatureTypeHandler,
  holeFeatureTypeHandler,
  holeFeatureTypeHandlerV2,
  holeFeatureTypeHandlerV3,
  placementFeatureTypeHandler,
  mirrorFeatureTypeHandler,
  mirrorFeatureTypeHandlerV2,
  mirrorFeatureTypeHandlerV3,
  patternFeatureTypeHandler,
  patternFeatureTypeHandlerV2,
  shellFeatureTypeHandler,
  shellFeatureTypeHandlerV2,
  splitFeatureTypeHandler,
  splitFeatureTypeHandlerV2,
  loftFeatureTypeHandler,
  loftFeatureTypeHandlerV2,
  loftFeatureTypeHandlerV3,
  sweepFeatureTypeHandler,
  importedFeatureTypeHandler,
  meshImportFeatureTypeHandler,
  threadFeatureTypeHandler,
  threadFeatureTypeHandlerV2,
  compoundFeatureTypeHandler,
  compoundFeatureTypeV2Handler,
  unionFeatureTypeHandler,
  unionFeatureTypeV2Handler,
]
