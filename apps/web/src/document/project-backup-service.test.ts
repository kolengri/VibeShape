import { afterEach, expect, it, mock, spyOn } from "bun:test"
import { readVShapeV6 } from "@vibeshape/formats/vshape"
import { portableProjectV6PayloadSchema, VibeShapeDatabase } from "@vibeshape/persistence"
import { historyRepairJournalFixture } from "../../../../packages/domain/src/history-repair.test-fixture"
import type { BrowserPortableProject } from "./authored-project-file"
import { BrowserProjectRepository } from "./browser-project-repository"
import { exportSavedProjectBackup } from "./project-backup-service"

afterEach(() => mock.restore())

function portable(): Extract<BrowserPortableProject, { version: 6 }> {
  const fixture = historyRepairJournalFixture()
  return {
    version: 6,
    project: portableProjectV6PayloadSchema.parse({
      snapshot: fixture.removed.snapshot,
      seed: null,
      legacyEvents: [],
      versionedEvents: fixture.events,
      assetBlobs: [],
      historyMode: "complete",
      promotionRevision: 0,
      upgradeRevision: fixture.upgradeRevision,
      textureUpgradeRevision: fixture.removed.snapshot.revision,
      sourceUpgradeRevision: fixture.removed.snapshot.revision,
      repairUpgradeRevision: fixture.removed.snapshot.revision,
      migrationDiagnostic: null,
      unavailableRecords: [],
    }),
  }
}

it("keeps full replayable History and rejects a snapshot that the journal cannot reproduce", async () => {
  const input = portable()
  const expected = {
    schemaVersion: 0,
    databaseName: "backup-service-test",
    documentId: input.project.snapshot.id,
    revision: input.project.snapshot.revision,
  }
  const close = spyOn(VibeShapeDatabase.prototype, "close").mockImplementation(() => {})
  const repositoryExport = spyOn(BrowserProjectRepository.prototype, "exportPortableProject")
  const progress = mock()
  repositoryExport.mockResolvedValueOnce({ ok: true, value: input })
  const saving = exportSavedProjectBackup(expected, progress)
  expect(progress.mock.calls).toEqual([["reading-project"]])
  const saved = await saving
  expect(progress.mock.calls).toEqual([["reading-project"], ["building-archive"]])
  expect(saved.ok).toBe(true)
  if (!saved.ok) throw new Error(saved.diagnostic.message)
  const read = await readVShapeV6(saved.file)
  expect(read.ok).toBe(true)
  if (!read.ok) throw new Error(read.diagnostic.message)
  expect(read.value.snapshot).toEqual(input.project.snapshot)
  expect(read.value.versionedEvents).toEqual(input.project.versionedEvents)
  const inconsistent = {
    ...input,
    project: {
      ...input.project,
      snapshot: { ...input.project.snapshot, name: "Changed without event" },
    },
  }
  repositoryExport.mockResolvedValueOnce({ ok: true, value: inconsistent })
  expect(await exportSavedProjectBackup(expected)).toMatchObject({
    ok: false,
    diagnostic: { code: "history-mismatch" },
  })
  expect(close).toHaveBeenCalledTimes(2)
})

it("closes the worker database after stale revision, repository failure, and thrown failure", async () => {
  const input = portable()
  const request = {
    schemaVersion: 0,
    databaseName: "backup-service-test",
    documentId: input.project.snapshot.id,
    revision: input.project.snapshot.revision + 1,
  }
  const close = spyOn(VibeShapeDatabase.prototype, "close").mockImplementation(() => {})
  const repositoryExport = spyOn(BrowserProjectRepository.prototype, "exportPortableProject")
  repositoryExport.mockResolvedValueOnce({ ok: true, value: input })
  expect(await exportSavedProjectBackup(request)).toMatchObject({
    ok: false,
    diagnostic: { code: "project-action-blocked" },
  })
  repositoryExport.mockResolvedValueOnce({
    ok: false,
    diagnostic: { code: "document-not-found", message: "Missing project.", retryable: false },
  })
  expect(await exportSavedProjectBackup(request)).toMatchObject({
    ok: false,
    diagnostic: { code: "document-not-found" },
  })
  repositoryExport.mockRejectedValueOnce(new Error("Storage unavailable."))
  await expect(exportSavedProjectBackup(request)).rejects.toThrow("Storage unavailable.")
  expect(close).toHaveBeenCalledTimes(3)
})
