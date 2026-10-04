import {
  IMPORT_UPLOAD_CHUNK_MAX_BYTES,
  IMPORT_UPLOAD_TTL_MS,
} from "@vibeshape/automation-api/imports"
import { type LocalFailure, localFailure } from "@vibeshape/automation-api/local-tools"
import {
  type LocalPlanarImportOperation,
  localPlanarImportInputs,
  type PlanarUploadDescriptor,
  type PlanarUploadInspection,
  planarUploadCommitSchema,
  planarUploadDescriptorSchema,
  planarUploadFormat,
  planarUploadInspectionSchema,
} from "@vibeshape/automation-api/planar-imports"
import { canonicalJson } from "@vibeshape/domain/canonical-json"
import {
  type CommandActor,
  commandActorSchema,
  commandActorsEqual,
} from "@vibeshape/domain/commands"
import { draftIdSchema } from "@vibeshape/domain/identifiers"
import type { ImportDocumentContext } from "../features/import/import-model"
import {
  createPlanarImportTransaction,
  type PlanarSource,
  readPlanarSource,
} from "../features/planar-import/import-model"
import {
  type PlanarInspection,
  planarParserResponseSchema,
} from "../features/planar-import/parser-contract"
import { appendOwnedSourceChunk } from "./source-upload-chunks"

class PlanarInspectionFailure extends Error {
  constructor(readonly diagnostic: { code: string; message: string }) {
    super(diagnostic.message)
  }
}
type Inspection = PlanarInspection
type Transaction = ReturnType<typeof createPlanarImportTransaction>
type Result<T> = { ok: true; value: T } | LocalFailure
export type PlanarImportReviewInput = Readonly<{
  kind: "planar-import"
  actor: CommandActor
  draft: {
    draftId: string
    documentId: string
    baseRevision: number
    draftVersion: number
    expiresAt: string
  }
  source: PlanarUploadInspection
  label: string
  inspection: Inspection
  transaction: Pick<Transaction, "transactionId" | "commands">
}>
export type PlanarImportReviewedCommit = PlanarImportReviewInput & Pick<Transaction, "assetBlobs">
export type PlanarImportSessionConfiguration = Readonly<{
  documentId: string
  isActive: () => boolean
  readContext: () => ImportDocumentContext | null
  createId: () => string
  inspect: (prepared: PlanarSource) => Promise<ReturnType<typeof planarParserResponseSchema.parse>>
  review: (input: PlanarImportReviewInput) => Promise<"approved" | "rejected" | "cancelled">
  commit: (input: PlanarImportReviewedCommit) => Promise<Result<{ revision: number }>>
  now?: () => number
}>
type Captured = {
  prepared: PlanarSource
  inspection: Inspection
  transaction: Transaction
  view: PlanarUploadInspection
}
type Upload = {
  actor: CommandActor
  descriptor: PlanarUploadDescriptor
  bytes: Uint8Array
  label: string
  captured: Captured | null
}

/** One paired actor owns temporary source bytes and a closed reviewed transaction. */
export function createPlanarImportUploadSession(configuration: PlanarImportSessionConfiguration) {
  const now = configuration.now ?? Date.now
  let upload: Upload | null = null
  let owner: CommandActor | null = null
  let closed = false
  let busy = false
  let persisting = false
  let epoch = 0
  let expiry: ReturnType<typeof setTimeout> | null = null
  function release() {
    if (expiry !== null) clearTimeout(expiry)
    expiry = null
    upload = null
    epoch++
  }
  function scheduleExpiry(record: Upload) {
    if (expiry !== null) clearTimeout(expiry)
    expiry = setTimeout(
      () => {
        if (upload === record && !persisting) release()
      },
      Math.max(0, Date.parse(record.descriptor.expiresAt) - now()),
    )
  }
  function failure(code: string, message: string, retryable = false) {
    return localFailure(code, message, retryable)
  }
  function available() {
    return !closed && configuration.isActive()
  }
  function actor(input: unknown) {
    const parsed = commandActorSchema.safeParse(input)
    if (!parsed.success || parsed.data.type !== "mcp") return null
    if (owner && !commandActorsEqual(owner, parsed.data)) return null
    owner ??= parsed.data
    return parsed.data
  }
  function current(record: Upload, generation: number, signal?: AbortSignal) {
    return (
      available() &&
      !signal?.aborted &&
      upload === record &&
      epoch === generation &&
      Date.parse(record.descriptor.expiresAt) > now() &&
      configuration.readContext()?.revision === record.descriptor.baseRevision
    )
  }
  function owned(uploadId: string) {
    if (!upload || upload.descriptor.uploadId !== uploadId) return null
    if (Date.parse(upload.descriptor.expiresAt) <= now()) {
      release()
      return null
    }
    return upload
  }
  async function inspectOwned(prepared: PlanarSource) {
    const result = structuredClone(await configuration.inspect(structuredClone(prepared)))
    const inspected = planarParserResponseSchema.parse(result)
    if (!inspected.ok) throw new PlanarInspectionFailure(inspected.diagnostic)
    if (inspected.prepared.format !== prepared.input.format)
      throw new Error("The planar source format changed.")
    return inspected
  }
  function begin(
    input: LocalPlanarImportOperation & { tool: "begin_planar_import_upload" },
    paired: CommandActor,
  ) {
    const options = localPlanarImportInputs.begin_planar_import_upload.parse(input.arguments)
    const context = configuration.readContext()
    const format = planarUploadFormat(options.filename)
    if (
      !context ||
      context.documentId !== configuration.documentId ||
      context.revision !== options.revision
    )
      return failure("stale-revision", "The import base is no longer current.", true)
    if (!format) return failure("unsupported-import-format", "The source format is unavailable.")
    const descriptor = planarUploadDescriptorSchema.parse({
      uploadId: configuration.createId(),
      documentId: configuration.documentId,
      baseRevision: context.revision,
      uploadVersion: 0,
      filename: options.filename,
      byteLength: options.byteLength,
      unit: options.unit,
      plane: options.plane,
      format,
      receivedBytes: 0,
      sha256: null,
      status: "uploading",
      expiresAt: new Date(now() + IMPORT_UPLOAD_TTL_MS).toISOString(),
      chunkMaxBytes: IMPORT_UPLOAD_CHUNK_MAX_BYTES,
    })
    release()
    upload = {
      actor: paired,
      descriptor,
      bytes: new Uint8Array(descriptor.byteLength),
      label: options.label ?? options.filename.slice(0, 120),
      captured: null,
    }
    scheduleExpiry(upload)
    return { ok: true as const, value: structuredClone(descriptor) }
  }
  function append(
    record: Upload,
    input: Extract<LocalPlanarImportOperation, { tool: "append_planar_import_chunk" }>,
  ) {
    const { offset, base64 } = localPlanarImportInputs.append_planar_import_chunk.parse(
      input.arguments,
    )
    const result = appendOwnedSourceChunk(
      record.bytes,
      record.descriptor.receivedBytes,
      record.captured !== null,
      { offset, base64 },
    )
    if (!result.ok) return result
    if (result.receivedBytes === record.descriptor.receivedBytes)
      return { ok: true as const, value: structuredClone(record.descriptor) }
    record.descriptor = planarUploadDescriptorSchema.parse({
      ...record.descriptor,
      receivedBytes: result.receivedBytes,
      uploadVersion: record.descriptor.uploadVersion + 1,
      expiresAt: new Date(now() + IMPORT_UPLOAD_TTL_MS).toISOString(),
    })
    scheduleExpiry(record)
    return { ok: true as const, value: structuredClone(record.descriptor) }
  }
  async function capture(record: Upload, generation: number, signal?: AbortSignal) {
    if (record.captured) return { ok: true as const, value: structuredClone(record.captured.view) }
    if (record.descriptor.receivedBytes !== record.bytes.byteLength)
      return failure("incomplete-import-upload", "Upload every source byte before inspection.")
    const prepared = await readPlanarSource(
      {
        name: record.descriptor.filename,
        size: record.bytes.byteLength,
        arrayBuffer: async () => Uint8Array.from(record.bytes).buffer,
      },
      record.descriptor.unit,
    )
    if (!current(record, generation, signal))
      return failure(
        "import-cancelled",
        "The source capture was cancelled before planar inspection.",
        true,
      )
    const inspection = await inspectOwned(prepared)
    if (!current(record, generation, signal))
      return failure(
        "import-cancelled",
        "The import source or base changed during inspection.",
        true,
      )
    const context = configuration.readContext()
    if (!context) return failure("stale-revision", "The import base is unavailable.", true)
    const transaction = createPlanarImportTransaction(
      context,
      prepared,
      inspection,
      record.descriptor.plane,
      record.label,
      configuration.createId,
      record.actor,
    )
    transaction.transactionId = draftIdSchema.parse(record.descriptor.uploadId)
    const digest = prepared.digest
    const descriptor = planarUploadDescriptorSchema.parse({
      ...record.descriptor,
      sha256: digest,
      status: "ready",
      uploadVersion: record.descriptor.uploadVersion + 1,
    })
    const view = inspectionView(descriptor, prepared, inspection, transaction)
    record.descriptor = descriptor
    record.captured = { prepared, inspection, transaction, view }
    return { ok: true as const, value: structuredClone(view) }
  }
  async function commit(
    record: Upload,
    requestedVersion: number,
    generation: number,
    signal?: AbortSignal,
  ) {
    const captured = record.captured
    if (!captured || requestedVersion !== record.descriptor.uploadVersion)
      return failure(
        "import-preview-required",
        "Inspect the current upload and retain its exact uploadVersion before commit.",
      )
    const inspected = await inspectOwned(captured.prepared)
    if (
      !current(record, generation, signal) ||
      inspectionIdentity(inspected) !== inspectionIdentity(captured.inspection)
    )
      return failure(
        "import-source-changed",
        "The reviewed import inspection is no longer current.",
        true,
      )
    const review: PlanarImportReviewInput = {
      kind: "planar-import",
      actor: record.actor,
      draft: {
        draftId: record.descriptor.uploadId,
        documentId: configuration.documentId,
        baseRevision: record.descriptor.baseRevision,
        draftVersion: requestedVersion,
        expiresAt: record.descriptor.expiresAt,
      },
      source: captured.view,
      label: record.label,
      inspection: inspected,
      transaction: {
        transactionId: captured.transaction.transactionId,
        commands: captured.transaction.commands,
      },
    }
    const decision = await configuration.review(structuredClone(review))
    if (decision !== "approved" || !current(record, generation, signal))
      return failure(
        "import-review-cancelled",
        "The import was not applied through its current browser review.",
      )
    return persist(record, captured, review, requestedVersion)
  }
  async function persist(
    record: Upload,
    captured: Captured,
    review: PlanarImportReviewInput,
    requestedVersion: number,
  ) {
    persisting = true
    try {
      const result = await configuration.commit(
        structuredClone({
          ...review,
          assetBlobs: captured.transaction.assetBlobs,
        }),
      )
      if (!result.ok) return result
      release()
      return {
        ok: true as const,
        value: planarUploadCommitSchema.parse({
          uploadId: record.descriptor.uploadId,
          documentId: configuration.documentId,
          baseRevision: record.descriptor.baseRevision,
          revision: result.value.revision,
          uploadVersion: requestedVersion,
          sketchId: captured.view.sketchId,
          pathOutputs: captured.view.pathOutputs,
        }),
      }
    } finally {
      persisting = false
      if (closed) release()
      else if (upload === record) scheduleExpiry(record)
    }
  }
  async function executeOwned(
    operation: Exclude<LocalPlanarImportOperation, { tool: "begin_planar_import_upload" }>,
    generation: number,
    signal?: AbortSignal,
  ) {
    const record = owned(operation.arguments.uploadId)
    if (operation.tool === "discard_planar_import_upload") {
      if (record) {
        release()
      }
      return {
        ok: true as const,
        value: { uploadId: operation.arguments.uploadId, discarded: true as const },
      }
    }
    if (!record)
      return failure("import-upload-unavailable", "The owned upload is absent or expired.")
    if (!current(record, generation, signal))
      return failure("stale-revision", "The import base changed.", true)
    if (operation.tool === "append_planar_import_chunk") return append(record, operation)
    if (operation.tool === "inspect_planar_import_upload")
      return await capture(record, generation, signal)
    return await commit(record, operation.arguments.uploadVersion, generation, signal)
  }
  return {
    async execute(
      inputActor: unknown,
      operation: LocalPlanarImportOperation,
      signal?: AbortSignal,
    ) {
      if (busy) return failure("busy", "Another import operation is pending.", true)
      const paired = actor(inputActor)
      if (!paired || !available())
        return failure("session-revoked", "The import owner session is unavailable.")
      if (signal?.aborted) return failure("import-cancelled", "The import request was cancelled.")
      busy = true
      const generation = epoch
      try {
        if (operation.tool === "begin_planar_import_upload") return begin(operation, paired)
        return await executeOwned(operation, generation, signal)
      } catch (error) {
        if (error instanceof PlanarInspectionFailure)
          return failure(error.diagnostic.code, error.diagnostic.message)
        return failure("import-failed", "The planar source could not be inspected or imported.")
      } finally {
        busy = false
      }
    },
    isPersisting: () => persisting,
    cancel() {
      if (!persisting) {
        release()
      }
    },
    dispose() {
      closed = true
      if (!persisting) {
        release()
      }
    },
  }
}

function inspectionIdentity(inspection: Inspection) {
  return canonicalJson(inspection)
}
function inspectionView(
  upload: PlanarUploadDescriptor,
  _prepared: PlanarSource,
  inspection: Inspection,
  transaction: Transaction,
) {
  const command = transaction.commands.at(-1)
  const asset = transaction.commands.find(
    (command) => command.kind === "org.vibeshape.document.add-source-assets",
  )
  if (
    command?.kind !== "org.vibeshape.history.insert-sketch" ||
    asset?.kind !== "org.vibeshape.document.add-source-assets" ||
    !asset.payload.assets[0]
  )
    throw new Error("The captured planar sketch asset is unavailable.")
  const source = asset.payload.assets[0]
  return planarUploadInspectionSchema.parse({
    upload,
    sketchId: command.payload.sketch.id,
    normalization: source.normalization,
    unitPolicy: inspection.prepared.units.policy,
    bounds: inspection.bounds,
    pathOutputs: source.outputs,
    closedPaths: inspection.prepared.paths.filter((path) => path.closed).length,
    curves: inspection.prepared.paths.reduce((count, path) => count + path.segments.length, 0),
  })
}
