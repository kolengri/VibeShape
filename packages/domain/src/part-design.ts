import { z } from "zod"
import type { FeatureRecord } from "./feature-graph"
import { featureTypeDescriptorSchema } from "./feature-type-contracts"
import type { TrustedFeatureTypeHandler } from "./feature-type-registry"
import { type FeatureId, sketchEntityIdSchema, sketchIdSchema } from "./identifiers"
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

export const booleanFeatureParametersSchema = z
  .object({ operation: z.literal("subtract") })
  .strict()

export const booleanFeatureContentParametersSchema = booleanFeatureParametersSchema

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

type NormalizedExtrusionParameters = z.infer<typeof extrusionFeatureParametersSchema> & {
  profiles?: z.infer<typeof sketchProfileSetSchema>
}
type NormalizedRevolveParameters = z.infer<typeof revolveFeatureParametersSchema> & {
  profiles?: z.infer<typeof sketchProfileSetSchema>
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

function resolveExtrusionParameters(parameters: unknown, variables: VariableValues) {
  const multiProfile = z
    .union([extrusionFeatureParametersV3Schema, extrusionFeatureParametersV4Schema])
    .safeParse(parameters)
  if (multiProfile.success) {
    const distance = resolveLengthParameter("distance", multiProfile.data.distance, variables)
    if (!distance.ok) return distance
    return {
      ok: true,
      parameters: { ...multiProfile.data, distance: distance.quantity },
    } as const
  }
  const parsed = z
    .object({
      profile: sketchProfileSelectorSchema,
      distance: lengthQuantitySchema,
      symmetric: z.boolean(),
      operation: extrusionOperationSchema,
    })
    .strict()
    .safeParse(parameters)
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

function isExtrusionType(feature: FeatureRecord) {
  const type = feature.type
  if (!type) return false
  return [
    legacyExtrusionFeatureType.type,
    extrusionFeatureType.type,
    extrusionFeatureTypeV3.type,
    extrusionFeatureTypeV4.type,
  ].some(
    (expected) =>
      type.moduleId === expected.moduleId &&
      type.moduleVersion === expected.moduleVersion &&
      type.typeId === expected.typeId &&
      type.schemaVersion === expected.schemaVersion,
  )
}

export function readExtrusionFeatureParameters(
  feature: FeatureRecord,
): NormalizedExtrusionParameters | null {
  if (!isExtrusionType(feature)) return null
  switch (feature.type.schemaVersion) {
    case 1: {
      const parsed = legacyExtrusionFeatureParametersSchema.safeParse(feature.parameters)
      return parsed.success ? parsed.data : null
    }
    case 2: {
      const parsed = extrusionFeatureParametersSchema.safeParse(feature.parameters)
      return parsed.success ? parsed.data : null
    }
    case 3: {
      const parsed = extrusionFeatureParametersV3Schema.safeParse(feature.parameters)
      if (!parsed.success) return null
      const profile = parsed.data.profiles.profiles[0]
      return profile ? { ...parsed.data, profile } : null
    }
    case 4: {
      const parsed = extrusionFeatureParametersV4Schema.safeParse(feature.parameters)
      if (!parsed.success) return null
      const profile = parsed.data.profiles.profiles[0]
      return profile ? { ...parsed.data, profile } : null
    }
    default:
      return null
  }
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
  const parsed = z
    .union([
      legacyRevolveFeatureParametersSchema,
      legacyRevolveFeatureParametersV2Schema,
      legacyRevolveFeatureParametersV3Schema,
      revolveFeatureParametersSchema,
      revolveFeatureParametersV5Schema,
    ])
    .safeParse(feature.parameters)
  if (!parsed.success) return null
  const normalized =
    typeof parsed.data.axis === "string"
      ? { ...parsed.data, axis: { kind: "origin-axis" as const, axis: parsed.data.axis } }
      : parsed.data
  if ("profile" in normalized) return normalized
  const profile = normalized.profiles.profiles[0]
  return profile ? ({ ...normalized, profile } as NormalizedRevolveParameters) : null
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

function revolveDependencyIssue(
  feature: FeatureRecord,
  parameters: NonNullable<ReturnType<typeof readRevolveFeatureParameters>>,
) {
  const expectedDependencies = expectedRevolveDependencyIds(
    parameters,
    parameters.operation === "new" ? null : (feature.dependencies[0] ?? null),
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
    type: booleanFeatureType.type,
    parametersSchema: booleanFeatureParametersSchema,
    contentParameters(parameters) {
      return booleanFeatureContentParametersSchema.parse(parameters)
    },
  },
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
]
