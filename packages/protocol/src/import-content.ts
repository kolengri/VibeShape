import { z } from "zod"

const uuid = z
  .string()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
const coordinate = z.number().finite().min(-100_000).max(100_000)
const vector = z.tuple([coordinate, coordinate, coordinate])
const filename = z
  .string()
  .trim()
  .min(1)
  .max(255)
  .refine(
    (name) =>
      !name.includes("/") &&
      !name.includes("\\") &&
      Array.from(name).every(
        (character) => character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127,
      ),
  )
const normalization = z
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
  .strict()
export const sourceAssetNormalizationSchema = normalization
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
export const importedSourceContentSchema = z
  .object({
    digest: z.string().regex(/^[a-f0-9]{64}$/),
    byteLength: z
      .number()
      .int()
      .positive()
      .max(32 * 1024 * 1024),
    format: z.enum(["step", "brep"]),
    normalization,
    unitPolicy: z.enum(["step-system-mm", "brep-source-normalized"]),
    readerPolicyVersion: z.literal(1),
  })
  .strict()
  .superRefine((source, context) => {
    if ((source.format === "step") !== (source.unitPolicy === "step-system-mm"))
      context.addIssue({
        code: "custom",
        message: "The exact source format and unit policy disagree.",
      })
    if (source.format === "step" && source.normalization.sourceUnit === "unitless")
      context.addIssue({
        code: "custom",
        message: "STEP import requires explicit source-unit metadata.",
      })
  })
const outputs = z
  .array(z.object({ outputId: uuid, signature: importedSolidSignatureSchema }).strict())
  .min(1)
  .max(128)
  .refine(
    (values) => new Set(values.map(({ outputId }) => outputId)).size === values.length,
    "Imported output identities cannot repeat.",
  )
export const importedFeatureContentParametersSchema = z
  .object({
    source: importedSourceContentSchema,
    outputs,
    matchingPolicyVersion: z.literal(1),
  })
  .strict()
export const exactSourceAssetDescriptorSchema = z
  .object({
    id: uuid,
    digest: importedSourceContentSchema.shape.digest,
    byteLength: importedSourceContentSchema.shape.byteLength,
    filename,
    format: z.enum(["step", "brep"]),
    representation: z.literal("exact-solid"),
    normalization,
    outputs: z
      .array(uuid)
      .min(1)
      .max(128)
      .refine((values) => new Set(values).size === values.length),
  })
  .strict()
function sameSourceDescriptor(
  source: z.infer<typeof importedSourceContentSchema>,
  asset: z.infer<typeof exactSourceAssetDescriptorSchema>,
) {
  return (
    source.digest === asset.digest &&
    source.byteLength === asset.byteLength &&
    source.format === asset.format &&
    source.normalization.sourceUnit === asset.normalization.sourceUnit &&
    source.normalization.scaleToMillimeters === asset.normalization.scaleToMillimeters
  )
}
export const importedSourceMaterializationSchema = z
  .object({
    sourceAssetId: uuid,
    content: importedFeatureContentParametersSchema,
    asset: exactSourceAssetDescriptorSchema,
    bytes: z
      .instanceof(Uint8Array)
      .refine((bytes) => bytes.byteLength > 0 && bytes.byteLength <= 32 * 1024 * 1024),
  })
  .strict()
  .superRefine(({ sourceAssetId, content, asset, bytes }, context) => {
    const metadata =
      sourceAssetId === asset.id &&
      content.source.byteLength === bytes.byteLength &&
      sameSourceDescriptor(content.source, asset)
    const ids = content.outputs.map(({ outputId }) => outputId)
    const sameOutputs =
      ids.length === asset.outputs.length && ids.every((id, index) => id === asset.outputs[index])
    if (!metadata || !sameOutputs)
      context.addIssue({
        code: "custom",
        message: "The feature content and immutable source descriptor disagree.",
      })
  })
export type ImportedSourceContent = z.infer<typeof importedSourceContentSchema>
export type ImportedSolidSignature = z.infer<typeof importedSolidSignatureSchema>
export type ImportedFeatureContentParameters = z.infer<
  typeof importedFeatureContentParametersSchema
>
export type ImportedSourceMaterialization = z.infer<typeof importedSourceMaterializationSchema>

const sourceAssetWireDescriptorSchema = z
  .object({
    id: uuid,
    digest: importedSourceContentSchema.shape.digest,
    byteLength: z.number().int().positive().safe(),
    filename,
    format: z.enum(["step", "brep", "stl", "3mf", "obj", "svg", "dxf"]),
    representation: z.enum(["exact-solid", "triangle-mesh", "sketch-curves"]),
    normalization,
    outputs: z
      .array(uuid)
      .min(1)
      .max(1024)
      .refine((values) => new Set(values).size === values.length),
  })
  .strict()
  .superRefine((asset, context) => {
    const expected =
      asset.format === "step" || asset.format === "brep"
        ? "exact-solid"
        : asset.format === "svg" || asset.format === "dxf"
          ? "sketch-curves"
          : "triangle-mesh"
    if (asset.representation !== expected)
      context.addIssue({
        code: "custom",
        message: "The wire source format and representation disagree.",
      })
  })
const sourceAssetMaterializationObjectSchema = z
  .object({ asset: sourceAssetWireDescriptorSchema, bytes: z.instanceof(Uint8Array) })
  .strict()
  .superRefine(({ asset, bytes }, context) => {
    if (bytes.byteLength !== asset.byteLength)
      context.addIssue({
        code: "custom",
        message: "Wire source bytes must match the declared byte length.",
      })
  })
export const sourceAssetMaterializationSchema = sourceAssetMaterializationObjectSchema.transform(
  ({ asset, bytes }) => ({ asset, bytes: Uint8Array.from(bytes) }),
)
export const sourceAssetMaterializationsSchema = z
  .array(sourceAssetMaterializationObjectSchema)
  .max(128)
  .superRefine((values, context) => {
    if (new Set(values.map(({ asset }) => asset.id)).size !== values.length)
      context.addIssue({ code: "custom", message: "Wire source asset identities cannot repeat." })
    const digests = new Map<string, Uint8Array>()
    for (const { asset, bytes } of values) {
      const previous = digests.get(asset.digest)
      if (
        previous &&
        (previous.length !== bytes.length ||
          !previous.every((value, index) => value === bytes[index]))
      )
        context.addIssue({
          code: "custom",
          message: "One wire content digest cannot carry different bytes.",
        })
      digests.set(asset.digest, bytes)
    }
  })
  .transform((values) =>
    values.map(({ asset, bytes }) => ({ asset, bytes: Uint8Array.from(bytes) })),
  )
export type SourceAssetMaterialization = z.output<typeof sourceAssetMaterializationSchema>
