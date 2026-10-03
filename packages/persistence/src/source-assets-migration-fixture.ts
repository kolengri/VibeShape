import {
  canonicalJson,
  type DocumentAuthorityEvent,
  type DocumentSnapshotV2,
} from "@vibeshape/domain"
import Dexie from "dexie"
import { storeAuthorityEvent, storeAuthoritySnapshot } from "./authority-records"
import { projectRecordV2Schema } from "./authority-schemas"
import { VibeShapeDatabase } from "./database"
import { VersionedLocalDocumentRepository } from "./versioned-repository"

/** Browser evidence for the actual old database layout, without opening it through the new version. */
export async function sourceAssetsMigrationEvidence(
  name: string,
  snapshot: DocumentSnapshotV2,
  events: readonly DocumentAuthorityEvent[],
  storedAt: string,
) {
  const old = new Dexie(name)
  old.version(3).stores({
    projects: "documentId, updatedAt",
    snapshots: "[documentId+revision], documentId, revision",
    events: "[documentId+revision], documentId, revision, &commandId",
    recovery: "documentId, updatedAt",
    leases: "documentId, expiresAt",
    cacheIndex: "contentHash, lastAccessedAt, engineBuildId",
    projectThumbnails: "documentId, revision, generatedAt",
    projectsV1: "documentId, updatedAt",
    snapshotsV1: "[documentId+revision], documentId, revision",
    eventsV1: "[documentId+revision], documentId, revision, &commandId",
    recoveryV1: "documentId, updatedAt",
  })
  const upgrade = events.find((event) => event.type === "org.vibeshape.document.upgraded-v2")
  const project = projectRecordV2Schema.parse({
    schemaVersion: 2,
    documentId: snapshot.id,
    name: snapshot.name,
    headRevision: snapshot.revision,
    latestSnapshotRevision: snapshot.revision,
    cleanCloseRevision: snapshot.revision,
    createdAt: snapshot.createdAt,
    updatedAt: storedAt,
    lastExternalBackupAt: null,
    migrationProvenance: "current",
    migrationDiagnostic: null,
    unavailableRecords: [],
    upgradeRevision: upgrade?.revision,
  })
  await old.table("projectsV1").add(project)
  await old.table("snapshotsV1").add(await storeAuthoritySnapshot(snapshot, storedAt))
  await old
    .table("eventsV1")
    .bulkAdd(await Promise.all(events.map((event) => storeAuthorityEvent(event, storedAt))))
  old.close()
  const next = new VibeShapeDatabase(name)
  try {
    const recovered = await new VersionedLocalDocumentRepository(next).recoverAuthority(snapshot.id)
    if (
      !recovered.ok ||
      canonicalJson(recovered.value.snapshot) !== canonicalJson(snapshot) ||
      next.verno !== 4 ||
      (await next.assetBlobs.count()) !== 0
    )
      throw new Error("The IndexedDB V3 migration changed historical authority.")
    return true
  } finally {
    await next.delete()
  }
}
