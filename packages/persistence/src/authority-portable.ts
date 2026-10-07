import {
  canonicalJson,
  type DocumentId,
  type DocumentSnapshotV2,
  type DocumentSnapshotV3,
  type DocumentSnapshotV4,
  type DocumentSnapshotV5,
  documentIdSchema,
  documentSourceAssetClosure,
  migrateDocumentSnapshot,
  replayDocumentAuthorityEvents,
  replayDocumentEvents,
  type SourceAssetBlob,
} from "@vibeshape/domain"
import { sourceAssetBlobSchema } from "@vibeshape/domain/source-assets"
import { z } from "zod"
import {
  requireAuthorityProject,
  storeAuthorityEvent,
  storeAuthoritySnapshot,
  validAuthoritySnapshot,
} from "./authority-records"
import { authorityEventsThrough } from "./authority-recovery"
import {
  type PortableProjectV3,
  type PortableProjectV4,
  type PortableProjectV5,
  type PortableProjectV6,
  type ProjectRecordV2,
  type ProjectRecordV3,
  type ProjectRecordV4,
  type ProjectRecordV5,
  portableProjectV3PayloadSchema,
  portableProjectV4PayloadSchema,
  portableProjectV5PayloadSchema,
  portableProjectV6PayloadSchema,
  projectRecordV2Schema,
  projectRecordV3Schema,
  projectRecordV4Schema,
  projectRecordV5Schema,
} from "./authority-schemas"
import type { VibeShapeDatabase } from "./database"
import {
  classifyPersistenceError,
  createPersistenceDiagnostic,
  persistenceInvariantError,
} from "./diagnostics"
import { importedLegacyProject, storedLegacyPortableRecords } from "./portable-legacy-records"
import {
  LocalDocumentRepository,
  type PersistenceResult,
  type PortableProjectImportReport,
} from "./repository"
import { projectRecordSchema } from "./schemas"
import {
  publishSourceAssetBytes,
  readSourceAssetBytes,
  verifySourceAssetBlobs,
} from "./source-asset-store"

async function parsePortablePayload(
  database: VibeShapeDatabase,
  project: ProjectRecordV2 | ProjectRecordV3 | ProjectRecordV4 | ProjectRecordV5,
  input: unknown,
): Promise<PortableProjectV3 | PortableProjectV4 | PortableProjectV5 | PortableProjectV6> {
  if (project.schemaVersion === 2) return portableProjectV3PayloadSchema.parse(input)
  if (project.schemaVersion === 3)
    return portableProjectV4PayloadSchema.parse({
      ...z.record(z.string(), z.unknown()).parse(input),
      textureUpgradeRevision: project.textureUpgradeRevision,
    })
  const schema =
    project.schemaVersion === 5 ? portableProjectV6PayloadSchema : portableProjectV5PayloadSchema
  const partial = z
    .object({
      ...schema.shape,
      assetBlobs: z.array(sourceAssetBlobSchema).default([]),
      textureUpgradeRevision: portableProjectV5PayloadSchema.shape.textureUpgradeRevision.default(
        project.textureUpgradeRevision,
      ),
      ...(project.schemaVersion === 5
        ? {
            repairUpgradeRevision:
              portableProjectV6PayloadSchema.shape.repairUpgradeRevision.default(
                project.repairUpgradeRevision,
              ),
          }
        : {}),
      sourceUpgradeRevision: portableProjectV5PayloadSchema.shape.sourceUpgradeRevision.default(
        project.sourceUpgradeRevision,
      ),
    })
    .strict()
    .parse(input)
  const closure = documentSourceAssetClosure(
    partial.seed,
    partial.versionedEvents,
    partial.snapshot,
  )
  const digests = new Set<string>()
  const assetBlobs: SourceAssetBlob[] = []
  for (const asset of closure) {
    if (digests.has(asset.digest)) continue
    const read = await readSourceAssetBytes(database, asset.digest)
    if (!read.ok)
      throw persistenceInvariantError(
        "corrupt-history",
        "The full historical source closure cannot be exported.",
      )
    assetBlobs.push({ digest: asset.digest, bytes: Uint8Array.from(read.value) })
    digests.add(asset.digest)
  }
  return schema.parse({ ...partial, assetBlobs })
}

function validatePortableAuthority(
  project: PortableProjectV3 | PortableProjectV4 | PortableProjectV5 | PortableProjectV6,
) {
  let legacySnapshot = null
  if (project.historyMode === "complete" && project.seed) {
    const legacy = replayDocumentEvents(project.legacyEvents)
    if (!legacy.ok)
      throw persistenceInvariantError("corrupt-history", "The portable legacy history is invalid.")
    const migrated = migrateDocumentSnapshot(legacy.snapshot, project.legacyEvents)
    if (!migrated.ok || canonicalJson(migrated.snapshot) !== canonicalJson(project.seed))
      throw persistenceInvariantError(
        "corrupt-history",
        "The legacy journal does not reproduce the promotion seed.",
      )
    legacySnapshot = legacy.snapshot
  }
  const replayed = replayDocumentAuthorityEvents(project.seed, project.versionedEvents)
  if (!replayed.ok || canonicalJson(replayed.snapshot) !== canonicalJson(project.snapshot))
    throw persistenceInvariantError(
      "corrupt-history",
      "The authority journal does not reproduce the portable snapshot.",
    )
  return legacySnapshot
}

async function exactSnapshot(
  database: VibeShapeDatabase,
  documentId: DocumentId,
  revision: number,
) {
  const snapshot = await validAuthoritySnapshot(
    await database.snapshotsV1.get([documentId, revision]),
  )
  if (!snapshot)
    throw persistenceInvariantError(
      "corrupt-history",
      "The exact authority snapshot is missing or invalid.",
    )
  return snapshot
}

async function checkpoint(
  database: VibeShapeDatabase,
  snapshot: DocumentSnapshotV2 | DocumentSnapshotV3 | DocumentSnapshotV4 | DocumentSnapshotV5,
  project: ProjectRecordV2 | ProjectRecordV3 | ProjectRecordV4 | ProjectRecordV5,
  evidence: string[],
) {
  return parsePortablePayload(database, project, {
    snapshot,
    seed: snapshot,
    legacyEvents: [],
    versionedEvents: [],
    historyMode: "checkpoint",
    promotionRevision: snapshot.revision,
    upgradeRevision: project.upgradeRevision,
    migrationDiagnostic: {
      code: "legacy-journal-unavailable",
      message:
        "The complete mixed journal cannot be proven; this file preserves a read-only checkpoint.",
    },
    unavailableRecords: evidence.length ? evidence : ["authority-history"],
  })
}

async function validatedCompleteOrCheckpoint(
  database: VibeShapeDatabase,
  input: unknown,
  snapshot: DocumentSnapshotV2 | DocumentSnapshotV3 | DocumentSnapshotV4 | DocumentSnapshotV5,
  project: ProjectRecordV2 | ProjectRecordV3 | ProjectRecordV4 | ProjectRecordV5,
) {
  let parsed: PortableProjectV3 | PortableProjectV4 | PortableProjectV5 | PortableProjectV6
  try {
    parsed = await parsePortablePayload(database, project, input)
  } catch (error) {
    if (error instanceof Error && error.name === "ZodError")
      return checkpoint(database, snapshot, project, ["authority-boundary"])
    throw error
  }
  try {
    validatePortableAuthority(parsed)
  } catch {
    return checkpoint(database, snapshot, project, ["authority-replay"])
  }
  return parsed
}

async function readLegacyBoundary(
  database: VibeShapeDatabase,
  project: ProjectRecordV2 | ProjectRecordV3 | ProjectRecordV4 | ProjectRecordV5,
) {
  const record = await database.projects.get(project.documentId)
  if (!record) return { seed: null, events: [], evidence: [] }
  const legacy = projectRecordSchema.safeParse(record)
  if (!legacy.success) return { seed: null, events: [], evidence: ["legacy-head"] }
  const seed = await validAuthoritySnapshot(
    await database.snapshotsV1.get([project.documentId, legacy.data.headRevision]),
  )
  if (!seed) return { seed: null, events: [], evidence: ["promotion-seed"] }
  const exported = await new LocalDocumentRepository(database).exportPortableProject(
    project.documentId,
  )
  return exported.ok
    ? { seed, events: exported.value.events, evidence: [] }
    : { seed, events: [], evidence: ["legacy-prefix"] }
}

async function assembleComplete(
  database: VibeShapeDatabase,
  project: ProjectRecordV2 | ProjectRecordV3 | ProjectRecordV4 | ProjectRecordV5,
  snapshot: DocumentSnapshotV2 | DocumentSnapshotV3 | DocumentSnapshotV4 | DocumentSnapshotV5,
) {
  const boundary = await readLegacyBoundary(database, project)
  if (boundary.evidence.length) return checkpoint(database, snapshot, project, boundary.evidence)
  const corrupt: string[] = []
  const versionedEvents = await authorityEventsThrough(
    database,
    project.documentId,
    (boundary.seed?.revision ?? 0) + 1,
    project.headRevision,
    corrupt,
  )
  if (corrupt.length) return checkpoint(database, snapshot, project, corrupt)
  return validatedCompleteOrCheckpoint(
    database,
    {
      snapshot,
      seed: boundary.seed,
      legacyEvents: boundary.events,
      versionedEvents,
      historyMode: "complete",
      promotionRevision: boundary.seed?.revision ?? 0,
      upgradeRevision: project.upgradeRevision,
      migrationDiagnostic: null,
      unavailableRecords: [],
    },
    snapshot,
    project,
  )
}

export async function exportDocumentAuthority(
  database: VibeShapeDatabase,
  input: unknown,
): Promise<
  PersistenceResult<PortableProjectV3 | PortableProjectV4 | PortableProjectV5 | PortableProjectV6>
> {
  const documentId = documentIdSchema.safeParse(input)
  if (!documentId.success)
    return {
      ok: false,
      diagnostic: createPersistenceDiagnostic("invalid-input", "The document ID is invalid."),
    }
  try {
    const project = await requireAuthorityProject(database, documentId.data)
    if (project.schemaVersion === 1)
      throw persistenceInvariantError(
        "invalid-input",
        "Authored export requires a V2 or V3 document.",
      )
    const snapshot = await exactSnapshot(database, project.documentId, project.headRevision)
    if (snapshot.schemaVersion === 1)
      throw persistenceInvariantError(
        "corrupt-history",
        "The authority head and snapshot versions disagree.",
      )
    return { ok: true, value: await assembleComplete(database, project, snapshot) }
  } catch (error) {
    return { ok: false, diagnostic: classifyPersistenceError(error) }
  }
}

async function preparePortableAuthority(
  project: PortableProjectV3 | PortableProjectV4 | PortableProjectV5 | PortableProjectV6,
  storedAt: string,
  backupAt: string | null,
) {
  const legacySnapshot = validatePortableAuthority(project)
  const legacy = legacySnapshot
    ? {
        ...(await storedLegacyPortableRecords(project.legacyEvents, legacySnapshot, storedAt)),
        project: importedLegacyProject(legacySnapshot, storedAt, backupAt),
      }
    : null
  const events = await Promise.all(
    project.versionedEvents.map((event) => storeAuthorityEvent(event, storedAt)),
  )
  const snapshots = project.seed ? [await storeAuthoritySnapshot(project.seed, storedAt)] : []
  if (!project.seed || project.seed.revision !== project.snapshot.revision)
    snapshots.push(await storeAuthoritySnapshot(project.snapshot, storedAt))
  const head = portableAuthorityHead(project, storedAt, backupAt)
  const prepared = "assetBlobs" in project ? await verifySourceAssetBlobs(project.assetBlobs) : []
  return { legacy, events, snapshots, head, prepared }
}

export async function publishPortableAuthority(
  database: VibeShapeDatabase,
  project: PortableProjectV3 | PortableProjectV4 | PortableProjectV5 | PortableProjectV6,
  storedAt: string,
  backupAt: string | null,
): Promise<PortableProjectImportReport> {
  if (project.historyMode !== "complete")
    throw persistenceInvariantError(
      "invalid-input",
      "A checkpoint cannot become writable authority.",
    )
  const records = await preparePortableAuthority(project, storedAt, backupAt)
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
      database.assetBlobs,
    ],
    async () => {
      const id = project.snapshot.id
      if (
        (await database.projectsV1.get(id)) ||
        (await database.projects.get(id)) ||
        (await database.leases.get(id))
      )
        throw persistenceInvariantError(
          "document-already-exists",
          "The local document or its writer lease already exists.",
        )
      if (records.legacy) {
        await database.projects.add(records.legacy.project)
        await database.events.bulkAdd(records.legacy.events)
        await database.snapshots.add(records.legacy.snapshot)
      }
      await publishSourceAssetBytes(
        database,
        documentSourceAssetClosure(project.seed, project.versionedEvents, project.snapshot),
        records.prepared,
      )
      await database.eventsV1.bulkAdd(records.events)
      await database.snapshotsV1.bulkAdd(records.snapshots)
      await database.projectsV1.add(records.head)
      await database.recovery.delete(id)
      await database.recoveryV1.delete(id)
    },
  )
  return {
    documentId: project.snapshot.id,
    revision: project.snapshot.revision,
    eventChecksums: [...(records.legacy?.events ?? []), ...records.events].map(
      (event) => event.checksum,
    ),
    snapshotChecksum: records.snapshots.at(-1)?.checksum ?? "",
  }
}

function portableAuthorityHead(
  project: PortableProjectV3 | PortableProjectV4 | PortableProjectV5 | PortableProjectV6,
  storedAt: string,
  backupAt: string | null,
) {
  return {
    2: projectRecordV2Schema,
    3: projectRecordV3Schema,
    4: projectRecordV4Schema,
    5: projectRecordV5Schema,
  }[project.snapshot.schemaVersion].parse({
    schemaVersion: project.snapshot.schemaVersion,
    ...("textureUpgradeRevision" in project
      ? { textureUpgradeRevision: project.textureUpgradeRevision }
      : {}),
    ...("sourceUpgradeRevision" in project
      ? { sourceUpgradeRevision: project.sourceUpgradeRevision }
      : {}),
    ...("repairUpgradeRevision" in project
      ? { repairUpgradeRevision: project.repairUpgradeRevision }
      : {}),
    documentId: project.snapshot.id,
    name: project.snapshot.name,
    headRevision: project.snapshot.revision,
    latestSnapshotRevision: project.snapshot.revision,
    cleanCloseRevision: project.snapshot.revision,
    createdAt: project.snapshot.createdAt,
    updatedAt: storedAt,
    lastExternalBackupAt: backupAt,
    migrationProvenance: project.seed ? "journal-derived" : "current",
    migrationDiagnostic: null,
    unavailableRecords: [],
    upgradeRevision: project.upgradeRevision,
  })
}
