import { z } from "zod"
import type { FeatureRecord } from "./feature-graph"
import { featureTypeDescriptorSchema, featureTypeKey } from "./feature-type-contracts"
import type { TrustedFeatureTypeHandler } from "./feature-type-registry"
import type { FeatureId } from "./identifiers"
import { addHelixExtentIssues, helixFields, resolveHelixParameters } from "./part-design-helix"
import { expectedLoftDependencyIds } from "./part-design-loft"
import { referenceFrameSupportFeatureId } from "./reference-frame"
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

/** Version 2 adds a helical path; planar sketch paths keep writing version 1. */
export const sweepHelixPathSchema = z
  .object({ kind: z.literal("helix"), ...helixFields })
  .strict()
  .superRefine((path, context) => addHelixExtentIssues(path, context))
export type SweepHelixPath = Readonly<z.infer<typeof sweepHelixPathSchema>>
export const sweepFeatureParametersV2Schema = z
  .object({ profile: sketchProfileSelectorSchema, path: sweepHelixPathSchema })
  .strict()
export type SweepFeatureParametersV2 = Readonly<z.infer<typeof sweepFeatureParametersV2Schema>>
export const sweepFeatureTypeV2 = featureTypeDescriptorSchema.parse({
  ...sweepFeatureType,
  type: { ...sweepFeatureType.type, schemaVersion: 2 },
  dependencies: { min: 0, max: 9 },
})

export function readSweepFeatureParametersV2(
  feature: Pick<FeatureRecord, "type" | "parameters">,
): SweepFeatureParametersV2 | null {
  if (featureTypeKey(feature.type) !== featureTypeKey(sweepFeatureTypeV2.type)) return null
  return sweepFeatureParametersV2Schema.safeParse(feature.parameters).data ?? null
}

/** Profile sketch owners first, then a distinct helix-axis producer. */
export function sweepV2AxisOwnerIds(parameters: SweepFeatureParametersV2): readonly FeatureId[] {
  const support = referenceFrameSupportFeatureId(parameters.path.axis)
  return support ? [support] : []
}

export const sweepFeatureTypeHandlerV2: TrustedFeatureTypeHandler = {
  type: sweepFeatureTypeV2.type,
  parametersSchema: sweepFeatureParametersV2Schema,
  resolveParameters(parameters, variables) {
    const parsed = sweepFeatureParametersV2Schema.safeParse(parameters)
    if (!parsed.success) return { ok: true, parameters }
    const path = resolveHelixParameters(parsed.data.path, variables, "invalid-sweep-helix", "path.")
    if (!path.ok) return path
    const valid = sweepFeatureParametersV2Schema.safeParse({
      ...parsed.data,
      path: path.parameters,
    })
    return valid.success
      ? { ok: true, parameters: valid.data }
      : {
          ok: false,
          diagnostic: {
            code: "invalid-sweep-helix",
            message: "The resolved helical Sweep path violates its bounds.",
            issues: valid.error.issues.map((issue) => ({
              path: issue.path.join("."),
              message: issue.message,
            })),
          },
        }
  },
  validateFeature(feature) {
    const parameters = sweepFeatureParametersV2Schema.parse(feature.parameters)
    const owners = new Set(feature.dependencies)
    return feature.references.some(({ featureId }) => !owners.has(featureId)) ||
      sweepV2AxisOwnerIds(parameters).some((id) => !owners.has(id))
      ? [
          {
            path: "dependencies",
            message: "Sweep reference and helix-axis owners must be scheduled dependencies.",
          },
        ]
      : []
  },
  contentParameters(parameters) {
    return sweepFeatureParametersV2Schema.parse(parameters)
  },
}
