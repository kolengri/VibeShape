import { z } from "zod"
import type { FeatureRecord } from "./feature-graph"
import { featureTypeDescriptorSchema, featureTypeKey } from "./feature-type-contracts"
import type { TrustedFeatureTypeHandler } from "./feature-type-registry"
import { expectedLoftDependencyIds } from "./part-design-loft"
import { sketchPathSelectorSchema } from "./sketch-path-selector"
import { sketchProfileSelectorSchema } from "./sketch-profile-selector"

export const sweepFeatureParametersSchema = z
  .object({ profile: sketchProfileSelectorSchema, path: sketchPathSelectorSchema })
  .strict()

type SweepFeatureParameters = Readonly<z.infer<typeof sweepFeatureParametersSchema>>
export const sweepFeatureType = featureTypeDescriptorSchema.parse({
  schemaVersion: 0,
  type: {
    moduleId: "org.vibeshape.core.part-design",
    moduleVersion: "0.1.0",
    typeId: "org.vibeshape.feature.part-design.sweep",
    schemaVersion: 1,
  },
  classification: "solid",
  dependencies: { min: 0, max: 8 },
  references: { min: 0, max: 4_096 },
})

export function readSweepFeatureParameters(
  feature: Pick<FeatureRecord, "type" | "parameters">,
): SweepFeatureParameters | null {
  if (featureTypeKey(feature.type) !== featureTypeKey(sweepFeatureType.type)) return null
  const parsed = sweepFeatureParametersSchema.safeParse(feature.parameters)
  return parsed.success ? parsed.data : null
}

/** Profile owners precede path owners; repeated owners retain their first occurrence. */
export const expectedSweepDependencyIds = expectedLoftDependencyIds

export const sweepFeatureTypeHandler: TrustedFeatureTypeHandler = {
  type: sweepFeatureType.type,
  parametersSchema: sweepFeatureParametersSchema,
  validateFeature(feature) {
    return feature.references.some(({ featureId }) => !feature.dependencies.includes(featureId))
      ? [
          {
            path: "dependencies",
            message: "Sweep reference owners must be scheduled dependencies.",
          },
        ]
      : []
  },
  contentParameters(parameters) {
    return sweepFeatureParametersSchema.parse(parameters)
  },
}
