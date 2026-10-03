import {
  applyDocumentV4Command,
  documentRestoredV4EventSchema,
  reduceDocumentV4Event,
} from "@vibeshape/domain"
import { describe, expect, it } from "vitest"
import { assemblyLibraryFixture, libraryFixtureId } from "../../../scripts/assembly-library-fixture"
import {
  authorityEnvelope,
  authorityTimestamp,
  evidenceValue,
} from "../../../scripts/authority-persistence-fixture"
import { sourceAssetsFixture } from "../../../scripts/source-assets-fixture"
import { readVShapeV5, writeVShapeV5 } from "./vshape"

describe("portable frozen library occurrences", () => {
  it("keeps foreign pinned source bytes after Undo and preserves a reference across native round trip", async () => {
    const source = assemblyLibraryFixture()
    const local = await sourceAssetsFixture()
    const definition = {
      ...source.definition,
      id: libraryFixtureId(500),
      libraryBinding: { itemId: libraryFixtureId(90), version: 1 },
    }
    const inserted = evidenceValue(
      applyDocumentV4Command(local.upgraded.snapshot, {
        ...authorityEnvelope(5),
        schemaVersion: 4,
        kind: "org.vibeshape.document.assembly-command",
        payload: { changes: [{ kind: "definition.insert-pinned", definition }] },
      }),
    )
    const prefix = [
      local.authored.created.event,
      local.authored.added.event,
      local.authored.upgraded.event,
      local.textureUpgraded.event,
      local.upgraded.event,
      inserted.event,
    ]
    const input = {
      snapshot: inserted.snapshot,
      seed: null,
      legacyEvents: [],
      versionedEvents: prefix,
      assetBlobs: [source.blob],
      historyMode: "complete",
      promotionRevision: 0,
      upgradeRevision: 3,
      textureUpgradeRevision: 4,
      sourceUpgradeRevision: 5,
      migrationDiagnostic: null,
      unavailableRecords: [],
      exportedAt: authorityTimestamp,
      createdBy: { application: "VibeShape", version: "0.0.0", build: null },
    }
    const read = evidenceValue(
      await readVShapeV5(evidenceValue(await writeVShapeV5(input)).value),
    ).value
    expect(read.snapshot.assembly.definitions[0]).toEqual(definition)
    expect(read.assetBlobs).toEqual([source.blob])
    const undo = documentRestoredV4EventSchema.parse({
      ...authorityEnvelope(inserted.snapshot.revision),
      schemaVersion: 4,
      type: "org.vibeshape.document.restored",
      revision: inserted.snapshot.revision + 1,
      transactionId: null,
      direction: "undo",
      targetRevision: local.upgraded.snapshot.revision,
    })
    const snapshot = evidenceValue(
      reduceDocumentV4Event(inserted.snapshot, undo, local.upgraded.snapshot),
    ).snapshot
    const cancelled = { ...input, snapshot, versionedEvents: [...prefix, undo] }
    expect((await writeVShapeV5({ ...cancelled, assetBlobs: [] })).ok).toBe(false)
    const reopened = evidenceValue(
      await readVShapeV5(evidenceValue(await writeVShapeV5(cancelled)).value),
    ).value
    expect(reopened.snapshot.assembly.definitions).toEqual([])
    expect(reopened.assetBlobs).toEqual([source.blob])
  })
})
