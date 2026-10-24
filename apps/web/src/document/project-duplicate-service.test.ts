import { afterEach, expect, it, mock, spyOn } from "bun:test"
import { documentIdSchema } from "@vibeshape/domain/identifiers"
import { readVShapeV6, writeVShapeV6 } from "@vibeshape/formats/vshape"
import { portableProjectV6PayloadSchema, VibeShapeDatabase } from "@vibeshape/persistence"
import { historyRepairJournalFixture } from "../../../../packages/domain/src/history-repair.test-fixture"
import { BrowserProjectRepository } from "./browser-project-repository"
import { createProjectImportPreparation } from "./project-import-service"

afterEach(() => mock.restore())

function fixture() {
  const history = historyRepairJournalFixture()
  const source = {
    version: 6 as const,
    project: portableProjectV6PayloadSchema.parse({
      snapshot: history.removed.snapshot,
      seed: null,
      legacyEvents: [],
      versionedEvents: history.events,
      assetBlobs: [],
      historyMode: "complete",
      promotionRevision: 0,
      upgradeRevision: history.upgradeRevision,
      textureUpgradeRevision: history.removed.snapshot.revision,
      sourceUpgradeRevision: history.removed.snapshot.revision,
      repairUpgradeRevision: history.removed.snapshot.revision,
      migrationDiagnostic: null,
      unavailableRecords: [],
    }),
  }
  const request = {
    schemaVersion: 0,
    kind: "duplicate",
    jobId: crypto.randomUUID(),
    databaseName: "duplicate-service-test",
    sourceDocumentId: source.project.snapshot.id,
    expectedHeadRevision: source.project.snapshot.revision,
    documentId: documentIdSchema.parse("0195b5ac-b250-7a2c-8c33-000000000901"),
    name: "Independent copy",
    issuedAt: "2026-10-24T12:00:00.000Z",
  }
  const close = spyOn(VibeShapeDatabase.prototype, "close").mockImplementation(() => {})
  const load = spyOn(BrowserProjectRepository.prototype, "exportPortableProject")
  load.mockResolvedValue({ ok: true, value: source })
  return { source, request, close, load }
}

it("recovers and prepares an independent replay-proven copy without writing the database", async () => {
  const { source, request, close, load } = fixture()
  const original = structuredClone(source)
  const copy = spyOn(BrowserProjectRepository.prototype, "copyPortableProject")
  const result = await createProjectImportPreparation()(request)
  expect(result.kind).toBe("prepared")
  if (result.kind !== "prepared" || result.value.version !== 6)
    throw new Error("Expected a prepared V6 project.")
  const project = result.value.project
  expect(project.snapshot).toMatchObject({ id: request.documentId, name: request.name })
  expect(project.versionedEvents).toHaveLength(source.project.versionedEvents.length + 1)
  const originals = new Set(source.project.versionedEvents.map((event) => event.commandId))
  expect(project.versionedEvents.every((event) => !originals.has(event.commandId))).toBe(true)
  expect(source).toEqual(original)
  expect(load).toHaveBeenCalledWith(request.sourceDocumentId)
  expect(copy).not.toHaveBeenCalled()
  expect(close).toHaveBeenCalledTimes(1)
  const archive = await writeVShapeV6({
    ...project,
    exportedAt: request.issuedAt,
    createdBy: { application: "VibeShape", version: "test", build: null },
    engine: null,
  })
  if (!archive.ok) throw new Error(archive.diagnostic.message)
  const read = await readVShapeV6(archive.value)
  expect(read.ok).toBe(true)
  if (read.ok) expect(read.value.snapshot).toEqual(project.snapshot)
})

it("rejects stale and foreign source snapshots and closes the database on every outcome", async () => {
  const { source, request, close, load } = fixture()
  expect(
    await createProjectImportPreparation()({
      ...request,
      expectedHeadRevision: request.expectedHeadRevision + 1,
    }),
  ).toMatchObject({ kind: "error", diagnostic: { code: "stale-revision" } })
  expect(
    await createProjectImportPreparation()({ ...request, sourceDocumentId: request.documentId }),
  ).toMatchObject({ kind: "error", diagnostic: { code: "stale-revision" } })
  load.mockResolvedValueOnce({
    ok: false,
    diagnostic: { code: "document-not-found", message: "Missing project.", retryable: false },
  })
  expect(await createProjectImportPreparation()(request)).toMatchObject({
    kind: "error",
    diagnostic: { code: "document-not-found" },
  })
  load.mockRejectedValueOnce(new Error("Storage unavailable."))
  await expect(createProjectImportPreparation()(request)).rejects.toThrow("Storage unavailable.")
  load.mockResolvedValueOnce({
    ok: true,
    value: { ...source, project: { ...source.project, historyMode: "checkpoint" } },
  })
  expect(await createProjectImportPreparation()(request)).toMatchObject({
    kind: "error",
    diagnostic: { code: "checkpoint-read-only" },
  })
  expect(close).toHaveBeenCalledTimes(5)
})

it("claims the worker phase before asynchronous recovery and never starts a second job", async () => {
  const { source, request, load } = fixture()
  let resolve!: (value: { ok: true; value: typeof source }) => void
  load.mockReturnValueOnce(
    new Promise((complete) => {
      resolve = complete
    }),
  )
  const prepare = createProjectImportPreparation()
  const pending = prepare(request)
  await expect(prepare(request)).rejects.toThrow("phase is invalid")
  expect(load).toHaveBeenCalledTimes(1)
  resolve({ ok: true, value: source })
  expect((await pending).kind).toBe("prepared")
})
