import { applyVersionedDocumentCommand } from "@vibeshape/domain"
import {
  type AuthoredDocumentSnapshot,
  type DocumentAuthoritySnapshot,
  documentAuthoritySnapshotSchema,
} from "@vibeshape/domain/document-v2"
import type {
  DocumentAuthorityEvent,
  DocumentV2Event,
  DocumentV3Event,
} from "@vibeshape/domain/document-v2-command-schemas"
import { applyDocumentV2Command } from "@vibeshape/domain/document-v2-commands"
import { applyDocumentV3Command } from "@vibeshape/domain/document-v3-commands"
import {
  authorityFailure,
  capturePartAllocations,
  documentAuthoredCommandRequestSchema,
  matchRuntimeProjection,
  modelProjection,
  type PartAllocationFactory,
  prepareAuthorityModelEvent,
  prepareAuthorityRestore,
  runtimeProjection,
} from "./authority-persistence-operations"
import { DocumentUndoHistory } from "./document-undo-history"
import {
  type DocumentAuthoredMetadataPort,
  type DocumentHistoryPort,
  type DocumentSemanticHistoryPort,
  documentHistoryRequestSchema,
  type PersistentDocumentRepositoryPort,
  type SessionPortResult,
} from "./persistent-document-session"
import {
  createVersionedPersistenceAdapter,
  translateLegacyDocumentEvent,
  type VersionedCloseInput,
  type VersionedCommitInput,
  type VersionedDocumentRepositoryPort,
  type VersionedDraftInput,
  type VersionedRecoveryReport,
} from "./versioned-persistence-adapter"

export type AuthorityCommitInput = Readonly<
  Omit<VersionedCommitInput, "baseSnapshot" | "snapshot" | "event"> & {
    baseSnapshot: DocumentAuthoritySnapshot
    snapshot: DocumentAuthoritySnapshot
    event: DocumentAuthorityEvent
  }
>
export type AuthorityDraftInput = Readonly<
  Omit<VersionedDraftInput, "baseSnapshot" | "snapshot" | "events"> & {
    baseSnapshot: DocumentAuthoritySnapshot
    snapshot: DocumentAuthoritySnapshot
    events: readonly DocumentAuthorityEvent[]
  }
>
export type AuthorityRecoveryReport = Readonly<
  Omit<VersionedRecoveryReport, "snapshot"> & {
    snapshot: DocumentAuthoritySnapshot
  }
>
export type AuthorityDocumentRepositoryPort = VersionedDocumentRepositoryPort &
  Readonly<{
    commitAuthority: (input: AuthorityCommitInput) => Promise<SessionPortResult<unknown>>
    commitAuthorityDraft: (input: AuthorityDraftInput) => Promise<SessionPortResult<unknown>>
    recoverAuthority: (
      documentId: VersionedCloseInput["documentId"],
    ) => Promise<SessionPortResult<AuthorityRecoveryReport>>
    closeAuthorityCleanly: (input: VersionedCloseInput) => Promise<SessionPortResult<unknown>>
  }>

/** V0 remains disposable runtime data; all V2 writes retain full authored authority. */
export function createAuthorityPersistenceAdapter(
  repository: AuthorityDocumentRepositoryPort,
  createPart: PartAllocationFactory,
  initialSnapshot: DocumentAuthoritySnapshot | null = null,
): PersistentDocumentRepositoryPort &
  Readonly<{
    readonly currentAuthoritySnapshot: DocumentAuthoritySnapshot | null
    authoredMetadata: DocumentAuthoredMetadataPort
    history: DocumentHistoryPort
    semanticHistory: DocumentSemanticHistoryPort
  }> {
  let authority = initialSnapshot && initialSnapshot.schemaVersion !== 1 ? initialSnapshot : null
  let legacy = createVersionedPersistenceAdapter(
    repository,
    initialSnapshot?.schemaVersion === 1 ? initialSnapshot : null,
  )
  const history = new DocumentUndoHistory<AuthoredDocumentSnapshot>()
  const current = () => authority ?? legacy.currentV1Snapshot

  async function persist(
    input: AuthorityCommitInput,
    next: AuthoredDocumentSnapshot,
    record = true,
  ) {
    let result: SessionPortResult<unknown>
    try {
      result = await repository.commitAuthority({
        sessionId: input.sessionId,
        lease: input.lease,
        storedAt: input.storedAt,
        baseSnapshot: input.baseSnapshot,
        event: input.event,
        snapshot: input.snapshot,
      })
    } catch {
      return authorityFailure("persistence-failed", "The authored document change was not saved.")
    }
    if (!result.ok) return result
    if (record) history.record(authority, next)
    authority = next
    const projected = runtimeProjection(next)
    return projected.ok
      ? { ok: true as const, value: projected.snapshot }
      : authorityFailure("invalid-event", projected.diagnostic.message)
  }

  return {
    get currentAuthoritySnapshot() {
      return current()
    },
    authoredMetadata: {
      get snapshot() {
        return current()
      },
      async apply(input) {
        const base = current()
        if (!base) return authorityFailure("document-not-found", "The document does not exist.")
        const match = matchRuntimeProjection(base, input.baseSnapshot)
        if (match) return match
        const parsed = documentAuthoredCommandRequestSchema.safeParse(input.command)
        if (!parsed.success)
          return authorityFailure("invalid-command", "The authored metadata command is invalid.")
        const command =
          parsed.data.kind === "org.vibeshape.document.upgrade-v2"
            ? {
                ...parsed.data,
                payload: {
                  partAllocations: capturePartAllocations(modelProjection(base), [], createPart),
                },
              }
            : parsed.data
        const result =
          command.schemaVersion === 3 || base.schemaVersion === 3
            ? applyDocumentV3Command(base, { ...command, schemaVersion: 3 })
            : applyDocumentV2Command(base, command)
        if (!result.ok) return authorityFailure(result.diagnostic.code, result.diagnostic.message)
        return persist(
          {
            ...input,
            storedAt: result.event.issuedAt,
            baseSnapshot: base,
            event: result.event,
            snapshot: result.snapshot,
          },
          result.snapshot,
        )
      },
    },
    history: {
      get availability() {
        return authority
          ? history.availability
          : (legacy.history?.availability ?? { canUndo: false, canRedo: false })
      },
      async navigate(input) {
        if (!authority)
          return legacy.history
            ? legacy.history.navigate(input)
            : authorityFailure("history-unavailable", "History is unavailable.")
        const base = authority
        const match = matchRuntimeProjection(base, input.baseSnapshot)
        if (match) return match
        const parsed = documentHistoryRequestSchema.safeParse(input.request)
        if (!parsed.success)
          return authorityFailure("invalid-input", "The authored history request is invalid.")
        const result = prepareAuthorityRestore(
          base,
          parsed.data,
          history.target(parsed.data.direction),
        )
        if (!result.ok) return result
        const saved = await persist(
          {
            ...input,
            storedAt: result.event.issuedAt,
            baseSnapshot: base,
            event: result.event,
            snapshot: result.snapshot,
          },
          result.snapshot,
          false,
        )
        if (saved.ok) history.accept(parsed.data.direction)
        return saved
      },
    },
    semanticHistory: {
      get items() {
        return current()?.history ?? []
      },
      async move(input) {
        if (!authority)
          return legacy.semanticHistory
            ? legacy.semanticHistory.move(input)
            : authorityFailure("history-unavailable", "History is unavailable.")
        const base = authority
        const match = matchRuntimeProjection(base, input.baseSnapshot)
        if (match) return match
        const moved = applyVersionedDocumentCommand(modelProjection(base), input.command)
        if (!moved.ok || moved.event.type !== "org.vibeshape.history.item-moved")
          return authorityFailure("invalid-command", "The command is not a valid History move.")
        const result = prepareAuthorityModelEvent(base, moved.event, createPart)
        if (!result.ok) return authorityFailure(result.diagnostic.code, result.diagnostic.message)
        return persist(
          {
            ...input,
            storedAt: result.event.issuedAt,
            baseSnapshot: base,
            event: result.event,
            snapshot: result.snapshot,
          },
          result.snapshot,
        )
      },
    },
    async commit(input) {
      if (!authority) return legacy.commit(input)
      const base = authority
      if (!input.baseSnapshot)
        return authorityFailure(
          "invalid-input",
          "An authored document requires an existing base snapshot.",
        )
      const match = matchRuntimeProjection(base, input.baseSnapshot)
      if (match) return match
      const translated = translateLegacyDocumentEvent(modelProjection(base), input.event)
      if ("ok" in translated) return translated
      const result = prepareAuthorityModelEvent(base, translated, createPart)
      if (!result.ok) return authorityFailure(result.diagnostic.code, result.diagnostic.message)
      const resultMatch = matchRuntimeProjection(result.snapshot, input.snapshot)
      if (resultMatch) return resultMatch
      return persist(
        { ...input, baseSnapshot: base, event: result.event, snapshot: result.snapshot },
        result.snapshot,
      )
    },
    async commitDraft(input) {
      if (!authority) return legacy.commitDraft(input)
      const base = authority
      const match = matchRuntimeProjection(base, input.baseSnapshot)
      if (match) return match
      let next = base
      const events: (DocumentV2Event | DocumentV3Event)[] = []
      for (const event of input.events) {
        const translated = translateLegacyDocumentEvent(modelProjection(next), event)
        if ("ok" in translated) return translated
        const result = prepareAuthorityModelEvent(next, translated, createPart)
        if (!result.ok) return authorityFailure(result.diagnostic.code, result.diagnostic.message)
        next = result.snapshot
        events.push(result.event)
      }
      const resultMatch = matchRuntimeProjection(next, input.snapshot)
      if (resultMatch) return resultMatch
      let saved: SessionPortResult<unknown>
      try {
        saved = await repository.commitAuthorityDraft({
          ...input,
          baseSnapshot: base,
          events,
          snapshot: next,
        })
      } catch {
        return authorityFailure("persistence-failed", "The authored draft was not saved.")
      }
      if (saved.ok) {
        history.record(base, next)
        authority = next
      }
      return saved
    },
    async recover(documentId) {
      let result: SessionPortResult<AuthorityRecoveryReport>
      try {
        result = await repository.recoverAuthority(documentId)
      } catch {
        return authorityFailure(
          "persistence-failed",
          "The authored document could not be recovered.",
        )
      }
      if (!result.ok) return result
      const parsed = documentAuthoritySnapshotSchema.safeParse(result.value.snapshot)
      if (!parsed.success)
        return authorityFailure("invalid-recovered-document", "The recovered authority is invalid.")
      const projected = runtimeProjection(parsed.data)
      if (!projected.ok)
        return authorityFailure("invalid-recovered-document", projected.diagnostic.message)
      authority = parsed.data.schemaVersion !== 1 ? parsed.data : null
      legacy = createVersionedPersistenceAdapter(
        repository,
        parsed.data.schemaVersion === 1 ? parsed.data : null,
      )
      history.clear()
      return {
        ok: true,
        value: {
          ...result.value,
          snapshot: projected.snapshot,
          migration: {
            provenance: result.value.migration.migrationProvenance,
            diagnostic: result.value.migration.migrationDiagnostic,
            unavailableRecords: result.value.migration.unavailableRecords,
          },
        },
      }
    },
    async closeCleanly(input) {
      if (!authority) return legacy.closeCleanly(input)
      try {
        return await repository.closeAuthorityCleanly(input)
      } catch {
        return authorityFailure(
          "persistence-failed",
          "The authored document could not close cleanly.",
        )
      }
    },
  }
}
