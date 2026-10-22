import { describe, expect, it } from "bun:test"
import { vi } from "../../../tests/unit/support/bun-test"
import { historyRepairJournalFixture } from "../../domain/src/history-repair.test-fixture"
import * as portableAuthority from "./authority-portable"
import {
  storeAuthorityEvent,
  storeAuthoritySnapshot,
  validAuthorityEvent,
  validAuthoritySnapshot,
} from "./authority-records"
import { portableProjectV6PayloadSchema, projectRecordV5Schema } from "./authority-schemas"
import { VibeShapeDatabase } from "./database"
import { VersionedLocalDocumentRepository } from "./versioned-repository"

describe("stored disconnected History authority", () => {
  it("admits complete V6 copies and imports through the production repository dispatcher", async () => {
    const fixture = historyRepairJournalFixture()
    const revision = fixture.removed.snapshot.revision
    const payload = {
      snapshot: fixture.removed.snapshot,
      seed: null,
      legacyEvents: [],
      versionedEvents: fixture.events,
      assetBlobs: [],
      historyMode: "complete",
      promotionRevision: 0,
      upgradeRevision: fixture.upgradeRevision,
      textureUpgradeRevision: revision,
      sourceUpgradeRevision: revision,
      repairUpgradeRevision: revision,
      migrationDiagnostic: null,
      unavailableRecords: [],
    }
    const storedAt = fixture.removed.snapshot.updatedAt
    const published = vi.spyOn(portableAuthority, "publishPortableAuthority").mockResolvedValue({
      documentId: fixture.removed.snapshot.id,
      revision,
      eventChecksums: [],
      snapshotChecksum: "test-checksum",
    })
    try {
      const database = new VibeShapeDatabase("v6-dispatch-test")
      const repository = new VersionedLocalDocumentRepository(database)
      expect(
        await repository.copyPortableProjectV6({ ...payload, copiedAt: storedAt }),
      ).toMatchObject({ ok: true })
      expect(published).toHaveBeenLastCalledWith(
        database,
        { ...payload, copiedAt: storedAt },
        storedAt,
        null,
      )
      expect(
        await repository.importPortableProjectV3({
          ...payload,
          importedAt: storedAt,
          exportedAt: storedAt,
        }),
      ).toMatchObject({ ok: true })
      expect(published).toHaveBeenCalledTimes(2)
      expect(
        await repository.copyPortableProjectV6({
          ...payload,
          versionedEvents: [],
          copiedAt: storedAt,
        }),
      ).toMatchObject({ ok: false, diagnostic: { code: "invalid-input" } })
      expect(published).toHaveBeenCalledTimes(2)
    } finally {
      published.mockRestore()
    }
  })

  it("preserves typed repair state under checksummed V5 records and refuses corrupt or mismatched versions", async () => {
    const fixture = historyRepairJournalFixture()
    const storedAt = fixture.removed.snapshot.updatedAt
    const snapshot = await storeAuthoritySnapshot(fixture.removed.snapshot, storedAt)
    const event = await storeAuthorityEvent(fixture.removed.event, storedAt)
    expect(await validAuthoritySnapshot(snapshot)).toEqual(fixture.removed.snapshot)
    expect(await validAuthorityEvent(event)).toEqual(fixture.removed.event)
    expect(await validAuthoritySnapshot({ ...snapshot, checksum: "0".repeat(64) })).toBeNull()
    expect(await validAuthoritySnapshot({ ...snapshot, schemaVersion: 4 })).toBeNull()
    await expect(validAuthoritySnapshot({ ...snapshot, schemaVersion: 7 })).rejects.toThrow()
  })
  it("validates explicit atomic adoption and portable replay without relaxing old authority heads", () => {
    const fixture = historyRepairJournalFixture()
    const revision = fixture.removed.snapshot.revision
    const payload = {
      snapshot: fixture.removed.snapshot,
      seed: null,
      legacyEvents: [],
      versionedEvents: fixture.events,
      assetBlobs: [],
      historyMode: "complete",
      promotionRevision: 0,
      upgradeRevision: fixture.upgradeRevision,
      textureUpgradeRevision: revision,
      sourceUpgradeRevision: revision,
      repairUpgradeRevision: revision,
      migrationDiagnostic: null,
      unavailableRecords: [],
    }
    expect(portableProjectV6PayloadSchema.safeParse(payload).success).toBe(true)
    expect(
      portableProjectV6PayloadSchema.safeParse({ ...payload, repairUpgradeRevision: revision - 1 })
        .success,
    ).toBe(false)
    expect(
      projectRecordV5Schema.safeParse({
        schemaVersion: 5,
        documentId: fixture.removed.snapshot.id,
        name: fixture.removed.snapshot.name,
        headRevision: revision,
        latestSnapshotRevision: revision,
        cleanCloseRevision: null,
        createdAt: fixture.removed.snapshot.createdAt,
        updatedAt: fixture.removed.snapshot.updatedAt,
        lastExternalBackupAt: null,
        migrationProvenance: "current",
        migrationDiagnostic: null,
        unavailableRecords: [],
        upgradeRevision: fixture.upgradeRevision,
        textureUpgradeRevision: revision,
        sourceUpgradeRevision: revision,
        repairUpgradeRevision: revision,
      }).success,
    ).toBe(true)
  })
})
