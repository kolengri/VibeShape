import { z } from "zod"
import type { FeatureRecord } from "./feature-graph"
import { featureTypeDescriptorSchema, featureTypeKey } from "./feature-type-contracts"
import type { TrustedFeatureTypeHandler } from "./feature-type-registry"
import type { FeatureId } from "./identifiers"
import { sketchProfileSelectorKey, sketchProfileSelectorSchema } from "./sketch-profile-selector"

const MAX_LOFT_SECTIONS = 8
const MAX_LOFT_BOUNDARY_ENTITIES = 2_000

export const loftFeatureParametersSchema = z
  .object({
    sections: z.array(sketchProfileSelectorSchema).min(2).max(MAX_LOFT_SECTIONS),
    ruled: z.boolean(),
  })
  .strict()
  .superRefine(({ sections }, context) => {
    if (new Set(sections.map(sketchProfileSelectorKey)).size !== sections.length)
      context.addIssue({
        code: "custom",
        path: ["sections"],
        message: "Loft sections must be unique.",
      })
    if (sections.some(({ holeBoundaryEntityIds }) => holeBoundaryEntityIds.length > 0))
      context.addIssue({
        code: "custom",
        path: ["sections"],
        message: "Loft v1 requires hole-free sections until authored hole correspondence exists.",
      })
    if (
      sections.reduce((total, section) => total + section.outerBoundaryEntityIds.length, 0) >
      MAX_LOFT_BOUNDARY_ENTITIES
    )
      context.addIssue({
        code: "custom",
        path: ["sections"],
        message: "Loft sections exceed the aggregate boundary entity budget.",
      })
  })

type LoftFeatureParameters = Readonly<z.infer<typeof loftFeatureParametersSchema>>
export const loftFeatureType = featureTypeDescriptorSchema.parse({
  schemaVersion: 0,
  type: {
    moduleId: "org.vibeshape.core.part-design",
    moduleVersion: "0.1.0",
    typeId: "org.vibeshape.feature.part-design.loft",
    schemaVersion: 1,
  },
  classification: "solid",
  dependencies: { min: 0, max: 8 },
  references: { min: 0, max: 4_096 },
})

export function readLoftFeatureParameters(
  feature: Pick<FeatureRecord, "type" | "parameters">,
): LoftFeatureParameters | null {
  if (featureTypeKey(feature.type) !== featureTypeKey(loftFeatureType.type)) return null
  const parsed = loftFeatureParametersSchema.safeParse(feature.parameters)
  return parsed.success ? parsed.data : null
}

/** Callers supply resolved support and external-model owners in authored section order. */
export function expectedLoftDependencyIds(owners: readonly FeatureId[]): FeatureId[] {
  return [...new Set(owners)]
}

export const loftFeatureTypeHandler: TrustedFeatureTypeHandler = {
  type: loftFeatureType.type,
  parametersSchema: loftFeatureParametersSchema,
  validateFeature(feature) {
    // Full dependency equality requires the authoritative sketches, unavailable at this boundary.
    return feature.references.some(({ featureId }) => !feature.dependencies.includes(featureId))
      ? [{ path: "dependencies", message: "Loft reference owners must be scheduled dependencies." }]
      : []
  },
  contentParameters(parameters) {
    return loftFeatureParametersSchema.parse(parameters)
  },
}
