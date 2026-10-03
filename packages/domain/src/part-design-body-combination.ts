import { z } from "zod"
import { type BodyReference, bodyReferenceSchema } from "./body-reference"
import type { FeatureRecord } from "./feature-graph"
import { featureTypeDescriptorSchema, featureTypeKey } from "./feature-type-contracts"
import type { TrustedFeatureTypeHandler } from "./feature-type-registry"
import { type CompoundSlotId, compoundSlotIdSchema } from "./identifiers"

const selectedBodiesSchema = z
  .array(bodyReferenceSchema)
  .min(2)
  .max(8)
  .superRefine((bodies, context) => {
    if (new Set(bodies.map(({ featureId }) => featureId)).size !== bodies.length) {
      context.addIssue({
        code: "custom",
        message:
          "Select two to eight exact bodies from distinct producing features; several bodies from one feature are not supported yet.",
      })
    }
  })

export const compoundFeatureParametersSchema = z
  .object({
    slots: z
      .array(z.object({ slotId: compoundSlotIdSchema, targetBody: bodyReferenceSchema }).strict())
      .min(2)
      .max(8),
  })
  .strict()
  .superRefine(({ slots }, context) => {
    if (new Set(slots.map(({ slotId }) => slotId)).size !== slots.length)
      context.addIssue({
        code: "custom",
        path: ["slots"],
        message: "Compound slot identities must be unique.",
      })
    const selected = selectedBodiesSchema.safeParse(slots.map(({ targetBody }) => targetBody))
    if (!selected.success)
      context.addIssue({
        code: "custom",
        path: ["slots"],
        message: "Compound requires two to eight exact bodies from distinct producing features.",
      })
  })
export const unionFeatureParametersSchema = z.object({ bodies: selectedBodiesSchema }).strict()
export type CompoundFeatureParameters = Readonly<z.infer<typeof compoundFeatureParametersSchema>>
export type UnionFeatureParameters = Readonly<z.infer<typeof unionFeatureParametersSchema>>

const exactBodySlotsSchema = z
  .array(bodyReferenceSchema)
  .min(2)
  .max(8)
  .superRefine((bodies, context) => {
    const keys = bodies.map(({ featureId, outputRole }) => `${featureId}:${outputRole}`)
    if (new Set(keys).size !== keys.length)
      context.addIssue({
        code: "custom",
        message: "Each selected exact body must appear only once.",
      })
  })
export const compoundFeatureParametersV2Schema = z
  .object({
    slots: z
      .array(z.object({ slotId: compoundSlotIdSchema, targetBody: bodyReferenceSchema }).strict())
      .min(2)
      .max(8),
  })
  .strict()
  .superRefine(({ slots }, context) => {
    if (new Set(slots.map(({ slotId }) => slotId)).size !== slots.length)
      context.addIssue({
        code: "custom",
        path: ["slots"],
        message: "Compound slot identities must be unique.",
      })
    const selected = exactBodySlotsSchema.safeParse(slots.map(({ targetBody }) => targetBody))
    if (!selected.success)
      context.addIssue({
        code: "custom",
        path: ["slots"],
        message: "Compound requires two to eight distinct exact bodies.",
      })
  })
export const unionFeatureParametersV2Schema = z.object({ bodies: exactBodySlotsSchema }).strict()

function combinationDescriptor(kind: "compound" | "union", schemaVersion = 1) {
  return featureTypeDescriptorSchema.parse({
    schemaVersion: 0,
    type: {
      moduleId: "org.vibeshape.core.part-design",
      moduleVersion: "0.1.0",
      typeId: `org.vibeshape.feature.part-design.${kind}`,
      schemaVersion,
    },
    classification: "solid",
    dependencies: { min: schemaVersion === 1 ? 2 : 1, max: 8 },
    references: { min: 0, max: 0 },
  })
}
export const compoundFeatureType = combinationDescriptor("compound")
export const unionFeatureType = combinationDescriptor("union")
export const compoundFeatureTypeV2 = combinationDescriptor("compound", 2)
export const unionFeatureTypeV2 = combinationDescriptor("union", 2)

export function isBodyCombinationV2(feature: Pick<FeatureRecord, "type">): boolean {
  const key = featureTypeKey(feature.type)
  return (
    key === featureTypeKey(compoundFeatureTypeV2.type) ||
    key === featureTypeKey(unionFeatureTypeV2.type)
  )
}

export function compoundBodyOutputRole(slotId: CompoundSlotId): string {
  return `body.${compoundSlotIdSchema.parse(slotId)}`
}

export function readCompoundFeatureParameters(
  feature: Pick<FeatureRecord, "type" | "parameters">,
): CompoundFeatureParameters | null {
  const key = featureTypeKey(feature.type)
  const schema =
    key === featureTypeKey(compoundFeatureType.type)
      ? compoundFeatureParametersSchema
      : key === featureTypeKey(compoundFeatureTypeV2.type)
        ? compoundFeatureParametersV2Schema
        : null
  if (!schema) return null
  const parsed = schema.safeParse(feature.parameters)
  return parsed.success ? parsed.data : null
}
export function readUnionFeatureParameters(
  feature: Pick<FeatureRecord, "type" | "parameters">,
): UnionFeatureParameters | null {
  const key = featureTypeKey(feature.type)
  const schema =
    key === featureTypeKey(unionFeatureType.type)
      ? unionFeatureParametersSchema
      : key === featureTypeKey(unionFeatureTypeV2.type)
        ? unionFeatureParametersV2Schema
        : null
  if (!schema) return null
  const parsed = schema.safeParse(feature.parameters)
  return parsed.success ? parsed.data : null
}

function validateSelectedDependencies(feature: FeatureRecord, bodies: readonly BodyReference[]) {
  return bodies.length === feature.dependencies.length &&
    bodies.every((body, index) => body.featureId === feature.dependencies[index])
    ? []
    : [
        {
          path: "dependencies",
          message:
            "Body combinations must preserve the exact ordered selected producer dependencies.",
        },
      ]
}

export const compoundFeatureTypeHandler: TrustedFeatureTypeHandler = {
  type: compoundFeatureType.type,
  parametersSchema: compoundFeatureParametersSchema,
  validateFeature(feature) {
    return validateSelectedDependencies(
      feature,
      compoundFeatureParametersSchema
        .parse(feature.parameters)
        .slots.map(({ targetBody }) => targetBody),
    )
  },
  contentParameters(parameters) {
    return {
      outputRoles: compoundFeatureParametersSchema
        .parse(parameters)
        .slots.map(({ slotId }) => compoundBodyOutputRole(slotId)),
    }
  },
}
export const unionFeatureTypeHandler: TrustedFeatureTypeHandler = {
  type: unionFeatureType.type,
  parametersSchema: unionFeatureParametersSchema,
  validateFeature(feature) {
    return validateSelectedDependencies(
      feature,
      unionFeatureParametersSchema.parse(feature.parameters).bodies,
    )
  },
  contentParameters(parameters) {
    unionFeatureParametersSchema.parse(parameters)
    return {}
  },
}

function validateV2Dependencies(feature: FeatureRecord, bodies: readonly BodyReference[]) {
  const producers = [...new Set(bodies.map(({ featureId }) => featureId))]
  return producers.length === feature.dependencies.length &&
    producers.every((id, index) => id === feature.dependencies[index])
    ? []
    : [
        {
          path: "dependencies",
          message: "Body combinations must declare each ordered producer once.",
        },
      ]
}
export const compoundFeatureTypeV2Handler: TrustedFeatureTypeHandler = {
  type: compoundFeatureTypeV2.type,
  parametersSchema: compoundFeatureParametersV2Schema,
  validateFeature(feature) {
    return validateV2Dependencies(
      feature,
      compoundFeatureParametersV2Schema
        .parse(feature.parameters)
        .slots.map(({ targetBody }) => targetBody),
    )
  },
  contentParameters(parameters) {
    return {
      outputRoles: compoundFeatureParametersV2Schema
        .parse(parameters)
        .slots.map(({ slotId }) => compoundBodyOutputRole(slotId)),
    }
  },
}
export const unionFeatureTypeV2Handler: TrustedFeatureTypeHandler = {
  type: unionFeatureTypeV2.type,
  parametersSchema: unionFeatureParametersV2Schema,
  validateFeature(feature) {
    return validateV2Dependencies(
      feature,
      unionFeatureParametersV2Schema.parse(feature.parameters).bodies,
    )
  },
  contentParameters(parameters) {
    unionFeatureParametersV2Schema.parse(parameters)
    return {}
  },
}
