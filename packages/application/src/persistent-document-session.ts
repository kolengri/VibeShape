import { canonicalJson } from "@vibeshape/domain/canonical-json"
import type { CommandDispatcher } from "@vibeshape/domain/command-dispatcher"
import type { CommandActor, DocumentEvent } from "@vibeshape/domain/commands"
import {
  commandActorSchema,
  commandActorsEqual,
  documentCommandSchema,
  documentEventSchema,
} from "@vibeshape/domain/commands"
import { type DocumentSnapshot, documentSnapshotSchema } from "@vibeshape/domain/document"
import type { HistoryItemRef } from "@vibeshape/domain/document-node"
import type { DocumentAuthoritySnapshot } from "@vibeshape/domain/document-v2"
import {
  commandIdSchema,
  type DocumentId,
  documentIdSchema,
  draftIdSchema,
  revisionSchema,
  type SessionId,
  type SketchId,
  sessionIdSchema,
  timestampSchema,
} from "@vibeshape/domain/identifiers"
import type { SketchRecord } from "@vibeshape/domain/sketch"
import {
  type DocumentExportOptions,
  type DocumentWorkerRequest,
  type DocumentWorkerTerminalResponse,
  documentWorkerResponseSchema,
  type FeatureMeshPolicy,
  featureMeshPolicySchema,
  type GeometryExportFormat,
  type InspectMeshImportInput,
  type InspectSourceImportInput,
  inspectMeshImportInputSchema,
  inspectSourceImportInputSchema,
  type MeshImportInspection,
  type SourceImportInspection,
} from "@vibeshape/protocol"
import { z } from "zod"
import { authorityTransactionSchema } from "./authority-transaction"
import type {
  DocumentHistoryCheckpoint,
  DocumentHistoryCheckpointState,
} from "./document-undo-history"
import { draftCommandFailure } from "./draft-validation-diagnostics"

export type {
  DocumentHistoryCheckpoint,
  DocumentHistoryCheckpointState,
} from "./document-undo-history"

const DEFAULT_LEASE_DURATION_MS = 30_000

export const documentHistoryRequestSchema = z
  .object({
    direction: z.enum(["undo", "redo"]),
    targetRevision: revisionSchema.optional(),
    commandId: commandIdSchema,
    documentId: documentIdSchema,
    baseRevision: revisionSchema,
    issuedAt: timestampSchema,
    actor: commandActorSchema,
  })
  .strict()

export type DocumentHistoryRequest = Readonly<z.infer<typeof documentHistoryRequestSchema>>
export type DocumentHistoryAvailability = Readonly<{ canUndo: boolean; canRedo: boolean }>
export type DocumentHistoryPreview = Readonly<{
  targetRevision: number
  snapshot: DocumentSnapshot
  authority: DocumentAuthoritySnapshot
}>

export type DocumentHistoryPort = Readonly<{
  readonly availability: DocumentHistoryAvailability
  preview?: (
    direction: DocumentHistoryRequest["direction"],
    targetRevision?: number,
  ) => DocumentHistoryPreview | null | Promise<DocumentHistoryPreview | null>
  navigate: (
    input: Readonly<{
      request: DocumentHistoryRequest
      sessionId: SessionId
      lease: { epoch: number; nowMs: number }
      baseSnapshot: DocumentSnapshot
    }>,
  ) => Promise<SessionPortResult<DocumentSnapshot>>
  checkpoints?: Readonly<{
    capture: (acceptsActor: (actor: CommandActor) => boolean) => DocumentHistoryCheckpoint | null
    read: (handle: DocumentHistoryCheckpoint) => DocumentHistoryCheckpointState | null
    preview: (handle: DocumentHistoryCheckpoint) => DocumentHistoryPreview | null
    release: (handle: DocumentHistoryCheckpoint) => void
    seal: (handle: DocumentHistoryCheckpoint, revision: number) => boolean
    restore: (input: {
      handle: DocumentHistoryCheckpoint
      request: DocumentHistoryRequest
      sessionId: SessionId
      lease: { epoch: number; nowMs: number }
      baseSnapshot: DocumentSnapshot
    }) => Promise<SessionPortResult<DocumentSnapshot>>
  }>
}>

const openSessionInputSchema = z
  .object({
    documentId: documentIdSchema,
    sessionId: sessionIdSchema,
    mesh: featureMeshPolicySchema,
    leaseDurationMs: z.number().int().min(1_000).max(60_000).default(DEFAULT_LEASE_DURATION_MS),
  })
  .strict()

const createSessionInputSchema = z
  .object({
    sessionId: sessionIdSchema,
    mesh: featureMeshPolicySchema,
    leaseDurationMs: z.number().int().min(1_000).max(60_000).default(DEFAULT_LEASE_DURATION_MS),
    command: z.unknown(),
  })
  .strict()

const draftCommitInputSchema = z
  .object({
    draftId: draftIdSchema,
    commands: z.array(z.unknown()).min(1).max(256),
    expectedSnapshot: documentSnapshotSchema.optional(),
  })
  .strict()

const draftValidationInputSchema = z
  .object({
    transactionId: draftIdSchema,
    baseSnapshot: documentSnapshotSchema,
    events: z.array(documentEventSchema).min(1).max(256),
    snapshot: documentSnapshotSchema,
  })
  .strict()

type DocumentRebuildResponse = Extract<DocumentWorkerTerminalResponse, { type: "documentRebuilt" }>
type DocumentExportResponse = Extract<DocumentWorkerTerminalResponse, { type: "documentExported" }>
type SketchSolveResponse = Extract<DocumentWorkerTerminalResponse, { type: "sketchSolved" }>
type SketchSolveRequest = Extract<DocumentWorkerRequest, { type: "solveSketch" }>

export type PersistentSketchSolveOptions = Readonly<
  Partial<Pick<SketchSolveRequest, "continuation" | "draggedPoints">>
>

export type DocumentSketchSolveInput = Readonly<{
  sketchId: SketchId
  draftSketch?: SketchRecord
}> &
  PersistentSketchSolveOptions

export type SessionPortDiagnostic = Readonly<{
  code: string
  message: string
  retryable: boolean
}>

export type SessionPortResult<Value> =
  | { ok: true; value: Value }
  | { ok: false; diagnostic: SessionPortDiagnostic }

export type PersistedRecoveryReport = Readonly<{
  status: "clean" | "recovered" | "recovered-with-loss"
  snapshot: DocumentSnapshot
  headRevision: number
  recoveredRevision: number
  lostRevisionCount: number
  corruptRecords: readonly string[]
  migration?: PersistedRecoveryMigration
}>

export type PersistedRecoveryMigration = Readonly<{
  provenance: "current" | "journal-derived" | "snapshot-derived"
  diagnostic: Readonly<{ code: string; message: string }> | null
  unavailableRecords: readonly string[]
}>

type PersistenceCommitInput = Readonly<{
  sessionId: SessionId
  lease: { epoch: number; nowMs: number } | null
  storedAt: string
  baseSnapshot: DocumentSnapshot | null
  event: DocumentEvent
  snapshot: DocumentSnapshot
}>

type PersistenceCloseInput = Readonly<{
  documentId: DocumentId
  revision: number
  sessionId: SessionId
  lease: { epoch: number; nowMs: number }
}>

type PersistenceDraftCommitInput = Readonly<{
  sessionId: SessionId
  lease: { epoch: number; nowMs: number }
  storedAt: string
  transactionId: z.infer<typeof draftIdSchema>
  baseSnapshot: DocumentSnapshot
  events: readonly DocumentEvent[]
  snapshot: DocumentSnapshot
}>

export type PersistenceDraftValidationInput = Pick<
  PersistenceDraftCommitInput,
  "transactionId" | "baseSnapshot" | "events" | "snapshot"
>

type PersistenceHistoryMoveInput = Readonly<{
  sessionId: SessionId
  lease: { epoch: number; nowMs: number }
  baseSnapshot: DocumentSnapshot
  command: unknown
}>

export type DocumentSemanticHistoryPort = Readonly<{
  readonly items: readonly HistoryItemRef[]
  move: (input: PersistenceHistoryMoveInput) => Promise<SessionPortResult<DocumentSnapshot>>
  insert?: (input: PersistenceHistoryMoveInput) => Promise<SessionPortResult<DocumentSnapshot>>
}>

export type DocumentAuthoredMetadataPort = Readonly<{
  readonly snapshot: DocumentAuthoritySnapshot | null
  apply: (input: PersistenceHistoryMoveInput) => Promise<SessionPortResult<DocumentSnapshot>>
}>

export type PersistentDocumentRepositoryPort = Readonly<{
  authoredTransaction?: DocumentAuthoredMetadataPort
  authoredMetadata?: DocumentAuthoredMetadataPort
  history?: DocumentHistoryPort
  semanticHistory?: DocumentSemanticHistoryPort
  /** A confirmed semantic projection may include authority-owned repair restoration. */
  committedSnapshot?: DocumentSnapshot | null
  commit: (input: PersistenceCommitInput) => Promise<SessionPortResult<unknown>>
  commitDraft: (input: PersistenceDraftCommitInput) => Promise<SessionPortResult<unknown>>
  validateDraft?: (input: PersistenceDraftValidationInput) => Promise<SessionPortResult<unknown>>
  recover: (documentId: DocumentId) => Promise<SessionPortResult<PersistedRecoveryReport>>
  closeCleanly: (input: PersistenceCloseInput) => Promise<SessionPortResult<unknown>>
}>

type LeaseRequest = Readonly<{
  documentId: DocumentId
  ownerId: SessionId
  nowMs: number
  durationMs: number
}>

type LeaseIdentity = Readonly<{
  documentId: DocumentId
  ownerId: SessionId
  nowMs: number
}>

export type DocumentLeasePort = Readonly<{
  acquire: (
    input: LeaseRequest,
  ) => Promise<SessionPortResult<{ lease: { epoch: number; expiresAt: number } }>>
  release: (input: LeaseIdentity) => Promise<SessionPortResult<unknown>>
}>

export type DocumentRebuildPort = Readonly<{
  rebuild: (input: {
    document: DocumentSnapshot
    mesh: FeatureMeshPolicy
  }) => Promise<DocumentRebuildResponse>
  exportDocument: (
    format: GeometryExportFormat,
    options?: DocumentExportOptions,
  ) => Promise<DocumentExportResponse>
  inspectMeshImport?: (
    input: InspectMeshImportInput,
  ) => Promise<Extract<DocumentWorkerTerminalResponse, { type: "meshImportInspected" }>>
  inspectSourceImport?: (
    input: InspectSourceImportInput,
  ) => Promise<Extract<DocumentWorkerTerminalResponse, { type: "sourceImportInspected" }>>
  solveSketch: (input: DocumentSketchSolveInput) => Promise<SketchSolveResponse>
  dispose: (revision?: number) => Promise<unknown>
  terminate: () => void
}>

export type PersistentDocumentSessionDependencies = Readonly<{
  commandDispatcher: Pick<CommandDispatcher, "dispatch">
  repository: PersistentDocumentRepositoryPort
  leases: DocumentLeasePort
  createRebuildPort: (documentId: DocumentId) => DocumentRebuildPort
  now: () => number
}>

export type PersistentDocumentSessionDiagnosticCode =
  | "invalid-session-input"
  | "invalid-draft-commit"
  | "invalid-recovered-document"
  | "command-rejected"
  | "persistence-failed"
  | "write-access-unavailable"
  | "rebuild-failed"
  | "export-failed"
  | "sketch-solve-failed"
  | "session-closed"
  | "close-failed"

export type PersistentDocumentSessionDiagnostic = Readonly<{
  code: PersistentDocumentSessionDiagnosticCode
  message: string
  retryable: boolean
  sourceCode: string | null
}>

export type DocumentRebuildOutcome =
  | { ok: true; response: DocumentRebuildResponse }
  | { ok: false; diagnostic: PersistentDocumentSessionDiagnostic }

export type PersistentDocumentExportResult =
  | { ok: true; response: DocumentExportResponse }
  | { ok: false; diagnostic: PersistentDocumentSessionDiagnostic }

export type PersistentSketchSolveResult =
  | { ok: true; response: SketchSolveResponse }
  | { ok: false; diagnostic: PersistentDocumentSessionDiagnostic }

export type PersistentDocumentSessionReport = Readonly<{
  status: "created" | PersistedRecoveryReport["status"]
  mode: "read-write" | "read-only"
  snapshot: DocumentSnapshot
  historyItems: readonly HistoryItemRef[] | null
  rebuild: DocumentRebuildOutcome
  lostRevisionCount: number
  corruptRecords: readonly string[]
  migration: PersistedRecoveryMigration | null
  writeAccessDiagnostic: PersistentDocumentSessionDiagnostic | null
}>

export type PersistentDocumentSessionOpenResult =
  | {
      ok: true
      session: PersistentDocumentSession
      report: PersistentDocumentSessionReport
    }
  | { ok: false; diagnostic: PersistentDocumentSessionDiagnostic }

export type PersistentDocumentCommitResult =
  | {
      ok: true
      snapshot: DocumentSnapshot
      event: DocumentEvent
      rebuild: DocumentRebuildOutcome
    }
  | { ok: false; diagnostic: PersistentDocumentSessionDiagnostic }

export type PersistentDocumentDraftCommitResult =
  | {
      ok: true
      snapshot: DocumentSnapshot
      events: readonly DocumentEvent[]
      rebuild: DocumentRebuildOutcome
    }
  | { ok: false; diagnostic: PersistentDocumentSessionDiagnostic }

export type PersistentDocumentDraftValidationResult =
  | { ok: true }
  | { ok: false; diagnostic: PersistentDocumentSessionDiagnostic }

export type PersistentDocumentHistoryResult =
  | { ok: true; snapshot: DocumentSnapshot; rebuild: DocumentRebuildOutcome }
  | { ok: false; diagnostic: PersistentDocumentSessionDiagnostic }

type WriterLease = Readonly<{ epoch: number; expiresAt: number }>

function diagnostic(
  code: PersistentDocumentSessionDiagnosticCode,
  message: string,
  retryable = false,
  sourceCode: string | null = null,
): PersistentDocumentSessionDiagnostic {
  return { code, message, retryable, sourceCode }
}

const workerExportErrorSchema = z.object({ response: documentWorkerResponseSchema })

/** Retains bounded worker evidence without exposing unvalidated exception payloads. */
export function documentExportFailure(
  error: unknown,
  fallbackMessage = "The current document geometry could not be exported.",
): Extract<PersistentDocumentExportResult, { ok: false }> {
  const parsed = workerExportErrorSchema.safeParse(error)
  const source =
    parsed.success && parsed.data.response.type === "failure"
      ? parsed.data.response.diagnostic
      : null
  return {
    ok: false,
    diagnostic: diagnostic(
      "export-failed",
      source?.message ?? fallbackMessage,
      source?.retryable ?? true,
      source?.code ?? null,
    ),
  }
}

function portDiagnostic(
  code: PersistentDocumentSessionDiagnosticCode,
  message: string,
  source: SessionPortDiagnostic,
) {
  return diagnostic(
    code,
    source.code === "checkpoint-budget-exceeded" || source.code === "persistence-failed"
      ? source.message.slice(0, 512)
      : code === "persistence-failed"
        ? `${message} ${source.code}: ${source.message}`.slice(0, 512)
        : message,
    source.retryable,
    source.code,
  )
}

function commandDiagnostic(source: { code: string; message: string; retryable: boolean }) {
  return diagnostic("command-rejected", source.message, source.retryable, source.code)
}

function rebuildFailure(): DocumentRebuildOutcome {
  return {
    ok: false,
    diagnostic: diagnostic(
      "rebuild-failed",
      "The committed document could not be rebuilt. Its semantic revision remains saved.",
      true,
    ),
  }
}

function invalidInput(message: string): PersistentDocumentSessionOpenResult {
  return { ok: false, diagnostic: diagnostic("invalid-session-input", message) }
}

function parseRecoveredSnapshot(
  documentId: DocumentId,
  recovery: PersistedRecoveryReport,
):
  | { ok: true; snapshot: DocumentSnapshot }
  | { ok: false; diagnostic: PersistentDocumentSessionDiagnostic } {
  const snapshot = documentSnapshotSchema.safeParse(recovery.snapshot)
  if (!snapshot.success || snapshot.data.id !== documentId) {
    return {
      ok: false,
      diagnostic: diagnostic(
        "invalid-recovered-document",
        "The persistence adapter returned an invalid document snapshot.",
      ),
    }
  }
  return { ok: true, snapshot: snapshot.data }
}

async function acquireWriterLease(
  dependencies: PersistentDocumentSessionDependencies,
  input: {
    documentId: DocumentId
    sessionId: SessionId
    leaseDurationMs: number
  },
) {
  const nowMs = dependencies.now()
  const result = await dependencies.leases.acquire({
    documentId: input.documentId,
    ownerId: input.sessionId,
    nowMs,
    durationMs: input.leaseDurationMs,
  })
  return result.ok
    ? ({ ok: true, lease: result.value.lease, nowMs } as const)
    : ({
        ok: false,
        diagnostic: portDiagnostic(
          "write-access-unavailable",
          "The document opened read-only because write access is unavailable.",
          result.diagnostic,
        ),
      } as const)
}

function dispatchDraftCommands(
  dispatcher: Pick<CommandDispatcher, "dispatch">,
  snapshot: DocumentSnapshot,
  input: z.output<typeof draftCommitInputSchema>,
):
  | { ok: true; snapshot: DocumentSnapshot; events: readonly DocumentEvent[]; storedAt: string }
  | { ok: false; diagnostic: PersistentDocumentSessionDiagnostic } {
  let draftSnapshot = snapshot
  const events: DocumentEvent[] = []
  for (const [index, commandInput] of input.commands.entries()) {
    const command = dispatcher.dispatch(draftSnapshot, commandInput, {
      transactionId: input.draftId,
    })
    if (!command.ok) {
      const parsed = documentCommandSchema.safeParse(commandInput)
      return {
        ok: false,
        diagnostic: commandDiagnostic(
          draftCommandFailure(index, parsed.success ? parsed.data : null, command.diagnostic),
        ),
      }
    }
    const firstEvent = events[0]
    if (firstEvent && !commandActorsEqual(firstEvent.actor, command.event.actor)) {
      return {
        ok: false,
        diagnostic: diagnostic(
          "invalid-draft-commit",
          "Every document draft command must use the same actor.",
        ),
      }
    }
    draftSnapshot = command.snapshot
    events.push(command.event)
  }
  const finalEvent = events.at(-1)
  return finalEvent
    ? { ok: true, snapshot: draftSnapshot, events, storedAt: finalEvent.issuedAt }
    : {
        ok: false,
        diagnostic: diagnostic("invalid-draft-commit", "The document draft commit is empty."),
      }
}

function historyRequestDiagnostic(
  message: string,
  retryable = false,
  sourceCode: string | null = null,
): PersistentDocumentSessionDiagnostic {
  return diagnostic("command-rejected", message, retryable, sourceCode)
}

function validateHistoryRequest(
  input: unknown,
  history: DocumentHistoryPort | undefined,
  documentId: DocumentId,
  revision: number,
) {
  const parsed = documentHistoryRequestSchema.safeParse(input)
  if (!parsed.success || !history)
    return {
      ok: false as const,
      diagnostic: historyRequestDiagnostic(
        "Document history is unavailable or the request is invalid.",
      ),
    }
  if (parsed.data.documentId !== documentId || parsed.data.baseRevision !== revision)
    return {
      ok: false as const,
      diagnostic: historyRequestDiagnostic(
        "The history request does not target the current revision.",
        true,
        "stale-revision",
      ),
    }
  return { ok: true as const, request: parsed.data, history }
}

async function persistHistoryRequest(
  history: DocumentHistoryPort,
  request: DocumentHistoryRequest,
  sessionId: SessionId,
  lease: { epoch: number; nowMs: number },
  baseSnapshot: DocumentSnapshot,
  checkpoint?: DocumentHistoryCheckpoint,
) {
  try {
    if (checkpoint) {
      if (!history.checkpoints)
        return {
          ok: false as const,
          diagnostic: diagnostic("command-rejected", "The internal checkpoint is unavailable."),
        }
      return await history.checkpoints.restore({
        handle: checkpoint,
        request,
        sessionId,
        lease,
        baseSnapshot,
      })
    }
    return await history.navigate({ request, sessionId, lease, baseSnapshot })
  } catch {
    return {
      ok: false as const,
      diagnostic: diagnostic("persistence-failed", "The history change was not saved.", true),
    }
  }
}

function validateHistoryResult(
  value: DocumentSnapshot,
  documentId: DocumentId,
  revision: number,
  advance = 1,
) {
  const restored = documentSnapshotSchema.safeParse(value)
  return restored.success &&
    restored.data.id === documentId &&
    restored.data.revision === revision + advance
    ? restored.data
    : null
}

export class PersistentDocumentSession {
  readonly #documentId: DocumentId
  readonly #sessionId: SessionId
  readonly #mesh: FeatureMeshPolicy
  readonly #leaseDurationMs: number
  readonly #dependencies: PersistentDocumentSessionDependencies
  readonly #rebuildPort: DocumentRebuildPort
  #snapshot: DocumentSnapshot
  #lease: WriterLease | null
  #closed = false
  #operationQueue: Promise<void> = Promise.resolve()
  #pendingOperations = 0

  get hasPendingOperations() {
    return this.#pendingOperations > 0
  }

  /** Captures the saved head after work already accepted by this session. */
  settleAcceptedOperations(): Promise<number> {
    return this.#enqueue(async () => this.#snapshot.revision)
  }

  constructor(input: {
    snapshot: DocumentSnapshot
    sessionId: SessionId
    mesh: FeatureMeshPolicy
    leaseDurationMs: number
    lease: WriterLease | null
    dependencies: PersistentDocumentSessionDependencies
    rebuildPort: DocumentRebuildPort
  }) {
    this.#documentId = input.snapshot.id
    this.#sessionId = input.sessionId
    this.#mesh = input.mesh
    this.#leaseDurationMs = input.leaseDurationMs
    this.#snapshot = input.snapshot
    this.#lease = input.lease
    this.#dependencies = input.dependencies
    this.#rebuildPort = input.rebuildPort
  }

  get snapshot() {
    return this.#snapshot
  }

  get mode() {
    return this.#lease ? ("read-write" as const) : ("read-only" as const)
  }

  get history(): DocumentHistoryAvailability {
    return !this.#closed && this.#lease && this.#dependencies.repository.history
      ? this.#dependencies.repository.history.availability
      : { canUndo: false, canRedo: false }
  }

  get historyItems() {
    return this.#dependencies.repository.semanticHistory?.items ?? null
  }

  async previewHistory(
    direction: DocumentHistoryRequest["direction"],
    targetRevision?: number,
  ): Promise<DocumentHistoryPreview | null> {
    if (this.#closed || !this.#lease) return null
    const revision = this.snapshot.revision
    const target = await this.#dependencies.repository.history?.preview?.(direction, targetRevision)
    return !this.#closed && this.#lease && this.snapshot.revision === revision
      ? (target ?? null)
      : null
  }

  navigateHistory(input: unknown): Promise<PersistentDocumentHistoryResult> {
    return this.#enqueue(() => this.#navigateHistory(input))
  }

  captureHistoryCheckpoint(acceptsActor: (actor: CommandActor) => boolean) {
    if (this.#closed || !this.#lease || this.hasPendingOperations) return null
    return this.#dependencies.repository.history?.checkpoints?.capture(acceptsActor) ?? null
  }

  readHistoryCheckpoint(handle: DocumentHistoryCheckpoint) {
    if (this.#closed || !this.#lease) return null
    return this.#dependencies.repository.history?.checkpoints?.read(handle) ?? null
  }

  releaseHistoryCheckpoint(handle: DocumentHistoryCheckpoint) {
    this.#dependencies.repository.history?.checkpoints?.release(handle)
  }

  sealHistoryCheckpoint(handle: DocumentHistoryCheckpoint, revision: number) {
    if (this.#closed || !this.#lease) return false
    return this.#dependencies.repository.history?.checkpoints?.seal(handle, revision) ?? false
  }

  previewHistoryCheckpoint(handle: DocumentHistoryCheckpoint) {
    if (this.#closed || !this.#lease) return null
    return this.#dependencies.repository.history?.checkpoints?.preview(handle) ?? null
  }

  restoreHistoryCheckpoint(handle: DocumentHistoryCheckpoint, input: unknown) {
    return this.#enqueue(() => this.#navigateHistory(input, handle))
  }

  moveHistoryItem(input: unknown): Promise<PersistentDocumentHistoryResult> {
    return this.#enqueue(() => this.#moveHistoryItem(input))
  }

  insertHistoryItem(input: unknown): Promise<PersistentDocumentHistoryResult> {
    return this.#enqueue(() =>
      this.#commitPortMutation(
        input,
        this.#dependencies.repository.semanticHistory?.insert,
        "The document does not expose History insertion.",
        "The History item was not saved.",
      ),
    )
  }

  get authoredSnapshot() {
    return this.#dependencies.repository.authoredMetadata?.snapshot ?? null
  }

  commitAuthoredTransaction(input: unknown): Promise<PersistentDocumentHistoryResult> {
    return this.#enqueue(async () => {
      const parsed = authorityTransactionSchema.safeParse(input)
      if (!parsed.success)
        return {
          ok: false as const,
          diagnostic: diagnostic("command-rejected", "The authored transaction is invalid."),
        }
      return this.#commitPortMutation(
        parsed.data,
        this.#dependencies.repository.authoredTransaction?.apply,
        "The document does not expose authored transactions.",
        "The authored transaction was not saved.",
        parsed.data.commands.length,
      )
    })
  }

  commitAuthored(input: unknown): Promise<PersistentDocumentHistoryResult> {
    return this.#enqueue(() =>
      this.#commitPortMutation(
        input,
        this.#dependencies.repository.authoredMetadata?.apply,
        "The document does not expose authored metadata mutations.",
        "The authored metadata was not saved.",
      ),
    )
  }

  async #moveHistoryItem(input: unknown): Promise<PersistentDocumentHistoryResult> {
    return this.#commitPortMutation(
      input,
      this.#dependencies.repository.semanticHistory?.move,
      "The document does not expose semantic History mutations.",
      "The History order was not saved.",
    )
  }

  async #commitPortMutation(
    input: unknown,
    operation: DocumentSemanticHistoryPort["move"] | undefined,
    unavailableMessage: string,
    failureMessage: string,
    advance = 1,
  ): Promise<PersistentDocumentHistoryResult> {
    if (this.#closed)
      return {
        ok: false,
        diagnostic: diagnostic("session-closed", "The document session is closed."),
      }
    if (!operation)
      return {
        ok: false,
        diagnostic: diagnostic("command-rejected", unavailableMessage),
      }
    const lease = await this.#renewWriteAccess()
    if (!lease.ok) return lease
    let result: SessionPortResult<DocumentSnapshot>
    try {
      result = await operation({
        sessionId: this.#sessionId,
        lease: { epoch: lease.lease.epoch, nowMs: lease.nowMs },
        baseSnapshot: this.#snapshot,
        command: input,
      })
    } catch {
      return {
        ok: false,
        diagnostic: diagnostic("persistence-failed", failureMessage, true),
      }
    }
    if (!result.ok)
      return {
        ok: false,
        diagnostic: portDiagnostic("persistence-failed", failureMessage, result.diagnostic),
      }
    const restored = validateHistoryResult(
      result.value,
      this.#documentId,
      this.#snapshot.revision,
      advance,
    )
    if (!restored)
      return {
        ok: false,
        diagnostic: diagnostic(
          "invalid-recovered-document",
          "The persistence adapter returned an invalid document revision.",
        ),
      }
    this.#snapshot = restored
    return { ok: true, snapshot: restored, rebuild: await this.#rebuild() }
  }

  async #navigateHistory(
    input: unknown,
    checkpoint?: DocumentHistoryCheckpoint,
  ): Promise<PersistentDocumentHistoryResult> {
    if (this.#closed)
      return {
        ok: false,
        diagnostic: diagnostic("session-closed", "The document session is closed."),
      }
    const validated = validateHistoryRequest(
      input,
      this.#dependencies.repository.history,
      this.#documentId,
      this.#snapshot.revision,
    )
    if (!validated.ok) return validated
    if (checkpoint && validated.request.direction !== "undo")
      return {
        ok: false,
        diagnostic: historyRequestDiagnostic(
          "Internal checkpoints restore only an owned baseline.",
        ),
      }
    const lease = await this.#renewWriteAccess()
    if (!lease.ok) return lease
    const result = await persistHistoryRequest(
      validated.history,
      validated.request,
      this.#sessionId,
      { epoch: lease.lease.epoch, nowMs: lease.nowMs },
      this.#snapshot,
      checkpoint,
    )
    if (!result.ok)
      return {
        ok: false,
        diagnostic: portDiagnostic(
          "persistence-failed",
          "The history change was not saved.",
          result.diagnostic,
        ),
      }
    const restored = validateHistoryResult(result.value, this.#documentId, this.#snapshot.revision)
    if (!restored)
      return {
        ok: false,
        diagnostic: diagnostic(
          "invalid-recovered-document",
          "The history adapter returned an invalid document revision.",
        ),
      }
    this.#snapshot = restored
    return { ok: true, snapshot: this.#snapshot, rebuild: await this.#rebuild() }
  }

  commit(input: unknown): Promise<PersistentDocumentCommitResult> {
    return this.#enqueue(() => this.#commit(input))
  }

  commitDraft(input: unknown): Promise<PersistentDocumentDraftCommitResult> {
    return this.#enqueue(() => this.#commitDraft(input))
  }

  validateDraft(input: unknown): Promise<PersistentDocumentDraftValidationResult> {
    return this.#enqueue(async () => {
      const prepared = this.#prepareDraft(input)
      if (!prepared.ok) return prepared
      const repository = this.#dependencies.repository
      if (!repository.validateDraft) return { ok: true }
      let result: SessionPortResult<unknown>
      try {
        // Clone before parsing because JSON-valued feature parameters retain their input aliases.
        const ownedInput = draftValidationInputSchema.parse(
          JSON.parse(
            canonicalJson({
              transactionId: prepared.draftId,
              baseSnapshot: this.#snapshot,
              events: prepared.events,
              snapshot: prepared.snapshot,
            }),
          ),
        )
        result = await repository.validateDraft(ownedInput)
      } catch {
        return {
          ok: false,
          diagnostic: diagnostic(
            "invalid-draft-commit",
            "The document draft could not be validated.",
          ),
        }
      }
      return result.ok
        ? { ok: true }
        : {
            ok: false,
            diagnostic: portDiagnostic(
              "invalid-draft-commit",
              result.diagnostic.message.slice(0, 512),
              result.diagnostic,
            ),
          }
    })
  }

  retryRebuild(): Promise<DocumentRebuildOutcome> {
    return this.#enqueue(() => this.#rebuild())
  }

  exportDocument(
    format: GeometryExportFormat,
    options: DocumentExportOptions = {},
  ): Promise<PersistentDocumentExportResult> {
    return this.#enqueue(() => this.#exportDocument(format, options))
  }

  inspectSourceImport(input: unknown): Promise<SessionPortResult<SourceImportInspection>> {
    return this.#enqueue(async () => {
      if (this.#closed)
        return {
          ok: false,
          diagnostic: diagnostic("session-closed", "The document session is closed."),
        }
      const parsed = inspectSourceImportInputSchema.safeParse(input)
      if (!parsed.success || !this.#rebuildPort.inspectSourceImport)
        return {
          ok: false,
          diagnostic: diagnostic(
            "command-rejected",
            "The source inspection request is invalid or unavailable.",
          ),
        }
      try {
        const response = await this.#rebuildPort.inspectSourceImport(parsed.data)
        return { ok: true, value: response.inspection }
      } catch (error) {
        return {
          ok: false,
          diagnostic: diagnostic(
            "command-rejected",
            error instanceof Error ? error.message : "The source could not be inspected.",
          ),
        }
      }
    })
  }

  inspectMeshImport(input: unknown): Promise<SessionPortResult<MeshImportInspection>> {
    return this.#enqueue(async () => {
      if (this.#closed)
        return {
          ok: false,
          diagnostic: diagnostic("session-closed", "The document session is closed."),
        }
      const parsed = inspectMeshImportInputSchema.safeParse(input)
      if (!parsed.success || !this.#rebuildPort.inspectMeshImport)
        return {
          ok: false,
          diagnostic: diagnostic(
            "command-rejected",
            "The mesh inspection request is invalid or unavailable.",
          ),
        }
      try {
        const response = await this.#rebuildPort.inspectMeshImport(parsed.data)
        return { ok: true, value: response.inspection }
      } catch (error) {
        return {
          ok: false,
          diagnostic: diagnostic(
            "command-rejected",
            error instanceof Error ? error.message : "The source could not be inspected.",
          ),
        }
      }
    })
  }

  solveSketch(
    sketchId: SketchId,
    draftSketch?: SketchRecord,
    options: PersistentSketchSolveOptions = {},
  ): Promise<PersistentSketchSolveResult> {
    return this.#enqueue(() => this.#solveSketch(sketchId, draftSketch, options))
  }

  close(): Promise<SessionPortResult<void>> {
    return this.#enqueue(() => this.#close())
  }

  async #commit(input: unknown): Promise<PersistentDocumentCommitResult> {
    if (this.#closed) {
      return {
        ok: false,
        diagnostic: diagnostic("session-closed", "The document session is closed."),
      }
    }
    const lease = await this.#renewWriteAccess()
    if (!lease.ok) return lease
    const command = this.#dependencies.commandDispatcher.dispatch(this.#snapshot, input)
    if (!command.ok) return { ok: false, diagnostic: commandDiagnostic(command.diagnostic) }
    const persisted = await this.#dependencies.repository.commit({
      sessionId: this.#sessionId,
      lease: { epoch: lease.lease.epoch, nowMs: lease.nowMs },
      storedAt: command.event.issuedAt,
      baseSnapshot: this.#snapshot,
      event: command.event,
      snapshot: command.snapshot,
    })
    if (!persisted.ok) {
      return {
        ok: false,
        diagnostic: portDiagnostic(
          "persistence-failed",
          "The document revision was not saved.",
          persisted.diagnostic,
        ),
      }
    }
    const confirmed = confirmedCommitSnapshot(this.#dependencies.repository, command.snapshot)
    if (!confirmed.ok) return confirmed
    this.#snapshot = confirmed.snapshot
    return {
      ok: true,
      snapshot: confirmed.snapshot,
      event: command.event,
      rebuild: await this.#rebuild(),
    }
  }

  #prepareDraft(input: unknown) {
    if (this.#closed) {
      return {
        ok: false as const,
        diagnostic: diagnostic("session-closed", "The document session is closed."),
      }
    }
    const parsed = draftCommitInputSchema.safeParse(input)
    if (!parsed.success) {
      return {
        ok: false as const,
        diagnostic: diagnostic("invalid-draft-commit", "The document draft commit is invalid."),
      }
    }
    const dispatched = dispatchDraftCommands(
      this.#dependencies.commandDispatcher,
      this.#snapshot,
      parsed.data,
    )
    if (!dispatched.ok) return dispatched
    if (
      parsed.data.expectedSnapshot &&
      canonicalJson(dispatched.snapshot) !== canonicalJson(parsed.data.expectedSnapshot)
    ) {
      return {
        ok: false as const,
        diagnostic: diagnostic(
          "invalid-draft-commit",
          "The document draft commit target does not match the dispatched snapshot.",
        ),
      }
    }
    return { ...dispatched, draftId: parsed.data.draftId }
  }

  async #commitDraft(input: unknown): Promise<PersistentDocumentDraftCommitResult> {
    const dispatched = this.#prepareDraft(input)
    if (!dispatched.ok) return dispatched
    const lease = await this.#renewWriteAccess()
    if (!lease.ok) return lease
    const persisted = await this.#dependencies.repository.commitDraft({
      sessionId: this.#sessionId,
      lease: { epoch: lease.lease.epoch, nowMs: lease.nowMs },
      storedAt: dispatched.storedAt,
      transactionId: dispatched.draftId,
      baseSnapshot: this.#snapshot,
      events: dispatched.events,
      snapshot: dispatched.snapshot,
    })
    if (!persisted.ok) {
      return {
        ok: false,
        diagnostic: portDiagnostic(
          "persistence-failed",
          `The document draft was not saved. ${persisted.diagnostic.message}`.slice(0, 512),
          persisted.diagnostic,
        ),
      }
    }
    const confirmed = confirmedCommitSnapshot(this.#dependencies.repository, dispatched.snapshot)
    if (!confirmed.ok) return confirmed
    this.#snapshot = confirmed.snapshot
    return {
      ok: true,
      snapshot: confirmed.snapshot,
      events: dispatched.events,
      rebuild: await this.#rebuild(),
    }
  }

  async #renewWriteAccess() {
    const result = await acquireWriterLease(this.#dependencies, {
      documentId: this.#documentId,
      sessionId: this.#sessionId,
      leaseDurationMs: this.#leaseDurationMs,
    })
    if (result.ok) {
      this.#lease = result.lease
      return result
    }
    this.#lease = null
    return { ok: false, diagnostic: result.diagnostic } as const
  }

  async #rebuild(): Promise<DocumentRebuildOutcome> {
    if (this.#closed) {
      return {
        ok: false,
        diagnostic: diagnostic("session-closed", "The document session is closed."),
      }
    }
    try {
      return {
        ok: true,
        response: await this.#rebuildPort.rebuild({
          document: this.#snapshot,
          mesh: this.#mesh,
        }),
      }
    } catch {
      return rebuildFailure()
    }
  }

  async #exportDocument(
    format: GeometryExportFormat,
    options: DocumentExportOptions,
  ): Promise<PersistentDocumentExportResult> {
    if (this.#closed) {
      return {
        ok: false,
        diagnostic: diagnostic("session-closed", "The document session is closed."),
      }
    }
    try {
      return { ok: true, response: await this.#rebuildPort.exportDocument(format, options) }
    } catch (error) {
      return documentExportFailure(error)
    }
  }

  async #solveSketch(
    sketchId: SketchId,
    draftSketch?: SketchRecord,
    options: PersistentSketchSolveOptions = {},
  ): Promise<PersistentSketchSolveResult> {
    if (this.#closed) {
      return {
        ok: false,
        diagnostic: diagnostic("session-closed", "The document session is closed."),
      }
    }
    const authority = this.authoredSnapshot
    if (
      !draftSketch &&
      authority &&
      "repairIntents" in authority &&
      authority.repairIntents.some(
        (intent) => intent.kind === "sketch" && intent.authored.id === sketchId,
      )
    )
      return {
        ok: false,
        diagnostic: diagnostic(
          "sketch-solve-failed",
          "The sketch has disconnected inputs. Repair its support or external references before solving.",
        ),
      }
    try {
      const input: DocumentSketchSolveInput = {
        sketchId,
        ...(draftSketch ? { draftSketch } : {}),
        ...options,
      }
      return {
        ok: true,
        response: await this.#rebuildPort.solveSketch(input),
      }
    } catch {
      return {
        ok: false,
        diagnostic: diagnostic(
          "sketch-solve-failed",
          "The current sketch could not be solved.",
          true,
        ),
      }
    }
  }

  async #close(): Promise<SessionPortResult<void>> {
    if (this.#closed) return { ok: true, value: undefined }
    let closeDiagnostic: PersistentDocumentSessionDiagnostic | null = null
    try {
      if (this.#lease) closeDiagnostic = await this.#closePersistence()
      await this.#rebuildPort.dispose(this.#snapshot.revision)
    } catch {
      closeDiagnostic ??= diagnostic(
        "close-failed",
        "The document worker could not be disposed cleanly.",
        true,
      )
    } finally {
      this.#closed = true
      this.#lease = null
      this.#rebuildPort.terminate()
    }
    return closeDiagnostic
      ? { ok: false, diagnostic: closeDiagnostic }
      : { ok: true, value: undefined }
  }

  async #closePersistence() {
    const renewed = await this.#renewWriteAccess()
    if (!renewed.ok) return renewed.diagnostic
    const closed = await this.#dependencies.repository.closeCleanly({
      documentId: this.#documentId,
      revision: this.#snapshot.revision,
      sessionId: this.#sessionId,
      lease: { epoch: renewed.lease.epoch, nowMs: renewed.nowMs },
    })
    if (!closed.ok) {
      return portDiagnostic(
        "close-failed",
        "The saved document could not be marked as cleanly closed.",
        closed.diagnostic,
      )
    }
    const released = await this.#dependencies.leases.release({
      documentId: this.#documentId,
      ownerId: this.#sessionId,
      nowMs: renewed.nowMs,
    })
    return released.ok
      ? null
      : portDiagnostic(
          "close-failed",
          "The document lease could not be released cleanly.",
          released.diagnostic,
        )
  }

  #enqueue<Result>(operation: () => Promise<Result>): Promise<Result> {
    this.#pendingOperations += 1
    const result = this.#operationQueue.then(operation).finally(() => {
      this.#pendingOperations -= 1
    })
    this.#operationQueue = result.then(
      () => undefined,
      () => undefined,
    )
    return result
  }
}

async function createSession(
  dependencies: PersistentDocumentSessionDependencies,
  input: {
    snapshot: DocumentSnapshot
    sessionId: SessionId
    mesh: FeatureMeshPolicy
    leaseDurationMs: number
  },
) {
  const writeAccess = await acquireWriterLease(dependencies, {
    documentId: input.snapshot.id,
    sessionId: input.sessionId,
    leaseDurationMs: input.leaseDurationMs,
  })
  const rebuildPort = dependencies.createRebuildPort(input.snapshot.id)
  const session = new PersistentDocumentSession({
    ...input,
    dependencies,
    rebuildPort,
    lease: writeAccess.ok ? writeAccess.lease : null,
  })
  const rebuild = await session.retryRebuild()
  return {
    session,
    rebuild,
    writeAccessDiagnostic: writeAccess.ok ? null : writeAccess.diagnostic,
  }
}

export async function openPersistentDocumentSession(
  dependencies: PersistentDocumentSessionDependencies,
  input: unknown,
): Promise<PersistentDocumentSessionOpenResult> {
  const parsed = openSessionInputSchema.safeParse(input)
  if (!parsed.success) return invalidInput("The persisted document open request is invalid.")
  const recovered = await dependencies.repository.recover(parsed.data.documentId)
  if (!recovered.ok) {
    return {
      ok: false,
      diagnostic: portDiagnostic(
        "persistence-failed",
        "The saved document could not be recovered.",
        recovered.diagnostic,
      ),
    }
  }
  const snapshot = parseRecoveredSnapshot(parsed.data.documentId, recovered.value)
  if (!snapshot.ok) return snapshot
  const opened = await createSession(dependencies, { ...parsed.data, snapshot: snapshot.snapshot })
  return {
    ok: true,
    session: opened.session,
    report: {
      status: recovered.value.status,
      mode: opened.session.mode,
      snapshot: opened.session.snapshot,
      historyItems: opened.session.historyItems,
      rebuild: opened.rebuild,
      lostRevisionCount: recovered.value.lostRevisionCount,
      corruptRecords: recovered.value.corruptRecords,
      migration: recovered.value.migration ?? null,
      writeAccessDiagnostic: opened.writeAccessDiagnostic,
    },
  }
}

export async function createPersistentDocumentSession(
  dependencies: PersistentDocumentSessionDependencies,
  input: unknown,
): Promise<PersistentDocumentSessionOpenResult> {
  const parsed = createSessionInputSchema.safeParse(input)
  if (!parsed.success) return invalidInput("The persisted document create request is invalid.")
  const command = documentCommandSchema.safeParse(parsed.data.command)
  if (!command.success || command.data.kind !== "org.vibeshape.document.create") {
    return invalidInput("A persisted document session must start with a document create command.")
  }
  const created = dependencies.commandDispatcher.dispatch(null, command.data)
  if (!created.ok) return { ok: false, diagnostic: commandDiagnostic(created.diagnostic) }
  const persisted = await dependencies.repository.commit({
    sessionId: parsed.data.sessionId,
    lease: null,
    storedAt: created.event.issuedAt,
    baseSnapshot: null,
    event: created.event,
    snapshot: created.snapshot,
  })
  if (!persisted.ok) {
    return {
      ok: false,
      diagnostic: portDiagnostic(
        "persistence-failed",
        "The new document could not be saved.",
        persisted.diagnostic,
      ),
    }
  }
  const opened = await createSession(dependencies, {
    snapshot: created.snapshot,
    sessionId: parsed.data.sessionId,
    mesh: parsed.data.mesh,
    leaseDurationMs: parsed.data.leaseDurationMs,
  })
  return {
    ok: true,
    session: opened.session,
    report: {
      status: "created",
      mode: opened.session.mode,
      snapshot: opened.session.snapshot,
      historyItems: opened.session.historyItems,
      rebuild: opened.rebuild,
      lostRevisionCount: 0,
      corruptRecords: [],
      migration: null,
      writeAccessDiagnostic: opened.writeAccessDiagnostic,
    },
  }
}

function confirmedCommitSnapshot(
  repository: PersistentDocumentRepositoryPort,
  requested: DocumentSnapshot,
) {
  if (!repository.committedSnapshot) return { ok: true as const, snapshot: requested }
  const confirmed = documentSnapshotSchema.safeParse(repository.committedSnapshot)
  return confirmed.success &&
    confirmed.data.id === requested.id &&
    confirmed.data.revision === requested.revision
    ? { ok: true as const, snapshot: confirmed.data }
    : {
        ok: false as const,
        diagnostic: diagnostic(
          "persistence-failed",
          "The confirmed semantic projection does not match the committed revision.",
        ),
      }
}
