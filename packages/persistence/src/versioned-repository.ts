import {
  canonicalJson,
  commandActorsEqual,
  type DocumentEvent,
  type DocumentId,
  type DocumentSnapshot,
  type DocumentSnapshotV1,
  documentIdSchema,
  documentSnapshotV1Schema,
  migrateDocumentSnapshot,
  reduceVersionedDocumentEvent,
  replayDocumentEvents,
  replayVersionedDocumentEvents,
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
  type PortableProjectImportReport,
  type ProjectDeleteReport,
  type ProjectThumbnailCopyReport,
  type ProjectThumbnailWriteReport,
} from "./repository"
import {
  type EventRecord,
  type EventRecordV1,
  eventRecordSchema,
  eventRecordV1Schema,
  type LocalProjectSummary,
  type ProjectRecord,
  type ProjectRecordV1,
  persistencePromotionInputSchema,
  persistenceV1CommitInputSchema,
  persistenceV1DraftCommitInputSchema,
  portableProjectV2CopySchema,
  portableProjectV2ImportSchema,
  portableProjectV2PayloadSchema,
  projectDeleteInputSchema,
  projectRecordSchema,
  projectRecordV1Schema,
  projectThumbnailCopyInputSchema,
  projectThumbnailRecordSchema,
  projectThumbnailWriteInputSchema,
  type RecoveryRecordV1,
  recoveryRecordV1Schema,
  type SnapshotRecordV1,
  snapshotRecordSchema,
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

export interface PortableProjectV2 {
  snapshot: DocumentSnapshotV1
  seed: DocumentSnapshotV1 | null
  legacyEvents: readonly DocumentEvent[]
  versionedEvents: readonly VersionedDocumentEvent[]
  historyMode: "complete" | "checkpoint"
  promotionRevision: number
  migrationDiagnostic: ProjectRecordV1["migrationDiagnostic"]
  unavailableRecords: readonly string[]
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

function invalidPortableV2(message: string): never {
  throw persistenceInvariantError("corrupt-history", message)
}

function validatePortableProjectV2(project: PortableProjectV2) {
  if (project.historyMode === "complete" && project.seed) {
    const legacy = replayDocumentEvents(project.legacyEvents)
    if (!legacy.ok) invalidPortableV2("The portable legacy history is invalid.")
    const migrated = migrateDocumentSnapshot(legacy.snapshot, project.legacyEvents)
    if (!migrated.ok || canonicalJson(migrated.snapshot) !== canonicalJson(project.seed))
      invalidPortableV2("The portable legacy history does not reproduce its promotion seed.")
  }
  const replayed = replayVersionedDocumentEvents(project.seed, project.versionedEvents)
  if (!replayed.ok || canonicalJson(replayed.snapshot) !== canonicalJson(project.snapshot))
    invalidPortableV2("The portable versioned history does not reproduce its snapshot.")
}

async function exactVersionedSnapshot(
  database: VibeShapeDatabase,
  documentId: DocumentId,
  revision: number,
) {
  const record = await database.snapshotsV1.get([documentId, revision])
  const snapshot = record ? await validStoredSnapshot(record) : null
  if (!snapshot) invalidPortableV2("The persisted versioned snapshot is missing or invalid.")
  return snapshot
}

async function exactVersionedEvents(
  database: VibeShapeDatabase,
  documentId: DocumentId,
  firstRevision: number,
  lastRevision: number,
) {
  if (firstRevision > lastRevision) return []
  const records = await database.eventsV1
    .where("[documentId+revision]")
    .between([documentId, firstRevision], [documentId, lastRevision], true, true)
    .sortBy("revision")
  if (records.length !== lastRevision - firstRevision + 1)
    invalidPortableV2("The persisted versioned event suffix is incomplete.")
  const events: VersionedDocumentEvent[] = []
  for (let index = 0; index < records.length; index += 1) {
    const event = await validStoredEvent(records[index] as EventRecordV1)
    if (!event || event.revision !== firstRevision + index)
      invalidPortableV2("The persisted versioned event suffix is invalid.")
    events.push(event)
  }
  return events
}

async function storedLegacyPortableRecords(
  events: readonly DocumentEvent[],
  snapshot: DocumentSnapshot,
  storedAt: string,
) {
  const storedEvents: EventRecord[] = []
  for (const event of events) {
    const serialized = await serializeStoredRecord(event)
    storedEvents.push(
      eventRecordSchema.parse({
        schemaVersion: 0,
        documentId: event.documentId,
        revision: event.revision,
        commandId: event.commandId,
        storedAt,
        ...serialized,
      }),
    )
  }
  const serialized = await serializeStoredRecord(snapshot)
  const storedSnapshot = snapshotRecordSchema.parse({
    schemaVersion: 0,
    documentId: snapshot.id,
    revision: snapshot.revision,
    storedAt,
    ...serialized,
  })
  return { events: storedEvents, snapshot: storedSnapshot }
}

async function storedVersionedPortableRecords(project: PortableProjectV2, storedAt: string) {
  const events = await Promise.all(
    project.versionedEvents.map((event) => storedEvent(event, storedAt)),
  )
  const snapshots = project.seed ? [await storedSnapshot(project.seed, storedAt)] : []
  if (!project.seed || project.seed.revision !== project.snapshot.revision)
    snapshots.push(await storedSnapshot(project.snapshot, storedAt))
  return { events, snapshots }
}

function importedVersionedProject(
  project: PortableProjectV2,
  storedAt: string,
  externalBackupAt: string | null,
) {
  const migrationProvenance =
    project.historyMode === "checkpoint"
      ? "snapshot-derived"
      : project.seed
        ? "journal-derived"
        : "current"
  return projectRecordV1Schema.parse({
    schemaVersion: 1,
    documentId: project.snapshot.id,
    name: project.snapshot.name,
    headRevision: project.snapshot.revision,
    latestSnapshotRevision: project.snapshot.revision,
    cleanCloseRevision: project.snapshot.revision,
    createdAt: project.snapshot.createdAt,
    updatedAt: storedAt,
    lastExternalBackupAt: externalBackupAt,
    migrationProvenance,
    migrationDiagnostic: project.migrationDiagnostic,
    unavailableRecords: project.unavailableRecords,
  })
}

function importedLegacyProject(
  snapshot: DocumentSnapshot,
  storedAt: string,
  externalBackupAt: string | null,
) {
  return projectRecordSchema.parse({
    schemaVersion: 0,
    documentId: snapshot.id,
    name: snapshot.name,
    headRevision: snapshot.revision,
    latestSnapshotRevision: snapshot.revision,
    cleanCloseRevision: snapshot.revision,
    createdAt: snapshot.createdAt,
    updatedAt: storedAt,
    lastExternalBackupAt: externalBackupAt,
  })
}

async function publishPortableProjectV2(
  database: VibeShapeDatabase,
  project: PortableProjectV2,
  storedAt: string,
  externalBackupAt: string | null,
) {
  validatePortableProjectV2(project)
  const records = await preparePortableProjectV2Records(project, storedAt, externalBackupAt)
  await database.transaction(
    "rw",
    [
      database.projects,
      database.projectsV1,
      database.events,
      database.eventsV1,
      database.snapshots,
      database.snapshotsV1,
      database.recovery,
      database.recoveryV1,
      database.leases,
    ],
    () => writePortableProjectV2Records(database, records),
  )
  return portableProjectV2WriteReport(project, records)
}

function replayPortableLegacySnapshot(project: PortableProjectV2) {
  if (project.historyMode !== "complete" || !project.seed) return null
  const replayed = replayDocumentEvents(project.legacyEvents)
  if (!replayed.ok) invalidPortableV2("The portable legacy history is invalid.")
  return replayed.snapshot
}

async function preparePortableProjectV2Records(
  project: PortableProjectV2,
  storedAt: string,
  externalBackupAt: string | null,
) {
  const legacySnapshot = replayPortableLegacySnapshot(project)
  return {
    project,
    storedAt,
    externalBackupAt,
    legacySnapshot,
    legacyRecords: legacySnapshot
      ? await storedLegacyPortableRecords(project.legacyEvents, legacySnapshot, storedAt)
      : null,
    versionedRecords: await storedVersionedPortableRecords(project, storedAt),
    versionedProject: importedVersionedProject(project, storedAt, externalBackupAt),
  }
}

function portableProjectV2WriteReport(
  project: PortableProjectV2,
  records: Awaited<ReturnType<typeof preparePortableProjectV2Records>>,
) {
  return {
    documentId: project.snapshot.id,
    revision: project.snapshot.revision,
    eventChecksums: [
      ...(records.legacyRecords?.events.map(({ checksum }) => checksum) ?? []),
      ...records.versionedRecords.events.map(({ checksum }) => checksum),
    ],
    snapshotChecksum: records.versionedRecords.snapshots.at(-1)?.checksum ?? "",
  } satisfies PortableProjectImportReport
}

async function writePortableProjectV2Records(
  database: VibeShapeDatabase,
  input: Awaited<ReturnType<typeof preparePortableProjectV2Records>>,
) {
  const documentId = input.project.snapshot.id
  requireNewDocument(
    parseCurrentProject(await database.projectsV1.get(documentId)),
    await database.projects.get(documentId),
  )
  if (input.legacyRecords && input.legacySnapshot) {
    await database.events.bulkAdd(input.legacyRecords.events)
    await database.snapshots.add(input.legacyRecords.snapshot)
    await database.projects.add(
      importedLegacyProject(input.legacySnapshot, input.storedAt, input.externalBackupAt),
    )
  }
  if (input.versionedRecords.events.length > 0)
    await database.eventsV1.bulkAdd(input.versionedRecords.events)
  await database.snapshotsV1.bulkAdd(input.versionedRecords.snapshots)
  await database.projectsV1.add(input.versionedProject)
  await database.recovery.delete(documentId)
  await database.recoveryV1.delete(documentId)
  await database.leases.delete(documentId)
}

function checkpointEvidence(recovered: MigratedRecoveryReport | null, message: string) {
  const diagnostic = recovered?.migration.diagnostic ?? {
    code: "legacy-journal-unavailable",
    message,
  }
  const unavailableRecords = [
    ...(recovered?.migration.unavailableRecords ?? []),
    ...(recovered?.corruptRecords ?? []),
  ]
  return {
    migrationDiagnostic: diagnostic,
    unavailableRecords: unavailableRecords.length > 0 ? unavailableRecords : ["legacy-prefix"],
  }
}

async function promotedPortableBoundary(
  database: VibeShapeDatabase,
  project: ProjectRecordV1,
  seed: DocumentSnapshotV1,
) {
  const legacyRepository = new LocalDocumentRepository(database)
  const recoveredResult = await legacyRepository.recoverMigrated(project.documentId)
  const recovered = recoveredResult.ok ? recoveredResult.value : null
  const seedIsRecovered = recovered && canonicalJson(recovered.snapshot) === canonicalJson(seed)
  const complete =
    seedIsRecovered &&
    recovered.status !== "recovered-with-loss" &&
    recovered.migration.provenance === "journal-derived"
      ? await legacyRepository.exportPortableProject(project.documentId)
      : null
  return complete?.ok
    ? {
        historyMode: "complete" as const,
        legacyEvents: complete.value.events,
        migrationDiagnostic: null,
        unavailableRecords: [],
      }
    : {
        historyMode: "checkpoint" as const,
        legacyEvents: [],
        ...checkpointEvidence(
          recovered,
          "The retained legacy prefix cannot prove the versioned promotion seed.",
        ),
      }
}

async function assemblePromotedPortableProjectV2(
  database: VibeShapeDatabase,
  project: ProjectRecordV1,
  snapshot: DocumentSnapshotV1,
  legacyRecord: ProjectRecord,
) {
  const promotionRevision = legacyRecord.headRevision
  const seed = await exactVersionedSnapshot(database, project.documentId, promotionRevision)
  const versionedEvents = await exactVersionedEvents(
    database,
    project.documentId,
    promotionRevision + 1,
    project.headRevision,
  )
  const boundary = await promotedPortableBoundary(database, project, seed)
  return portableProjectV2PayloadSchema.parse({
    snapshot,
    seed,
    versionedEvents,
    promotionRevision,
    ...boundary,
  })
}

async function assembleNativePortableProjectV2(
  database: VibeShapeDatabase,
  project: ProjectRecordV1,
  snapshot: DocumentSnapshotV1,
) {
  const versionedEvents = await exactVersionedEvents(
    database,
    project.documentId,
    1,
    project.headRevision,
  )
  return portableProjectV2PayloadSchema.parse({
    snapshot,
    seed: null,
    legacyEvents: [],
    versionedEvents,
    historyMode: "complete",
    promotionRevision: 0,
    migrationDiagnostic: null,
    unavailableRecords: [],
  })
}

async function assemblePortableProjectV2(database: VibeShapeDatabase, project: ProjectRecordV1) {
  if (project.latestSnapshotRevision !== project.headRevision)
    invalidPortableV2("The versioned project head does not name its exact snapshot.")
  const snapshot = await exactVersionedSnapshot(database, project.documentId, project.headRevision)
  const legacyRecord = await database.projects.get(project.documentId)
  if (!legacyRecord) {
    const portable = await assembleNativePortableProjectV2(database, project, snapshot)
    validatePortableProjectV2(portable)
    return portable
  }
  const legacy = projectRecordSchema.safeParse(legacyRecord)
  if (!legacy.success) invalidPortableV2("The retained legacy project head is invalid.")
  const portable = await assemblePromotedPortableProjectV2(database, project, snapshot, legacy.data)
  validatePortableProjectV2(portable)
  return portable
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

  // fallow-ignore-next-line unused-class-member -- Consumed by the versioned portable project lifecycle.
  async exportPortableProjectV2(
    documentIdInput: unknown,
  ): Promise<PersistenceResult<PortableProjectV2>> {
    const documentId = documentIdSchema.safeParse(documentIdInput)
    if (!documentId.success)
      return {
        ok: false,
        diagnostic: createPersistenceDiagnostic("invalid-input", "The document ID is invalid."),
      }
    try {
      const project = await requireStoredVersionedProject(this.database, documentId.data)
      return { ok: true, value: await assemblePortableProjectV2(this.database, project) }
    } catch (error) {
      return { ok: false, diagnostic: classifyPersistenceError(error) }
    }
  }

  // fallow-ignore-next-line unused-class-member -- Consumed by the versioned portable project lifecycle.
  async importPortableProjectV2(
    inputValue: unknown,
  ): Promise<PersistenceResult<PortableProjectImportReport>> {
    const input = portableProjectV2ImportSchema.safeParse(inputValue)
    if (!input.success)
      return {
        ok: false,
        diagnostic: createPersistenceDiagnostic(
          "invalid-input",
          "The portable v2 project import is invalid.",
        ),
      }
    try {
      return {
        ok: true,
        value: await publishPortableProjectV2(
          this.database,
          input.data,
          input.data.importedAt,
          input.data.exportedAt,
        ),
      }
    } catch (error) {
      return { ok: false, diagnostic: classifyPersistenceError(error) }
    }
  }

  // fallow-ignore-next-line unused-class-member -- Consumed by the versioned portable project lifecycle.
  async copyPortableProjectV2(
    inputValue: unknown,
  ): Promise<PersistenceResult<PortableProjectImportReport>> {
    const input = portableProjectV2CopySchema.safeParse(inputValue)
    if (!input.success)
      return {
        ok: false,
        diagnostic: createPersistenceDiagnostic(
          "invalid-input",
          "The portable v2 project copy is invalid.",
        ),
      }
    try {
      return {
        ok: true,
        value: await publishPortableProjectV2(this.database, input.data, input.data.copiedAt, null),
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
