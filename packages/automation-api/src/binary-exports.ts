import { documentIdSchema, revisionSchema } from "@vibeshape/domain/identifiers"
import { z } from "zod"
import type { LocalOperation } from "./local-tools"

export const BINARY_EXPORT_MAX_BYTES = 6 * 1024 * 1024
export const BINARY_EXPORT_CHUNK_MAX_BYTES = 90 * 1024
export const BINARY_EXPORT_TTL_MS = 5 * 60 * 1000
const exportId = z.uuid()
const byteOffset = z.number().int().min(0).max(BINARY_EXPORT_MAX_BYTES)
export const binaryExportFormatSchema = z.enum(["step", "stl", "3mf", "vshape"])
const descriptorFields = {
  exportId,
  documentId: documentIdSchema,
  revision: revisionSchema,
  format: binaryExportFormatSchema,
  filename: z.string().regex(/^model\.(step|stl|3mf|vshape)$/),
  mimeType: z.enum(["model/step", "model/stl", "model/3mf", "application/octet-stream"]),
  byteLength: z.number().int().positive().max(BINARY_EXPORT_MAX_BYTES),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  expiresAt: z.iso.datetime(),
  chunkMaxBytes: z.literal(BINARY_EXPORT_CHUNK_MAX_BYTES),
}
export const binaryExportDescriptorSchema = z
  .object(descriptorFields)
  .strict()
  .refine(
    (value) =>
      value.filename === `model.${value.format}` &&
      value.mimeType === binaryExportMimeType(value.format),
    "Export filename and media type must match its format.",
  )
export const binaryExportChunkSchema = z
  .object({
    exportId,
    documentId: documentIdSchema,
    revision: revisionSchema,
    offset: byteOffset,
    totalBytes: descriptorFields.byteLength,
    byteLength: z.number().int().min(0).max(BINARY_EXPORT_CHUNK_MAX_BYTES),
    base64: z
      .string()
      .max((BINARY_EXPORT_CHUNK_MAX_BYTES / 3) * 4)
      .regex(/^[A-Za-z0-9+/]*={0,2}$/)
      .refine((value) => value.length % 4 === 0),
    nextOffset: byteOffset.nullable(),
  })
  .strict()
  .refine(chunkIsConsistent, "Export chunk length and next offset must match its bytes.")
export const binaryExportDiscardSchema = z.object({ exportId, discarded: z.literal(true) }).strict()
export const localBinaryExportInputs = {
  prepare_model_export: z
    .object({ revision: revisionSchema, format: binaryExportFormatSchema.exclude(["vshape"]) })
    .strict(),
  prepare_project_backup: z.object({ revision: revisionSchema }).strict(),
  read_export_chunk: z
    .object({
      exportId,
      offset: byteOffset,
      limit: z
        .number()
        .int()
        .min(1)
        .max(BINARY_EXPORT_CHUNK_MAX_BYTES)
        .default(BINARY_EXPORT_CHUNK_MAX_BYTES),
    })
    .strict(),
  discard_export: z.object({ exportId }).strict(),
}
export const localBinaryExportOperations = [
  z
    .object({
      tool: z.literal("prepare_model_export"),
      arguments: localBinaryExportInputs.prepare_model_export,
    })
    .strict(),
  z
    .object({
      tool: z.literal("prepare_project_backup"),
      arguments: localBinaryExportInputs.prepare_project_backup,
    })
    .strict(),
  z
    .object({
      tool: z.literal("read_export_chunk"),
      arguments: localBinaryExportInputs.read_export_chunk,
    })
    .strict(),
  z
    .object({
      tool: z.literal("discard_export"),
      arguments: localBinaryExportInputs.discard_export,
    })
    .strict(),
] as const
const operationSchema = z.discriminatedUnion("tool", localBinaryExportOperations)
export type LocalBinaryExportOperation = z.infer<typeof operationSchema>
export type BinaryExportDescriptor = z.infer<typeof binaryExportDescriptorSchema>
export type BinaryExportChunk = z.infer<typeof binaryExportChunkSchema>
export function isLocalBinaryExport(
  operation: LocalOperation,
): operation is LocalBinaryExportOperation {
  return (
    operation.tool === "prepare_model_export" ||
    operation.tool === "prepare_project_backup" ||
    operation.tool === "read_export_chunk" ||
    operation.tool === "discard_export"
  )
}
export function binaryExportResultMatches(
  operation: LocalBinaryExportOperation,
  value: unknown,
  documentId?: string,
) {
  if (operation.tool === "discard_export")
    return binaryExportDiscardSchema.parse(value).exportId === operation.arguments.exportId
  if (operation.tool === "read_export_chunk") {
    const chunk = binaryExportChunkSchema.parse(value)
    return (
      (documentId === undefined || chunk.documentId === documentId) &&
      chunk.exportId === operation.arguments.exportId &&
      chunk.offset === operation.arguments.offset &&
      chunk.byteLength === Math.min(operation.arguments.limit, chunk.totalBytes - chunk.offset)
    )
  }
  const file = binaryExportDescriptorSchema.parse(value)
  return (
    (documentId === undefined || file.documentId === documentId) &&
    file.revision === operation.arguments.revision &&
    file.format ===
      (operation.tool === "prepare_project_backup" ? "vshape" : operation.arguments.format)
  )
}
export function binaryExportMimeType(format: z.infer<typeof binaryExportFormatSchema>) {
  const types = {
    step: "model/step",
    stl: "model/stl",
    "3mf": "model/3mf",
    vshape: "application/octet-stream",
  } as const
  return types[format]
}

function chunkIsConsistent(value: {
  base64: string
  byteLength: number
  offset: number
  totalBytes: number
  nextOffset: number | null
}) {
  const padding = value.base64.endsWith("==") ? 2 : value.base64.endsWith("=") ? 1 : 0
  const end = value.offset + value.byteLength
  return (
    value.byteLength === (value.base64.length / 4) * 3 - padding &&
    end <= value.totalBytes &&
    (value.byteLength > 0 || value.offset === value.totalBytes) &&
    value.nextOffset === (end === value.totalBytes ? null : end)
  )
}
