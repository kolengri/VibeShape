import {
  applyVersionedDocumentCommand,
  canonicalJson,
  type DocumentEvent,
  type DocumentId,
  type DocumentSnapshot,
  type DocumentSnapshotV1,
  documentSnapshotV1Schema,
  projectDocumentSnapshotV1ToV0,
  reduceVersionedDocumentEvent,
  type VersionedDocumentEvent,
} from "@vibeshape/domain"
import type {
  PersistedRecoveryMigration,
  PersistedRecoveryReport,
  PersistentDocumentRepositoryPort,
  SessionPortDiagnostic,
} from "./persistent-document-session"

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

function failed(code: string, message: string): VersionedPortResult<never> {
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

export function createVersionedPersistenceAdapter(
  repository: VersionedDocumentRepositoryPort,
  initialSnapshot: DocumentSnapshotV1 | null = null,
): PersistentDocumentRepositoryPort &
  Readonly<{ readonly currentV1Snapshot: DocumentSnapshotV1 | null }> {
  let authority = initialSnapshot

  const projectInput = (snapshot: DocumentSnapshotV1 | null, expected: DocumentSnapshot | null) => {
    const projected = project(snapshot)
    return projected.ok && canonicalJson(projected.snapshot) === canonicalJson(expected)
      ? null
      : failed("invalid-input", "The v1 and v0 snapshots do not match canonically.")
  }

  return {
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
      if (persisted.ok) authority = reduced.snapshot
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
      if (persisted.ok) authority = current
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
