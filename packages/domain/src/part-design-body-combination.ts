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

function combinationDescriptor(kind: "compound" | "union") {
  return featureTypeDescriptorSchema.parse({
    schemaVersion: 0,
    type: {
      moduleId: "org.vibeshape.core.part-design",
      moduleVersion: "0.1.0",
      typeId: `org.vibeshape.feature.part-design.${kind}`,
      schemaVersion: 1,
    },
    classification: "solid",
    dependencies: { min: 2, max: 8 },
    references: { min: 0, max: 0 },
  })
}
export const compoundFeatureType = combinationDescriptor("compound")
export const unionFeatureType = combinationDescriptor("union")

export function compoundBodyOutputRole(slotId: CompoundSlotId): string {
  return `body.${compoundSlotIdSchema.parse(slotId)}`
}

export function readCompoundFeatureParameters(
  feature: Pick<FeatureRecord, "type" | "parameters">,
): CompoundFeatureParameters | null {
  if (featureTypeKey(feature.type) !== featureTypeKey(compoundFeatureType.type)) return null
  const parsed = compoundFeatureParametersSchema.safeParse(feature.parameters)
  return parsed.success ? parsed.data : null
}
export function readUnionFeatureParameters(
  feature: Pick<FeatureRecord, "type" | "parameters">,
): UnionFeatureParameters | null {
  if (featureTypeKey(feature.type) !== featureTypeKey(unionFeatureType.type)) return null
  const parsed = unionFeatureParametersSchema.safeParse(feature.parameters)
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
