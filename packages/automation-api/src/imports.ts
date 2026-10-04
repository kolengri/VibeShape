import { bodyReferenceSchema } from "@vibeshape/domain/body-reference"
import { documentIdSchema, featureIdSchema, revisionSchema } from "@vibeshape/domain/identifiers"
import { sourceAssetSchema } from "@vibeshape/domain/source-assets"
import { z } from "zod"
import type { LocalOperation } from "./local-tools"

export const IMPORT_UPLOAD_MAX_BYTES = 6 * 1024 * 1024
export const IMPORT_UPLOAD_CHUNK_MAX_BYTES = 90 * 1024
export const IMPORT_UPLOAD_TTL_MS = 5 * 60 * 1000
export const importUploadUnitSchema =
  sourceAssetSchema.shape.normalization.shape.sourceUnit.exclude(["unitless"])
const uploadId = z.uuid()
const offset = z.number().int().nonnegative().max(IMPORT_UPLOAD_MAX_BYTES)
const version = z.number().int().nonnegative().safe()
const base64 = z
  .string()
  .min(4)
  .max((IMPORT_UPLOAD_CHUNK_MAX_BYTES / 3) * 4)
  .regex(/^[A-Za-z0-9+/]*={0,2}$/)
  .refine((value) => value.length % 4 === 0, "Base64 requires complete groups.")
const fileFields = {
  filename: sourceAssetSchema.shape.filename,
  byteLength: z.number().int().positive().max(IMPORT_UPLOAD_MAX_BYTES),
  sourceUnit: importUploadUnitSchema.nullable(),
}
export function importUploadFormat(filename: string) {
  const extension = filename.toLowerCase().split(".").at(-1)
  if (extension === "step" || extension === "stp") return "step"
  return extension === "brep" || extension === "stl" || extension === "3mf" ? extension : null
}
function fileIntentIsValid(input: { filename: string; sourceUnit: string | null }) {
  const format = importUploadFormat(input.filename)
  return format !== null && (format === "3mf") === (input.sourceUnit === null)
}
export const importUploadDescriptorSchema = z
  .object({
    uploadId,
    documentId: documentIdSchema,
    baseRevision: revisionSchema,
    uploadVersion: version,
    ...fileFields,
    format: z.enum(["step", "brep", "stl", "3mf"]),
    receivedBytes: offset,
    sha256: sourceAssetSchema.shape.digest.nullable(),
    status: z.enum(["uploading", "ready"]),
    expiresAt: z.iso.datetime(),
    chunkMaxBytes: z.literal(IMPORT_UPLOAD_CHUNK_MAX_BYTES),
  })
  .strict()
  .refine(
    (value) =>
      fileIntentIsValid(value) &&
      value.format === importUploadFormat(value.filename) &&
      value.receivedBytes <= value.byteLength &&
      (value.status === "ready"
        ? value.receivedBytes === value.byteLength && value.sha256 !== null
        : value.sha256 === null),
    "Import descriptor must match its source intent and captured byte state.",
  )
const coordinate = z.number().finite().min(-1_000_000).max(1_000_000)
const point = z.tuple([coordinate, coordinate, coordinate])
export const importUploadInspectionSchema = z
  .object({
    upload: importUploadDescriptorSchema,
    featureId: featureIdSchema,
    representation: z.enum(["exact-solid", "triangle-mesh"]),
    normalization: sourceAssetSchema.shape.normalization,
    outputs: z
      .array(
        z
          .object({
            outputRole: bodyReferenceSchema.shape.outputRole,
            bounds: z.object({ min: point, max: point }).strict(),
            volumeMm3: z.number().finite().positive().nullable(),
            surfaceAreaMm2: z.number().finite().positive(),
            triangleCount: z.number().int().nonnegative().safe(),
          })
          .strict(),
      )
      .min(1)
      .max(128),
    warnings: z
      .array(z.object({ code: z.literal("degenerate-triangles"), count: version }).strict())
      .max(1),
  })
  .strict()
  .refine(
    (value) =>
      value.upload.status === "ready" &&
      value.representation ===
        (value.upload.format === "step" || value.upload.format === "brep"
          ? "exact-solid"
          : "triangle-mesh") &&
      new Set(value.outputs.map(({ outputRole }) => outputRole)).size === value.outputs.length &&
      value.outputs.every(({ volumeMm3 }) =>
        value.representation === "exact-solid" ? volumeMm3 !== null : volumeMm3 === null,
      ),
    "Import inspection requires captured unique output roles and explicit representation.",
  )
export const importUploadCommitSchema = z
  .object({
    uploadId,
    documentId: documentIdSchema,
    baseRevision: revisionSchema,
    revision: revisionSchema,
    uploadVersion: version,
    featureId: featureIdSchema,
    outputRoles: z.array(bodyReferenceSchema.shape.outputRole).min(1).max(128),
  })
  .strict()
  .refine(
    (value) =>
      value.revision > value.baseRevision &&
      new Set(value.outputRoles).size === value.outputRoles.length,
    "Import commit must advance its base with unique outputs.",
  )
export const importUploadDiscardSchema = z.object({ uploadId, discarded: z.literal(true) }).strict()
export const localImportInputs = {
  begin_import_upload: z
    .object({
      revision: revisionSchema,
      ...fileFields,
      label: z.string().min(1).max(120).optional(),
    })
    .strict()
    .refine(fileIntentIsValid, "Import requires a native format and its explicit source units."),
  append_import_chunk: z.object({ uploadId, offset, base64 }).strict(),
  inspect_import_upload: z.object({ uploadId }).strict(),
  commit_import_upload: z.object({ uploadId, uploadVersion: version }).strict(),
  discard_import_upload: z.object({ uploadId }).strict(),
}
export const localImportOperations = [
  z
    .object({
      tool: z.literal("begin_import_upload"),
      arguments: localImportInputs.begin_import_upload,
    })
    .strict(),
  z
    .object({
      tool: z.literal("append_import_chunk"),
      arguments: localImportInputs.append_import_chunk,
    })
    .strict(),
  z
    .object({
      tool: z.literal("inspect_import_upload"),
      arguments: localImportInputs.inspect_import_upload,
    })
    .strict(),
  z
    .object({
      tool: z.literal("commit_import_upload"),
      arguments: localImportInputs.commit_import_upload,
    })
    .strict(),
  z
    .object({
      tool: z.literal("discard_import_upload"),
      arguments: localImportInputs.discard_import_upload,
    })
    .strict(),
] as const
const operationSchema = z.discriminatedUnion("tool", localImportOperations)
export type LocalImportOperation = z.infer<typeof operationSchema>
export type ImportUploadDescriptor = z.infer<typeof importUploadDescriptorSchema>
export type ImportUploadInspection = z.infer<typeof importUploadInspectionSchema>
export type ImportUploadCommit = z.infer<typeof importUploadCommitSchema>
export function isLocalImport(operation: LocalOperation): operation is LocalImportOperation {
  return (
    operation.tool === "begin_import_upload" ||
    operation.tool === "append_import_chunk" ||
    operation.tool === "inspect_import_upload" ||
    operation.tool === "commit_import_upload" ||
    operation.tool === "discard_import_upload"
  )
}

export function importResultMatches(
  operation: LocalImportOperation,
  value: unknown,
  documentId?: string,
) {
  if (operation.tool === "discard_import_upload")
    return importUploadDiscardSchema.parse(value).uploadId === operation.arguments.uploadId
  if (operation.tool === "commit_import_upload") {
    const result = importUploadCommitSchema.parse(value)
    return (
      (documentId === undefined || result.documentId === documentId) &&
      result.uploadId === operation.arguments.uploadId &&
      result.uploadVersion === operation.arguments.uploadVersion
    )
  }
  return descriptorResultMatches(operation, value, documentId)
}

function descriptorResultMatches(
  operation: Exclude<
    LocalImportOperation,
    { tool: "commit_import_upload" | "discard_import_upload" }
  >,
  value: unknown,
  documentId?: string,
) {
  const descriptor =
    operation.tool === "inspect_import_upload"
      ? importUploadInspectionSchema.parse(value).upload
      : importUploadDescriptorSchema.parse(value)
  if (documentId !== undefined && descriptor.documentId !== documentId) return false
  if (operation.tool === "begin_import_upload") {
    return beginResultMatches(operation.arguments, descriptor)
  }
  if (descriptor.uploadId !== operation.arguments.uploadId) return false
  if (operation.tool === "inspect_import_upload") return descriptor.status === "ready"
  return appendResultMatches(operation.arguments, descriptor)
}

function beginResultMatches(
  input: z.infer<typeof localImportInputs.begin_import_upload>,
  descriptor: ImportUploadDescriptor,
) {
  return (
    descriptor.baseRevision === input.revision &&
    descriptor.filename === input.filename &&
    descriptor.byteLength === input.byteLength &&
    descriptor.sourceUnit === input.sourceUnit &&
    descriptor.receivedBytes === 0 &&
    descriptor.uploadVersion === 0 &&
    descriptor.status === "uploading"
  )
}

function appendResultMatches(
  input: z.infer<typeof localImportInputs.append_import_chunk>,
  descriptor: ImportUploadDescriptor,
) {
  const padding = input.base64.endsWith("==") ? 2 : input.base64.endsWith("=") ? 1 : 0
  const byteLength = (input.base64.length / 4) * 3 - padding
  return (
    byteLength === Math.min(IMPORT_UPLOAD_CHUNK_MAX_BYTES, descriptor.byteLength - input.offset) &&
    descriptor.receivedBytes >= input.offset + byteLength
  )
}
