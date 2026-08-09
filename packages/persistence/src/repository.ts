import {
  canonicalJson,
  commandActorsEqual,
  type DocumentEvent,
  type DocumentId,
  type DocumentSnapshot,
  documentEventSchema,
  documentIdSchema,
  documentSnapshotSchema,
  reduceDocumentEvent,
  sessionIdSchema,
} from "@vibeshape/domain"
import { type ZodType, z } from "zod"
import type { VibeShapeDatabase } from "./database"
import {
  classifyPersistenceError,
  createPersistenceDiagnostic,
  persistenceInvariantError,
} from "./diagnostics"
import { sha256Text } from "./hash"
import {
  type EventRecord,
  eventRecordSchema,
  type LeaseRecord,
  type LocalProjectSummary,
  localProjectSummarySchema,
  type PersistenceDiagnostic,
  type ProjectRecord,
  persistenceCommitInputSchema,
  persistenceDraftCommitInputSchema,
  portableProjectImportSchema,
  projectRecordSchema,
  type RecoveryRecord,
  recoveryRecordSchema,
  type SnapshotRecord,
  snapshotRecordSchema,
  type WriterLeaseClaim,
  writerLeaseClaimSchema,
} from "./schemas"

export type PersistenceResult<Value> =
  | { ok: true; value: Value }
  | { ok: false; diagnostic: PersistenceDiagnostic }

export interface CommitReport {
  documentId: DocumentId
  revision: number
  eventChecksum: string
  snapshotChecksum: string
}

export interface DraftCommitReport {
  documentId: DocumentId
  revision: number
  eventChecksums: readonly string[]
  snapshotChecksum: string
}

export interface RecoveryReport {
  status: "clean" | "recovered" | "recovered-with-loss"
  snapshot: DocumentSnapshot
  headRevision: number
  recoveredRevision: number
  lostRevisionCount: number
  corruptRecords: string[]
}

export interface PortableProject {
  snapshot: DocumentSnapshot
  events: readonly DocumentEvent[]
}

export interface PortableProjectImportReport {
  documentId: DocumentId
  revision: number
  eventChecksums: readonly string[]
  snapshotChecksum: string
}

const MAX_LOCAL_PROJECTS = 4_096

async function serializeRecord(value: unknown) {
  const payload = canonicalJson(value)
  return { payload, checksum: await sha256Text(payload) }
}

async function parseStoredPayload<Output>(
  record: { payload: string; checksum: string },
  schema: ZodType<Output>,
) {
  if ((await sha256Text(record.payload)) !== record.checksum) return null
  try {
    return schema.parse(JSON.parse(record.payload))
  } catch {
    return null
  }
}

function validateCommitRelationship(
  baseSnapshot: DocumentSnapshot | null,
  event: DocumentEvent,
  snapshot: DocumentSnapshot,
) {
  requireMatchingCommitRevisions(baseSnapshot, event, snapshot)
  requireMatchingCommitDocument(baseSnapshot, event, snapshot)
  requireEventResult(baseSnapshot, event, snapshot)
}

function validateDraftCommitRelationship(
  input: z.output<typeof persistenceDraftCommitInputSchema>,
) {
  let snapshot: DocumentSnapshot | null = input.baseSnapshot

  for (const event of input.events) {
    if (event.transactionId !== input.transactionId) {
      throw persistenceInvariantError(
        "invalid-input",
        "Every draft event must use the supplied transaction ID.",
      )
    }
    if (event.documentId !== input.snapshot.id || event.documentId !== input.baseSnapshot.id) {
      throw persistenceInvariantError(
        "invalid-input",
        "Every draft event must target the supplied document.",
      )
    }
    const firstEvent = input.events[0]
    if (firstEvent && !commandActorsEqual(firstEvent.actor, event.actor)) {
      throw persistenceInvariantError("invalid-input", "Every draft event must use the same actor.")
    }
    const reduced = reduceDocumentEvent(snapshot, event)
    if (!reduced.ok) {
      throw persistenceInvariantError(
        "invalid-input",
        "The draft event sequence cannot be replayed.",
      )
    }
    snapshot = reduced.snapshot
  }

  if (canonicalJson(snapshot) !== canonicalJson(input.snapshot)) {
    throw persistenceInvariantError(
      "invalid-input",
      "The supplied snapshot is not the draft event sequence result.",
    )
  }
}

function requireMatchingCommitRevisions(
  baseSnapshot: DocumentSnapshot | null,
  event: DocumentEvent,
  snapshot: DocumentSnapshot,
) {
  const baseRevision = baseSnapshot?.revision ?? 0
  const matches = [event.baseRevision === baseRevision, snapshot.revision === event.revision].every(
    Boolean,
  )
  if (!matches) {
    throw persistenceInvariantError("invalid-input", "The commit revisions are inconsistent.")
  }
}

function requireMatchingCommitDocument(
  baseSnapshot: DocumentSnapshot | null,
  event: DocumentEvent,
  snapshot: DocumentSnapshot,
) {
  const baseDocumentId = baseSnapshot ? baseSnapshot.id : snapshot.id
  const matches = [event.documentId === snapshot.id, baseDocumentId === snapshot.id].every(Boolean)
  if (!matches) {
    throw persistenceInvariantError("invalid-input", "The commit documents are inconsistent.")
  }
}

function requireEventResult(
  baseSnapshot: DocumentSnapshot | null,
  event: DocumentEvent,
  snapshot: DocumentSnapshot,
) {
  const reduced = reduceDocumentEvent(baseSnapshot, event)
  if (!reduced.ok || canonicalJson(reduced.snapshot) !== canonicalJson(snapshot)) {
    throw persistenceInvariantError(
      "invalid-input",
      "The supplied snapshot is not the event result.",
    )
  }
}

function projectForCommit(
  current: ProjectRecord | undefined,
  snapshot: DocumentSnapshot,
  storedAt: string,
): ProjectRecord {
  const createdAt = current ? current.createdAt : snapshot.createdAt
  const lastExternalBackupAt = current ? current.lastExternalBackupAt : null
  return projectRecordSchema.parse({
    schemaVersion: 0,
    documentId: snapshot.id,
    name: snapshot.name,
    headRevision: snapshot.revision,
    latestSnapshotRevision: snapshot.revision,
    cleanCloseRevision: null,
    createdAt,
    updatedAt: storedAt,
    lastExternalBackupAt,
  })
}

function requireCurrentRevision(current: ProjectRecord | undefined, event: DocumentEvent) {
  if (event.baseRevision === 0) {
    requireNewDocument(current)
    return
  }
  requireExistingRevision(current, event.baseRevision)
}

function requireNewDocument(current: ProjectRecord | undefined) {
  if (current) {
    throw persistenceInvariantError("document-already-exists", "The document already exists.")
  }
}

function requireExistingRevision(current: ProjectRecord | undefined, baseRevision: number) {
  if (!current) {
    throw persistenceInvariantError("document-not-found", "The document does not exist.")
  }
  if (current.headRevision !== baseRevision) {
    throw persistenceInvariantError("stale-revision", "The persisted document revision changed.")
  }
}

function hasValidWriterLease(
  lease: LeaseRecord | undefined,
  sessionId: string,
  claim: WriterLeaseClaim | null,
) {
  if (!lease || !claim) return false
  return [
    lease.ownerId === sessionId,
    lease.epoch === claim.epoch,
    lease.expiresAt > claim.nowMs,
  ].every(Boolean)
}

function requireCommitLease(
  current: ProjectRecord | undefined,
  lease: LeaseRecord | undefined,
  input: {
    sessionId: string
    lease: WriterLeaseClaim | null
  },
) {
  if (!current) {
    if (input.lease !== null) {
      throw persistenceInvariantError(
        "invalid-input",
        "A new document cannot reference an existing writer lease.",
      )
    }
    return
  }
  if (!hasValidWriterLease(lease, input.sessionId, input.lease)) {
    throw persistenceInvariantError("lease-lost", "The document writer lease is no longer valid.")
  }
}

function recoveryForCommit(
  input: {
    sessionId: string
    storedAt: string
    snapshot: DocumentSnapshot
  },
  current: RecoveryRecord | undefined,
): RecoveryRecord {
  return recoveryRecordSchema.parse({
    schemaVersion: 0,
    documentId: input.snapshot.id,
    sessionId: input.sessionId,
    openedAt: current?.openedAt ?? input.storedAt,
    updatedAt: input.storedAt,
    lastConfirmedRevision: input.snapshot.revision,
  })
}

async function storedRecords(input: z.output<typeof persistenceCommitInputSchema>) {
  const event = await serializeRecord(input.event)
  const snapshot = await serializeRecord(input.snapshot)
  return {
    event: eventRecordSchema.parse({
      schemaVersion: 0,
      documentId: input.event.documentId,
      revision: input.event.revision,
      commandId: input.event.commandId,
      storedAt: input.storedAt,
      ...event,
    }),
    snapshot: snapshotRecordSchema.parse({
      schemaVersion: 0,
      documentId: input.snapshot.id,
      revision: input.snapshot.revision,
      storedAt: input.storedAt,
      ...snapshot,
    }),
  }
}

async function storedDraftRecords(input: z.output<typeof persistenceDraftCommitInputSchema>) {
  const events = await Promise.all(
    input.events.map(async (event) => {
      const serialized = await serializeRecord(event)
      return eventRecordSchema.parse({
        schemaVersion: 0,
        documentId: event.documentId,
        revision: event.revision,
        commandId: event.commandId,
        storedAt: input.storedAt,
        ...serialized,
      })
    }),
  )
  const serializedSnapshot = await serializeRecord(input.snapshot)
  const snapshot = snapshotRecordSchema.parse({
    schemaVersion: 0,
    documentId: input.snapshot.id,
    revision: input.snapshot.revision,
    storedAt: input.storedAt,
    ...serializedSnapshot,
  })
  return { events, snapshot }
}

async function storedPortableRecords(input: z.output<typeof portableProjectImportSchema>) {
  const events = await Promise.all(
    input.events.map(async (event) => {
      const serialized = await serializeRecord(event)
      return eventRecordSchema.parse({
        schemaVersion: 0,
        documentId: event.documentId,
        revision: event.revision,
        commandId: event.commandId,
        storedAt: input.importedAt,
        ...serialized,
      })
    }),
  )
  const serializedSnapshot = await serializeRecord(input.snapshot)
  const snapshot = snapshotRecordSchema.parse({
    schemaVersion: 0,
    documentId: input.snapshot.id,
    revision: input.snapshot.revision,
    storedAt: input.importedAt,
    ...serializedSnapshot,
  })
  return { events, snapshot }
}

function replayPortableEvents(events: readonly DocumentEvent[]) {
  let snapshot: DocumentSnapshot | null = null
  for (const event of events) {
    const reduced = reduceDocumentEvent(snapshot, event)
    if (!reduced.ok) {
      throw persistenceInvariantError("corrupt-history", "The portable event history is invalid.")
    }
    snapshot = reduced.snapshot
  }
  if (!snapshot) {
    throw persistenceInvariantError("corrupt-history", "The portable event history is empty.")
  }
  return snapshot
}

function validatePortableProject(snapshot: DocumentSnapshot, events: readonly DocumentEvent[]) {
  const replayed = replayPortableEvents(events)
  if (canonicalJson(replayed) !== canonicalJson(snapshot)) {
    throw persistenceInvariantError(
      "corrupt-history",
      "The portable event history does not reproduce its document snapshot.",
    )
  }
}

function importedProjectRecord(input: z.output<typeof portableProjectImportSchema>): ProjectRecord {
  return projectRecordSchema.parse({
    schemaVersion: 0,
    documentId: input.snapshot.id,
    name: input.snapshot.name,
    headRevision: input.snapshot.revision,
    latestSnapshotRevision: input.snapshot.revision,
    cleanCloseRevision: input.snapshot.revision,
    createdAt: input.snapshot.createdAt,
    updatedAt: input.importedAt,
    lastExternalBackupAt: input.exportedAt,
  })
}

async function latestValidSnapshot(records: readonly SnapshotRecord[]) {
  const corruptRecords: string[] = []
  for (const record of records) {
    const snapshot = await validStoredSnapshot(record)
    if (snapshot) return { snapshot, corruptRecords }
    corruptRecords.push(`snapshot:${record.revision}`)
  }
  return { snapshot: null, corruptRecords }
}

async function validStoredSnapshot(record: SnapshotRecord) {
  const parsedRecord = snapshotRecordSchema.safeParse(record)
  if (!parsedRecord.success) return null
  const snapshot = await parseStoredPayload(parsedRecord.data, documentSnapshotSchema)
  if (!snapshot) return null
  return snapshotMetadataMatches(parsedRecord.data, snapshot) ? snapshot : null
}

function snapshotMetadataMatches(record: SnapshotRecord, snapshot: DocumentSnapshot) {
  return [snapshot.id === record.documentId, snapshot.revision === record.revision].every(Boolean)
}

function eventMetadataMatches(record: EventRecord, event: DocumentEvent) {
  return [event.documentId === record.documentId, event.revision === record.revision].every(Boolean)
}

async function validStoredEvent(record: EventRecord) {
  const parsedRecord = eventRecordSchema.safeParse(record)
  if (!parsedRecord.success) return null
  const event = await parseStoredPayload(parsedRecord.data, documentEventSchema)
  if (!event) return null
  return eventMetadataMatches(parsedRecord.data, event) ? event : null
}

async function replayStoredEvent(snapshot: DocumentSnapshot | null, record: EventRecord) {
  const event = await validStoredEvent(record)
  if (!event) return null
  const reduced = reduceDocumentEvent(snapshot, event)
  return reduced.ok ? reduced.snapshot : null
}

async function replayStoredEvents(
  baseSnapshot: DocumentSnapshot | null,
  records: readonly EventRecord[],
  corruptRecords: string[],
) {
  let snapshot = baseSnapshot
  for (const record of records) {
    const replayed = await replayStoredEvent(snapshot, record)
    if (!replayed) {
      corruptRecords.push(`event:${record.revision}`)
      break
    }
    snapshot = replayed
  }
  return snapshot
}

async function requireStoredProject(database: VibeShapeDatabase, documentId: DocumentId) {
  const record = await database.projects.get(documentId)
  if (!record) {
    throw persistenceInvariantError("document-not-found", "The document does not exist.")
  }
  const project = projectRecordSchema.safeParse(record)
  if (!project.success) {
    throw persistenceInvariantError("corrupt-history", "The persisted project head is invalid.")
  }
  return project.data
}

async function recoveryMarkerPresent(
  database: VibeShapeDatabase,
  documentId: DocumentId,
  corruptRecords: string[],
) {
  const record = await database.recovery.get(documentId)
  if (record === undefined) return false
  if (!recoveryRecordSchema.safeParse(record).success) corruptRecords.push("recovery-marker")
  return true
}

function recoveryStatus(lostRevisionCount: number, markerPresent: boolean) {
  if (lostRevisionCount > 0) return "recovered-with-loss" as const
  return markerPresent ? ("recovered" as const) : ("clean" as const)
}

async function recoverDocumentSnapshot(database: VibeShapeDatabase, project: ProjectRecord) {
  const snapshots = (
    await database.snapshots.where("documentId").equals(project.documentId).toArray()
  ).sort((left, right) => right.revision - left.revision)
  const valid = await latestValidSnapshot(snapshots)
  const baseRevision = valid.snapshot?.revision ?? 0
  const events = await database.events
    .where("[documentId+revision]")
    .between(
      [project.documentId, baseRevision + 1],
      [project.documentId, project.headRevision],
      true,
      true,
    )
    .sortBy("revision")
  const snapshot = await replayStoredEvents(valid.snapshot, events, valid.corruptRecords)
  if (!snapshot) {
    throw persistenceInvariantError("corrupt-history", "No valid document revision remains.")
  }
  return { snapshot, corruptRecords: valid.corruptRecords }
}

function semanticWriteTransaction(database: VibeShapeDatabase, operation: () => Promise<void>) {
  return database.transaction(
    "rw",
    database.projects,
    database.events,
    database.snapshots,
    database.recovery,
    database.leases,
    operation,
  )
}

export class LocalDocumentRepository {
  constructor(readonly database: VibeShapeDatabase) {}

  async listProjects(): Promise<PersistenceResult<readonly LocalProjectSummary[]>> {
    try {
      const records = await this.database.projects.limit(MAX_LOCAL_PROJECTS + 1).toArray()
      if (records.length > MAX_LOCAL_PROJECTS) {
        throw persistenceInvariantError(
          "corrupt-history",
          "The local project index exceeds the supported project limit.",
        )
      }
      const projects = records.map((record) => {
        const project = projectRecordSchema.safeParse(record)
        if (!project.success) {
          throw persistenceInvariantError(
            "corrupt-history",
            "The local project index contains an invalid record.",
          )
        }
        return localProjectSummarySchema.parse({
          documentId: project.data.documentId,
          name: project.data.name,
          headRevision: project.data.headRevision,
          createdAt: project.data.createdAt,
          updatedAt: project.data.updatedAt,
          lastExternalBackupAt: project.data.lastExternalBackupAt,
        })
      })
      projects.sort(
        (left, right) =>
          right.updatedAt.localeCompare(left.updatedAt) ||
          left.documentId.localeCompare(right.documentId),
      )
      return { ok: true, value: projects }
    } catch (error) {
      return { ok: false, diagnostic: classifyPersistenceError(error) }
    }
  }

  async commit(input: unknown): Promise<PersistenceResult<CommitReport>> {
    const parsed = persistenceCommitInputSchema.safeParse(input)
    if (!parsed.success) {
      return {
        ok: false,
        diagnostic: createPersistenceDiagnostic(
          "invalid-input",
          "The persistence commit is invalid.",
        ),
      }
    }
    try {
      validateCommitRelationship(parsed.data.baseSnapshot, parsed.data.event, parsed.data.snapshot)
      const records = await storedRecords(parsed.data)
      await semanticWriteTransaction(this.database, async () => {
        const current = await this.database.projects.get(parsed.data.snapshot.id)
        const currentRecovery = await this.database.recovery.get(parsed.data.snapshot.id)
        const lease = await this.database.leases.get(parsed.data.snapshot.id)
        requireCurrentRevision(current, parsed.data.event)
        requireCommitLease(current, lease, parsed.data)
        await this.database.events.add(records.event)
        await this.database.snapshots.add(records.snapshot)
        await this.database.projects.put(
          projectForCommit(current, parsed.data.snapshot, parsed.data.storedAt),
        )
        await this.database.recovery.put(recoveryForCommit(parsed.data, currentRecovery))
      })
      return {
        ok: true,
        value: {
          documentId: parsed.data.snapshot.id,
          revision: parsed.data.snapshot.revision,
          eventChecksum: records.event.checksum,
          snapshotChecksum: records.snapshot.checksum,
        },
      }
    } catch (error) {
      return { ok: false, diagnostic: classifyPersistenceError(error) }
    }
  }

  async commitDraft(input: unknown): Promise<PersistenceResult<DraftCommitReport>> {
    const parsed = persistenceDraftCommitInputSchema.safeParse(input)
    if (!parsed.success) {
      return {
        ok: false,
        diagnostic: createPersistenceDiagnostic(
          "invalid-input",
          "The persistence draft commit is invalid.",
        ),
      }
    }
    try {
      validateDraftCommitRelationship(parsed.data)
      const records = await storedDraftRecords(parsed.data)
      await semanticWriteTransaction(this.database, async () => {
        const current = await this.database.projects.get(parsed.data.snapshot.id)
        const currentRecovery = await this.database.recovery.get(parsed.data.snapshot.id)
        const lease = await this.database.leases.get(parsed.data.snapshot.id)
        requireExistingRevision(current, parsed.data.baseSnapshot.revision)
        requireCommitLease(current, lease, parsed.data)
        await this.database.events.bulkAdd(records.events)
        await this.database.snapshots.add(records.snapshot)
        await this.database.projects.put(
          projectForCommit(current, parsed.data.snapshot, parsed.data.storedAt),
        )
        await this.database.recovery.put(recoveryForCommit(parsed.data, currentRecovery))
      })
      return {
        ok: true,
        value: {
          documentId: parsed.data.snapshot.id,
          revision: parsed.data.snapshot.revision,
          eventChecksums: records.events.map((event) => event.checksum),
          snapshotChecksum: records.snapshot.checksum,
        },
      }
    } catch (error) {
      return { ok: false, diagnostic: classifyPersistenceError(error) }
    }
  }

  async recover(documentIdInput: unknown): Promise<PersistenceResult<RecoveryReport>> {
    const documentId = documentIdSchema.safeParse(documentIdInput)
    if (!documentId.success) {
      return {
        ok: false,
        diagnostic: createPersistenceDiagnostic("invalid-input", "The document ID is invalid."),
      }
    }
    try {
      const project = await requireStoredProject(this.database, documentId.data)
      const recovered = await recoverDocumentSnapshot(this.database, project)
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
        },
      }
    } catch (error) {
      return { ok: false, diagnostic: classifyPersistenceError(error) }
    }
  }

  async exportPortableProject(
    documentIdInput: unknown,
  ): Promise<PersistenceResult<PortableProject>> {
    const documentId = documentIdSchema.safeParse(documentIdInput)
    if (!documentId.success) {
      return {
        ok: false,
        diagnostic: createPersistenceDiagnostic("invalid-input", "The document ID is invalid."),
      }
    }
    try {
      const project = await requireStoredProject(this.database, documentId.data)
      const snapshotRecord = await this.database.snapshots.get([
        documentId.data,
        project.headRevision,
      ])
      const snapshot = snapshotRecord ? await validStoredSnapshot(snapshotRecord) : null
      if (!snapshot) {
        throw persistenceInvariantError(
          "corrupt-history",
          "The persisted project head snapshot is invalid.",
        )
      }
      const eventRecords = await this.database.events
        .where("[documentId+revision]")
        .between([documentId.data, 1], [documentId.data, project.headRevision], true, true)
        .sortBy("revision")
      if (eventRecords.length !== project.headRevision) {
        throw persistenceInvariantError(
          "corrupt-history",
          "The persisted project journal is incomplete.",
        )
      }
      const events: DocumentEvent[] = []
      for (const record of eventRecords) {
        const event = await validStoredEvent(record)
        if (!event) {
          throw persistenceInvariantError(
            "corrupt-history",
            "The persisted project journal is invalid.",
          )
        }
        events.push(event)
      }
      validatePortableProject(snapshot, events)
      return { ok: true, value: { snapshot, events } }
    } catch (error) {
      return { ok: false, diagnostic: classifyPersistenceError(error) }
    }
  }

  async importPortableProject(
    inputValue: unknown,
  ): Promise<PersistenceResult<PortableProjectImportReport>> {
    const input = portableProjectImportSchema.safeParse(inputValue)
    if (!input.success) {
      return {
        ok: false,
        diagnostic: createPersistenceDiagnostic(
          "invalid-input",
          "The portable project import is invalid.",
        ),
      }
    }
    try {
      validatePortableProject(input.data.snapshot, input.data.events)
      const records = await storedPortableRecords(input.data)
      await semanticWriteTransaction(this.database, async () => {
        const current = await this.database.projects.get(input.data.snapshot.id)
        requireNewDocument(current)
        await this.database.events.bulkAdd(records.events)
        await this.database.snapshots.add(records.snapshot)
        await this.database.projects.add(importedProjectRecord(input.data))
        await this.database.recovery.delete(input.data.snapshot.id)
        await this.database.leases.delete(input.data.snapshot.id)
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

  async closeCleanly(inputValue: unknown) {
    const input = z
      .object({
        documentId: documentIdSchema,
        revision: z.number().int().nonnegative().safe(),
        sessionId: sessionIdSchema,
        lease: writerLeaseClaimSchema,
      })
      .strict()
      .safeParse(inputValue)
    if (!input.success) {
      return {
        ok: false,
        diagnostic: createPersistenceDiagnostic(
          "invalid-input",
          "The clean-close input is invalid.",
        ),
      } as const
    }
    try {
      await this.database.transaction(
        "rw",
        this.database.projects,
        this.database.recovery,
        this.database.leases,
        async () => {
          const project = await requireStoredProject(this.database, input.data.documentId)
          if (project.headRevision !== input.data.revision) {
            throw persistenceInvariantError("stale-revision", "The clean-close revision is stale.")
          }
          const lease = await this.database.leases.get(input.data.documentId)
          if (!hasValidWriterLease(lease, input.data.sessionId, input.data.lease)) {
            throw persistenceInvariantError(
              "lease-lost",
              "The document writer lease is no longer valid.",
            )
          }
          await this.database.projects.put({
            ...project,
            cleanCloseRevision: project.headRevision,
          })
          await this.database.recovery.delete(input.data.documentId)
        },
      )
      return { ok: true, value: undefined } as const
    } catch (error) {
      return { ok: false, diagnostic: classifyPersistenceError(error) } as const
    }
  }
}
