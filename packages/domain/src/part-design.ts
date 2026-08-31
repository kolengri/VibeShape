import { z } from "zod"
import type { FeatureRecord } from "./feature-graph"
import { featureTypeDescriptorSchema } from "./feature-type-contracts"
import type { TrustedFeatureTypeHandler } from "./feature-type-registry"
import { sketchEntityIdSchema, sketchIdSchema } from "./identifiers"
import { sketchProfileSelectorSchema } from "./sketch-profile-selector"
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

export const revolveAxisSchema = z.union([
  z.object({ kind: z.literal("origin-axis"), axis: z.enum(["x", "y"]) }).strict(),
  z
    .object({
      kind: z.literal("sketch-line"),
      sketchId: sketchIdSchema,
      entityId: sketchEntityIdSchema,
    })
    .strict(),
])

export const revolveFeatureParametersSchema = z
  .object({
    profile: sketchProfileSelectorSchema,
    axis: revolveAxisSchema,
    angle: revolveAngleSchema,
    operation: extrusionOperationSchema,
  })
  .strict()

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

export const revolveFeatureType = featureTypeDescriptorSchema.parse({
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
  return [legacyExtrusionFeatureType.type, extrusionFeatureType.type].some(
    (expected) =>
      type.moduleId === expected.moduleId &&
      type.moduleVersion === expected.moduleVersion &&
      type.typeId === expected.typeId &&
      type.schemaVersion === expected.schemaVersion,
  )
}

export function readExtrusionFeatureParameters(feature: FeatureRecord) {
  if (!isExtrusionType(feature)) return null
  const parsed = extrusionFeatureParametersSchema.safeParse(feature.parameters)
  return parsed.success ? parsed.data : null
}

export function isRevolveType(feature: FeatureRecord) {
  const type = feature.type
  return [
    legacyRevolveFeatureType.type,
    legacyRevolveFeatureTypeV2.type,
    revolveFeatureType.type,
  ].some(
    (expected) =>
      type.moduleId === expected.moduleId &&
      type.moduleVersion === expected.moduleVersion &&
      type.typeId === expected.typeId &&
      type.schemaVersion === expected.schemaVersion,
  )
}

export function readRevolveFeatureParameters(feature: FeatureRecord) {
  if (!isRevolveType(feature)) return null
  const parsed = z
    .union([
      legacyRevolveFeatureParametersSchema,
      legacyRevolveFeatureParametersV2Schema,
      revolveFeatureParametersSchema,
    ])
    .safeParse(feature.parameters)
  if (!parsed.success) return null
  return typeof parsed.data.axis === "string"
    ? { ...parsed.data, axis: { kind: "origin-axis" as const, axis: parsed.data.axis } }
    : parsed.data
}

function resolveRevolveParameters(parameters: unknown, variables: VariableValues) {
  const parsed = z
    .union([
      legacyRevolveFeatureParametersSchema,
      legacyRevolveFeatureParametersV2Schema,
      revolveFeatureParametersSchema,
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
  const issues: Array<{ path: string; message: string }> = []
  if (
    parameters.axis.kind === "sketch-line" &&
    parameters.axis.sketchId !== parameters.profile.sketchId
  ) {
    issues.push({
      path: "parameters.axis.sketchId",
      message: "A sketch-line revolve axis must belong to the selected profile sketch.",
    })
  }
  const supportDependencyCount = new Set(feature.references.map(({ featureId }) => featureId)).size
  const minimumDependencyCount = parameters.operation === "new" ? supportDependencyCount : 1
  const maximumDependencyCount =
    parameters.operation === "new" ? supportDependencyCount : supportDependencyCount + 1
  if (
    feature.dependencies.length < minimumDependencyCount ||
    feature.dependencies.length > maximumDependencyCount
  ) {
    issues.push({
      path: "dependencies",
      message:
        parameters.operation === "new"
          ? "New-body revolve dependencies must match its sketch-support references."
          : `${parameters.operation} revolve requires one target plus any distinct sketch-support dependency.`,
    })
  }
  return issues
}

function extrusionFeatureInvariant(feature: FeatureRecord) {
  const parameters = extrusionFeatureParametersSchema.safeParse(feature.parameters)
  if (!parameters.success) return []
  const supportDependencyCount = new Set(feature.references.map(({ featureId }) => featureId)).size
  const minimumDependencyCount = parameters.data.operation === "new" ? supportDependencyCount : 1
  const maximumDependencyCount =
    parameters.data.operation === "new" ? supportDependencyCount : supportDependencyCount + 1
  return feature.dependencies.length >= minimumDependencyCount &&
    feature.dependencies.length <= maximumDependencyCount
    ? []
    : [
        {
          path: "dependencies",
          message:
            parameters.data.operation === "new"
              ? "New-body extrusion dependencies must match its sketch-support references."
              : `${parameters.data.operation} extrusion requires one target plus any distinct sketch-support dependency.`,
        },
      ]
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
]
