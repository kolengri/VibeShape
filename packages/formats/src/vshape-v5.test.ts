import { describe, expect, it } from "bun:test"
import {
  canonicalJson,
  documentRestoredV4EventSchema,
  reduceDocumentV4Event,
} from "@vibeshape/domain"
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate"
import {
  authorityEnvelope,
  authorityTimestamp,
  evidenceValue,
} from "../../../scripts/authority-persistence-fixture"
import { sourceAssetsFixture } from "../../../scripts/source-assets-fixture"
import { readAuthoredVShape, readVShapeV3, readVShapeV5, writeVShapeV5 } from "./vshape"

async function input() {
  const f = await sourceAssetsFixture()
  return {
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
    exportedAt: authorityTimestamp,
    createdBy: { application: "VibeShape", version: "0.0.0", build: null },
  }
}

describe("portable source asset closure", () => {
  it("round trips verified source bytes and keeps old readers outside V5 authority", async () => {
    const source = await input()
    const archive = evidenceValue(await writeVShapeV5(source)).value
    const read = evidenceValue(await readVShapeV5(archive)).value
    expect(read.snapshot).toEqual(source.snapshot)
    expect(read.assetBlobs).toEqual(source.assetBlobs)
    expect(evidenceValue(await readAuthoredVShape(archive)).value.version).toBe(5)
    expect((await readVShapeV3(archive)).ok).toBe(false)
  })

  it("includes cancelled imports required by Redo even when the current snapshot is empty", async () => {
    const source = await input()
    const f = await sourceAssetsFixture()
    const undo = documentRestoredV4EventSchema.parse({
      ...authorityEnvelope(6),
      schemaVersion: 4,
      type: "org.vibeshape.document.restored",
      revision: 7,
      transactionId: null,
      direction: "undo",
      targetRevision: 5,
    })
    const snapshot = evidenceValue(
      reduceDocumentV4Event(source.snapshot, undo, f.upgraded.snapshot),
    ).snapshot
    const cancelled = { ...source, snapshot, versionedEvents: [...source.versionedEvents, undo] }
    expect(snapshot.assets).toEqual([])
    expect((await writeVShapeV5({ ...cancelled, assetBlobs: [] })).ok).toBe(false)
    const archive = evidenceValue(await writeVShapeV5(cancelled)).value
    expect(evidenceValue(await readVShapeV5(archive)).value.assetBlobs).toEqual(source.assetBlobs)
  })

  it("rejects missing, mismatched, undeclared and hostile asset entries", async () => {
    const source = await input()
    const archive = evidenceValue(await writeVShapeV5(source)).value
    const path = `assets/${source.assetBlobs[0]?.digest}.bin`
    const cases = [
      (files: Record<string, Uint8Array>) => {
        delete files[path]
      },
      (files: Record<string, Uint8Array>) => {
        files[path] = strToU8("Corrupt source")
      },
      (files: Record<string, Uint8Array>) => {
        files["assets/undeclared.bin"] = strToU8("Extra")
      },
      (files: Record<string, Uint8Array>) => {
        files["../source.step"] = strToU8("Unsafe")
      },
    ]
    for (const mutate of cases) {
      const files = unzipSync(archive)
      mutate(files)
      expect((await readVShapeV5(zipSync(files))).ok).toBe(false)
    }
    const files = unzipSync(archive)
    const manifest = JSON.parse(strFromU8(files["manifest.json"] ?? new Uint8Array()))
    manifest.assetEntries[0].bytes += 1
    files["manifest.json"] = strToU8(canonicalJson(manifest))
    expect((await readVShapeV5(zipSync(files))).ok).toBe(false)
    expect(
      (await writeVShapeV5({ ...source, assetBlobs: [...source.assetBlobs, ...source.assetBlobs] }))
        .ok,
    ).toBe(false)
  })
})
