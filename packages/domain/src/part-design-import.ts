import { z } from "zod"
import { canonicalJson } from "./canonical-json"
import type { FeatureRecord } from "./feature-graph"
import { featureTypeDescriptorSchema, featureTypeKey } from "./feature-type-contracts"
import type { TrustedFeatureTypeHandler } from "./feature-type-registry"
import { validateMeshImportAssets } from "./part-design-mesh-import"
import type { SourceAsset } from "./source-assets"
import { sourceAssetIdSchema, sourceAssetOutputIdSchema, sourceAssetSchema } from "./source-assets"

export const MAX_IMPORTED_SOLIDS = 128
const coordinate = z.number().finite().min(-100_000).max(100_000)
const vector = z.tuple([coordinate, coordinate, coordinate])
export const importedSolidSignatureSchema = z
  .object({
    volume: z.number().finite().positive().max(1e18),
    area: z.number().finite().positive().max(1e17),
    centroid: vector,
    bounds: z.object({ min: vector, max: vector }).strict(),
    faceCount: z.number().int().positive().max(500_000),
    edgeCount: z.number().int().positive().max(500_000),
  })
  .strict()
  .superRefine((signature, context) => {
    if (!signature.bounds.min.every((value, axis) => value < (signature.bounds.max[axis] ?? value)))
      context.addIssue({
        code: "custom",
        message: "Imported solid bounds must enclose positive extent on every axis.",
      })
  })
export const importedSourceSchema = z
  .object({
    digest: sourceAssetSchema.shape.digest,
    byteLength: sourceAssetSchema.shape.byteLength,
    format: z.enum(["step", "brep"]),
    normalization: sourceAssetSchema.shape.normalization,
    unitPolicy: z.enum(["step-system-mm", "brep-source-normalized"]),
    readerPolicyVersion: z.literal(1),
  })
  .strict()
  .superRefine((source, context) => {
    if ((source.format === "step") !== (source.unitPolicy === "step-system-mm"))
      context.addIssue({
        code: "custom",
        message: "The exact import format and unit policy disagree.",
      })
    if (source.format === "step" && source.normalization.sourceUnit === "unitless")
      context.addIssue({
        code: "custom",
        message: "STEP import requires explicit source-unit metadata.",
      })
  })
export const importedOutputsSchema = z
  .array(
    z
      .object({
        outputId: sourceAssetOutputIdSchema,
        signature: importedSolidSignatureSchema,
      })
      .strict(),
  )
  .min(1)
  .max(MAX_IMPORTED_SOLIDS)
  .refine(
    (outputs) => new Set(outputs.map((output) => output.outputId)).size === outputs.length,
    "Imported body output identities cannot repeat.",
  )
export const importedFeatureParametersSchema = z
  .object({
    sourceAssetId: sourceAssetIdSchema,
    source: importedSourceSchema,
    outputs: importedOutputsSchema,
    matchingPolicyVersion: z.literal(1),
  })
  .strict()
export type ImportedFeatureParameters = Readonly<z.infer<typeof importedFeatureParametersSchema>>
export type ImportedSolidSignature = Readonly<z.infer<typeof importedSolidSignatureSchema>>
export function importedBodyOutputRole(outputId: string) {
  return `import.${sourceAssetOutputIdSchema.parse(outputId)}`
}
export const importedFeatureType = featureTypeDescriptorSchema.parse({
  schemaVersion: 0,
  type: {
    moduleId: "org.vibeshape.core.part-design",
    moduleVersion: "0.1.0",
    typeId: "org.vibeshape.feature.part-design.imported",
    schemaVersion: 1,
  },
  classification: "solid",
  dependencies: { min: 0, max: 0 },
  references: { min: 0, max: 0 },
})
export function readImportedFeatureParameters(
  feature: Pick<FeatureRecord, "type" | "parameters">,
): ImportedFeatureParameters | null {
  if (featureTypeKey(feature.type) !== featureTypeKey(importedFeatureType.type)) return null
  const parsed = importedFeatureParametersSchema.safeParse(feature.parameters)
  return parsed.success ? parsed.data : null
}
export const importedFeatureTypeHandler: TrustedFeatureTypeHandler = {
  type: importedFeatureType.type,
  parametersSchema: importedFeatureParametersSchema,
  contentParameters(parameters) {
    const { sourceAssetId: _id, ...content } = importedFeatureParametersSchema.parse(parameters)
    return content
  },
}

/** Source lookup belongs to complete V3 authority, outside the historical V2 projection. */
export function validateImportedFeatureAssets(model: {
  features: readonly Pick<FeatureRecord, "type" | "parameters">[]
  assets: readonly SourceAsset[]
}): string | null {
  const meshFailure = validateMeshImportAssets(model)
  if (meshFailure) return meshFailure
  const assets = new Map(model.assets.map((asset) => [asset.id, asset]))
  for (const feature of model.features) {
    if (featureTypeKey(feature.type) !== featureTypeKey(importedFeatureType.type)) continue
    const parameters = readImportedFeatureParameters(feature)
    if (!parameters) return "An imported feature has invalid source parameters."
    const asset = assets.get(parameters.sourceAssetId)
    if (asset?.representation !== "exact-solid")
      return "An imported exact feature requires its persisted exact-solid source asset."
    const source = parameters.source
    if (
      asset.digest !== source.digest ||
      asset.byteLength !== source.byteLength ||
      asset.format !== source.format ||
      canonicalJson(asset.normalization) !== canonicalJson(source.normalization)
    )
      return "An imported feature must match its immutable source metadata."
    if (
      canonicalJson(asset.outputs) !==
      canonicalJson(parameters.outputs.map(({ outputId }) => outputId))
    )
      return "An imported feature must declare every captured source output in its original order."
  }
  return null
}
