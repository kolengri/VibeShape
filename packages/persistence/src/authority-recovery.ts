import {
  canonicalJson,
  type DocumentAuthorityEvent,
  type DocumentAuthoritySnapshot,
  type DocumentId,
  documentIdSchema,
  reduceDocumentAuthorityEvent,
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
import { requireSourceAssetBytes } from "./source-asset-store"

export interface AuthorityRecoveryReport {
  status: "clean" | "recovered" | "recovered-with-loss"
  snapshot: DocumentAuthoritySnapshot
  headRevision: number
  recoveredRevision: number
  lostRevisionCount: number
  corruptRecords: string[]
  navigation?: ProjectAuthorityRecord["navigation"]
  migration: Pick<
    ProjectAuthorityRecord,
    "migrationProvenance" | "migrationDiagnostic" | "unavailableRecords"
  >
}
const MAX_RECORDS = 100_000

function requireSnapshotRecordBudget(inspected: number) {
  if (inspected > MAX_RECORDS)
    throw persistenceInvariantError(
      "corrupt-history",
      "The snapshot history exceeds its record budget.",
    )
}

async function latestSnapshotThrough(
  database: VibeShapeDatabase,
  documentId: DocumentId,
  revision: number,
) {
  return database.snapshotsV1
    .where("[documentId+revision]")
    .between([documentId, 0], [documentId, revision], true, true)
    .reverse()
    .first()
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

async function latestValidAuthoritySnapshot(
  database: VibeShapeDatabase,
  documentId: DocumentId,
  revision: number,
  corrupt: string[],
) {
  let inspected = 0
  let record = await latestSnapshotThrough(database, documentId, revision)
  while (record) {
    requireSnapshotRecordBudget(++inspected)
    const snapshot = await validAuthoritySnapshot(record)
    if (snapshot) return snapshot
    corrupt.push(`snapshot-authority:${record.revision}`)
    record = await latestSnapshotThrough(database, documentId, record.revision - 1)
  }
  return null
}

type StoredReplayEvent = Readonly<{ event: DocumentAuthorityEvent; checksum: string }>
type ReplayReceipt = Readonly<{
  schemaVersion: DocumentAuthoritySnapshot["schemaVersion"]
  updatedAt: string
  sourceRevision: number
  baseRevision: number | null
  eventChecksum: string | null
}>

async function eventAt(
  database: VibeShapeDatabase,
  documentId: DocumentId,
  revision: number,
): Promise<StoredReplayEvent | null> {
  const record = await database.eventsV1.get([documentId, revision])
  const event = record ? await validAuthorityEvent(record) : null
  return event?.revision === revision && event.documentId === documentId && record
    ? { event, checksum: record.checksum }
    : null
}

async function earliestValidAuthoritySnapshot(
  database: VibeShapeDatabase,
  documentId: DocumentId,
  first: number,
  last: number,
) {
  let inspected = 0
  while (first <= last) {
    const record = await database.snapshotsV1
      .where("[documentId+revision]")
      .between([documentId, first], [documentId, last], true, true)
      .first()
    if (!record) return null
    requireSnapshotRecordBudget(++inspected)
    const snapshot = await validAuthoritySnapshot(record)
    if (snapshot) return snapshot
    first = record.revision + 1
  }
  return null
}

async function historicalReplaySeed(
  database: VibeShapeDatabase,
  documentId: DocumentId,
  revision: number,
) {
  const creation = await eventAt(database, documentId, 1)
  return creation?.event.type === "org.vibeshape.document.created"
    ? null
    : earliestValidAuthoritySnapshot(database, documentId, 0, revision)
}

/** One request shares bounded full states and compact receipts for already validated reductions. */
class AuthorityReplayContext {
  #cache = new Map<number, { snapshot: DocumentAuthoritySnapshot; bytes: number }>()
  #bytes = 0
  #receipts = new Map<number, ReplayReceipt>()
  #checkedAssets = new Set<number>()
  #unavailable: { first: number; last: number }[] = []

  constructor(
    private readonly database: VibeShapeDatabase,
    private readonly documentId: DocumentId,
  ) {}

  #cached(revision: number) {
    const cached = this.#cache.get(revision)
    if (!cached) return null
    this.#cache.delete(revision)
    this.#cache.set(revision, cached)
    return cached.snapshot
  }

  #retain(snapshot: DocumentAuthoritySnapshot) {
    const previous = this.#cache.get(snapshot.revision)
    if (previous) {
      this.#bytes -= previous.bytes
      this.#cache.delete(snapshot.revision)
    }
    const bytes = canonicalJson(snapshot).length * 2
    if (bytes > 32 * 1024 * 1024) return
    this.#cache.set(snapshot.revision, { snapshot, bytes })
    this.#bytes += bytes
    while (this.#cache.size > 100 || this.#bytes > 32 * 1024 * 1024) {
      const oldest = this.#cache.entries().next().value
      if (!oldest) break
      this.#cache.delete(oldest[0])
      this.#bytes -= oldest[1].bytes
    }
  }

  #remember(
    snapshot: DocumentAuthoritySnapshot,
    stored?: StoredReplayEvent,
    target?: DocumentAuthoritySnapshot | null,
  ) {
    // Same-schema restores copy target content exactly; only revision/time change. Flatten
    // those aliases so evicted or oversized restore baselines never replay nested prefixes.
    const sourceRevision = this.#sourceRevision(snapshot, stored, target)
    if (stored || !this.#receipts.has(snapshot.revision))
      this.#receipts.set(snapshot.revision, {
        schemaVersion: snapshot.schemaVersion,
        updatedAt: snapshot.updatedAt,
        sourceRevision,
        baseRevision: stored?.event.baseRevision ?? null,
        eventChecksum: stored?.checksum ?? null,
      })
    this.#retain(snapshot)
  }

  #sourceRevision(
    snapshot: DocumentAuthoritySnapshot,
    stored?: StoredReplayEvent,
    target?: DocumentAuthoritySnapshot | null,
  ) {
    if (
      stored?.event.type !== "org.vibeshape.document.restored" ||
      target?.schemaVersion !== snapshot.schemaVersion
    )
      return snapshot.revision
    return this.#receipts.get(target.revision)?.sourceRevision ?? target.revision
  }

  async #checkpoint(revision: number) {
    const record = await this.database.snapshotsV1.get([this.documentId, revision])
    const snapshot = record ? await validAuthoritySnapshot(record) : null
    return snapshot?.id === this.documentId && snapshot.revision === revision ? snapshot : null
  }

  async #target(event: DocumentAuthorityEvent) {
    if (
      event.type !== "org.vibeshape.document.restored" ||
      event.targetRevision >= event.baseRevision
    )
      return null
    return this.resolve(event.targetRevision)
  }

  async resolve(revision: number): Promise<DocumentAuthoritySnapshot | null> {
    const snapshot = await this.#state(revision)
    if (!snapshot || snapshot.id !== this.documentId || snapshot.revision !== revision) return null
    const source = this.#receipts.get(revision)?.sourceRevision ?? revision
    await this.#verifyAssets(snapshot, source)
    return snapshot
  }

  async #state(revision: number) {
    const cached = this.#cached(revision)
    if (cached) return cached
    if (this.#receipts.has(revision)) return this.#reconstruct(revision)
    if (this.#unavailable.some(({ first, last }) => revision >= first && revision <= last))
      return null
    return this.#load(revision)
  }

  async #verifyAssets(snapshot: DocumentAuthoritySnapshot, source: number) {
    if (this.#checkedAssets.has(source)) return
    if (snapshot.schemaVersion === 4 || snapshot.schemaVersion === 5) {
      await requireSourceAssetBytes(this.database, snapshot.assets)
      this.#checkedAssets.add(source)
    }
  }

  async #load(revision: number) {
    const exact = await this.#checkpoint(revision)
    if (exact) {
      this.#remember(exact)
      return exact
    }
    // Start an uncached historical prefix at creation or its earliest verified seed.
    // Every resolvable target is then encountered in the same forward context.
    let seed = await historicalReplaySeed(this.database, this.documentId, revision)
    this.#markUnavailable(1, (seed?.revision ?? 1) - 1)
    let snapshot = await this.replay(seed, revision, [])
    while (snapshot?.revision !== revision) {
      seed = await this.#nextSeed(snapshot, revision)
      if (!seed) return null
      // A verified later checkpoint can bridge corrupt/missing journal segments, as
      // nearest-checkpoint loading did. Gaps cannot trigger nested prefix attempts.
      snapshot = await this.replay(seed, revision, [])
    }
    return snapshot
  }

  async #nextSeed(snapshot: DocumentAuthoritySnapshot | null, revision: number) {
    const first = (snapshot?.revision ?? 0) + 1
    const seed = await earliestValidAuthoritySnapshot(
      this.database,
      this.documentId,
      first,
      revision,
    )
    this.#markUnavailable(first, (seed?.revision ?? revision + 1) - 1)
    return seed
  }

  #markUnavailable(first: number, last: number) {
    if (first <= last) this.#unavailable.push({ first, last })
  }

  async #lineage(
    revision: number,
  ): Promise<{ snapshot: DocumentAuthoritySnapshot | null; steps: number[] }> {
    const steps: number[] = []
    let cursor = revision
    let snapshot: DocumentAuthoritySnapshot | null = null
    while (cursor > 0) {
      snapshot = this.#cached(cursor)
      if (snapshot) break
      const receipt = this.#receipts.get(cursor)
      if (!receipt) {
        snapshot = await this.#load(cursor)
        break
      }
      if (receipt.baseRevision === null) {
        snapshot = (await this.#checkpoint(cursor)) ?? (await this.#load(cursor))
        break
      }
      steps.push(cursor)
      cursor = receipt.sourceRevision === cursor ? receipt.baseRevision : receipt.sourceRevision
    }
    return { snapshot, steps }
  }

  async #reconstruct(revision: number): Promise<DocumentAuthoritySnapshot | null> {
    const lineage = await this.#lineage(revision)
    let snapshot = lineage.snapshot
    const steps = lineage.steps
    if (snapshot) this.#retain(snapshot)
    for (const step of steps.reverse()) {
      snapshot = await this.#reconstructStep(snapshot, step)
      if (!snapshot) return null
      this.#retain(snapshot)
    }
    return snapshot
  }

  async #reconstructStep(snapshot: DocumentAuthoritySnapshot | null, revision: number) {
    const receipt = this.#receipts.get(revision)
    if (!receipt) return null
    if (receipt.sourceRevision !== revision)
      return snapshot?.schemaVersion === receipt.schemaVersion
        ? { ...snapshot, revision, updatedAt: receipt.updatedAt }
        : null
    const stored = await eventAt(this.database, this.documentId, revision)
    if (!stored || stored.checksum !== receipt.eventChecksum) return null
    // A restore reaches this path only across schemas. Its target has a lower authority
    // version, so reconstruction holds a bounded number of working states, not a
    // recursive stack of full historical prefixes. Promotion stays in the domain reducer.
    const target = await this.#target(stored.event)
    const reduced = reduceDocumentAuthorityEvent(snapshot, stored.event, target ?? undefined)
    return reduced.ok ? reduced.snapshot : null
  }

  async replay(seed: DocumentAuthoritySnapshot | null, headRevision: number, corrupt: string[]) {
    let snapshot = seed
    if (seed) this.#remember(seed)
    for (let revision = (seed?.revision ?? 0) + 1; revision <= headRevision; revision += 1) {
      const stored = await eventAt(this.database, this.documentId, revision)
      if (!stored) {
        corrupt.push(`event-authority:${revision}`)
        break
      }
      const target = await this.#target(stored.event)
      const reduced = reduceDocumentAuthorityEvent(snapshot, stored.event, target ?? undefined)
      if (!reduced.ok) {
        corrupt.push(`event-authority:${revision}`)
        break
      }
      snapshot = reduced.snapshot
      this.#remember(snapshot, stored, target)
    }
    return snapshot
  }
}

export async function loadAuthorityRestoreTarget(
  database: VibeShapeDatabase,
  documentId: DocumentId,
  revision: number,
): Promise<DocumentAuthoritySnapshot | null> {
  return new AuthorityReplayContext(database, documentId).resolve(revision)
}

export async function recoverAuthoritySnapshot(
  database: VibeShapeDatabase,
  project: ProjectAuthorityRecord,
) {
  const corruptRecords: string[] = []
  const seed = await latestValidAuthoritySnapshot(
    database,
    project.documentId,
    project.latestSnapshotRevision,
    corruptRecords,
  )
  const snapshot = await new AuthorityReplayContext(database, project.documentId).replay(
    seed,
    project.headRevision,
    corruptRecords,
  )
  if (!snapshot || snapshot.schemaVersion !== project.schemaVersion)
    throw persistenceInvariantError(
      "corrupt-history",
      "Recovery cannot cross the document authority version boundary.",
    )
  if (project.schemaVersion !== 1 && snapshot.revision < project.upgradeRevision)
    throw persistenceInvariantError(
      "corrupt-history",
      "No valid V2 revision remains at the recorded upgrade boundary.",
    )
  if (
    project.schemaVersion >= 3 &&
    "textureUpgradeRevision" in project &&
    snapshot.revision < project.textureUpgradeRevision
  )
    throw persistenceInvariantError(
      "corrupt-history",
      "Recovery cannot cross the committed texture authority boundary.",
    )
  if (
    project.schemaVersion >= 4 &&
    "sourceUpgradeRevision" in project &&
    snapshot.revision < project.sourceUpgradeRevision
  )
    throw persistenceInvariantError(
      "corrupt-history",
      "No valid V3 revision remains at its source upgrade boundary.",
    )
  if (project.schemaVersion === 5 && snapshot.revision < project.repairUpgradeRevision)
    throw persistenceInvariantError(
      "corrupt-history",
      "Recovery cannot cross committed repair authority.",
    )
  if (snapshot.schemaVersion === 4 || snapshot.schemaVersion === 5)
    await requireSourceAssetBytes(database, snapshot.assets)
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
        navigation: lostRevisionCount === 0 ? project.navigation : undefined,
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
