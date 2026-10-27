import { z } from "zod"

export const MAX_SOURCE_ASSET_BYTES = Infinity
export const MAX_DOCUMENT_SOURCE_ASSETS = 1024
const uuidV7Schema = z
  .string()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
export const sourceAssetIdSchema = uuidV7Schema.brand<"SourceAssetId">()
export const sourceAssetOutputIdSchema = uuidV7Schema.brand<"SourceAssetOutputId">()
export const sourceAssetDigestSchema = z.string().regex(/^[a-f0-9]{64}$/)
export const sourceAssetRepresentationSchema = z.enum([
  "exact-solid",
  "triangle-mesh",
  "sketch-curves",
])

export const sourceAssetSchema = z
  .object({
    id: sourceAssetIdSchema,
    digest: sourceAssetDigestSchema,
    byteLength: z.number().int().positive().safe(),
    filename: z
      .string()
      .trim()
      .min(1)
      .max(255)
      .refine(
        (filename) =>
          !filename.includes("/") &&
          !filename.includes("\\") &&
          Array.from(filename).every(
            (character) => character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127,
          ),
        "The source filename must be a safe leaf name.",
      ),
    format: z.enum(["step", "brep", "stl", "3mf", "obj", "svg", "dxf"]),
    representation: sourceAssetRepresentationSchema,
    normalization: z
      .object({
        sourceUnit: z.enum([
          "micrometer",
          "millimeter",
          "centimeter",
          "meter",
          "inch",
          "foot",
          "unitless",
        ]),
        scaleToMillimeters: z.number().finite().positive().max(1_000_000),
        normalizedUnit: z.literal("millimeter"),
      })
      .strict(),
    outputs: z.array(sourceAssetOutputIdSchema).min(1).max(1024),
  })
  .strict()
  .superRefine((asset, context) => {
    const representation =
      asset.format === "step" || asset.format === "brep"
        ? "exact-solid"
        : asset.format === "stl" || asset.format === "3mf" || asset.format === "obj"
          ? "triangle-mesh"
          : "sketch-curves"
    if (asset.representation !== representation)
      context.addIssue({
        code: "custom",
        message: "The source format and representation disagree.",
      })
    if (new Set(asset.outputs).size !== asset.outputs.length)
      context.addIssue({ code: "custom", message: "Source output identities must be unique." })
  })
export type SourceAsset = Readonly<z.infer<typeof sourceAssetSchema>>
export type SourceAssetId = z.infer<typeof sourceAssetIdSchema>
export type SourceAssetOutputId = z.infer<typeof sourceAssetOutputIdSchema>

export const sourceAssetsSchema = z
  .array(sourceAssetSchema)
  .max(MAX_DOCUMENT_SOURCE_ASSETS)
  .superRefine((assets, context) => {
    const ids = new Set<string>()
    const outputs = new Set<string>()
    const sizes = new Map<string, number>()
    for (const asset of assets) {
      if (ids.has(asset.id) || asset.outputs.some((id) => outputs.has(id)))
        context.addIssue({
          code: "custom",
          message: "Source asset and output identities cannot repeat.",
        })
      if (sizes.has(asset.digest) && sizes.get(asset.digest) !== asset.byteLength)
        context.addIssue({
          code: "custom",
          message: "One content digest cannot declare different sizes.",
        })
      ids.add(asset.id)
      for (const id of asset.outputs) outputs.add(id)
      sizes.set(asset.digest, asset.byteLength)
    }
  })

export const sourceAssetBlobSchema = z
  .object({
    digest: sourceAssetDigestSchema,
    bytes: z
      .instanceof(Uint8Array)
      .refine((bytes) => bytes.byteLength > 0, "Source bytes must be nonempty."),
  })
  .strict()
export type SourceAssetBlob = Readonly<z.infer<typeof sourceAssetBlobSchema>>
