import { z } from "zod"
import type { FeatureRecord } from "./feature-graph"
import { featureTypeDescriptorSchema, featureTypeKey } from "./feature-type-contracts"
import type { TrustedFeatureTypeHandler } from "./feature-type-registry"
import { type FeatureId, sketchEntityIdSchema } from "./identifiers"
import { sketchProfileSelectorKey, sketchProfileSelectorSchema } from "./sketch-profile-selector"

export const MAX_LOFT_SECTIONS = 24
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

export const loftHoleCorrespondenceSchema = z
  .array(
    z
      .object({
        sectionBoundaryEntityIds: z
          .array(z.array(sketchEntityIdSchema).min(1).max(2_000))
          .min(2)
          .max(MAX_LOFT_SECTIONS),
      })
      .strict(),
  )
  .max(128)
export const loftFeatureParametersV2Schema = z
  .object({
    sections: z.array(sketchProfileSelectorSchema).min(2).max(MAX_LOFT_SECTIONS),
    ruled: z.boolean(),
    holeCorrespondence: loftHoleCorrespondenceSchema,
  })
  .strict()
  .superRefine(({ sections, holeCorrespondence }, context) => {
    if (new Set(sections.map(sketchProfileSelectorKey)).size !== sections.length)
      context.addIssue({
        code: "custom",
        path: ["sections"],
        message: "Loft sections must be unique.",
      })
    const count = sections.reduce(
      (total, section) =>
        total + section.outerBoundaryEntityIds.length + section.holeBoundaryEntityIds.flat().length,
      0,
    )
    if (count > MAX_LOFT_BOUNDARY_ENTITIES)
      context.addIssue({
        code: "custom",
        path: ["sections"],
        message: "Loft sections exceed the aggregate boundary entity budget.",
      })
    for (const [sectionIndex, section] of sections.entries()) {
      const expected = section.holeBoundaryEntityIds.map((ids) => JSON.stringify(ids)).sort()
      const actual = holeCorrespondence
        .map((track) => JSON.stringify(track.sectionBoundaryEntityIds[sectionIndex]))
        .sort()
      if (
        JSON.stringify(expected) !== JSON.stringify(actual) ||
        new Set(actual).size !== actual.length
      )
        context.addIssue({
          code: "custom",
          path: ["holeCorrespondence"],
          message: "Every Loft hole must have one explicit correspondence across all sections.",
        })
    }
    if (
      holeCorrespondence.some((track) => track.sectionBoundaryEntityIds.length !== sections.length)
    )
      context.addIssue({
        code: "custom",
        path: ["holeCorrespondence"],
        message: "Hole correspondence must cover every ordered section.",
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
  dependencies: { min: 0, max: MAX_LOFT_SECTIONS },
  references: { min: 0, max: 4_096 },
})

export const loftFeatureTypeV2 = featureTypeDescriptorSchema.parse({
  ...loftFeatureType,
  type: { ...loftFeatureType.type, schemaVersion: 2 },
})

export function readLoftFeatureParameters(
  feature: Pick<FeatureRecord, "type" | "parameters">,
): LoftFeatureParameters | z.infer<typeof loftFeatureParametersV2Schema> | null {
  if (featureTypeKey(feature.type) === featureTypeKey(loftFeatureTypeV2.type)) {
    const parsed = loftFeatureParametersV2Schema.safeParse(feature.parameters)
    return parsed.success ? parsed.data : null
  }
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

export const loftFeatureTypeHandlerV2: TrustedFeatureTypeHandler = {
  ...loftFeatureTypeHandler,
  type: loftFeatureTypeV2.type,
  parametersSchema: loftFeatureParametersV2Schema,
  contentParameters(parameters) {
    return loftFeatureParametersV2Schema.parse(parameters)
  },
}
