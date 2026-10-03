import { z } from "zod"
import { canonicalJson } from "./canonical-json"
import type { FeatureRecord } from "./feature-graph"
import { featureTypeDescriptorSchema, featureTypeKey } from "./feature-type-contracts"
import type { TrustedFeatureTypeHandler } from "./feature-type-registry"
import {
  type SourceAsset,
  sourceAssetIdSchema,
  sourceAssetOutputIdSchema,
  sourceAssetSchema,
} from "./source-assets"

const capturedMeshOutputSchema = z
  .object({
    outputId: sourceAssetOutputIdSchema,
    nodeKey: z.string().min(1).max(128),
  })
  .strict()
export const meshImportContentSchema = z
  .object({
    source: z
      .object({
        digest: sourceAssetSchema.shape.digest,
        byteLength: sourceAssetSchema.shape.byteLength,
        format: z.enum(["stl", "3mf"]),
        normalization: sourceAssetSchema.shape.normalization,
        parserPolicyVersion: z.literal(1),
      })
      .strict(),
    outputs: z
      .array(capturedMeshOutputSchema)
      .min(1)
      .max(128)
      .refine(
        (outputs) =>
          new Set(outputs.map(({ outputId }) => outputId)).size === outputs.length &&
          new Set(outputs.map(({ nodeKey }) => nodeKey)).size === outputs.length,
        "Captured mesh outputs must have unique authored identities and source node keys.",
      ),
  })
  .strict()
export const meshImportFeatureParametersSchema = meshImportContentSchema.extend({
  sourceAssetId: sourceAssetIdSchema,
})
export type MeshImportContent = z.infer<typeof meshImportContentSchema>
export type MeshImportFeatureParameters = z.infer<typeof meshImportFeatureParametersSchema>
export const meshImportFeatureType = featureTypeDescriptorSchema.parse({
  schemaVersion: 0,
  type: {
    moduleId: "org.vibeshape.core.part-design",
    moduleVersion: "0.1.0",
    typeId: "org.vibeshape.feature.part-design.imported-mesh",
    schemaVersion: 1,
  },
  classification: "mesh",
  dependencies: { min: 0, max: 0 },
  references: { min: 0, max: 0 },
})
export function readMeshImportFeatureParameters(
  feature: Pick<FeatureRecord, "type" | "parameters">,
): MeshImportFeatureParameters | null {
  if (featureTypeKey(feature.type) !== featureTypeKey(meshImportFeatureType.type)) return null
  const parsed = meshImportFeatureParametersSchema.safeParse(feature.parameters)
  return parsed.success ? parsed.data : null
}
export function meshImportOutputRole(outputId: string) {
  return `mesh.${sourceAssetOutputIdSchema.parse(outputId)}`
}
export const meshImportFeatureTypeHandler: TrustedFeatureTypeHandler = {
  type: meshImportFeatureType.type,
  parametersSchema: meshImportFeatureParametersSchema,
  contentParameters(parameters) {
    const { sourceAssetId: _id, ...content } = meshImportFeatureParametersSchema.parse(parameters)
    return content
  },
}
export function validateMeshImportAssets(model: {
  features: readonly Pick<FeatureRecord, "type" | "parameters">[]
  assets: readonly SourceAsset[]
}): string | null {
  const assets = new Map(model.assets.map((asset) => [asset.id, asset]))
  for (const feature of model.features) {
    if (featureTypeKey(feature.type) !== featureTypeKey(meshImportFeatureType.type)) continue
    const parameters = readMeshImportFeatureParameters(feature)
    if (!parameters) return "An imported mesh feature has invalid source parameters."
    const asset = assets.get(parameters.sourceAssetId)
    if (asset?.representation !== "triangle-mesh")
      return "A mesh import requires its persisted triangle-mesh source asset."
    const { parserPolicyVersion: _policy, ...source } = parameters.source
    if (
      canonicalJson(source) !==
        canonicalJson({
          digest: asset.digest,
          byteLength: asset.byteLength,
          format: asset.format,
          normalization: asset.normalization,
        }) ||
      canonicalJson(asset.outputs) !==
        canonicalJson(parameters.outputs.map(({ outputId }) => outputId))
    )
      return "An imported mesh must match its immutable source metadata and captured outputs."
  }
  return null
}
