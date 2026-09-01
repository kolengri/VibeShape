import {
  type DocumentId,
  type DocumentSnapshotV1,
  documentIdSchema,
  type SessionId,
  sessionIdSchema,
} from "@vibeshape/domain"
import type { FeatureMeshPolicy } from "@vibeshape/protocol"
import {
  type DocumentLeasePort,
  openPersistentDocumentSession,
  type PersistedRecoveryMigration,
  type PersistentDocumentRepositoryPort,
  type PersistentDocumentSessionDependencies,
  type PersistentDocumentSessionOpenResult,
  type SessionPortDiagnostic,
} from "./persistent-document-session"
import {
  createVersionedPersistenceAdapter,
  type VersionedDocumentRepositoryPort,
  type VersionedRecoveryReport,
} from "./versioned-persistence-adapter"

export type VersionedPromotionInput = Readonly<{
  sessionId: SessionId
  lease: { epoch: number; nowMs: number }
  storedAt: string
  sourceHeadRevision: number
  snapshot: DocumentSnapshotV1
  migrationProvenance: "journal-derived" | "snapshot-derived"
  migrationDiagnostic: Readonly<{ code: string; message: string }> | null
  unavailableRecords: readonly string[]
}>

export type VersionedPromotionPort = Readonly<{
  promote: (input: VersionedPromotionInput) => Promise<VersionedPromotionResult<unknown>>
}>

export type VersionedPromotionResult<Value> =
  | Readonly<{ ok: true; value: Value }>
  | Readonly<{ ok: false; diagnostic: SessionPortDiagnostic }>

export type MigratedLegacyRecoveryReport = Readonly<{
  status: "clean" | "recovered" | "recovered-with-loss"
  snapshot: DocumentSnapshotV1
  headRevision: number
  recoveredRevision: number
  lostRevisionCount: number
  corruptRecords: readonly string[]
  migration: Readonly<{
    provenance: PersistedRecoveryMigration["provenance"]
    diagnostic: PersistedRecoveryMigration["diagnostic"]
    unavailableRecords: readonly string[]
  }>
}>

export type VersionedDocumentSessionDependencies = Readonly<{
  legacyRepository: PersistentDocumentRepositoryPort & {
    recoverMigrated: (
      documentId: DocumentId,
    ) => Promise<
      | { ok: true; value: MigratedLegacyRecoveryReport }
      | { ok: false; diagnostic: SessionPortDiagnostic }
    >
  }
  versionedRepository: VersionedDocumentRepositoryPort & VersionedPromotionPort
  leases: DocumentLeasePort
  commandDispatcher: PersistentDocumentSessionDependencies["commandDispatcher"]
  createRebuildPort: PersistentDocumentSessionDependencies["createRebuildPort"]
  now: () => number
}>

function cachedVersionedRepository(
  repository: VersionedDocumentRepositoryPort,
  recovery: VersionedRecoveryReport,
): VersionedDocumentRepositoryPort {
  let first = true
  return {
    commit: (input) => repository.commit(input),
    commitDraft: (input) => repository.commitDraft(input),
    closeCleanly: (input) => repository.closeCleanly(input),
    recover: async (documentId) => {
      if (first) {
        first = false
        return { ok: true, value: recovery }
      }
      return repository.recover(documentId)
    },
  }
}

function readOnlyLeases(source: DocumentLeasePort): DocumentLeasePort {
  return {
    acquire: async () => ({
      ok: false,
      diagnostic: {
        code: "write-access-unavailable",
        message: "The legacy document requires versioned promotion before it can be edited.",
        retryable: true,
      },
    }),
    release: source.release,
  }
}

function versionedRecoveryFromMigration(
  migrated: MigratedLegacyRecoveryReport,
): VersionedRecoveryReport {
  return {
    ...migrated,
    migration: {
      migrationProvenance: migrated.migration.provenance,
      migrationDiagnostic: migrated.migration.diagnostic,
      unavailableRecords: migrated.migration.unavailableRecords,
    },
  }
}

function openMigratedReadOnly(
  dependencies: VersionedDocumentSessionDependencies,
  input: Readonly<{
    documentId: DocumentId
    sessionId: SessionId
    mesh: FeatureMeshPolicy
    leaseDurationMs?: number
  }>,
  migrated: MigratedLegacyRecoveryReport,
) {
  const adapter = createVersionedPersistenceAdapter(
    cachedVersionedRepository(
      dependencies.versionedRepository,
      versionedRecoveryFromMigration(migrated),
    ),
    migrated.snapshot,
  )
  return openPersistentDocumentSession(
    { ...dependencies, repository: adapter, leases: readOnlyLeases(dependencies.leases) },
    input,
  )
}

export async function openVersionedDocumentSession(
  dependencies: VersionedDocumentSessionDependencies,
  input: Readonly<{
    documentId: DocumentId
    sessionId: SessionId
    mesh: FeatureMeshPolicy
    leaseDurationMs?: number
    storedAt: string
  }>,
): Promise<PersistentDocumentSessionOpenResult> {
  const documentId = documentIdSchema.safeParse(input.documentId)
  const sessionId = sessionIdSchema.safeParse(input.sessionId)
  if (!documentId.success || !sessionId.success)
    return {
      ok: false,
      diagnostic: {
        code: "invalid-session-input",
        message: "The versioned document open request is invalid.",
        retryable: false,
        sourceCode: null,
      },
    }

  const sessionInput = {
    documentId: documentId.data,
    sessionId: sessionId.data,
    mesh: input.mesh,
    ...(input.leaseDurationMs === undefined ? {} : { leaseDurationMs: input.leaseDurationMs }),
  }

  const versioned = await dependencies.versionedRepository.recover(documentId.data)
  if (versioned.ok) {
    const adapter = createVersionedPersistenceAdapter(
      cachedVersionedRepository(dependencies.versionedRepository, versioned.value),
      versioned.value.snapshot,
    )
    return openPersistentDocumentSession({ ...dependencies, repository: adapter }, sessionInput)
  }
  if (versioned.diagnostic.code !== "document-not-found")
    return {
      ok: false,
      diagnostic: {
        code: "persistence-failed",
        message: "The versioned document could not be recovered.",
        retryable: versioned.diagnostic.retryable,
        sourceCode: versioned.diagnostic.code,
      },
    }

  const migrated = await dependencies.legacyRepository.recoverMigrated(documentId.data)
  if (!migrated.ok)
    return {
      ok: false,
      diagnostic: {
        code: "persistence-failed",
        message: "The saved document could not be recovered.",
        retryable: migrated.diagnostic.retryable,
        sourceCode: migrated.diagnostic.code,
      },
    }

  const complete =
    migrated.value.status !== "recovered-with-loss" && migrated.value.lostRevisionCount === 0
  if (!complete) return openMigratedReadOnly(dependencies, sessionInput, migrated.value)

  const nowMs = dependencies.now()
  const lease = await dependencies.leases.acquire({
    documentId: documentId.data,
    ownerId: sessionId.data,
    nowMs,
    durationMs: input.leaseDurationMs ?? 30_000,
  })
  if (!lease.ok) return openMigratedReadOnly(dependencies, sessionInput, migrated.value)

  const promotion = await dependencies.versionedRepository.promote({
    sessionId: sessionId.data,
    lease: { epoch: lease.value.lease.epoch, nowMs },
    storedAt: input.storedAt,
    sourceHeadRevision: migrated.value.headRevision,
    snapshot: migrated.value.snapshot,
    migrationProvenance:
      migrated.value.migration.provenance === "snapshot-derived"
        ? "snapshot-derived"
        : "journal-derived",
    migrationDiagnostic: migrated.value.migration.diagnostic,
    unavailableRecords: migrated.value.migration.unavailableRecords,
  })
  if (!promotion.ok) {
    await dependencies.leases.release({
      documentId: documentId.data,
      ownerId: sessionId.data,
      nowMs,
    })
    return openMigratedReadOnly(dependencies, sessionInput, migrated.value)
  }

  const recovery = versionedRecoveryFromMigration(migrated.value)
  const adapter = createVersionedPersistenceAdapter(
    cachedVersionedRepository(dependencies.versionedRepository, recovery),
    migrated.value.snapshot,
  )
  return openPersistentDocumentSession({ ...dependencies, repository: adapter }, sessionInput)
}
