import {
  IMPORT_UPLOAD_CHUNK_MAX_BYTES,
  IMPORT_UPLOAD_TTL_MS,
  type ImportUploadDescriptor,
  type ImportUploadInspection,
  importUploadCommitSchema,
  importUploadDescriptorSchema,
  importUploadFormat,
  importUploadInspectionSchema,
  type LocalImportOperation,
  localImportInputs,
} from "@vibeshape/automation-api/imports"
import type { LightweightingSourceIdentity } from "@vibeshape/automation-api/lightweighting-tools"
import { type LocalFailure, localFailure } from "@vibeshape/automation-api/local-tools"
import { canonicalJson } from "@vibeshape/domain/canonical-json"
import {
  type CommandActor,
  commandActorSchema,
  commandActorsEqual,
} from "@vibeshape/domain/commands"
import { draftIdSchema } from "@vibeshape/domain/identifiers"
import type {
  StructuralOptimizationSettings,
  StructuralOptimizationSummary,
} from "@vibeshape/domain/lightweighting"
import { importedBodyOutputRole } from "@vibeshape/domain/part-design-import"
import { meshImportOutputRole } from "@vibeshape/domain/part-design-mesh-import"
import {
  type MeshImportInspection,
  meshImportInspectionSchema,
  type SourceImportInspection,
  sourceImportInspectionSchema,
} from "@vibeshape/protocol"
import {
  createImportTransaction,
  type ImportDocumentContext,
  type PreparedImportSource,
  readImportSource,
} from "../features/import/import-model"
import { appendOwnedSourceChunk } from "./source-upload-chunks"

type Inspection = SourceImportInspection | MeshImportInspection
type Transaction = ReturnType<typeof createImportTransaction>
type Result<T> = { ok: true; value: T } | LocalFailure
export type ImportReviewInput = Readonly<{
  kind: "import"
  actor: CommandActor
  draft: {
    draftId: string
    documentId: string
    baseRevision: number
    draftVersion: number
    expiresAt: string
  }
  source: ImportUploadInspection
  label: string
  lightweighting?: Readonly<{
    sourceName: string
    source: LightweightingSourceIdentity
    settings: StructuralOptimizationSettings
    summary: StructuralOptimizationSummary
  }>
  inspection: Inspection
  transaction: Pick<Transaction, "transactionId" | "commands">
}>
export type ImportReviewedCommit = ImportReviewInput & Pick<Transaction, "assetBlobs">
export type ImportSessionConfiguration = Readonly<{
  documentId: string
  isActive: () => boolean
  readContext: () => ImportDocumentContext | null
  createId: () => string
  inspect: (prepared: PreparedImportSource) => Promise<Inspection>
  review: (input: ImportReviewInput) => Promise<"approved" | "rejected" | "cancelled">
  commit: (input: ImportReviewedCommit) => Promise<Result<{ revision: number }>>
  reviewContext?: () => ImportReviewInput["lightweighting"]
  now?: () => number
}>
type Captured = {
  prepared: PreparedImportSource
  inspection: Inspection
  transaction: Transaction
  view: ImportUploadInspection
}
type Upload = {
  actor: CommandActor
  descriptor: ImportUploadDescriptor
  bytes: Uint8Array
  label: string
  captured: Captured | null
}

/** One paired actor owns temporary source bytes and a closed reviewed transaction. */
export function createImportUploadSession(configuration: ImportSessionConfiguration) {
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
  async function inspectOwned(prepared: PreparedImportSource) {
    const result = structuredClone(await configuration.inspect(structuredClone(prepared)))
    return prepared.representation === "exact-solid"
      ? sourceImportInspectionSchema.parse(result)
      : meshImportInspectionSchema.parse(result)
  }
  function begin(
    input: LocalImportOperation & { tool: "begin_import_upload" },
    paired: CommandActor,
  ) {
    const options = localImportInputs.begin_import_upload.parse(input.arguments)
    const context = configuration.readContext()
    const format = importUploadFormat(options.filename)
    if (
      !context ||
      context.documentId !== configuration.documentId ||
      context.revision !== options.revision
    )
      return failure("stale-revision", "The import base is no longer current.", true)
    if (!format) return failure("unsupported-import-format", "The source format is unavailable.")
    const descriptor = importUploadDescriptorSchema.parse({
      uploadId: configuration.createId(),
      documentId: configuration.documentId,
      baseRevision: context.revision,
      uploadVersion: 0,
      filename: options.filename,
      byteLength: options.byteLength,
      sourceUnit: options.sourceUnit,
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
    input: Extract<LocalImportOperation, { tool: "append_import_chunk" }>,
  ) {
    const { offset, base64 } = localImportInputs.append_import_chunk.parse(input.arguments)
    const result = appendOwnedSourceChunk(
      record.bytes,
      record.descriptor.receivedBytes,
      record.captured !== null,
      { offset, base64 },
    )
    if (!result.ok) return result
    if (result.receivedBytes === record.descriptor.receivedBytes)
      return { ok: true as const, value: structuredClone(record.descriptor) }
    record.descriptor = importUploadDescriptorSchema.parse({
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
    const prepared = await readImportSource(
      {
        name: record.descriptor.filename,
        size: record.bytes.byteLength,
        arrayBuffer: async () => Uint8Array.from(record.bytes).buffer,
      },
      record.descriptor.sourceUnit,
    )
    if (!current(record, generation, signal))
      return failure(
        "import-cancelled",
        "The source capture was cancelled before native inspection.",
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
    const transaction = createImportTransaction(
      context,
      prepared,
      inspection,
      record.label,
      configuration.createId,
      record.actor,
    )
    transaction.transactionId = draftIdSchema.parse(record.descriptor.uploadId)
    const digest =
      prepared.representation === "exact-solid" ? prepared.source.digest : prepared.digest
    const descriptor = importUploadDescriptorSchema.parse({
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
    const lightweighting = configuration.reviewContext?.()
    const review: ImportReviewInput = {
      ...(lightweighting ? { lightweighting } : {}),
      kind: "import",
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
    review: ImportReviewInput,
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
        value: importUploadCommitSchema.parse({
          uploadId: record.descriptor.uploadId,
          documentId: configuration.documentId,
          baseRevision: record.descriptor.baseRevision,
          revision: result.value.revision,
          uploadVersion: requestedVersion,
          featureId: captured.view.featureId,
          outputRoles: captured.view.outputs.map(({ outputRole }) => outputRole),
        }),
      }
    } finally {
      persisting = false
      if (closed) release()
      else if (upload === record) scheduleExpiry(record)
    }
  }
  async function executeOwned(
    operation: Exclude<LocalImportOperation, { tool: "begin_import_upload" }>,
    generation: number,
    signal?: AbortSignal,
  ) {
    const record = owned(operation.arguments.uploadId)
    if (operation.tool === "discard_import_upload") {
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
    if (operation.tool === "append_import_chunk") return append(record, operation)
    if (operation.tool === "inspect_import_upload") return await capture(record, generation, signal)
    return await commit(record, operation.arguments.uploadVersion, generation, signal)
  }
  return {
    async execute(inputActor: unknown, operation: LocalImportOperation, signal?: AbortSignal) {
      if (busy) return failure("busy", "Another import operation is pending.", true)
      const paired = actor(inputActor)
      if (!paired || !available())
        return failure("session-revoked", "The import owner session is unavailable.")
      if (signal?.aborted) return failure("import-cancelled", "The import request was cancelled.")
      busy = true
      const generation = epoch
      try {
        if (operation.tool === "begin_import_upload") return begin(operation, paired)
        return await executeOwned(operation, generation, signal)
      } catch {
        return failure("import-failed", "The native source could not be inspected or imported.")
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
  return canonicalJson(
    "unitEvidence" in inspection
      ? {
          unitEvidence: inspection.unitEvidence,
          outputs: inspection.outputs.map(({ signature }) => signature),
        }
      : {
          normalization: inspection.normalization,
          warnings: inspection.warnings,
          outputs: inspection.outputs.map(({ nodeKey, shape }) => ({ nodeKey, shape })),
        },
  )
}
function inspectionView(
  upload: ImportUploadDescriptor,
  prepared: PreparedImportSource,
  inspection: Inspection,
  transaction: Transaction,
) {
  const feature = transaction.commands.at(-1)
  if (feature?.kind !== "org.vibeshape.history.insert-feature")
    throw new Error("The captured import feature is unavailable.")
  const asset = transaction.commands.find(
    (command) => command.kind === "org.vibeshape.document.add-source-assets",
  )
  if (asset?.kind !== "org.vibeshape.document.add-source-assets")
    throw new Error("The captured import asset is unavailable.")
  const outputs = asset.payload.assets[0]?.outputs
  if (!outputs) throw new Error("Captured import outputs are unavailable.")
  const exact = "unitEvidence" in inspection
  return importUploadInspectionSchema.parse({
    upload,
    featureId: feature.payload.feature.id,
    representation: prepared.representation,
    normalization:
      prepared.representation === "exact-solid"
        ? prepared.source.normalization
        : meshImportInspectionSchema.parse(inspection).normalization,
    warnings: "warnings" in inspection ? inspection.warnings : [],
    outputs: inspection.outputs.map((output, index) => {
      const outputId = outputs[index]
      if (!outputId) throw new Error("The captured output manifest is incomplete.")
      const shape = "signature" in output ? output.signature : output.shape
      return {
        outputRole: exact ? importedBodyOutputRole(outputId) : meshImportOutputRole(outputId),
        bounds: shape.bounds,
        volumeMm3: exact ? shape.volume : null,
        surfaceAreaMm2: "area" in shape ? shape.area : shape.surfaceArea,
        triangleCount: output.mesh.indices.length / 3,
      }
    }),
  })
}
