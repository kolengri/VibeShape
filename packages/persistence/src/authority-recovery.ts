import {
  canonicalJson,
  type DocumentAuthorityEvent,
  type DocumentAuthoritySnapshot,
  type DocumentId,
  documentIdSchema,
  reduceDocumentAuthorityEvent,
  replayDocumentAuthorityEvents,
} from "@vibeshape/domain"
import {
  requireAuthorityProject,
  requireSupportedAuthorityVersion,
  validAuthorityEvent,
  validAuthoritySnapshot,
} from "./authority-records"
import { type ProjectAuthorityRecord, recoveryAuthorityRecordSchema } from "./authority-schemas"
import type { VibeShapeDatabase } from "./database"
import {
  classifyPersistenceError,
  createPersistenceDiagnostic,
  persistenceInvariantError,
} from "./diagnostics"
import type { PersistenceResult } from "./repository"

export interface AuthorityRecoveryReport {
  status: "clean" | "recovered" | "recovered-with-loss"
  snapshot: DocumentAuthoritySnapshot
  headRevision: number
  recoveredRevision: number
  lostRevisionCount: number
  corruptRecords: string[]
  migration: Pick<
    ProjectAuthorityRecord,
    "migrationProvenance" | "migrationDiagnostic" | "unavailableRecords"
  >
}
const MAX_RECORDS = 100_000

async function snapshotsThrough(
  database: VibeShapeDatabase,
  documentId: DocumentId,
  revision: number,
) {
  const records = await database.snapshotsV1
    .where("[documentId+revision]")
    .between([documentId, 0], [documentId, revision], true, true)
    .limit(MAX_RECORDS + 1)
    .sortBy("revision")
  if (records.length > MAX_RECORDS)
    throw persistenceInvariantError(
      "corrupt-history",
      "The snapshot history exceeds its record budget.",
    )
  return records
}

export async function authorityEventsThrough(
  database: VibeShapeDatabase,
  documentId: DocumentId,
  first: number,
  last: number,
  corrupt: string[],
): Promise<readonly DocumentAuthorityEvent[]> {
  if (first > last) return []
  const records = await database.eventsV1
    .where("[documentId+revision]")
    .between([documentId, first], [documentId, last], true, true)
    .limit(MAX_RECORDS + 1)
    .sortBy("revision")
  if (records.length > MAX_RECORDS)
    throw persistenceInvariantError(
      "corrupt-history",
      "The event history exceeds its record budget.",
    )
  const events: DocumentAuthorityEvent[] = []
  for (const record of records) {
    const expected = first + events.length
    const event = record.revision === expected ? await validAuthorityEvent(record) : null
    if (!event) {
      corrupt.push(`event-authority:${expected}`)
      break
    }
    events.push(event)
  }
  if (events.length !== last - first + 1 && corrupt.length === 0)
    corrupt.push(`event-authority:${first + events.length}`)
  return events
}

async function findReplaySeed(
  database: VibeShapeDatabase,
  documentId: DocumentId,
  revision: number,
): Promise<DocumentAuthoritySnapshot | null> {
  const first = await database.eventsV1.get([documentId, 1])
  if (first && (await validAuthorityEvent(first))?.type === "org.vibeshape.document.created")
    return null
  for (const record of await snapshotsThrough(database, documentId, revision)) {
    const snapshot = await validAuthoritySnapshot(record)
    if (snapshot) return snapshot
  }
  throw persistenceInvariantError("corrupt-history", "No historical replay seed remains.")
}

export async function loadAuthorityRestoreTarget(
  database: VibeShapeDatabase,
  documentId: DocumentId,
  revision: number,
): Promise<DocumentAuthoritySnapshot | null> {
  const exact = await database.snapshotsV1.get([documentId, revision])
  const snapshot = exact ? await validAuthoritySnapshot(exact) : null
  if (snapshot) return snapshot
  const seed = await findReplaySeed(database, documentId, revision)
  const corrupt: string[] = []
  const events = await authorityEventsThrough(
    database,
    documentId,
    (seed?.revision ?? 0) + 1,
    revision,
    corrupt,
  )
  if (corrupt.length) return null
  const replayed = replayDocumentAuthorityEvents(seed, events)
  return replayed.ok && replayed.snapshot.revision === revision ? replayed.snapshot : null
}

function restoreResolver(database: VibeShapeDatabase, documentId: DocumentId) {
  const cache = new Map<number, { snapshot: DocumentAuthoritySnapshot; bytes: number }>()
  let bytes = 0
  return async (revision: number) => {
    const cached = cache.get(revision)
    if (cached) return cached.snapshot
    const snapshot = await loadAuthorityRestoreTarget(database, documentId, revision)
    if (!snapshot) return null
    const size = canonicalJson(snapshot).length * 2
    if (size > 32 * 1024 * 1024) return snapshot
    cache.set(revision, { snapshot, bytes: size })
    bytes += size
    while (cache.size > 100 || bytes > 32 * 1024 * 1024) {
      const oldest = cache.entries().next().value
      if (!oldest) break
      cache.delete(oldest[0])
      bytes -= oldest[1].bytes
    }
    return snapshot
  }
}

async function replayRecoverySuffix(
  database: VibeShapeDatabase,
  project: ProjectAuthorityRecord,
  seed: DocumentAuthoritySnapshot | null,
  corrupt: string[],
) {
  const events = await authorityEventsThrough(
    database,
    project.documentId,
    (seed?.revision ?? 0) + 1,
    project.headRevision,
    corrupt,
  )
  const resolve = restoreResolver(database, project.documentId)
  let snapshot = seed
  for (const event of events) {
    const target =
      event.type === "org.vibeshape.document.restored" ? await resolve(event.targetRevision) : null
    const reduced = reduceDocumentAuthorityEvent(snapshot, event, target ?? undefined)
    if (!reduced.ok) {
      corrupt.push(`event-authority:${event.revision}`)
      break
    }
    snapshot = reduced.snapshot
  }
  return snapshot
}

export async function recoverAuthoritySnapshot(
  database: VibeShapeDatabase,
  project: ProjectAuthorityRecord,
) {
  const records = await snapshotsThrough(
    database,
    project.documentId,
    project.latestSnapshotRevision,
  )
  const corruptRecords: string[] = []
  let seed: DocumentAuthoritySnapshot | null = null
  for (const record of records.reverse()) {
    seed = await validAuthoritySnapshot(record)
    if (seed) break
    corruptRecords.push(`snapshot-authority:${record.revision}`)
  }
  const snapshot = await replayRecoverySuffix(database, project, seed, corruptRecords)
  if (!snapshot || snapshot.schemaVersion !== project.schemaVersion)
    throw persistenceInvariantError(
      "corrupt-history",
      "Recovery cannot cross the document authority version boundary.",
    )
  if (project.schemaVersion === 3 && snapshot.revision < project.textureUpgradeRevision)
    throw persistenceInvariantError(
      "corrupt-history",
      "Recovery cannot cross the texture authority upgrade boundary.",
    )
  if (project.schemaVersion !== 1 && snapshot.revision < project.upgradeRevision)
    throw persistenceInvariantError(
      "corrupt-history",
      "No valid V2 revision remains at the recorded upgrade boundary.",
    )
  return { snapshot, corruptRecords }
}

export async function recoverDocumentAuthority(
  database: VibeShapeDatabase,
  input: unknown,
): Promise<PersistenceResult<AuthorityRecoveryReport>> {
  const documentId = documentIdSchema.safeParse(input)
  if (!documentId.success)
    return {
      ok: false,
      diagnostic: createPersistenceDiagnostic("invalid-input", "The document ID is invalid."),
    }
  try {
    const project = await requireAuthorityProject(database, documentId.data)
    const recovered = await recoverAuthoritySnapshot(database, project)
    const marker = await database.recoveryV1.get(documentId.data)
    requireSupportedAuthorityVersion(marker)
    if (marker && !recoveryAuthorityRecordSchema.safeParse(marker).success)
      recovered.corruptRecords.push("recovery-authority")
    const lostRevisionCount = project.headRevision - recovered.snapshot.revision
    return {
      ok: true,
      value: {
        ...recovered,
        status: lostRevisionCount > 0 ? "recovered-with-loss" : marker ? "recovered" : "clean",
        headRevision: project.headRevision,
        recoveredRevision: recovered.snapshot.revision,
        lostRevisionCount,
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
