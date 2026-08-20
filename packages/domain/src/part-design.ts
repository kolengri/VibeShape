import { z } from "zod"
import type { FeatureRecord } from "./feature-graph"
import { featureTypeDescriptorSchema } from "./feature-type-contracts"
import type { TrustedFeatureTypeHandler } from "./feature-type-registry"
import { sketchProfileSelectorSchema } from "./sketch-profile-selector"
import { lengthQuantitySchema } from "./units"
import {
  type EvaluatedVariable,
  type ExpressionValue,
  resolveQuantityExpression,
} from "./variables"

const MAX_PRIMITIVE_LENGTH_MM = 1_000_000

const primitiveLengthSchema = lengthQuantitySchema.refine(
  ({ value }) => value > 0 && value <= MAX_PRIMITIVE_LENGTH_MM,
  `Primitive lengths must be greater than zero and at most ${MAX_PRIMITIVE_LENGTH_MM} mm.`,
)

const primitiveContentLengthSchema = z.number().finite().positive().max(MAX_PRIMITIVE_LENGTH_MM)

export const boxFeatureParametersSchema = z
  .object({
    width: primitiveLengthSchema,
    depth: primitiveLengthSchema,
    height: primitiveLengthSchema,
    centered: z.boolean(),
  })
  .strict()

export const cylinderFeatureParametersSchema = z
  .object({
    radius: primitiveLengthSchema,
    height: primitiveLengthSchema,
    centered: z.boolean(),
  })
  .strict()

export const boxFeatureContentParametersSchema = z
  .object({
    width: primitiveContentLengthSchema,
    depth: primitiveContentLengthSchema,
    height: primitiveContentLengthSchema,
    centered: z.boolean(),
  })
  .strict()

export const cylinderFeatureContentParametersSchema = z
  .object({
    radius: primitiveContentLengthSchema,
    height: primitiveContentLengthSchema,
    centered: z.boolean(),
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

function resolveBoxParameters(parameters: unknown, variables: VariableValues) {
  const parsed = z
    .object({
      width: lengthQuantitySchema,
      depth: lengthQuantitySchema,
      height: lengthQuantitySchema,
      centered: z.boolean(),
    })
    .strict()
    .safeParse(parameters)
  if (!parsed.success) return { ok: true as const, parameters }
  const width = resolveLengthParameter("width", parsed.data.width, variables)
  if (!width.ok) return width
  const depth = resolveLengthParameter("depth", parsed.data.depth, variables)
  if (!depth.ok) return depth
  const height = resolveLengthParameter("height", parsed.data.height, variables)
  if (!height.ok) return height
  return {
    ok: true,
    parameters: {
      width: width.quantity,
      depth: depth.quantity,
      height: height.quantity,
      centered: parsed.data.centered,
    },
  } as const
}

function resolveCylinderParameters(parameters: unknown, variables: VariableValues) {
  const parsed = z
    .object({ radius: lengthQuantitySchema, height: lengthQuantitySchema, centered: z.boolean() })
    .strict()
    .safeParse(parameters)
  if (!parsed.success) return { ok: true as const, parameters }
  const radius = resolveLengthParameter("radius", parsed.data.radius, variables)
  if (!radius.ok) return radius
  const height = resolveLengthParameter("height", parsed.data.height, variables)
  if (!height.ok) return height
  return {
    ok: true,
    parameters: {
      radius: radius.quantity,
      height: height.quantity,
      centered: parsed.data.centered,
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
]
