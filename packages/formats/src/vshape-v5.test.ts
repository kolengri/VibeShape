import { describe, expect, it } from "bun:test"
import { createHash } from "node:crypto"
import {
  applyDocumentV4Command,
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

async function input(bytes?: Uint8Array<ArrayBuffer>) {
  const f = await sourceAssetsFixture()
  const blob = bytes ? { bytes, digest: createHash("sha256").update(bytes).digest("hex") } : f.blob
  const added = bytes
    ? evidenceValue(
        applyDocumentV4Command(f.upgraded.snapshot, {
          ...authorityEnvelope(5),
          schemaVersion: 4,
          kind: "org.vibeshape.document.add-source-assets",
          payload: {
            assets: [
              {
                ...f.asset,
                format: "stl",
                filename: "Candidate.stl",
                representation: "triangle-mesh",
                digest: blob.digest,
                byteLength: blob.bytes.byteLength,
              },
            ],
          },
        }),
      )
    : f.added
  return {
    snapshot: added.snapshot,
    seed: null,
    legacyEvents: [],
    versionedEvents: [
      f.authored.created.event,
      f.authored.added.event,
      f.authored.upgraded.event,
      f.textureUpgraded.event,
      f.upgraded.event,
      added.event,
    ],
    assetBlobs: [blob],
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

  it("round trips source bytes above the former archive, entry and expansion budgets", async () => {
    const source = await input(new Uint8Array(64 * 1024 * 1024 + 1))
    const archive = evidenceValue(await writeVShapeV5(source)).value
    expect(archive.byteLength).toBeGreaterThan(64 * 1024 * 1024)
    const reopened = evidenceValue(await readVShapeV5(archive)).value
    expect(reopened.snapshot).toEqual(source.snapshot)
    expect(reopened.assetBlobs[0]?.digest).toBe(source.assetBlobs[0]?.digest)
    expect(reopened.assetBlobs[0]?.bytes.byteLength).toBe(67_108_865)
    expect(reopened.assetBlobs[0]?.bytes.at(-1)).toBe(0)
  }, 30_000)

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
