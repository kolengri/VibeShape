import {
  type AuthoredDocumentSnapshot,
  canonicalJson,
  commandActorsEqual,
  type DocumentAuthorityEvent,
  type DocumentAuthoritySnapshot,
  documentEventSourceAssets,
  documentSourceAssetClosure,
  reduceDocumentAuthorityEvent,
  type SourceAssetBlob,
} from "@vibeshape/domain"
import {
  requireAuthorityProject,
  requireSupportedAuthorityVersion,
  storeAuthorityEvent,
  storeAuthoritySnapshot,
  validAuthorityEvent,
} from "./authority-records"
import { loadAuthorityRestoreTarget, recoverAuthoritySnapshot } from "./authority-recovery"
import {
  type ProjectAuthorityRecord,
  persistenceAuthorityCommitInputSchema,
  persistenceAuthorityDraftCommitInputSchema,
  projectRecordV2Schema,
  projectRecordV3Schema,
  projectRecordV4Schema,
  recoveryAuthorityRecordSchema,
  recoveryRecordV2Schema,
  recoveryRecordV3Schema,
  recoveryRecordV4Schema,
} from "./authority-schemas"
import type { VibeShapeDatabase } from "./database"
import {
  classifyPersistenceError,
  createPersistenceDiagnostic,
  persistenceInvariantError,
} from "./diagnostics"
import type { CommitReport, DraftCommitReport, PersistenceResult } from "./repository"
import type { WriterLeaseClaim } from "./schemas"
import { publishSourceAssetBytes, verifySourceAssetBlobs } from "./source-asset-store"
import { versionedSemanticWriteTransaction } from "./versioned-storage-transaction"
import { requireWriterLease } from "./writer-lease-authority"

type AuthorityWrite = Readonly<{
  sessionId: string
  lease: WriterLeaseClaim | null
  storedAt: string
  baseSnapshot: DocumentAuthoritySnapshot
  snapshot: AuthoredDocumentSnapshot
  events: readonly DocumentAuthorityEvent[]
  assetBlobs: readonly SourceAssetBlob[]
}>

async function validateSequence(database: VibeShapeDatabase, input: AuthorityWrite) {
  let snapshot: DocumentAuthoritySnapshot = input.baseSnapshot
  for (const event of input.events) {
    const target =
      event.type === "org.vibeshape.document.restored"
        ? await loadAuthorityRestoreTarget(database, event.documentId, event.targetRevision)
        : null
    const reduced = reduceDocumentAuthorityEvent(snapshot, event, target ?? undefined)
    if (!reduced.ok)
      throw persistenceInvariantError(
        "invalid-input",
        "The authority event does not extend its supplied base.",
      )
    snapshot = reduced.snapshot
  }
  if (canonicalJson(snapshot) !== canonicalJson(input.snapshot))
    throw persistenceInvariantError(
      "invalid-input",
      "The authority snapshot does not match its event sequence.",
    )
}

async function verifyStoredBase(database: VibeShapeDatabase, input: AuthorityWrite) {
  const project = await requireAuthorityProject(database, input.baseSnapshot.id)
  if (
    project.headRevision !== input.baseSnapshot.revision ||
    project.schemaVersion !== input.baseSnapshot.schemaVersion
  )
    throw persistenceInvariantError("stale-revision", "The persisted authority head changed.")
  if (project.migrationDiagnostic !== null || project.unavailableRecords.length > 0)
    throw persistenceInvariantError(
      "corrupt-history",
      "Degraded recovery cannot become writable authority.",
    )
  const recovered = await recoverAuthoritySnapshot(database, project)
  if (
    recovered.snapshot.revision !== project.headRevision ||
    canonicalJson(recovered.snapshot) !== canonicalJson(input.baseSnapshot)
  )
    throw persistenceInvariantError(
      "stale-revision",
      "The supplied authority base is not the recovered persisted head.",
    )
}

function nextProject(current: ProjectAuthorityRecord, input: AuthorityWrite) {
  const schema = { 2: projectRecordV2Schema, 3: projectRecordV3Schema, 4: projectRecordV4Schema }[
    input.snapshot.schemaVersion
  ]
  return schema.parse({
    ...current,
    schemaVersion: input.snapshot.schemaVersion,
    ...authorityUpgradeBoundaries(current, input),
    name: input.snapshot.name,
    headRevision: input.snapshot.revision,
    latestSnapshotRevision: input.snapshot.revision,
    cleanCloseRevision: null,
    updatedAt: input.storedAt,
  })
}

async function publicationClosure(database: VibeShapeDatabase, input: AuthorityWrite) {
  const historical: DocumentAuthorityEvent[] = []
  if (input.events.some((event) => documentEventSourceAssets(event).length > 0)) {
    const records = await database.eventsV1
      .where("documentId")
      .equals(input.snapshot.id)
      .limit(100_001)
      .toArray()
    if (records.length > 100_000)
      throw persistenceInvariantError(
        "corrupt-history",
        "The source journal exceeds its event budget.",
      )
    for (const record of records) {
      const event = await validAuthorityEvent(record)
      if (!event)
        throw persistenceInvariantError(
          "corrupt-history",
          "The historical source authority journal is corrupt.",
        )
      historical.push(event)
    }
  }
  try {
    return documentSourceAssetClosure(
      input.baseSnapshot,
      [...historical, ...input.events],
      input.snapshot,
    )
  } catch {
    throw persistenceInvariantError(
      "invalid-input",
      "Source identities cannot change their immutable historical declarations.",
    )
  }
}

async function writeAuthorityRecords(database: VibeShapeDatabase, input: AuthorityWrite) {
  await validateSequence(database, input)
  await verifyStoredBase(database, input)
  const prepared = await verifySourceAssetBlobs(input.assetBlobs)
  const assets = await publicationClosure(database, input)
  const records = {
    events: await Promise.all(
      input.events.map((event) => storeAuthorityEvent(event, input.storedAt)),
    ),
    snapshot: await storeAuthoritySnapshot(input.snapshot, input.storedAt),
  }
  await versionedSemanticWriteTransaction(database, async () => {
    const current = await requireAuthorityProject(database, input.snapshot.id)
    if (
      current.headRevision !== input.baseSnapshot.revision ||
      current.schemaVersion !== input.baseSnapshot.schemaVersion
    )
      throw persistenceInvariantError("stale-revision", "The authority head changed before commit.")
    requireWriterLease(true, await database.leases.get(input.snapshot.id), input)
    const project = nextProject(current, input)
    const marker = await database.recoveryV1.get(input.snapshot.id)
    requireSupportedAuthorityVersion(marker)
    const recovery = recoveryAuthorityRecordSchema.safeParse(marker)
    await publishSourceAssetBytes(database, assets, prepared)
    await database.eventsV1.bulkAdd(records.events)
    await database.snapshotsV1.add(records.snapshot)
    await database.projectsV1.put(project)
    await database.recoveryV1.put(
      (input.snapshot.schemaVersion === 4
        ? recoveryRecordV4Schema
        : input.snapshot.schemaVersion === 3
          ? recoveryRecordV3Schema
          : recoveryRecordV2Schema
      ).parse({
        schemaVersion: input.snapshot.schemaVersion,
        documentId: input.snapshot.id,
        sessionId: input.sessionId,
        openedAt: recovery.success ? recovery.data.openedAt : input.storedAt,
        updatedAt: input.storedAt,
        lastConfirmedRevision: input.snapshot.revision,
        migrationProvenance: project.migrationProvenance,
        migrationDiagnostic: project.migrationDiagnostic,
        unavailableRecords: project.unavailableRecords,
      }),
    )
  })
  return records
}

export async function commitDocumentAuthority(
  database: VibeShapeDatabase,
  inputValue: unknown,
): Promise<PersistenceResult<CommitReport>> {
  const parsed = persistenceAuthorityCommitInputSchema.safeParse(inputValue)
  if (
    !parsed.success ||
    parsed.data.baseSnapshot === null ||
    parsed.data.snapshot.schemaVersion === 1 ||
    parsed.data.event.schemaVersion === 1
  )
    return {
      ok: false,
      diagnostic: createPersistenceDiagnostic(
        "invalid-input",
        "An authority commit requires a base and one explicitly versioned authored event/result.",
      ),
    }
  try {
    const records = await writeAuthorityRecords(database, {
      ...parsed.data,
      baseSnapshot: parsed.data.baseSnapshot,
      snapshot: parsed.data.snapshot,
      events: [parsed.data.event],
    })
    const event = records.events[0]
    if (!event)
      throw persistenceInvariantError("invalid-input", "The committed authority event is missing.")
    return {
      ok: true,
      value: {
        documentId: parsed.data.snapshot.id,
        revision: parsed.data.snapshot.revision,
        eventChecksum: event.checksum,
        snapshotChecksum: records.snapshot.checksum,
      },
    }
  } catch (error) {
    return { ok: false, diagnostic: classifyPersistenceError(error) }
  }
}

function draftEnvelopesMatch(
  input: ReturnType<typeof persistenceAuthorityDraftCommitInputSchema.parse>,
): boolean {
  const first = input.events[0]
  return (
    first !== undefined &&
    input.events.every(
      (event) =>
        event.schemaVersion !== 1 &&
        event.type !== "org.vibeshape.document.restored" &&
        event.transactionId === input.transactionId &&
        event.documentId === input.snapshot.id &&
        commandActorsEqual(first.actor, event.actor),
    )
  )
}

export async function commitDocumentAuthorityDraft(
  database: VibeShapeDatabase,
  inputValue: unknown,
): Promise<PersistenceResult<DraftCommitReport>> {
  const parsed = persistenceAuthorityDraftCommitInputSchema.safeParse(inputValue)
  if (
    !parsed.success ||
    parsed.data.snapshot.schemaVersion === 1 ||
    !draftEnvelopesMatch(parsed.data)
  )
    return {
      ok: false,
      diagnostic: createPersistenceDiagnostic(
        "invalid-input",
        "The authority draft must contain one actor and transaction's authored events.",
      ),
    }
  try {
    const records = await writeAuthorityRecords(database, {
      ...parsed.data,
      snapshot: parsed.data.snapshot,
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

function authorityUpgradeBoundaries(current: ProjectAuthorityRecord, input: AuthorityWrite) {
  const revision = (type: DocumentAuthorityEvent["type"]) =>
    input.events.find((event) => event.type === type)?.revision
  const upgradeRevision =
    "upgradeRevision" in current
      ? current.upgradeRevision
      : revision("org.vibeshape.document.upgraded-v2")
  if (input.snapshot.schemaVersion === 2) return { upgradeRevision }
  const textureUpgradeRevision =
    "textureUpgradeRevision" in current
      ? current.textureUpgradeRevision
      : revision("org.vibeshape.document.upgraded-v3")
  if (input.snapshot.schemaVersion === 3) return { upgradeRevision, textureUpgradeRevision }
  const sourceUpgradeRevision =
    current.schemaVersion === 4
      ? current.sourceUpgradeRevision
      : revision("org.vibeshape.document.upgraded-v4")
  return { upgradeRevision, textureUpgradeRevision, sourceUpgradeRevision }
}
