import { documentIdSchema, revisionSchema, sketchIdSchema } from "@vibeshape/domain/identifiers"
import { sourceAssetOutputIdSchema, sourceAssetSchema } from "@vibeshape/domain/source-assets"
import { z } from "zod"
import {
  IMPORT_UPLOAD_CHUNK_MAX_BYTES,
  IMPORT_UPLOAD_MAX_BYTES,
  importUploadDiscardSchema,
  localImportInputs,
} from "./imports"
import type { LocalOperation } from "./local-tools"
export const planarImportUnitSchema = z.enum(["declared", "px", "mm", "cm", "m", "in", "ft", "um"])
export const planarImportPlaneSchema = z.enum(["xy", "xz", "yz"])
const version = z.number().int().nonnegative().safe()
export function planarUploadFormat(filename: string) {
  const extension = filename.toLowerCase().split(".").at(-1)
  return extension === "svg" || extension === "dxf" ? extension : null
}
const fields = {
  filename: sourceAssetSchema.shape.filename,
  byteLength: z.number().int().positive().max(IMPORT_UPLOAD_MAX_BYTES),
  unit: planarImportUnitSchema,
  plane: planarImportPlaneSchema,
}
function validIntent(input: { filename: string; unit: string }) {
  const format = planarUploadFormat(input.filename)
  return format === "svg" ? input.unit !== "declared" : format === "dxf" && input.unit !== "px"
}
export const planarUploadDescriptorSchema = z
  .object({
    uploadId: z.uuid(),
    documentId: documentIdSchema,
    baseRevision: revisionSchema,
    uploadVersion: version,
    ...fields,
    format: z.enum(["svg", "dxf"]),
    receivedBytes: z.number().int().nonnegative().max(IMPORT_UPLOAD_MAX_BYTES),
    sha256: sourceAssetSchema.shape.digest.nullable(),
    status: z.enum(["uploading", "ready"]),
    expiresAt: z.iso.datetime(),
    chunkMaxBytes: z.literal(IMPORT_UPLOAD_CHUNK_MAX_BYTES),
  })
  .strict()
  .refine(
    (value) =>
      validIntent(value) &&
      value.format === planarUploadFormat(value.filename) &&
      value.receivedBytes <= value.byteLength &&
      (value.status === "ready"
        ? value.receivedBytes === value.byteLength && value.sha256 !== null
        : value.sha256 === null),
    "Planar upload must match its units, format and captured bytes.",
  )
const coordinate = z.number().finite().min(-100_000).max(100_000)
const point = z.tuple([coordinate, coordinate])
const normalizations = {
  mm: ["millimeter", 1],
  cm: ["centimeter", 10],
  m: ["meter", 1000],
  in: ["inch", 25.4],
  ft: ["foot", 304.8],
  um: ["micrometer", 0.001],
  px: ["unitless", 25.4 / 96],
} as const
function validNormalization(value: {
  upload: PlanarUploadDescriptor
  unitPolicy: "selected" | "declared"
  normalization: z.infer<typeof sourceAssetSchema.shape.normalization>
}) {
  if (value.upload.unit === "declared")
    return (
      value.unitPolicy === "declared" &&
      Object.values(normalizations).some(
        ([unit, scale]) =>
          unit !== "unitless" &&
          unit === value.normalization.sourceUnit &&
          scale === value.normalization.scaleToMillimeters,
      )
    )
  const [unit, scale] = normalizations[value.upload.unit]
  return (
    value.unitPolicy === "selected" &&
    value.normalization.sourceUnit === unit &&
    value.normalization.scaleToMillimeters === scale
  )
}
export const planarUploadInspectionSchema = z
  .object({
    upload: planarUploadDescriptorSchema,
    sketchId: sketchIdSchema,
    normalization: sourceAssetSchema.shape.normalization,
    unitPolicy: z.enum(["selected", "declared"]),
    bounds: z.object({ min: point, max: point }).strict(),
    pathOutputs: z.array(sourceAssetOutputIdSchema).min(1).max(1024),
    closedPaths: z.number().int().nonnegative().max(1024),
    curves: z.number().int().positive().max(10_000),
  })
  .strict()
  .refine(
    (value) =>
      validNormalization(value) &&
      value.upload.status === "ready" &&
      new Set(value.pathOutputs).size === value.pathOutputs.length &&
      value.closedPaths <= value.pathOutputs.length &&
      value.pathOutputs.length <= value.curves &&
      value.bounds.min.every(
        (coordinate, index) => coordinate <= (value.bounds.max[index] ?? -Infinity),
      ),
    "Planar inspection requires complete captured paths and finite ordered bounds.",
  )
export const planarUploadCommitSchema = z
  .object({
    uploadId: z.uuid(),
    uploadVersion: version,
    documentId: documentIdSchema,
    baseRevision: revisionSchema,
    revision: revisionSchema,
    sketchId: sketchIdSchema,
    pathOutputs: z.array(sourceAssetOutputIdSchema).min(1).max(1024),
  })
  .strict()
  .refine(
    (value) =>
      value.revision > value.baseRevision &&
      new Set(value.pathOutputs).size === value.pathOutputs.length,
    "Planar commit requires an advancing base and unique captured paths.",
  )
export const localPlanarImportInputs = {
  begin_planar_import_upload: z
    .object({ revision: revisionSchema, ...fields, label: z.string().min(1).max(120).optional() })
    .strict()
    .refine(
      validIntent,
      "SVG requires selected units; DXF permits declared or selected physical units.",
    ),
  append_planar_import_chunk: localImportInputs.append_import_chunk,
  inspect_planar_import_upload: localImportInputs.inspect_import_upload,
  commit_planar_import_upload: localImportInputs.commit_import_upload,
  discard_planar_import_upload: localImportInputs.discard_import_upload,
}
export const localPlanarImportOperations = [
  z
    .object({
      tool: z.literal("begin_planar_import_upload"),
      arguments: localPlanarImportInputs.begin_planar_import_upload,
    })
    .strict(),
  z
    .object({
      tool: z.literal("append_planar_import_chunk"),
      arguments: localPlanarImportInputs.append_planar_import_chunk,
    })
    .strict(),
  z
    .object({
      tool: z.literal("inspect_planar_import_upload"),
      arguments: localPlanarImportInputs.inspect_planar_import_upload,
    })
    .strict(),
  z
    .object({
      tool: z.literal("commit_planar_import_upload"),
      arguments: localPlanarImportInputs.commit_planar_import_upload,
    })
    .strict(),
  z
    .object({
      tool: z.literal("discard_planar_import_upload"),
      arguments: localPlanarImportInputs.discard_planar_import_upload,
    })
    .strict(),
] as const
const planarOperationSchema = z.discriminatedUnion("tool", localPlanarImportOperations)
export type LocalPlanarImportOperation = z.infer<typeof planarOperationSchema>
export type PlanarUploadDescriptor = z.infer<typeof planarUploadDescriptorSchema>
export type PlanarUploadInspection = z.infer<typeof planarUploadInspectionSchema>
export function isLocalPlanarImport(
  operation: LocalOperation,
): operation is LocalPlanarImportOperation {
  return (
    operation.tool === "begin_planar_import_upload" ||
    operation.tool === "append_planar_import_chunk" ||
    operation.tool === "inspect_planar_import_upload" ||
    operation.tool === "commit_planar_import_upload" ||
    operation.tool === "discard_planar_import_upload"
  )
}

export function planarImportResultMatches(
  operation: LocalPlanarImportOperation,
  value: unknown,
  documentId?: string,
) {
  if (operation.tool === "discard_planar_import_upload")
    return importUploadDiscardSchema.parse(value).uploadId === operation.arguments.uploadId
  if (operation.tool === "commit_planar_import_upload") {
    const result = planarUploadCommitSchema.parse(value)
    return (
      (documentId === undefined || result.documentId === documentId) &&
      result.uploadId === operation.arguments.uploadId &&
      result.uploadVersion === operation.arguments.uploadVersion
    )
  }
  return planarDescriptorMatches(operation, value, documentId)
}
function planarDescriptorMatches(
  operation: Exclude<
    LocalPlanarImportOperation,
    { tool: "commit_planar_import_upload" | "discard_planar_import_upload" }
  >,
  value: unknown,
  documentId?: string,
) {
  const descriptor =
    operation.tool === "inspect_planar_import_upload"
      ? planarUploadInspectionSchema.parse(value).upload
      : planarUploadDescriptorSchema.parse(value)
  if (documentId !== undefined && descriptor.documentId !== documentId) return false
  if (operation.tool === "begin_planar_import_upload") {
    const input = operation.arguments
    return planarBeginMatches(input, descriptor)
  }
  if (descriptor.uploadId !== operation.arguments.uploadId) return false
  if (operation.tool === "inspect_planar_import_upload") return descriptor.status === "ready"
  return planarAppendMatches(operation.arguments, descriptor)
}
function planarAppendMatches(
  input: z.infer<typeof localPlanarImportInputs.append_planar_import_chunk>,
  descriptor: PlanarUploadDescriptor,
) {
  const padding = input.base64.endsWith("==") ? 2 : input.base64.endsWith("=") ? 1 : 0
  const byteLength = (input.base64.length / 4) * 3 - padding
  return (
    byteLength === Math.min(IMPORT_UPLOAD_CHUNK_MAX_BYTES, descriptor.byteLength - input.offset) &&
    descriptor.receivedBytes >= input.offset + byteLength
  )
}

function planarBeginMatches(
  input: z.infer<typeof localPlanarImportInputs.begin_planar_import_upload>,
  descriptor: PlanarUploadDescriptor,
) {
  return (
    descriptor.baseRevision === input.revision &&
    descriptor.filename === input.filename &&
    descriptor.byteLength === input.byteLength &&
    descriptor.unit === input.unit &&
    descriptor.plane === input.plane &&
    descriptor.receivedBytes === 0 &&
    descriptor.uploadVersion === 0 &&
    descriptor.status === "uploading"
  )
}
