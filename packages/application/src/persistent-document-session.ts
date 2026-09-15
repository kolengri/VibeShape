import { canonicalJson } from "@vibeshape/domain/canonical-json"
import type { CommandDispatcher } from "@vibeshape/domain/command-dispatcher"
import type { DocumentEvent } from "@vibeshape/domain/commands"
import {
  commandActorSchema,
  commandActorsEqual,
  documentCommandSchema,
} from "@vibeshape/domain/commands"
import { type DocumentSnapshot, documentSnapshotSchema } from "@vibeshape/domain/document"
import type { HistoryItemRef } from "@vibeshape/domain/document-node"
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
  type DocumentWorkerRequest,
  type DocumentWorkerTerminalResponse,
  type FeatureMeshPolicy,
  featureMeshPolicySchema,
  type GeometryExportFormat,
} from "@vibeshape/protocol"
import { z } from "zod"

const DEFAULT_LEASE_DURATION_MS = 30_000

export const documentHistoryRequestSchema = z
  .object({
    direction: z.enum(["undo", "redo"]),
    commandId: commandIdSchema,
    documentId: documentIdSchema,
    baseRevision: revisionSchema,
    issuedAt: timestampSchema,
    actor: commandActorSchema,
  })
  .strict()

export type DocumentHistoryRequest = Readonly<z.infer<typeof documentHistoryRequestSchema>>
export type DocumentHistoryAvailability = Readonly<{ canUndo: boolean; canRedo: boolean }>

export type DocumentHistoryPort = Readonly<{
  readonly availability: DocumentHistoryAvailability
  navigate: (
    input: Readonly<{
      request: DocumentHistoryRequest
      sessionId: SessionId
      lease: { epoch: number; nowMs: number }
      baseSnapshot: DocumentSnapshot
    }>,
  ) => Promise<SessionPortResult<DocumentSnapshot>>
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

type PersistenceHistoryMoveInput = Readonly<{
  sessionId: SessionId
  lease: { epoch: number; nowMs: number }
  baseSnapshot: DocumentSnapshot
  command: unknown
}>

export type DocumentSemanticHistoryPort = Readonly<{
  readonly items: readonly HistoryItemRef[]
  move: (input: PersistenceHistoryMoveInput) => Promise<SessionPortResult<DocumentSnapshot>>
}>

export type PersistentDocumentRepositoryPort = Readonly<{
  history?: DocumentHistoryPort
  semanticHistory?: DocumentSemanticHistoryPort
  commit: (input: PersistenceCommitInput) => Promise<SessionPortResult<unknown>>
  commitDraft: (input: PersistenceDraftCommitInput) => Promise<SessionPortResult<unknown>>
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
  exportDocument: (format: GeometryExportFormat) => Promise<DocumentExportResponse>
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

function portDiagnostic(
  code: PersistentDocumentSessionDiagnosticCode,
  message: string,
  source: SessionPortDiagnostic,
) {
  return diagnostic(code, message, source.retryable, source.code)
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
  for (const commandInput of input.commands) {
    const command = dispatcher.dispatch(draftSnapshot, commandInput, {
      transactionId: input.draftId,
    })
    if (!command.ok) return { ok: false, diagnostic: commandDiagnostic(command.diagnostic) }
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
) {
  try {
    return await history.navigate({ request, sessionId, lease, baseSnapshot })
  } catch {
    return {
      ok: false as const,
      diagnostic: diagnostic("persistence-failed", "The history change was not saved.", true),
    }
  }
}

function validateHistoryResult(value: DocumentSnapshot, documentId: DocumentId, revision: number) {
  const restored = documentSnapshotSchema.safeParse(value)
  return restored.success &&
    restored.data.id === documentId &&
    restored.data.revision === revision + 1
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

  navigateHistory(input: unknown): Promise<PersistentDocumentHistoryResult> {
    return this.#enqueue(() => this.#navigateHistory(input))
  }

  moveHistoryItem(input: unknown): Promise<PersistentDocumentHistoryResult> {
    return this.#enqueue(() => this.#moveHistoryItem(input))
  }

  async #moveHistoryItem(input: unknown): Promise<PersistentDocumentHistoryResult> {
    if (this.#closed)
      return {
        ok: false,
        diagnostic: diagnostic("session-closed", "The document session is closed."),
      }
    const semanticHistory = this.#dependencies.repository.semanticHistory
    if (!semanticHistory)
      return {
        ok: false,
        diagnostic: diagnostic(
          "command-rejected",
          "The document does not expose semantic History mutations.",
        ),
      }
    const lease = await this.#renewWriteAccess()
    if (!lease.ok) return lease
    let result: SessionPortResult<DocumentSnapshot>
    try {
      result = await semanticHistory.move({
        sessionId: this.#sessionId,
        lease: { epoch: lease.lease.epoch, nowMs: lease.nowMs },
        baseSnapshot: this.#snapshot,
        command: input,
      })
    } catch {
      return {
        ok: false,
        diagnostic: diagnostic("persistence-failed", "The History order was not saved.", true),
      }
    }
    if (!result.ok)
      return {
        ok: false,
        diagnostic: portDiagnostic(
          "persistence-failed",
          "The History order was not saved.",
          result.diagnostic,
        ),
      }
    const restored = validateHistoryResult(result.value, this.#documentId, this.#snapshot.revision)
    if (!restored)
      return {
        ok: false,
        diagnostic: diagnostic(
          "invalid-recovered-document",
          "The History adapter returned an invalid document revision.",
        ),
      }
    this.#snapshot = restored
    return { ok: true, snapshot: restored, rebuild: await this.#rebuild() }
  }

  async #navigateHistory(input: unknown): Promise<PersistentDocumentHistoryResult> {
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
    const lease = await this.#renewWriteAccess()
    if (!lease.ok) return lease
    const result = await persistHistoryRequest(
      validated.history,
      validated.request,
      this.#sessionId,
      { epoch: lease.lease.epoch, nowMs: lease.nowMs },
      this.#snapshot,
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

  retryRebuild(): Promise<DocumentRebuildOutcome> {
    return this.#enqueue(() => this.#rebuild())
  }

  exportDocument(format: GeometryExportFormat): Promise<PersistentDocumentExportResult> {
    return this.#enqueue(() => this.#exportDocument(format))
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
    this.#snapshot = command.snapshot
    return {
      ok: true,
      snapshot: command.snapshot,
      event: command.event,
      rebuild: await this.#rebuild(),
    }
  }

  async #commitDraft(input: unknown): Promise<PersistentDocumentDraftCommitResult> {
    if (this.#closed) {
      return {
        ok: false,
        diagnostic: diagnostic("session-closed", "The document session is closed."),
      }
    }
    const parsed = draftCommitInputSchema.safeParse(input)
    if (!parsed.success) {
      return {
        ok: false,
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
        ok: false,
        diagnostic: diagnostic(
          "invalid-draft-commit",
          "The document draft commit target does not match the dispatched snapshot.",
        ),
      }
    }
    const lease = await this.#renewWriteAccess()
    if (!lease.ok) return lease
    const persisted = await this.#dependencies.repository.commitDraft({
      sessionId: this.#sessionId,
      lease: { epoch: lease.lease.epoch, nowMs: lease.nowMs },
      storedAt: dispatched.storedAt,
      transactionId: parsed.data.draftId,
      baseSnapshot: this.#snapshot,
      events: dispatched.events,
      snapshot: dispatched.snapshot,
    })
    if (!persisted.ok) {
      return {
        ok: false,
        diagnostic: portDiagnostic(
          "persistence-failed",
          "The document draft was not saved.",
          persisted.diagnostic,
        ),
      }
    }
    this.#snapshot = dispatched.snapshot
    return {
      ok: true,
      snapshot: dispatched.snapshot,
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

  async #exportDocument(format: GeometryExportFormat): Promise<PersistentDocumentExportResult> {
    if (this.#closed) {
      return {
        ok: false,
        diagnostic: diagnostic("session-closed", "The document session is closed."),
      }
    }
    try {
      return { ok: true, response: await this.#rebuildPort.exportDocument(format) }
    } catch {
      return {
        ok: false,
        diagnostic: diagnostic(
          "export-failed",
          "The current document geometry could not be exported.",
          true,
        ),
      }
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
    const result = this.#operationQueue.then(operation)
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
