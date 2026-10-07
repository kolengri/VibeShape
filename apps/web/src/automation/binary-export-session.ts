import {
  BINARY_EXPORT_CHUNK_MAX_BYTES,
  BINARY_EXPORT_MAX_BYTES,
  BINARY_EXPORT_TTL_MS,
  type BinaryExportDescriptor,
  binaryExportChunkSchema,
  binaryExportDescriptorSchema,
  binaryExportMimeType,
  type LocalBinaryExportOperation,
} from "@vibeshape/automation-api/binary-exports"
import { localFailure } from "@vibeshape/automation-api/local-tools"
import { commandActorSchema } from "@vibeshape/domain/commands"
import type { MeshExportQuality } from "@vibeshape/protocol"

type Format = BinaryExportDescriptor["format"]
type PreparedFile =
  | { ok: true; documentId: string; revision: number; format: Format; file: Uint8Array }
  | { ok: false }
export type BinaryExportSourcePort = Readonly<{
  documentId: string
  currentRevision: () => number
  isActive: () => boolean
  prepare: (
    format: Format,
    revision: number,
    meshQuality?: MeshExportQuality,
  ) => Promise<PreparedFile>
}>
type PrepareOperation = Extract<
  LocalBinaryExportOperation,
  { tool: "prepare_model_export" | "prepare_project_backup" }
>
async function prepareExportSource(source: BinaryExportSourcePort, operation: PrepareOperation) {
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
  let retained: { descriptor: BinaryExportDescriptor; bytes: Uint8Array } | null = null
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
    if (retained && Date.parse(retained.descriptor.expiresAt) <= now()) retained = null
  }
  async function prepare(operation: PrepareOperation, signal?: AbortSignal) {
    if (busy) return localFailure("export-busy", "Another export is being prepared.", true)
    const revision = operation.arguments.revision
    if (options.currentRevision() !== revision)
      return localFailure("stale-revision", "The active project revision changed.", true)
    busy = true
    retained = null
    const operationEpoch = ++epoch
    const onAbort = () => {
      epoch++
      retained = null
    }
    signal?.addEventListener("abort", onAbort, { once: true })
    try {
      const { format, prepared } = await prepareExportSource(options, operation)
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
        filename: `model.${format}`,
        mimeType: binaryExportMimeType(format),
        byteLength: bytes.byteLength,
        sha256,
        expiresAt: new Date(now() + BINARY_EXPORT_TTL_MS).toISOString(),
        chunkMaxBytes: BINARY_EXPORT_CHUNK_MAX_BYTES,
      })
      retained = { descriptor, bytes }
      return { ok: true as const, value: descriptor }
    } catch {
      return localFailure("export-failed", "The file could not be prepared.", true)
    } finally {
      busy = false
      signal?.removeEventListener("abort", onAbort)
    }
  }
  function stillCurrent(operationEpoch: number, revision: number, signal?: AbortSignal) {
    return (
      available() &&
      epoch === operationEpoch &&
      !signal?.aborted &&
      options.currentRevision() === revision
    )
  }
  function validateSource(source: PreparedFile, format: Format, revision: number) {
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
    return null
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
      epoch++
      retained = null
    },
    dispose() {
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
