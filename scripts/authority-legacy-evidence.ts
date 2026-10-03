import {
  applyDocumentCommand,
  applyDocumentUpgradeV2Command,
  canonicalJson,
} from "../packages/domain/src/index"
import { VibeShapeDatabase } from "../packages/persistence/src/database"
import { acquireDocumentLease } from "../packages/persistence/src/lease"
import { LocalDocumentRepository } from "../packages/persistence/src/repository"
import { VersionedLocalDocumentRepository } from "../packages/persistence/src/versioned-repository"
import {
  authorityEnvelope,
  authorityId,
  authorityTimestamp,
  evidenceValue,
} from "./authority-persistence-fixture"

export async function verifyLegacyAuthorityBridge(name: string) {
  const database = new VibeShapeDatabase(`${name}-legacy`)
  const importedDatabase = new VibeShapeDatabase(`${name}-legacy-import`)
  const documentId = authorityId(1)
  const sessionId = authorityId(900)
  const lease = { epoch: 1, nowMs: 1 }
  const storedAt = authorityTimestamp
  try {
    const legacy = new LocalDocumentRepository(database)
    const repository = new VersionedLocalDocumentRepository(database)
    const created = evidenceValue(
      applyDocumentCommand(null, {
        ...authorityEnvelope(0),
        schemaVersion: 1,
        kind: "org.vibeshape.document.create",
        payload: { name: "Retained legacy" },
      }),
    )
    evidenceValue(
      await legacy.commit({
        sessionId,
        lease: null,
        storedAt,
        baseSnapshot: null,
        event: created.event,
        snapshot: created.snapshot,
      }),
    )
    const bytesBefore = canonicalJson(await database.events.toArray())
    evidenceValue(
      await acquireDocumentLease(database, {
        documentId,
        ownerId: sessionId,
        nowMs: 0,
        durationMs: 60_000,
      }),
    )
    const migrated = evidenceValue(await legacy.recoverMigrated(documentId)).value
    evidenceValue(
      await repository.promote({
        sessionId,
        lease,
        storedAt,
        sourceHeadRevision: 1,
        snapshot: migrated.snapshot,
        migrationProvenance: migrated.migration.provenance,
        migrationDiagnostic: migrated.migration.diagnostic,
        unavailableRecords: migrated.migration.unavailableRecords,
      }),
    )
    const upgraded = evidenceValue(
      applyDocumentUpgradeV2Command(migrated.snapshot, {
        ...authorityEnvelope(1),
        schemaVersion: 2,
        kind: "org.vibeshape.document.upgrade-v2",
        payload: { partAllocations: [] },
      }),
    )
    evidenceValue(
      await repository.commitAuthority({
        sessionId,
        lease,
        storedAt,
        baseSnapshot: migrated.snapshot,
        event: upgraded.event,
        snapshot: upgraded.snapshot,
      }),
    )
    const portable = evidenceValue(await repository.exportPortableProjectV3(documentId)).value
    if (
      portable.historyMode !== "complete" ||
      portable.promotionRevision !== 1 ||
      portable.legacyEvents.length !== 1 ||
      portable.versionedEvents.length !== 1
    )
      throw new Error("The portable authority lost its original migration boundary.")
    if (canonicalJson(await database.events.toArray()) !== bytesBefore)
      throw new Error("The V2 upgrade rewrote legacy bytes.")
    const imported = new VersionedLocalDocumentRepository(importedDatabase)
    evidenceValue(
      await imported.importPortableProjectV3({
        ...portable,
        importedAt: storedAt,
        exportedAt: storedAt,
      }),
    )
    if (
      canonicalJson(evidenceValue(await imported.recoverAuthority(documentId)).value.snapshot) !==
      canonicalJson(upgraded.snapshot)
    )
      throw new Error("The imported legacy bridge did not recover authored authority.")
    return true
  } finally {
    await database.delete()
    await importedDatabase.delete()
  }
}
