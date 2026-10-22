import { describe, expect, it } from "bun:test"
import { vi } from "../../../tests/unit/support/bun-test"
import { repairIssuedAt } from "../../domain/src/history-repair.test-fixture"
import { partAppearanceJournalFixture } from "../../domain/src/part-appearance.test-fixture"
import * as portableAuthority from "./authority-portable"
import {
  parseAuthorityProject,
  storeAuthorityEvent,
  storeAuthoritySnapshot,
  validAuthorityEvent,
  validAuthoritySnapshot,
} from "./authority-records"
import {
  portableProjectV7PayloadSchema,
  projectRecordV5Schema,
  projectRecordV6Schema,
} from "./authority-schemas"
import { VibeShapeDatabase } from "./database"
import { VersionedLocalDocumentRepository } from "./versioned-repository"

describe("stored authored appearance authority", () => {
  it("preserves checksummed visual data and refuses unsupported future versions and older head parsers", async () => {
    const { changed, payload } = partAppearanceJournalFixture()
    const record = await storeAuthoritySnapshot(changed.snapshot, repairIssuedAt)
    expect(await validAuthoritySnapshot(record)).toEqual(changed.snapshot)
    expect(
      await validAuthorityEvent(await storeAuthorityEvent(changed.event, repairIssuedAt)),
    ).toEqual(changed.event)
    expect(await validAuthoritySnapshot({ ...record, checksum: "0".repeat(64) })).toBeNull()
    await expect(validAuthoritySnapshot({ ...record, schemaVersion: 7 })).rejects.toThrow(
      "different authority schema",
    )
    const head = projectRecordV6Schema.parse({
      schemaVersion: 6,
      documentId: changed.snapshot.id,
      name: changed.snapshot.name,
      headRevision: changed.snapshot.revision,
      latestSnapshotRevision: changed.snapshot.revision,
      cleanCloseRevision: null,
      createdAt: changed.snapshot.createdAt,
      updatedAt: changed.snapshot.updatedAt,
      lastExternalBackupAt: null,
      migrationProvenance: "current",
      migrationDiagnostic: null,
      unavailableRecords: [],
      upgradeRevision: payload.upgradeRevision,
      textureUpgradeRevision: payload.textureUpgradeRevision,
      sourceUpgradeRevision: payload.sourceUpgradeRevision,
      repairUpgradeRevision: payload.repairUpgradeRevision,
      appearanceUpgradeRevision: payload.appearanceUpgradeRevision,
    })
    expect(parseAuthorityProject(head)).toEqual(head)
    expect(projectRecordV5Schema.safeParse(head).success).toBe(false)
    expect(() => parseAuthorityProject({ ...head, schemaVersion: 7 })).toThrow(
      "different authority schema",
    )
    expect(portableProjectV7PayloadSchema.safeParse(payload).success).toBe(true)
    expect(
      portableProjectV7PayloadSchema.safeParse({
        ...payload,
        appearanceUpgradeRevision: payload.appearanceUpgradeRevision - 1,
      }).success,
    ).toBe(false)
  })
  it("uses the ordinary repository import/copy dispatcher and rejects a journal that cannot reproduce appearance", async () => {
    const { payload } = partAppearanceJournalFixture()
    const published = vi.spyOn(portableAuthority, "publishPortableAuthority").mockResolvedValue({
      documentId: payload.snapshot.id,
      revision: payload.snapshot.revision,
      eventChecksums: [],
      snapshotChecksum: "test-checksum",
    })
    try {
      const database = new VibeShapeDatabase("appearance-authority-dispatch")
      const repository = new VersionedLocalDocumentRepository(database)
      expect(
        await repository.copyPortableProjectV7({ ...payload, copiedAt: repairIssuedAt }),
      ).toMatchObject({ ok: true })
      expect(
        await repository.importPortableProjectV3({
          ...payload,
          importedAt: repairIssuedAt,
          exportedAt: repairIssuedAt,
        }),
      ).toMatchObject({ ok: true })
      expect(published).toHaveBeenCalledTimes(2)
      expect(
        await repository.copyPortableProjectV7({
          ...payload,
          snapshot: { ...payload.snapshot, partAppearances: [] },
          copiedAt: repairIssuedAt,
        }),
      ).toMatchObject({ ok: false, diagnostic: { code: "invalid-input" } })
      expect(published).toHaveBeenCalledTimes(2)
    } finally {
      published.mockRestore()
    }
  })
})
