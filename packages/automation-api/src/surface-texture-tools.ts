import {
  documentIdSchema,
  featureIdSchema,
  revisionSchema,
  surfaceTextureLayerIdSchema,
} from "@vibeshape/domain/identifiers"
import {
  MAX_SURFACE_TEXTURE_LAYERS_PER_FEATURE,
  MAX_SURFACE_TEXTURE_MAP_DIMENSION,
  surfaceTextureLayerSchema,
  surfaceTextureMapSchema,
  surfaceTextureMaskSchema,
} from "@vibeshape/domain/surface-textures"
import { z } from "zod"

const MAX_GRAY_BYTES = MAX_SURFACE_TEXTURE_MAP_DIMENSION ** 2
const MAX_GRAY_BASE64 = Math.ceil(MAX_GRAY_BYTES / 3) * 4
const GRAY_BASE64_PATTERN = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/
const BASE64_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"

function grayPadding(value: string) {
  return value.endsWith("==") ? 2 : Number(value.endsWith("="))
}
function canonicalGrayEncoding(value: string) {
  if (!value.length || value.length > MAX_GRAY_BASE64 || !GRAY_BASE64_PATTERN.test(value))
    return false
  const padding = grayPadding(value)
  const tail = BASE64_ALPHABET.indexOf(value.charAt(value.length - padding - 1))
  return padding === 0 || (tail & (padding === 2 ? 15 : 3)) === 0
}
function canonicalGrayBytes(value: string): Uint8Array | null {
  if (!canonicalGrayEncoding(value)) return null
  const bytes = new Uint8Array((value.length / 4) * 3)
  for (let offset = 0; offset < value.length; offset += 4) {
    const a = BASE64_ALPHABET.indexOf(value.charAt(offset))
    const b = BASE64_ALPHABET.indexOf(value.charAt(offset + 1))
    const c = Math.max(0, BASE64_ALPHABET.indexOf(value.charAt(offset + 2)))
    const d = Math.max(0, BASE64_ALPHABET.indexOf(value.charAt(offset + 3)))
    const index = (offset / 4) * 3
    bytes[index] = (a << 2) | (b >> 4)
    bytes[index + 1] = (b << 4) | (c >> 2)
    bytes[index + 2] = (c << 6) | d
  }
  return bytes.subarray(0, bytes.length - grayPadding(value))
}

export const packedSurfaceTextureMapSchema = z
  .object({
    kind: z.literal("custom"),
    width: z.number().int().min(1).max(MAX_SURFACE_TEXTURE_MAP_DIMENSION),
    height: z.number().int().min(1).max(MAX_SURFACE_TEXTURE_MAP_DIMENSION),
    grayscaleBase64: z.string().min(4).max(MAX_GRAY_BASE64).regex(GRAY_BASE64_PATTERN),
  })
  .strict()
  .refine(
    (map) => canonicalGrayBytes(map.grayscaleBase64)?.length === map.width * map.height,
    "Canonical grayscale bytes must exactly match the map dimensions.",
  )

export const surfaceTextureWireMapSchema = z.discriminatedUnion("kind", [
  surfaceTextureMapSchema.options[0],
  packedSurfaceTextureMapSchema,
])
const { id: _id, featureId: _featureId, ...layerSettings } = surfaceTextureLayerSchema.shape
export const surfaceTextureRecipeSchema = z
  .object({ ...layerSettings, map: surfaceTextureWireMapSchema })
  .strict()
export const surfaceTexturePatchSchema = surfaceTextureRecipeSchema.partial()
export const surfaceTextureToolInputs = {
  model_surface_textures: z
    .object({ revision: revisionSchema, featureId: featureIdSchema })
    .strict(),
  create_surface_texture: z
    .object({
      baseRevision: revisionSchema,
      layerId: surfaceTextureLayerIdSchema,
      featureId: featureIdSchema,
      recipe: surfaceTextureRecipeSchema,
    })
    .strict(),
  update_surface_texture: z
    .object({
      baseRevision: revisionSchema,
      layerId: surfaceTextureLayerIdSchema,
      patch: surfaceTexturePatchSchema.default({}),
      appendMaskStrokes: surfaceTextureMaskSchema.shape.strokes.optional(),
    })
    .strict()
    .refine(
      ({ patch, appendMaskStrokes }) =>
        Object.keys(patch).length > 0 || (appendMaskStrokes?.length ?? 0) > 0,
      "A texture update requires settings or appended mask strokes.",
    )
    .refine(
      ({ patch, appendMaskStrokes }) => patch.mask === undefined || appendMaskStrokes === undefined,
      "Replace the mask or append strokes in one update, not both.",
    ),
  remove_surface_texture: z
    .object({ baseRevision: revisionSchema, layerId: surfaceTextureLayerIdSchema })
    .strict(),
} as const
export const surfaceTextureToolNames = [
  "model_surface_textures",
  "create_surface_texture",
  "update_surface_texture",
  "remove_surface_texture",
] as const
export const surfaceTextureOperations = [
  z
    .object({
      tool: z.literal("model_surface_textures"),
      arguments: surfaceTextureToolInputs.model_surface_textures,
    })
    .strict(),
  z
    .object({
      tool: z.literal("create_surface_texture"),
      arguments: surfaceTextureToolInputs.create_surface_texture,
    })
    .strict(),
  z
    .object({
      tool: z.literal("update_surface_texture"),
      arguments: surfaceTextureToolInputs.update_surface_texture,
    })
    .strict(),
  z
    .object({
      tool: z.literal("remove_surface_texture"),
      arguments: surfaceTextureToolInputs.remove_surface_texture,
    })
    .strict(),
] as const
export const surfaceTextureOperationSchema = z.discriminatedUnion("tool", surfaceTextureOperations)
export type SurfaceTextureOperation = z.infer<typeof surfaceTextureOperationSchema>
export type SurfaceTextureMutationOperation = Exclude<
  SurfaceTextureOperation,
  { tool: "model_surface_textures" }
>

export function decodeSurfaceTextureMap(input: z.infer<typeof surfaceTextureWireMapSchema>) {
  if (input.kind === "builtin") return surfaceTextureMapSchema.parse(input)
  const map = packedSurfaceTextureMapSchema.parse(input)
  const pixels = canonicalGrayBytes(map.grayscaleBase64)
  if (!pixels) throw new Error("The packed grayscale map is not canonical base64.")
  return surfaceTextureMapSchema.parse({
    kind: "custom",
    width: map.width,
    height: map.height,
    pixels: Array.from(pixels),
  })
}

export const surfaceTextureSummarySchema = z
  .object({
    ...layerSettings,
    id: surfaceTextureLayerIdSchema,
    featureId: featureIdSchema,
    target: z
      .object({
        kind: z.enum(["body", "faces"]),
        outputRole: surfaceTextureLayerSchema.shape.target.options[0].shape.outputRole,
        faceReferenceCount: z.number().int().min(0).max(256),
      })
      .strict()
      .refine((target) =>
        target.kind === "faces" ? target.faceReferenceCount > 0 : target.faceReferenceCount === 0,
      ),
    map: z.discriminatedUnion("kind", [
      surfaceTextureMapSchema.options[0],
      z
        .object({
          kind: z.literal("custom"),
          width: z.number().int().min(1).max(MAX_SURFACE_TEXTURE_MAP_DIMENSION),
          height: z.number().int().min(1).max(MAX_SURFACE_TEXTURE_MAP_DIMENSION),
          pixelCount: z.number().int().positive().max(MAX_GRAY_BYTES),
        })
        .strict()
        .refine((map) => map.pixelCount === map.width * map.height),
    ]),
    mask: z
      .object({
        base: surfaceTextureMaskSchema.shape.base,
        strokeCount: z.number().int().min(0).max(2048),
      })
      .strict(),
  })
  .strict()
export const surfaceTexturesViewSchema = z
  .object({
    schemaVersion: z.literal(1),
    documentId: documentIdSchema,
    revision: revisionSchema,
    featureId: featureIdSchema,
    layers: z.array(surfaceTextureSummarySchema).max(MAX_SURFACE_TEXTURE_LAYERS_PER_FEATURE),
  })
  .strict()
  .refine(
    (view) =>
      view.layers.every((layer) => layer.featureId === view.featureId) &&
      new Set(view.layers.map(({ id }) => id)).size === view.layers.length,
  )
export const surfaceTexturePreviewEvidenceSchema = z
  .object({
    bodyCount: z.number().int().min(0).max(MAX_SURFACE_TEXTURE_LAYERS_PER_FEATURE),
    sourceTriangleCount: z.number().int().min(0).max(2_000_000),
    triangleCount: z.number().int().min(0).max(2_000_000),
    vertexCount: z.number().int().min(0).max(6_000_000),
  })
  .strict()
export const surfaceTextureCommitViewSchema = z
  .object({
    schemaVersion: z.literal(1),
    documentId: documentIdSchema,
    baseRevision: revisionSchema,
    revision: revisionSchema,
    featureId: featureIdSchema,
    layerId: surfaceTextureLayerIdSchema,
    operation: z.enum(["create", "update", "remove"]),
    preview: surfaceTexturePreviewEvidenceSchema,
  })
  .strict()
  .refine((view) => view.revision === view.baseRevision + 1)
export type SurfaceTexturesView = z.infer<typeof surfaceTexturesViewSchema>
export type SurfaceTextureCommitView = z.infer<typeof surfaceTextureCommitViewSchema>
export type SurfaceTexturePreviewEvidence = z.infer<typeof surfaceTexturePreviewEvidenceSchema>

export function isSurfaceTextureToolName(name: string) {
  return Object.hasOwn(surfaceTextureToolInputs, name)
}
