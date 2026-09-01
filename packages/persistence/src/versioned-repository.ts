import {
  canonicalJson,
  commandActorsEqual,
  type DocumentId,
  type DocumentSnapshotV1,
  documentIdSchema,
  documentSnapshotV1Schema,
  reduceVersionedDocumentEvent,
  sessionIdSchema,
  type VersionedDocumentEvent,
  versionedDocumentEventSchema,
} from "@vibeshape/domain"
import { z } from "zod"
import type { VibeShapeDatabase } from "./database"
import {
  classifyPersistenceError,
  createPersistenceDiagnostic,
  persistenceInvariantError,
} from "./diagnostics"
import {
  authoritativeProjectCatalog,
  requireAuthoritativeProject,
  summarizeProjects,
} from "./project-catalog"
import {
  type CommitReport,
  type DraftCommitReport,
  LocalDocumentRepository,
  type MigratedRecoveryReport,
  type PersistenceResult,
  type ProjectDeleteReport,
  type ProjectThumbnailCopyReport,
  type ProjectThumbnailWriteReport,
} from "./repository"
import {
  type EventRecordV1,
  eventRecordV1Schema,
  type LocalProjectSummary,
  type ProjectRecord,
  type ProjectRecordV1,
  persistencePromotionInputSchema,
  persistenceV1CommitInputSchema,
  persistenceV1DraftCommitInputSchema,
  projectDeleteInputSchema,
  projectRecordSchema,
  projectRecordV1Schema,
  projectThumbnailCopyInputSchema,
  projectThumbnailRecordSchema,
  projectThumbnailWriteInputSchema,
  type RecoveryRecordV1,
  recoveryRecordV1Schema,
  type SnapshotRecordV1,
  snapshotRecordV1Schema,
  writerLeaseClaimSchema,
} from "./schemas"
import { parseStoredRecordPayload, serializeStoredRecord } from "./stored-record-codec"
import { hasValidWriterLease, requireWriterLease } from "./writer-lease-authority"

const versionedCleanCloseInputSchema = z
  .object({
    documentId: documentIdSchema,
    revision: z.number().int().nonnegative().safe(),
    sessionId: sessionIdSchema,
    lease: writerLeaseClaimSchema,
  })
  .strict()

export interface VersionedRecoveryReport {
  status: "clean" | "recovered" | "recovered-with-loss"
  snapshot: DocumentSnapshotV1
  headRevision: number
  recoveredRevision: number
  lostRevisionCount: number
  corruptRecords: string[]
  migration: Pick<
    ProjectRecordV1,
    "migrationProvenance" | "migrationDiagnostic" | "unavailableRecords"
  >
}

export interface PromotionReport {
  documentId: DocumentId
  revision: number
  snapshotChecksum: string
  migrationProvenance: ProjectRecordV1["migrationProvenance"]
}

function validateCommitRelationship(
  baseSnapshot: DocumentSnapshotV1 | null,
  event: VersionedDocumentEvent,
  snapshot: DocumentSnapshotV1,
) {
  const reduced = reduceVersionedDocumentEvent(baseSnapshot, event)
  if (!reduced.ok || canonicalJson(reduced.snapshot) !== canonicalJson(snapshot))
    throw persistenceInvariantError(
      "invalid-input",
      "The supplied versioned snapshot is not the event result.",
    )
}

function validateDraftRelationship(
  input: ReturnType<typeof persistenceV1DraftCommitInputSchema.parse>,
) {
  let snapshot: DocumentSnapshotV1 | null = input.baseSnapshot
  const firstEvent = input.events[0]
  for (const event of input.events) {
    if (event.transactionId !== input.transactionId)
      throw persistenceInvariantError(
        "invalid-input",
        "Every versioned draft event must use the supplied transaction ID.",
      )
    if (event.documentId !== input.snapshot.id || event.documentId !== input.baseSnapshot.id)
      throw persistenceInvariantError(
        "invalid-input",
        "Every versioned draft event must target the supplied document.",
      )
    if (firstEvent && !commandActorsEqual(firstEvent.actor, event.actor))
      throw persistenceInvariantError(
        "invalid-input",
        "Every versioned draft event must use the same actor.",
      )
    const reduced = reduceVersionedDocumentEvent(snapshot, event)
    if (!reduced.ok)
      throw persistenceInvariantError(
        "invalid-input",
        "The versioned draft event sequence cannot be replayed.",
      )
    snapshot = reduced.snapshot
  }
  if (canonicalJson(snapshot) !== canonicalJson(input.snapshot))
    throw persistenceInvariantError(
      "invalid-input",
      "The supplied snapshot is not the versioned draft event sequence result.",
    )
}

function projectForCommit(
  current: ProjectRecordV1 | undefined,
  snapshot: DocumentSnapshotV1,
  storedAt: string,
) {
  return projectRecordV1Schema.parse({
    schemaVersion: 1,
    documentId: snapshot.id,
    name: snapshot.name,
    headRevision: snapshot.revision,
    latestSnapshotRevision: snapshot.revision,
    cleanCloseRevision: null,
    createdAt: current?.createdAt ?? snapshot.createdAt,
    updatedAt: storedAt,
    lastExternalBackupAt: current?.lastExternalBackupAt ?? null,
    migrationProvenance: "current",
    migrationDiagnostic: null,
    unavailableRecords: [],
  })
}

function projectForPromotion(input: ReturnType<typeof persistencePromotionInputSchema.parse>) {
  return projectRecordV1Schema.parse({
    schemaVersion: 1,
    documentId: input.snapshot.id,
    name: input.snapshot.name,
    headRevision: input.snapshot.revision,
    latestSnapshotRevision: input.snapshot.revision,
    cleanCloseRevision: null,
    createdAt: input.snapshot.createdAt,
    updatedAt: input.storedAt,
    lastExternalBackupAt: null,
    migrationProvenance: input.migrationProvenance,
    migrationDiagnostic: input.migrationDiagnostic,
    unavailableRecords: input.unavailableRecords,
  })
}

function requirePromotionMatchesRecovery(
  input: ReturnType<typeof persistencePromotionInputSchema.parse>,
  recovered: MigratedRecoveryReport,
) {
  if (recovered.lostRevisionCount > 0)
    throw persistenceInvariantError(
      "corrupt-history",
      "Versioned promotion requires a complete recovered legacy head.",
    )
  const supplied = canonicalJson({
    headRevision: input.sourceHeadRevision,
    snapshot: input.snapshot,
    migration: {
      provenance: input.migrationProvenance,
      diagnostic: input.migrationDiagnostic,
      unavailableRecords: input.unavailableRecords,
    },
  })
  const authoritative = canonicalJson({
    headRevision: recovered.headRevision,
    snapshot: recovered.snapshot,
    migration: recovered.migration,
  })
  if (supplied !== authoritative)
    throw persistenceInvariantError(
      "stale-revision",
      "The legacy recovery result changed before versioned promotion.",
    )
}

function recoveryForCommit(
  input: Readonly<{
    sessionId: string
    storedAt: string
    snapshot: DocumentSnapshotV1
  }>,
  current: RecoveryRecordV1 | undefined,
  project: ProjectRecordV1,
) {
  return recoveryRecordV1Schema.parse({
    schemaVersion: 1,
    documentId: input.snapshot.id,
    sessionId: input.sessionId,
    openedAt: current?.openedAt ?? input.storedAt,
    updatedAt: input.storedAt,
    lastConfirmedRevision: input.snapshot.revision,
    migrationProvenance: project.migrationProvenance,
    migrationDiagnostic: project.migrationDiagnostic,
    unavailableRecords: project.unavailableRecords,
  })
}

async function storedSnapshot(snapshot: DocumentSnapshotV1, storedAt: string) {
  const serialized = await serializeStoredRecord(snapshot)
  return snapshotRecordV1Schema.parse({
    schemaVersion: 1,
    documentId: snapshot.id,
    revision: snapshot.revision,
    storedAt,
    ...serialized,
  })
}

async function storedEvent(event: VersionedDocumentEvent, storedAt: string) {
  const serialized = await serializeStoredRecord(event)
  return eventRecordV1Schema.parse({
    schemaVersion: 1,
    documentId: event.documentId,
    revision: event.revision,
    commandId: event.commandId,
    storedAt,
    ...serialized,
  })
}

async function storedDraftRecords(
  events: readonly VersionedDocumentEvent[],
  snapshot: DocumentSnapshotV1,
  storedAt: string,
) {
  return {
    events: await Promise.all(events.map((event) => storedEvent(event, storedAt))),
    snapshot: await storedSnapshot(snapshot, storedAt),
  }
}

function requireCurrentRevision(current: ProjectRecordV1 | undefined, baseRevision: number) {
  if (!current)
    throw persistenceInvariantError("document-not-found", "The versioned document does not exist.")
  if (current.headRevision !== baseRevision)
    throw persistenceInvariantError(
      "stale-revision",
      "The persisted versioned document revision changed.",
    )
}

function parseCurrentProject(record: ProjectRecordV1 | undefined) {
  if (!record) return undefined
  const project = projectRecordV1Schema.safeParse(record)
  if (!project.success)
    throw persistenceInvariantError("corrupt-history", "The versioned project head is invalid.")
  return project.data
}

function requireNewDocument(
  current: ProjectRecordV1 | undefined,
  legacy: ProjectRecord | undefined,
) {
  if (current || legacy)
    throw persistenceInvariantError("document-already-exists", "The document already exists.")
}

async function validStoredSnapshot(record: SnapshotRecordV1) {
  const parsed = snapshotRecordV1Schema.safeParse(record)
  if (!parsed.success) return null
  const snapshot = await parseStoredRecordPayload(parsed.data, documentSnapshotV1Schema)
  return snapshot &&
    snapshot.id === parsed.data.documentId &&
    snapshot.revision === parsed.data.revision
    ? snapshot
    : null
}

async function validStoredEvent(record: EventRecordV1) {
  const parsed = eventRecordV1Schema.safeParse(record)
  if (!parsed.success) return null
  const event = await parseStoredRecordPayload(parsed.data, versionedDocumentEventSchema)
  return event &&
    event.documentId === parsed.data.documentId &&
    event.revision === parsed.data.revision &&
    event.commandId === parsed.data.commandId
    ? event
    : null
}

async function latestValidSnapshot(records: readonly SnapshotRecordV1[]) {
  const corruptRecords: string[] = []
  for (const record of records) {
    const snapshot = await validStoredSnapshot(record)
    if (snapshot) return { snapshot, corruptRecords }
    corruptRecords.push(`snapshot-v1:${record.revision}`)
  }
  return { snapshot: null, corruptRecords }
}

async function replayStoredSuffix(
  snapshot: DocumentSnapshotV1 | null,
  records: readonly EventRecordV1[],
  corruptRecords: string[],
  headRevision: number,
) {
  let current = snapshot
  let expectedRevision = (snapshot?.revision ?? 0) + 1
  for (const record of records) {
    const reduced = await replayStoredEvent(current, record, expectedRevision)
    if (!reduced) {
      corruptRecords.push(`event-v1:${expectedRevision}`)
      break
    }
    current = reduced
    expectedRevision += 1
  }
  if (current && current.revision < headRevision && corruptRecords.length === 0)
    corruptRecords.push(`event-v1:${expectedRevision}`)
  return current
}

async function replayStoredEvent(
  snapshot: DocumentSnapshotV1 | null,
  record: EventRecordV1,
  expectedRevision: number,
) {
  if (record.revision !== expectedRevision) return null
  const event = await validStoredEvent(record)
  if (!event) return null
  const reduced = reduceVersionedDocumentEvent(snapshot, event)
  return reduced.ok ? reduced.snapshot : null
}

function recoveryStatus(lostRevisionCount: number, markerPresent: boolean) {
  if (lostRevisionCount > 0) return "recovered-with-loss" as const
  return markerPresent ? ("recovered" as const) : ("clean" as const)
}

function versionedSemanticWriteTransaction(
  database: VibeShapeDatabase,
  operation: () => Promise<void>,
) {
  return database.transaction(
    "rw",
    [
      database.projects,
      database.projectsV1,
      database.eventsV1,
      database.snapshotsV1,
      database.recoveryV1,
      database.leases,
    ],
    operation,
  )
}

async function requireStoredVersionedProject(database: VibeShapeDatabase, documentId: DocumentId) {
  const record = await database.projectsV1.get(documentId)
  if (!record)
    throw persistenceInvariantError("document-not-found", "The versioned document does not exist.")
  const project = projectRecordV1Schema.safeParse(record)
  if (!project.success)
    throw persistenceInvariantError("corrupt-history", "The versioned project head is invalid.")
  return project.data
}

async function recoverVersionedSnapshot(database: VibeShapeDatabase, project: ProjectRecordV1) {
  const snapshots = (
    await database.snapshotsV1
      .where("[documentId+revision]")
      .between(
        [project.documentId, 0],
        [project.documentId, project.latestSnapshotRevision],
        true,
        true,
      )
      .toArray()
  ).sort((left, right) => right.revision - left.revision)
  const valid = await latestValidSnapshot(snapshots)
  const baseRevision = valid.snapshot?.revision ?? 0
  const events = await database.eventsV1
    .where("[documentId+revision]")
    .between(
      [project.documentId, baseRevision + 1],
      [project.documentId, project.headRevision],
      true,
      true,
    )
    .sortBy("revision")
  const snapshot = await replayStoredSuffix(
    valid.snapshot,
    events,
    valid.corruptRecords,
    project.headRevision,
  )
  if (!snapshot)
    throw persistenceInvariantError(
      "corrupt-history",
      "No valid versioned document revision remains.",
    )
  return { snapshot, corruptRecords: valid.corruptRecords }
}

async function recoveryMarkerPresent(
  database: VibeShapeDatabase,
  documentId: DocumentId,
  corruptRecords: string[],
) {
  const marker = await database.recoveryV1.get(documentId)
  if (!marker) return false
  if (!recoveryRecordV1Schema.safeParse(marker).success) corruptRecords.push("recovery-v1")
  return true
}

async function deleteProjectSemanticRecords(database: VibeShapeDatabase, documentId: DocumentId) {
  const deletedEventCount =
    (await database.events.where("documentId").equals(documentId).delete()) +
    (await database.eventsV1.where("documentId").equals(documentId).delete())
  const deletedSnapshotCount =
    (await database.snapshots.where("documentId").equals(documentId).delete()) +
    (await database.snapshotsV1.where("documentId").equals(documentId).delete())
  const thumbnail = await database.projectThumbnails.get(documentId)
  await database.projectThumbnails.delete(documentId)
  await database.recovery.delete(documentId)
  await database.recoveryV1.delete(documentId)
  await database.leases.delete(documentId)
  await database.projects.delete(documentId)
  await database.projectsV1.delete(documentId)
  return {
    deletedEventCount,
    deletedSnapshotCount,
    deletedThumbnailCount: thumbnail ? 1 : 0,
  }
}

export class VersionedLocalDocumentRepository {
  constructor(readonly database: VibeShapeDatabase) {}

  // fallow-ignore-next-line unused-class-member -- Consumed by the versioned application project lifecycle.
  async listProjects(): Promise<PersistenceResult<readonly LocalProjectSummary[]>> {
    try {
      const projects = await authoritativeProjectCatalog(this.database)
      return { ok: true, value: await summarizeProjects(this.database, projects) }
    } catch (error) {
      return { ok: false, diagnostic: classifyPersistenceError(error) }
    }
  }

  // fallow-ignore-next-line unused-class-member -- Consumed through the workspace package export.
  async promote(inputValue: unknown): Promise<PersistenceResult<PromotionReport>> {
    const input = persistencePromotionInputSchema.safeParse(inputValue)
    if (!input.success)
      return {
        ok: false,
        diagnostic: createPersistenceDiagnostic(
          "invalid-input",
          "The versioned persistence promotion is invalid.",
        ),
      }
    const recovered = await new LocalDocumentRepository(this.database).recoverMigrated(
      input.data.snapshot.id,
    )
    if (!recovered.ok) return recovered
    try {
      requirePromotionMatchesRecovery(input.data, recovered.value)
      const snapshot = await storedSnapshot(input.data.snapshot, input.data.storedAt)
      const project = projectForPromotion(input.data)
      await versionedSemanticWriteTransaction(this.database, async () => {
        const legacyRecord = await this.database.projects.get(input.data.snapshot.id)
        if (!legacyRecord)
          throw persistenceInvariantError(
            "document-not-found",
            "The legacy source document does not exist.",
          )
        const legacy = projectRecordSchema.safeParse(legacyRecord)
        if (!legacy.success)
          throw persistenceInvariantError(
            "corrupt-history",
            "The legacy source project head is invalid.",
          )
        if (legacy.data.headRevision !== input.data.sourceHeadRevision)
          throw persistenceInvariantError(
            "stale-revision",
            "The legacy source document changed before promotion.",
          )
        if (await this.database.projectsV1.get(input.data.snapshot.id))
          throw persistenceInvariantError(
            "document-already-exists",
            "The versioned document already exists.",
          )
        const lease = await this.database.leases.get(input.data.snapshot.id)
        requireWriterLease(true, lease, input.data)
        const publishedProject = projectRecordV1Schema.parse({
          ...project,
          lastExternalBackupAt: legacy.data.lastExternalBackupAt,
        })
        await this.database.snapshotsV1.add(snapshot)
        await this.database.projectsV1.add(publishedProject)
        await this.database.recoveryV1.add(
          recoveryForCommit(input.data, undefined, publishedProject),
        )
      })
      return {
        ok: true,
        value: {
          documentId: input.data.snapshot.id,
          revision: input.data.snapshot.revision,
          snapshotChecksum: snapshot.checksum,
          migrationProvenance: project.migrationProvenance,
        },
      }
    } catch (error) {
      return { ok: false, diagnostic: classifyPersistenceError(error) }
    }
  }

  // fallow-ignore-next-line unused-class-member -- Consumed through the workspace package export.
  async commit(inputValue: unknown): Promise<PersistenceResult<CommitReport>> {
    const input = persistenceV1CommitInputSchema.safeParse(inputValue)
    if (!input.success)
      return {
        ok: false,
        diagnostic: createPersistenceDiagnostic(
          "invalid-input",
          "The versioned persistence commit is invalid.",
        ),
      }
    try {
      validateCommitRelationship(input.data.baseSnapshot, input.data.event, input.data.snapshot)
      const event = await storedEvent(input.data.event, input.data.storedAt)
      const snapshot = await storedSnapshot(input.data.snapshot, input.data.storedAt)
      await versionedSemanticWriteTransaction(this.database, async () => {
        const current = parseCurrentProject(
          await this.database.projectsV1.get(input.data.snapshot.id),
        )
        const legacy = await this.database.projects.get(input.data.snapshot.id)
        const lease = await this.database.leases.get(input.data.snapshot.id)
        if (input.data.event.baseRevision === 0) requireNewDocument(current, legacy)
        else requireCurrentRevision(current, input.data.event.baseRevision)
        requireWriterLease(current !== undefined, lease, input.data)
        const project = projectForCommit(current, input.data.snapshot, input.data.storedAt)
        const recovery = await this.database.recoveryV1.get(input.data.snapshot.id)
        await this.database.eventsV1.add(event)
        await this.database.snapshotsV1.add(snapshot)
        await this.database.projectsV1.put(project)
        await this.database.recoveryV1.put(recoveryForCommit(input.data, recovery, project))
      })
      return {
        ok: true,
        value: {
          documentId: input.data.snapshot.id,
          revision: input.data.snapshot.revision,
          eventChecksum: event.checksum,
          snapshotChecksum: snapshot.checksum,
        },
      }
    } catch (error) {
      return { ok: false, diagnostic: classifyPersistenceError(error) }
    }
  }

  // fallow-ignore-next-line unused-class-member -- Reserved by the application persistence port.
  async commitDraft(inputValue: unknown): Promise<PersistenceResult<DraftCommitReport>> {
    const input = persistenceV1DraftCommitInputSchema.safeParse(inputValue)
    if (!input.success)
      return {
        ok: false,
        diagnostic: createPersistenceDiagnostic(
          "invalid-input",
          "The versioned draft persistence commit is invalid.",
        ),
      }
    try {
      validateDraftRelationship(input.data)
      const records = await storedDraftRecords(
        input.data.events,
        input.data.snapshot,
        input.data.storedAt,
      )
      await versionedSemanticWriteTransaction(this.database, async () => {
        const current = parseCurrentProject(
          await this.database.projectsV1.get(input.data.snapshot.id),
        )
        const lease = await this.database.leases.get(input.data.snapshot.id)
        requireCurrentRevision(current, input.data.baseSnapshot.revision)
        requireWriterLease(true, lease, input.data)
        const project = projectForCommit(current, input.data.snapshot, input.data.storedAt)
        const recovery = await this.database.recoveryV1.get(input.data.snapshot.id)
        await this.database.eventsV1.bulkAdd(records.events)
        await this.database.snapshotsV1.add(records.snapshot)
        await this.database.projectsV1.put(project)
        await this.database.recoveryV1.put(recoveryForCommit(input.data, recovery, project))
      })
      return {
        ok: true,
        value: {
          documentId: input.data.snapshot.id,
          revision: input.data.snapshot.revision,
          eventChecksums: records.events.map(({ checksum }) => checksum),
          snapshotChecksum: records.snapshot.checksum,
        },
      }
    } catch (error) {
      return { ok: false, diagnostic: classifyPersistenceError(error) }
    }
  }

  // fallow-ignore-next-line unused-class-member -- Consumed through the workspace package export.
  async recover(documentIdInput: unknown): Promise<PersistenceResult<VersionedRecoveryReport>> {
    const documentId = documentIdSchema.safeParse(documentIdInput)
    if (!documentId.success)
      return {
        ok: false,
        diagnostic: createPersistenceDiagnostic("invalid-input", "The document ID is invalid."),
      }
    try {
      const project = await requireStoredVersionedProject(this.database, documentId.data)
      const recovered = await recoverVersionedSnapshot(this.database, project)
      const markerPresent = await recoveryMarkerPresent(
        this.database,
        documentId.data,
        recovered.corruptRecords,
      )
      const lostRevisionCount = project.headRevision - recovered.snapshot.revision
      return {
        ok: true,
        value: {
          status: recoveryStatus(lostRevisionCount, markerPresent),
          snapshot: recovered.snapshot,
          headRevision: project.headRevision,
          recoveredRevision: recovered.snapshot.revision,
          lostRevisionCount,
          corruptRecords: recovered.corruptRecords,
          migration: {
            migrationProvenance: project.migrationProvenance,
            migrationDiagnostic: project.migrationDiagnostic,
            unavailableRecords: project.unavailableRecords,
          },
        },
      }
    } catch (error) {
      return { ok: false, diagnostic: classifyPersistenceError(error) }
    }
  }

  // fallow-ignore-next-line unused-class-member -- Reserved by the application persistence port.
  async closeCleanly(inputValue: unknown): Promise<PersistenceResult<void>> {
    const input = versionedCleanCloseInputSchema.safeParse(inputValue)
    if (!input.success)
      return {
        ok: false,
        diagnostic: createPersistenceDiagnostic(
          "invalid-input",
          "The versioned clean-close input is invalid.",
        ),
      }
    try {
      await this.database.transaction(
        "rw",
        this.database.projectsV1,
        this.database.recoveryV1,
        this.database.leases,
        async () => {
          const record = await this.database.projectsV1.get(input.data.documentId)
          if (!record)
            throw persistenceInvariantError(
              "document-not-found",
              "The versioned document does not exist.",
            )
          const project = projectRecordV1Schema.parse(record)
          if (project.headRevision !== input.data.revision)
            throw persistenceInvariantError(
              "stale-revision",
              "The versioned clean-close revision is stale.",
            )
          const lease = await this.database.leases.get(input.data.documentId)
          if (!hasValidWriterLease(lease, input.data.sessionId, input.data.lease))
            throw persistenceInvariantError(
              "lease-lost",
              "The document writer lease is no longer valid.",
            )
          await this.database.projectsV1.put({
            ...project,
            cleanCloseRevision: project.headRevision,
          })
          await this.database.recoveryV1.delete(input.data.documentId)
        },
      )
      return { ok: true, value: undefined }
    } catch (error) {
      return { ok: false, diagnostic: classifyPersistenceError(error) }
    }
  }

  // fallow-ignore-next-line unused-class-member -- Consumed by the versioned application project lifecycle.
  async writeProjectThumbnail(
    inputValue: unknown,
  ): Promise<PersistenceResult<ProjectThumbnailWriteReport>> {
    const input = projectThumbnailWriteInputSchema.safeParse(inputValue)
    if (!input.success)
      return {
        ok: false,
        diagnostic: createPersistenceDiagnostic(
          "invalid-input",
          "The project thumbnail write is invalid.",
        ),
      }
    try {
      await this.database.transaction(
        "rw",
        this.database.projects,
        this.database.projectsV1,
        this.database.projectThumbnails,
        async () => {
          const project = await requireAuthoritativeProject(this.database, input.data.documentId)
          if (project.headRevision !== input.data.revision)
            throw persistenceInvariantError(
              "stale-revision",
              "The project changed before its thumbnail could be stored.",
            )
          await this.database.projectThumbnails.put(
            projectThumbnailRecordSchema.parse({ schemaVersion: 0, ...input.data }),
          )
        },
      )
      return {
        ok: true,
        value: { documentId: input.data.documentId, revision: input.data.revision },
      }
    } catch (error) {
      return { ok: false, diagnostic: classifyPersistenceError(error) }
    }
  }

  // fallow-ignore-next-line unused-class-member -- Consumed by the versioned application project lifecycle.
  async copyProjectThumbnail(
    inputValue: unknown,
  ): Promise<PersistenceResult<ProjectThumbnailCopyReport>> {
    const input = projectThumbnailCopyInputSchema.safeParse(inputValue)
    if (!input.success)
      return {
        ok: false,
        diagnostic: createPersistenceDiagnostic(
          "invalid-input",
          "The project thumbnail copy is invalid.",
        ),
      }
    try {
      let status: ProjectThumbnailCopyReport["status"] = "unavailable"
      await this.database.transaction(
        "rw",
        this.database.projects,
        this.database.projectsV1,
        this.database.projectThumbnails,
        async () => {
          const source = await requireAuthoritativeProject(
            this.database,
            input.data.sourceDocumentId,
          )
          const target = await requireAuthoritativeProject(
            this.database,
            input.data.targetDocumentId,
          )
          if (
            source.headRevision !== input.data.sourceRevision ||
            target.headRevision !== input.data.targetRevision
          )
            throw persistenceInvariantError(
              "stale-revision",
              "A project changed before its thumbnail could be copied.",
            )
          const sourceThumbnail = projectThumbnailRecordSchema.safeParse(
            await this.database.projectThumbnails.get(input.data.sourceDocumentId),
          )
          if (!sourceThumbnail.success || sourceThumbnail.data.revision !== source.headRevision)
            return
          await this.database.projectThumbnails.put({
            ...sourceThumbnail.data,
            documentId: target.documentId,
            revision: target.headRevision,
            generatedAt: input.data.generatedAt,
            bytes: Uint8Array.from(sourceThumbnail.data.bytes),
          })
          status = "copied"
        },
      )
      return { ok: true, value: { status } }
    } catch (error) {
      return { ok: false, diagnostic: classifyPersistenceError(error) }
    }
  }

  // fallow-ignore-next-line unused-class-member -- Reserved by the application project lifecycle.
  async deleteProject(inputValue: unknown): Promise<PersistenceResult<ProjectDeleteReport>> {
    const input = projectDeleteInputSchema.safeParse(inputValue)
    if (!input.success)
      return {
        ok: false,
        diagnostic: createPersistenceDiagnostic(
          "invalid-input",
          "The versioned project deletion input is invalid.",
        ),
      }
    try {
      let deletedCounts = {
        deletedEventCount: 0,
        deletedSnapshotCount: 0,
        deletedThumbnailCount: 0,
      }
      await this.database.transaction(
        "rw",
        [
          this.database.projects,
          this.database.projectsV1,
          this.database.events,
          this.database.eventsV1,
          this.database.snapshots,
          this.database.snapshotsV1,
          this.database.recovery,
          this.database.recoveryV1,
          this.database.leases,
          this.database.projectThumbnails,
        ],
        async () => {
          const project = await requireAuthoritativeProject(this.database, input.data.documentId)
          if (project.headRevision !== input.data.expectedHeadRevision)
            throw persistenceInvariantError(
              "stale-revision",
              "The versioned project changed before it could be deleted.",
            )
          const lease = await this.database.leases.get(input.data.documentId)
          if (lease && lease.expiresAt > input.data.nowMs)
            throw persistenceInvariantError(
              "lease-held",
              "The project is open for writing in another browser tab.",
            )
          deletedCounts = await deleteProjectSemanticRecords(this.database, input.data.documentId)
        },
      )
      return {
        ok: true,
        value: {
          documentId: input.data.documentId,
          ...deletedCounts,
        },
      }
    } catch (error) {
      return { ok: false, diagnostic: classifyPersistenceError(error) }
    }
  }
}
