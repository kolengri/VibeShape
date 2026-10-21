import {
  documentIdSchema,
  draftIdSchema,
  featureIdSchema,
  revisionSchema,
} from "@vibeshape/domain/identifiers"
import { z } from "zod"
import { serializedQueryBytes } from "./query-byte-budget"

export const RENDER_PREVIEW_MAX_BYTES = 90 * 1024
const renderPreviewQualitySchema = z.enum(["overview", "detail"])
export const renderPreviewViewSchema = z.enum([
  "isometric",
  "front",
  "back",
  "left",
  "right",
  "top",
  "bottom",
])
export const renderPreviewViewsSchema = z
  .array(renderPreviewViewSchema)
  .min(1)
  .max(4)
  .refine((views) => new Set(views).size === views.length, "Views must be unique.")
export const renderPreviewTargetSchema = z
  .object({ featureId: featureIdSchema, outputRole: z.string().min(1).max(120) })
  .strict()

const cameraVectorSchema = z.tuple([
  z.number().finite().min(-1_000_000).max(1_000_000),
  z.number().finite().min(-1_000_000).max(1_000_000),
  z.number().finite().min(-1_000_000).max(1_000_000),
])
export const renderPreviewCameraSchema = z
  .object({
    position: cameraVectorSchema,
    target: cameraVectorSchema,
    up: cameraVectorSchema.optional(),
    viewHeightMm: z.number().finite().positive().max(1_000_000).optional(),
  })
  .strict()
  .refine(({ position, target, up }) => {
    const direction = position.map((value, index) => value - (target[index] ?? 0))
    const distance = Math.hypot(...direction)
    if (!distance) return false
    if (!up) return true
    const upLength = Math.hypot(...up)
    const dot = direction.reduce((sum, value, index) => sum + value * (up[index] ?? 0), 0)
    return upLength > 0 && Math.abs(dot / distance / upLength) < 1 - 1e-10
  }, "The camera needs a distinct position/target and a nonparallel, nonzero up vector.")

const options = {
  revision: revisionSchema,
  quality: renderPreviewQualitySchema.optional(),
  views: renderPreviewViewsSchema.optional(),
  target: renderPreviewTargetSchema.optional(),
  camera: renderPreviewCameraSchema.optional(),
}
export const renderPreviewArgumentsSchema = z
  .discriminatedUnion("source", [
    z.object({ source: z.literal("model"), ...options }).strict(),
    z.object({ source: z.literal("draft"), draftId: draftIdSchema, ...options }).strict(),
  ])
  .refine((args) => !(args.camera && args.views), "Choose camera or standard views, not both.")
export const renderDraftPreviewRequestSchema = z
  .object({ schemaVersion: z.literal(1), draftId: draftIdSchema, ...options })
  .strict()
  .refine((args) => !(args.camera && args.views), "Choose camera or standard views, not both.")

const previewImageFieldsSchema = z
  .object({
    mimeType: z.literal("image/png"),
    base64: z
      .string()
      .min(44)
      .max(Math.ceil(RENDER_PREVIEW_MAX_BYTES / 3) * 4)
      .regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/)
      .refine((value) => value.startsWith("iVBORw0KGgo"), "A PNG signature is required."),
    width: z.number().int().positive().max(1024),
    height: z.number().int().positive().max(768),
    views: z
      .array(z.enum([...renderPreviewViewSchema.options, "custom"]))
      .min(1)
      .max(4)
      .refine(
        (views) =>
          new Set(views).size === views.length && (!views.includes("custom") || views.length === 1),
        "A custom camera produces one view.",
      ),
  })
  .strict()

function pngSizeMatches(image: z.infer<typeof previewImageFieldsSchema>) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"
  const header = new Uint8Array(24)
  for (let index = 0; index < 32; index += 4) {
    const bits =
      (alphabet.indexOf(image.base64[index] ?? "") << 18) |
      (alphabet.indexOf(image.base64[index + 1] ?? "") << 12) |
      (alphabet.indexOf(image.base64[index + 2] ?? "") << 6) |
      alphabet.indexOf(image.base64[index + 3] ?? "")
    header.set([(bits >>> 16) & 255, (bits >>> 8) & 255, bits & 255], (index / 4) * 3)
  }
  const bytes = new DataView(header.buffer)
  return (
    bytes.getUint32(8) === 13 &&
    bytes.getUint32(12) === 0x49484452 &&
    bytes.getUint32(16) === image.width &&
    bytes.getUint32(20) === image.height
  )
}
export const renderedPreviewImageSchema = previewImageFieldsSchema.refine(
  pngSizeMatches,
  "PNG dimensions must match the bounded image metadata.",
)

const evidence = {
  documentId: documentIdSchema,
  revision: revisionSchema,
  generation: z.number().int().nonnegative().safe(),
  geometryStatus: z.enum(["valid", "invalid"]),
  bodyCount: z.number().int().positive().safe(),
  quality: renderPreviewQualitySchema,
  target: renderPreviewTargetSchema.optional(),
  camera: renderPreviewCameraSchema.optional(),
  image: renderedPreviewImageSchema,
}
const overviewSizeMatches = (preview: {
  quality: "overview" | "detail"
  image: { width: number; height: number }
}) => preview.quality !== "overview" || (preview.image.width <= 768 && preview.image.height <= 576)
export const renderPreviewResultSchema = z
  .discriminatedUnion("source", [
    z.object({ source: z.literal("model"), ...evidence }).strict(),
    z
      .object({
        source: z.literal("draft"),
        draftId: draftIdSchema,
        baseRevision: revisionSchema,
        ...evidence,
      })
      .strict(),
  ])
  .refine(overviewSizeMatches, "Overview images must fit within 768 × 576 pixels.")
export type RenderPreviewArguments = z.infer<typeof renderPreviewArgumentsSchema>
export type RenderPreviewResult = z.infer<typeof renderPreviewResultSchema>
const renderOperationSchema = z
  .object({ tool: z.literal("render_preview"), arguments: renderPreviewArgumentsSchema })
  .strict()

const metadata = { ...evidence, image: previewImageFieldsSchema.omit({ base64: true }) }
export const renderPreviewMetadataSchema = z
  .discriminatedUnion("source", [
    z.object({ source: z.literal("model"), ...metadata }).strict(),
    z
      .object({
        source: z.literal("draft"),
        draftId: draftIdSchema,
        baseRevision: revisionSchema,
        ...metadata,
      })
      .strict(),
  ])
  .refine(overviewSizeMatches, "Overview images must fit within 768 × 576 pixels.")

export function renderPreviewMcpResult(value: RenderPreviewResult) {
  const { image, ...context } = value
  const { base64, ...imageMetadata } = image
  // Keep image bytes in one native content block, outside text and structured metadata.
  const result = { ok: true as const, value: { ...context, image: imageMetadata } }
  return {
    isError: false,
    content: [
      { type: "text" as const, text: JSON.stringify(result) },
      { type: "image" as const, data: base64, mimeType: image.mimeType },
    ],
    structuredContent: { result },
  }
}

export function renderPreviewResultContextMatches(
  input: unknown,
  result: { ok: boolean; value?: unknown },
  documentId?: string,
): boolean | null {
  const operation = renderOperationSchema.safeParse(input)
  if (!operation.success) return null
  if (serializedQueryBytes(result) > 128 * 1024) return false
  if (!result.ok) return true
  const value = renderPreviewResultSchema.safeParse(result.value)
  if (!value.success) return false
  return (
    value.data.quality === (operation.data.arguments.quality ?? "overview") &&
    revisionMatches(operation.data.arguments, value.data, documentId) &&
    targetMatches(operation.data.arguments, value.data) &&
    viewsMatch(operation.data.arguments, value.data) &&
    JSON.stringify(value.data.camera) === JSON.stringify(operation.data.arguments.camera)
  )
}

function viewsMatch(args: RenderPreviewArguments, preview: RenderPreviewResult) {
  const requestedViews = args.camera
    ? ["custom"]
    : (args.views ??
      (args.quality === "detail" ? ["isometric", "front", "right", "top"] : ["isometric"]))
  return (
    preview.image.views.length === requestedViews.length &&
    preview.image.views.every((view, index) => view === requestedViews[index])
  )
}

function targetMatches(args: RenderPreviewArguments, preview: RenderPreviewResult) {
  return (
    preview.target?.featureId === args.target?.featureId &&
    preview.target?.outputRole === args.target?.outputRole &&
    (args.target === undefined || preview.bodyCount === 1)
  )
}

function revisionMatches(
  args: RenderPreviewArguments,
  preview: RenderPreviewResult,
  documentId?: string,
) {
  return (
    (documentId === undefined || preview.documentId === documentId) &&
    preview.source === args.source &&
    preview.revision === args.revision &&
    (args.source !== "draft" || (preview.source === "draft" && preview.draftId === args.draftId))
  )
}
