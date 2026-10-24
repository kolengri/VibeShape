import { expect, it } from "bun:test"
import {
  applyDocumentV3Command,
  applyVersionedDocumentCommand,
  migrateDocumentSnapshot,
} from "@vibeshape/domain"
import { applyDocumentCommand } from "@vibeshape/domain/commands"
import { documentIdSchema, draftIdSchema } from "@vibeshape/domain/identifiers"
import {
  type AuthoredVShapeProject,
  readAuthoredVShape,
  writeVShape,
  writeVShapeV1,
  writeVShapeV2,
  writeVShapeV3,
  writeVShapeV4,
  writeVShapeV5,
  writeVShapeV6,
  writeVShapeV7,
} from "@vibeshape/formats/vshape"
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate"
import { z } from "zod"
import {
  historyRepairJournalFixture,
  repairIssuedAt,
} from "../../../../packages/domain/src/history-repair.test-fixture"
import { partAppearanceJournalFixture } from "../../../../packages/domain/src/part-appearance.test-fixture"
import { authorityFixture, evidenceValue } from "../../../../scripts/authority-persistence-fixture"
import { sourceAssetsFixture } from "../../../../scripts/source-assets-fixture"
import {
  surfaceTextureProjectFixture,
  textureFixtureEnvelope,
} from "../../../../tests/fixtures/surface-texture-project"
import { prepareProjectImport } from "./project-import-client"

const id = (n: number) => `0195b5ac-b250-7a2c-8c33-${String(n).padStart(12, "0")}`
const metadata = {
  exportedAt: repairIssuedAt,
  createdBy: { application: "VibeShape", version: "test", build: null },
  engine: null,
}
const envelope = {
  documentId: id(1),
  issuedAt: repairIssuedAt,
  actor: { type: "user", userId: null },
}

function legacy() {
  return evidenceValue(
    applyDocumentCommand(null, {
      ...envelope,
      commandId: id(2),
      baseRevision: 0,
      schemaVersion: 1,
      kind: "org.vibeshape.document.create",
      payload: { name: "Legacy housing" },
    }),
  )
}

async function archive(version: number) {
  const created = legacy()
  if (version === 0)
    return evidenceValue(
      await writeVShape({ ...metadata, snapshot: created.snapshot, events: [created.event] }),
    ).value
  const migrated = evidenceValue(migrateDocumentSnapshot(created.snapshot, [created.event]))
  if (version === 1)
    return evidenceValue(
      await writeVShapeV1({ ...metadata, snapshot: migrated.snapshot, events: [created.event] }),
    ).value
  if (version === 2) {
    const renamed = evidenceValue(
      applyVersionedDocumentCommand(
        migrated.snapshot,
        {
          ...envelope,
          commandId: id(3),
          baseRevision: 1,
          schemaVersion: 1,
          kind: "org.vibeshape.document.rename",
          payload: { name: "Promoted housing" },
        },
        { transactionId: draftIdSchema.parse(id(4)) },
      ),
    )
    return evidenceValue(
      await writeVShapeV2({
        ...metadata,
        snapshot: renamed.snapshot,
        seed: migrated.snapshot,
        legacyEvents: [created.event],
        versionedEvents: [renamed.event],
        historyMode: "complete",
        promotionRevision: 1,
        migrationDiagnostic: null,
        unavailableRecords: [],
      }),
    ).value
  }
  if (version === 3) {
    const f = authorityFixture()
    return evidenceValue(
      await writeVShapeV3({
        ...metadata,
        snapshot: f.renamed.snapshot,
        seed: null,
        legacyEvents: [],
        versionedEvents: [f.created.event, f.added.event, f.upgraded.event, f.renamed.event],
        historyMode: "complete",
        promotionRevision: 0,
        upgradeRevision: 3,
        migrationDiagnostic: null,
        unavailableRecords: [],
      }),
    ).value
  }
  if (version === 4) {
    const f = surfaceTextureProjectFixture()
    const applied = evidenceValue(
      applyDocumentV3Command(f.snapshot, {
        ...textureFixtureEnvelope(3),
        schemaVersion: 3,
        kind: "org.vibeshape.document.metadata-command",
        payload: {
          kind: "textures.replace-layers",
          featureId: f.layer.featureId,
          layers: [
            {
              ...f.layer,
              map: {
                kind: "custom",
                width: 256,
                height: 256,
                pixels: Array.from({ length: 65_536 }, () => 0),
              },
            },
          ],
        },
      }),
    )
    return evidenceValue(
      await writeVShapeV4({
        ...f.portable,
        snapshot: applied.snapshot,
        textureUpgradeRevision: 4,
        versionedEvents: [...f.events, applied.event],
      }),
    ).value
  }
  if (version === 5) {
    const f = await sourceAssetsFixture()
    return evidenceValue(
      await writeVShapeV5({
        ...metadata,
        snapshot: f.added.snapshot,
        seed: null,
        legacyEvents: [],
        versionedEvents: [
          f.authored.created.event,
          f.authored.added.event,
          f.authored.upgraded.event,
          f.textureUpgraded.event,
          f.upgraded.event,
          f.added.event,
        ],
        assetBlobs: [f.blob],
        historyMode: "complete",
        promotionRevision: 0,
        upgradeRevision: 3,
        textureUpgradeRevision: 4,
        sourceUpgradeRevision: 5,
        migrationDiagnostic: null,
        unavailableRecords: [],
      }),
    ).value
  }
  if (version === 6) {
    const f = historyRepairJournalFixture()
    return evidenceValue(
      await writeVShapeV6({
        ...metadata,
        snapshot: f.removed.snapshot,
        seed: null,
        legacyEvents: [],
        versionedEvents: f.events,
        assetBlobs: [],
        historyMode: "complete",
        promotionRevision: 0,
        upgradeRevision: f.upgradeRevision,
        textureUpgradeRevision: f.removed.snapshot.revision,
        sourceUpgradeRevision: f.removed.snapshot.revision,
        repairUpgradeRevision: f.removed.snapshot.revision,
        migrationDiagnostic: null,
        unavailableRecords: [],
      }),
    ).value
  }
  return evidenceValue(
    await writeVShapeV7({ ...metadata, ...partAppearanceJournalFixture().payload }),
  ).value
}

function prepare(bytes: Uint8Array, n = 100) {
  return prepareProjectImport(
    {
      bytes,
      documentId: documentIdSchema.parse(id(n)),
      issuedAt: repairIssuedAt,
      resolveName: (name) => `${name} imported`,
      signal: new AbortController().signal,
    },
    () => new Worker(new URL("./project-import-worker.ts", import.meta.url), { type: "module" }),
  )
}

function historyEvents({ project }: AuthoredVShapeProject) {
  return "versionedEvents" in project
    ? [...project.legacyEvents, ...project.versionedEvents]
    : project.events
}

function expectCopiedHistory(source: AuthoredVShapeProject, restored: AuthoredVShapeProject) {
  const sourceEvents = historyEvents(source)
  const copiedEvents = historyEvents(restored)
  const originals = new Set(sourceEvents.map((event) => event.commandId))
  expect(copiedEvents).toHaveLength(sourceEvents.length + 1)
  for (const event of copiedEvents) {
    expect(event.documentId).toBe<unknown>(id(100))
    expect(originals.has(event.commandId)).toBe(false)
  }
  const originalTransactions = new Set(
    sourceEvents.flatMap((event) => (event.transactionId ? [event.transactionId] : [])),
  )
  const copiedTransactions = new Set(
    copiedEvents.flatMap((event) => (event.transactionId ? [event.transactionId] : [])),
  )
  expect(copiedTransactions.size).toBe(originalTransactions.size)
  for (const transactionId of copiedTransactions)
    expect(originalTransactions.has(transactionId)).toBe(false)
}

function expectRetainedVersionPayload(
  source: AuthoredVShapeProject,
  restored: AuthoredVShapeProject,
) {
  if (source.version === 5 && restored.version === 5)
    expect(restored.project.assetBlobs).toEqual(source.project.assetBlobs)
  if (source.version === 4 && restored.version === 4)
    expect(restored.project.snapshot.surfaceTextures).toEqual(
      source.project.snapshot.surfaceTextures,
    )
  if (source.version === 7 && restored.version === 7)
    expect(restored.project.snapshot.partAppearances).toEqual(
      source.project.snapshot.partAppearances,
    )
}

for (const version of [0, 1, 2, 3, 4, 5, 6, 7]) {
  it(`prepares a replay-proven writable copy of native V${version} in a real module worker`, async () => {
    const bytes = await archive(version)
    const original = Uint8Array.from(bytes)
    const source = evidenceValue(await readAuthoredVShape(bytes)).value
    const copied = evidenceValue(await prepare(bytes)).value
    expect(bytes).toEqual(original)
    expect(copied.version).toBe<unknown>(Math.max(2, version))
    const writers = {
      2: writeVShapeV2,
      3: writeVShapeV3,
      4: writeVShapeV4,
      5: writeVShapeV5,
      6: writeVShapeV6,
      7: writeVShapeV7,
    }
    const saved = evidenceValue(
      await writers[copied.version]({ ...copied.project, ...metadata }),
    ).value
    const restored = evidenceValue(await readAuthoredVShape(saved)).value
    expect(restored.project.snapshot).toMatchObject({
      id: id(100),
      name: `${source.project.snapshot.name} imported`,
    })
    expectCopiedHistory(source, restored)
    expectRetainedVersionPayload(source, restored)
  }, 20_000)
}

it("creates disjoint identities on repeated imports", async () => {
  const bytes = await archive(2)
  const first = evidenceValue(await prepare(bytes, 100)).value
  const second = evidenceValue(await prepare(bytes, 101)).value
  const events = z.array(z.object({ commandId: z.string(), transactionId: z.string().nullable() }))
  const firstEvents = events.parse(first.project.versionedEvents)
  const secondEvents = events.parse(second.project.versionedEvents)
  for (const event of secondEvents)
    expect(
      firstEvents.some(
        (prior) =>
          prior.commandId === event.commandId ||
          (event.transactionId !== null && prior.transactionId === event.transactionId),
      ),
    ).toBe(false)
})

it("keeps checkpoint, archive corruption, version, and source-integrity error codes", async () => {
  const created = legacy()
  const migrated = evidenceValue(migrateDocumentSnapshot(created.snapshot, [created.event]))
  const checkpoint = evidenceValue(
    await writeVShapeV2({
      ...metadata,
      snapshot: migrated.snapshot,
      seed: migrated.snapshot,
      legacyEvents: [],
      versionedEvents: [],
      historyMode: "checkpoint",
      promotionRevision: 1,
      migrationDiagnostic: { code: "legacy-journal-unavailable", message: "Missing prefix." },
      unavailableRecords: ["event:1"],
    }),
  ).value
  expect(await prepare(checkpoint)).toMatchObject({
    ok: false,
    diagnostic: { code: "checkpoint-read-only" },
  })
  const corrupt = new Uint8Array([1, 2, 3])
  expect(await prepare(corrupt)).toEqual<unknown>(await readAuthoredVShape(corrupt))
  const source = await archive(5)
  const missingAsset = unzipSync(source)
  for (const path of Object.keys(missingAsset))
    if (path.startsWith("assets/")) delete missingAsset[path]
  const corruptAsset = unzipSync(source)
  for (const path of Object.keys(corruptAsset))
    if (path.startsWith("assets/")) corruptAsset[path] = strToU8("Corrupt source")
  const newer = unzipSync(source)
  const manifest = JSON.parse(strFromU8(newer["manifest.json"] ?? new Uint8Array()))
  newer["manifest.json"] = strToU8(JSON.stringify({ ...manifest, minimumReaderVersion: 99 }))
  for (const files of [missingAsset, corruptAsset, newer]) {
    const bytes = zipSync(files)
    const expected = await readAuthoredVShape(bytes)
    expect(expected.ok).toBe(false)
    expect(await prepare(bytes)).toEqual<unknown>(expected)
  }
}, 20_000)

it("can abort a real worker and immediately start another import without detaching source bytes", async () => {
  const bytes = await archive(2)
  const abort = new AbortController()
  const pending = prepareProjectImport(
    {
      bytes,
      documentId: documentIdSchema.parse(id(100)),
      issuedAt: repairIssuedAt,
      resolveName: (name) => `${name} imported`,
      signal: abort.signal,
    },
    () => new Worker(new URL("./project-import-worker.ts", import.meta.url), { type: "module" }),
  )
  abort.abort()
  await expect(pending).rejects.toMatchObject({ name: "AbortError" })
  expect((await prepare(bytes)).ok).toBe(true)
  expect(bytes.byteLength).toBeGreaterThan(0)
})
