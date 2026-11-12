import {
  BINARY_EXPORT_CHUNK_MAX_BYTES,
  BINARY_EXPORT_MAX_BYTES,
  BINARY_EXPORT_TTL_MS,
  type BinaryExportDescriptor,
  binaryExportChunkSchema,
  binaryExportDescriptorSchema,
  binaryExportFilename,
  binaryExportMimeType,
  type LocalBinaryExportOperation,
} from "@vibeshape/automation-api/binary-exports"
import {
  pictureRenderReceiptSchema,
  type preparePictureRenderArgumentsSchema,
} from "@vibeshape/automation-api/derived-reads"
import type { PrepareDrawingExportArguments } from "@vibeshape/automation-api/drawing-export-arguments"
import { localFailure } from "@vibeshape/automation-api/local-tools"
import { commandActorSchema } from "@vibeshape/domain/commands"
import type { MeshExportQuality } from "@vibeshape/protocol"
import type { z } from "zod"

export class BinaryExportPreparationError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly retryable = false,
  ) {
    super(message)
  }
}
type Format = Exclude<BinaryExportDescriptor["format"], "png">
export type ModelFormat = Exclude<Format, "svg" | "dxf" | "pdf">
export type PreparedPictureFile = {
  ok: true
  documentId: string
  revision: number
  format: "png"
  file: Uint8Array
  metadata: Omit<z.infer<typeof pictureRenderReceiptSchema>, "file">
  isCurrent: () => boolean
}
type PreparedFile =
  | { ok: true; documentId: string; revision: number; format: Format; file: Uint8Array }
  | { ok: false }
export type PreparedDrawingFile = PreparedFile
export type PreparedModelFile = PreparedFile
export type BinaryExportSourcePort = Readonly<{
  documentId: string
  currentRevision: () => number
  isActive: () => boolean
  preparePicture?: (
    request: z.infer<typeof preparePictureRenderArgumentsSchema>,
    signal: AbortSignal,
  ) => Promise<PreparedPictureFile | { ok: false }>
  /** Derived drawing sheet produced by the same projection and writers as the Drawing dialog. */
  prepareDrawing?: (
    request: PrepareDrawingExportArguments,
    signal: AbortSignal,
  ) => Promise<PreparedDrawingFile>
  prepare: (
    format: ModelFormat,
    revision: number,
    meshQuality?: MeshExportQuality,
  ) => Promise<PreparedFile>
}>
type PrepareOperation = Extract<
  LocalBinaryExportOperation,
  {
    tool:
      | "prepare_model_export"
      | "prepare_project_backup"
      | "prepare_picture_render"
      | "prepare_drawing_export"
  }
>
async function prepareExportSource(
  source: BinaryExportSourcePort,
  operation: PrepareOperation,
  signal: AbortSignal,
) {
  if (operation.tool === "prepare_picture_render")
    return {
      format: "png" as const,
      prepared: (await source.preparePicture?.(operation.arguments, signal)) ?? {
        ok: false as const,
      },
    }
  if (operation.tool === "prepare_drawing_export")
    return {
      format: operation.arguments.format,
      prepared: (await source.prepareDrawing?.(operation.arguments, signal)) ?? {
        ok: false as const,
      },
    }
  if (operation.tool === "prepare_project_backup")
    return {
      format: "vshape" as const,
      prepared: await source.prepare("vshape", operation.arguments.revision),
    }
  const { format, revision, meshQuality } = operation.arguments
  return {
    format,
    prepared: meshQuality
      ? await source.prepare(format, revision, meshQuality)
      : await source.prepare(format, revision),
  }
}
/** Retains one detached file for the paired actor; native export remains the document's responsibility. */
export function createBinaryExportSession(
  options: BinaryExportSourcePort & {
    now?: () => number
    createExportId?: () => string
    hash?: (bytes: Uint8Array) => Promise<string>
  },
) {
  const now = options.now ?? Date.now
  const hash = options.hash ?? hashFile
  const createExportId = options.createExportId ?? (() => crypto.randomUUID())
  let owner: string | null = null,
    closed = false,
    busy = false,
    epoch = 0
  let pending: AbortController | null = null
  let retained: {
    descriptor: BinaryExportDescriptor
    bytes: Uint8Array
    isCurrent?: () => boolean
  } | null = null
  function actorMatches(input: unknown) {
    const actor = commandActorSchema.safeParse(input)
    if (!actor.success || actor.data.type !== "mcp") return false
    const key = JSON.stringify([actor.data.clientId, actor.data.sessionId])
    if (owner === null) owner = key
    return owner === key
  }
  function available() {
    return !closed && options.isActive()
  }
  function expire() {
    if (
      retained &&
      (Date.parse(retained.descriptor.expiresAt) <= now() ||
        (retained.descriptor.format === "png" &&
          retained.descriptor.revision !== options.currentRevision()) ||
        retained.isCurrent?.() === false)
    )
      retained = null
  }
  async function prepare(operation: PrepareOperation, signal?: AbortSignal) {
    if (busy) return localFailure("export-busy", "Another export is being prepared.", true)
    const revision = operation.arguments.revision
    if (options.currentRevision() !== revision)
      return localFailure("stale-revision", "The active project revision changed.", true)
    busy = true
    retained = null
    const operationEpoch = ++epoch
    const abort = new AbortController()
    pending = abort
    const onAbort = () => {
      abort.abort()
      epoch++
      retained = null
    }
    signal?.addEventListener("abort", onAbort, { once: true })
    try {
      const { format, prepared } = await prepareExportSource(options, operation, abort.signal)
      if (!stillCurrent(operationEpoch, revision, signal)) return cancelled()
      const sourceFailure = validateSource(prepared, format, revision)
      if (sourceFailure) return sourceFailure
      if (!prepared.ok) throw new Error("Expected validated export source.")
      const bytes = Uint8Array.from(prepared.file)
      const sha256 = await hash(bytes)
      if (!stillCurrent(operationEpoch, revision, signal)) return cancelled()
      const descriptor = binaryExportDescriptorSchema.parse({
        exportId: createExportId(),
        documentId: options.documentId,
        revision,
        format,
        filename: binaryExportFilename(format),
        mimeType: binaryExportMimeType(format),
        byteLength: bytes.byteLength,
        sha256,
        expiresAt: new Date(now() + BINARY_EXPORT_TTL_MS).toISOString(),
        chunkMaxBytes: BINARY_EXPORT_CHUNK_MAX_BYTES,
      })
      return retainPrepared(descriptor, bytes, prepared)
    } catch (error) {
      return preparationFailure(error)
    } finally {
      if (pending === abort) pending = null
      busy = false
      signal?.removeEventListener("abort", onAbort)
    }
  }
  function retainPrepared(
    descriptor: BinaryExportDescriptor,
    bytes: Uint8Array,
    prepared: Extract<PreparedFile, { ok: true }> | PreparedPictureFile,
  ) {
    if (prepared.format === "png") {
      if (!prepared.isCurrent()) return cancelled()
      const value = pictureRenderReceiptSchema.parse({ file: descriptor, ...prepared.metadata })
      retained = { descriptor, bytes, isCurrent: prepared.isCurrent }
      return { ok: true as const, value }
    }
    retained = { descriptor, bytes }
    return { ok: true as const, value: descriptor }
  }
  function preparationFailure(error: unknown) {
    if (error instanceof BinaryExportPreparationError)
      return localFailure(error.code, error.message, error.retryable)
    return localFailure("export-failed", "The file could not be prepared.", true)
  }
  function stillCurrent(operationEpoch: number, revision: number, signal?: AbortSignal) {
    return (
      available() &&
      epoch === operationEpoch &&
      !signal?.aborted &&
      options.currentRevision() === revision
    )
  }
  function validateSource(
    source: PreparedFile | PreparedPictureFile,
    format: BinaryExportDescriptor["format"],
    revision: number,
  ) {
    if (!source.ok) return localFailure("export-failed", "The file could not be prepared.", true)
    if (
      source.documentId !== options.documentId ||
      source.revision !== revision ||
      source.format !== format
    )
      return localFailure(
        "stale-revision",
        "The exported file belongs to another document or revision.",
        true,
      )
    if (source.file.byteLength === 0 || source.file.byteLength > BINARY_EXPORT_MAX_BYTES)
      return localFailure("export-too-large", "Prepared files must contain at most 6 MiB.")
    return signatureFailure(format, source.file)
  }
  function read(operation: Extract<LocalBinaryExportOperation, { tool: "read_export_chunk" }>) {
    const file = retained
    if (!file || file.descriptor.exportId !== operation.arguments.exportId)
      return localFailure(
        "export-unavailable",
        "The prepared file is unavailable or expired.",
        true,
      )
    const { offset, limit } = operation.arguments
    if (offset > file.bytes.byteLength)
      return localFailure(
        "invalid-export-offset",
        "The export offset is outside the prepared file.",
      )
    const bytes = file.bytes.subarray(offset, offset + limit)
    const end = offset + bytes.byteLength
    return {
      ok: true as const,
      value: binaryExportChunkSchema.parse({
        exportId: file.descriptor.exportId,
        documentId: file.descriptor.documentId,
        revision: file.descriptor.revision,
        offset,
        totalBytes: file.bytes.byteLength,
        byteLength: bytes.byteLength,
        base64: encodeBytes(bytes),
        nextOffset: end === file.bytes.byteLength ? null : end,
      }),
    }
  }
  function cancelled() {
    return localFailure(
      "session-revoked",
      "The export preparation was cancelled or its source changed.",
      true,
    )
  }
  return {
    async execute(actor: unknown, operation: LocalBinaryExportOperation, signal?: AbortSignal) {
      if (!available() || signal?.aborted) return cancelled()
      if (!actorMatches(actor))
        return localFailure(
          "export-owner-mismatch",
          "The prepared file belongs to another paired actor.",
        )
      expire()
      if (operation.tool === "read_export_chunk") return read(operation)
      if (operation.tool === "discard_export") {
        if (retained && retained.descriptor.exportId !== operation.arguments.exportId)
          return localFailure(
            "export-unavailable",
            "The prepared file is unavailable or expired.",
            true,
          )
        retained = null
        return {
          ok: true as const,
          value: { exportId: operation.arguments.exportId, discarded: true as const },
        }
      }
      return prepare(operation, signal)
    },
    cancel() {
      pending?.abort()
      epoch++
      retained = null
    },
    dispose() {
      pending?.abort()
      closed = true
      epoch++
      retained = null
    },
  }
}
async function hashFile(bytes: Uint8Array) {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", Uint8Array.from(bytes)))
  return Array.from(digest, (value) => value.toString(16).padStart(2, "0")).join("")
}
function encodeBytes(bytes: Uint8Array) {
  let text = ""
  for (let i = 0; i < bytes.byteLength; i += 0x8000)
    text += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(text)
}

/** Leading bytes of derived formats whose producers run in the page rather than a kernel. */
const SIGNATURES: Partial<
  Record<BinaryExportDescriptor["format"], { bytes: readonly number[]; message: string }>
> = {
  png: {
    bytes: [137, 80, 78, 71, 13, 10, 26, 10],
    message: "The picture renderer did not return PNG bytes.",
  },
  svg: { bytes: asciiBytes("<?xml"), message: "The drawing writer returned unexpected bytes." },
  pdf: { bytes: asciiBytes("%PDF-"), message: "The drawing writer returned unexpected bytes." },
  dxf: {
    bytes: asciiBytes("0\r\nSECTION"),
    message: "The drawing writer returned unexpected bytes.",
  },
}
function asciiBytes(value: string) {
  return [...value].map((character) => character.charCodeAt(0))
}
function signatureFailure(format: BinaryExportDescriptor["format"], file: Uint8Array) {
  const signature = SIGNATURES[format]
  if (!signature || signature.bytes.every((value, index) => file[index] === value)) return null
  return localFailure("export-invalid-type", signature.message)
}
