import {
  applyVersionedDocumentCommand,
  canonicalJson,
  type DocumentEvent,
  type DocumentId,
  type DocumentSnapshot,
  type DocumentSnapshotV1,
  documentRestoredEventSchema,
  documentSnapshotV1Schema,
  projectDocumentSnapshotV1ToV0,
  reduceVersionedDocumentEvent,
  type VersionedDocumentEvent,
} from "@vibeshape/domain"
import { DocumentUndoHistory } from "./document-undo-history"
import type {
  DocumentHistoryRequest,
  PersistedRecoveryMigration,
  PersistedRecoveryReport,
  PersistentDocumentRepositoryPort,
  SessionPortDiagnostic,
} from "./persistent-document-session"
import { documentHistoryRequestSchema } from "./persistent-document-session"

export type VersionedLease = { epoch: number; nowMs: number }
export type VersionedCommitInput = Readonly<{
  sessionId: string
  lease: VersionedLease | null
  storedAt: string
  baseSnapshot: DocumentSnapshotV1 | null
  event: VersionedDocumentEvent
  snapshot: DocumentSnapshotV1
}>
export type VersionedDraftInput = Readonly<{
  sessionId: string
  lease: VersionedLease
  storedAt: string
  transactionId: string
  baseSnapshot: DocumentSnapshotV1
  events: readonly VersionedDocumentEvent[]
  snapshot: DocumentSnapshotV1
}>
export type VersionedCloseInput = Readonly<{
  documentId: DocumentId
  revision: number
  sessionId: string
  lease: VersionedLease
}>
export type VersionedRecoveryReport = Readonly<{
  status: "clean" | "recovered" | "recovered-with-loss"
  snapshot: DocumentSnapshotV1
  headRevision: number
  recoveredRevision: number
  lostRevisionCount: number
  corruptRecords: readonly string[]
  migration: Readonly<{
    migrationProvenance: PersistedRecoveryMigration["provenance"]
    migrationDiagnostic: PersistedRecoveryMigration["diagnostic"]
    unavailableRecords: readonly string[]
  }>
}>
export type VersionedDocumentRepositoryPort = Readonly<{
  commit: (input: VersionedCommitInput) => Promise<VersionedPortResult<unknown>>
  commitDraft: (input: VersionedDraftInput) => Promise<VersionedPortResult<unknown>>
  recover: (documentId: DocumentId) => Promise<VersionedPortResult<VersionedRecoveryReport>>
  closeCleanly: (input: VersionedCloseInput) => Promise<VersionedPortResult<unknown>>
}>
export type VersionedPortResult<Value> =
  | Readonly<{ ok: true; value: Value }>
  | Readonly<{ ok: false; diagnostic: SessionPortDiagnostic }>

function failed(code: string, message: string): Extract<VersionedPortResult<never>, { ok: false }> {
  return { ok: false, diagnostic: { code, message, retryable: false } }
}

function project(snapshot: DocumentSnapshotV1 | null) {
  return snapshot ? projectDocumentSnapshotV1ToV0(snapshot) : { ok: true as const, snapshot: null }
}

function translateAddEvent(
  snapshot: DocumentSnapshotV1 | null,
  event: DocumentEvent,
): VersionedDocumentEvent | VersionedPortResult<never> {
  if (
    !snapshot &&
    (event.type === "org.vibeshape.sketch.added" || event.type === "org.vibeshape.feature.added")
  )
    return failed("invalid-event", "A legacy add event requires an existing v1 History snapshot.")
  const historyAfter = snapshot?.history.at(-1) ?? null
  if (event.type === "org.vibeshape.sketch.added") {
    const result = applyVersionedDocumentCommand(
      snapshot,
      {
        schemaVersion: 1,
        kind: "org.vibeshape.history.insert-sketch",
        commandId: event.commandId,
        documentId: event.documentId,
        baseRevision: event.baseRevision,
        issuedAt: event.issuedAt,
        actor: event.actor,
        payload: { sketch: event.sketch, historyAfter },
      },
      { transactionId: event.transactionId },
    )
    return result.ok ? result.event : failed("invalid-event", result.diagnostic.message)
  }
  if (event.type === "org.vibeshape.feature.added") {
    const result = applyVersionedDocumentCommand(
      snapshot,
      {
        schemaVersion: 1,
        kind: "org.vibeshape.history.insert-feature",
        commandId: event.commandId,
        documentId: event.documentId,
        baseRevision: event.baseRevision,
        issuedAt: event.issuedAt,
        actor: event.actor,
        payload: { feature: event.feature, historyAfter },
      },
      { transactionId: event.transactionId },
    )
    return result.ok ? result.event : failed("invalid-event", result.diagnostic.message)
  }
  return event as VersionedDocumentEvent
}

function parseHistoryNavigation(
  input: Readonly<{
    request: unknown
    sessionId: string
    lease: VersionedLease
    baseSnapshot: DocumentSnapshot
  }>,
  authority: DocumentSnapshotV1 | null,
  projectInput: (
    snapshot: DocumentSnapshotV1 | null,
    expected: DocumentSnapshot | null,
  ) => Extract<VersionedPortResult<never>, { ok: false }> | null,
):
  | { ok: true; request: DocumentHistoryRequest; authority: DocumentSnapshotV1 }
  | { ok: false; diagnostic: SessionPortDiagnostic } {
  const parsed = documentHistoryRequestSchema.safeParse(input.request)
  if (!parsed.success || !authority)
    return failed("invalid-input", "The history request is invalid.")
  const baseMatch = projectInput(authority, input.baseSnapshot)
  if (baseMatch) return baseMatch
  const request = parsed.data
  if (request.documentId !== authority.id || request.baseRevision !== authority.revision)
    return failed(
      "stale-revision",
      "The history request does not target the current document revision.",
    )
  return { ok: true, request, authority }
}

function buildHistoryRestore(
  authority: DocumentSnapshotV1,
  request: DocumentHistoryRequest,
  history: DocumentUndoHistory,
):
  | {
      ok: true
      event: VersionedDocumentEvent
      restored: DocumentSnapshotV1
      projected: DocumentSnapshot
    }
  | { ok: false; diagnostic: SessionPortDiagnostic } {
  const target = history.target(request.direction)
  if (!target) return failed("history-unavailable", "There is no saved change in this direction.")
  const event = documentRestoredEventSchema.safeParse({
    ...request,
    schemaVersion: 1,
    type: "org.vibeshape.document.restored",
    transactionId: null,
    revision: authority.revision + 1,
    targetRevision: target.revision,
  })
  if (!event.success) return failed("invalid-event", "The history event is invalid.")
  const restored = reduceVersionedDocumentEvent(authority, event.data, target)
  if (!restored.ok) return failed("invalid-event", restored.diagnostic.message)
  const projected = projectDocumentSnapshotV1ToV0(restored.snapshot)
  if (!projected.ok) return failed("invalid-event", projected.diagnostic.message)
  return {
    ok: true as const,
    event: event.data,
    restored: restored.snapshot,
    projected: projected.snapshot,
  }
}

export function createVersionedPersistenceAdapter(
  repository: VersionedDocumentRepositoryPort,
  initialSnapshot: DocumentSnapshotV1 | null = null,
): PersistentDocumentRepositoryPort &
  Readonly<{ readonly currentV1Snapshot: DocumentSnapshotV1 | null }> {
  let authority = initialSnapshot
  const history = new DocumentUndoHistory()

  const projectInput = (
    snapshot: DocumentSnapshotV1 | null,
    expected: DocumentSnapshot | null,
  ): Extract<VersionedPortResult<never>, { ok: false }> | null => {
    const projected = project(snapshot)
    return projected.ok && canonicalJson(projected.snapshot) === canonicalJson(expected)
      ? null
      : failed("invalid-input", "The v1 and v0 snapshots do not match canonically.")
  }

  return {
    history: {
      get availability() {
        return history.availability
      },
      async navigate(input) {
        const parsed = parseHistoryNavigation(input, authority, projectInput)
        if (!parsed.ok) return parsed
        const restored = buildHistoryRestore(parsed.authority, parsed.request, history)
        if (!restored.ok) return restored
        let persisted: VersionedPortResult<unknown>
        try {
          persisted = await repository.commit({
            sessionId: input.sessionId,
            lease: input.lease,
            storedAt: parsed.request.issuedAt,
            baseSnapshot: authority,
            event: restored.event,
            snapshot: restored.restored,
          })
        } catch {
          return failed("persistence-failed", "The history change was not saved.")
        }
        if (!persisted.ok) return persisted
        authority = restored.restored
        history.accept(parsed.request.direction)
        return { ok: true, value: restored.projected }
      },
    },
    semanticHistory: {
      get items() {
        return authority?.history ?? []
      },
      async move(input) {
        const baseMatch = projectInput(authority, input.baseSnapshot)
        if (baseMatch) return baseMatch
        const reduced = applyVersionedDocumentCommand(authority, input.command)
        if (!reduced.ok || reduced.event.type !== "org.vibeshape.history.item-moved")
          return failed(
            "invalid-event",
            reduced.ok ? "The command is not a History move." : reduced.diagnostic.message,
          )
        const projected = projectDocumentSnapshotV1ToV0(reduced.snapshot)
        if (!projected.ok) return failed("invalid-event", projected.diagnostic.message)
        let persisted: VersionedPortResult<unknown>
        try {
          persisted = await repository.commit({
            sessionId: input.sessionId,
            lease: input.lease,
            storedAt: reduced.event.issuedAt,
            baseSnapshot: authority,
            event: reduced.event,
            snapshot: reduced.snapshot,
          })
        } catch {
          return failed("persistence-failed", "The History move was not saved.")
        }
        if (!persisted.ok) return persisted
        history.record(authority, reduced.snapshot)
        authority = reduced.snapshot
        return { ok: true, value: projected.snapshot }
      },
    },
    get currentV1Snapshot() {
      return authority
    },
    async commit(input) {
      const baseMatch = projectInput(authority, input.baseSnapshot)
      if (baseMatch) return baseMatch
      const translated = translateAddEvent(authority, input.event)
      if ("ok" in translated) return translated
      const reduced = reduceVersionedDocumentEvent(authority, translated)
      if (!reduced.ok) return failed("invalid-event", reduced.diagnostic.message)
      const resultMatch = projectInput(reduced.snapshot, input.snapshot)
      if (resultMatch) return resultMatch
      let persisted: VersionedPortResult<unknown>
      try {
        persisted = await repository.commit({
          ...input,
          event: translated,
          baseSnapshot: authority,
          snapshot: reduced.snapshot,
        })
      } catch {
        return failed("persistence-failed", "The versioned persistence commit failed.")
      }
      if (persisted.ok) {
        history.record(authority, reduced.snapshot)
        authority = reduced.snapshot
      }
      return persisted
    },
    async commitDraft(input) {
      const baseMatch = projectInput(authority, input.baseSnapshot)
      if (baseMatch) return baseMatch
      let current = authority
      if (!current) return failed("document-not-found", "The document does not exist.")
      const base = current
      const translated: VersionedDocumentEvent[] = []
      for (const event of input.events) {
        const lifted = translateAddEvent(current, event)
        if (!("type" in lifted)) return lifted
        const reduced = reduceVersionedDocumentEvent(current, lifted)
        if (!reduced.ok) return failed("invalid-event", reduced.diagnostic.message)
        current = reduced.snapshot
        translated.push(lifted)
      }
      const resultMatch = projectInput(current, input.snapshot)
      if (resultMatch) return resultMatch
      let persisted: VersionedPortResult<unknown>
      try {
        persisted = await repository.commitDraft({
          ...input,
          events: translated,
          baseSnapshot: base,
          snapshot: current,
        })
      } catch {
        return failed("persistence-failed", "The versioned draft persistence commit failed.")
      }
      if (persisted.ok) {
        history.record(authority, current)
        authority = current
      }
      return persisted
    },
    async recover(documentId) {
      let recovered: VersionedPortResult<VersionedRecoveryReport>
      try {
        recovered = await repository.recover(documentId)
      } catch {
        return failed("persistence-failed", "The versioned recovery failed.")
      }
      if (!recovered.ok) return recovered
      const parsed = documentSnapshotV1Schema.safeParse(recovered.value.snapshot)
      if (!parsed.success)
        return failed("invalid-recovered-document", "The recovered v1 snapshot is invalid.")
      const projected = projectDocumentSnapshotV1ToV0(parsed.data)
      if (!projected.ok) return failed("invalid-recovered-document", projected.diagnostic.message)
      authority = parsed.data
      history.clear()
      const value: PersistedRecoveryReport = {
        ...recovered.value,
        snapshot: projected.snapshot,
        migration: {
          provenance: recovered.value.migration.migrationProvenance,
          diagnostic: recovered.value.migration.migrationDiagnostic,
          unavailableRecords: recovered.value.migration.unavailableRecords,
        },
      }
      return { ok: true, value }
    },
    async closeCleanly(input) {
      try {
        return await repository.closeCleanly(input)
      } catch {
        return failed("persistence-failed", "The versioned clean close failed.")
      }
    },
  }
}
