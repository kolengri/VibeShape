import { describe, expect, it } from "bun:test"
import { documentSnapshotV2Schema } from "./document-v2"
import { copyCompleteDocumentAuthorityHistory } from "./document-v2-copy"
import { applyDocumentUpgradeV2Command } from "./document-v2-migration"
import { replayDocumentAuthorityEvents } from "./document-v2-replay"
import { applyDocumentV3Command } from "./document-v3-commands"
import { documentSnapshotV4Schema } from "./document-v4"
import { documentRestoredV4EventSchema } from "./document-v4-command-schemas"
import { applyDocumentV4Command, reduceDocumentV4Event } from "./document-v4-commands"
import { documentSourceAssetClosure } from "./source-asset-closure"
import { sourceAssetSchema } from "./source-assets"
import { applyVersionedDocumentCommand } from "./versioned-document-commands"

const id = (n: number) => `0195b5ac-b220-7a2c-8c33-${n.toString(16).padStart(12, "0")}`
const issuedAt = "2026-10-03T00:00:00Z"
const actor = { type: "user", userId: null } as const
function value<T extends { ok: boolean }>(result: T): Extract<T, { ok: true }> {
  if (!result.ok) throw new Error(JSON.stringify(result))
  return result as Extract<T, { ok: true }>
}
const envelope = (baseRevision: number) => ({
  documentId: id(1),
  commandId: id(baseRevision + 10),
  baseRevision,
  issuedAt,
  actor,
})
const asset = sourceAssetSchema.parse({
  id: id(200),
  digest: "a".repeat(64),
  byteLength: 123,
  filename: "Body.step",
  format: "step",
  representation: "exact-solid",
  normalization: { sourceUnit: "millimeter", scaleToMillimeters: 1, normalizedUnit: "millimeter" },
  outputs: [id(201)],
})
function fixture() {
  const created = value(
    applyVersionedDocumentCommand(null, {
      ...envelope(0),
      schemaVersion: 1,
      kind: "org.vibeshape.document.create",
      payload: { name: "Source project" },
    }),
  )
  const authored = value(
    applyDocumentUpgradeV2Command(created.snapshot, {
      ...envelope(1),
      schemaVersion: 2,
      kind: "org.vibeshape.document.upgrade-v2",
      payload: { partAllocations: [] },
    }),
  )
  const textured = value(
    applyDocumentV3Command(authored.snapshot, {
      ...envelope(2),
      schemaVersion: 3,
      kind: "org.vibeshape.document.upgrade-v3",
      payload: { change: null },
    }),
  )
  const upgraded = value(
    applyDocumentV4Command(textured.snapshot, {
      ...envelope(3),
      schemaVersion: 4,
      kind: "org.vibeshape.document.upgrade-v4",
      payload: {},
    }),
  )
  const added = value(
    applyDocumentV4Command(upgraded.snapshot, {
      ...envelope(4),
      schemaVersion: 4,
      kind: "org.vibeshape.document.add-source-assets",
      payload: { assets: [asset] },
    }),
  )
  return { created, authored, textured, upgraded, added }
}

describe("source asset authority", () => {
  it("captures an explicit empty upgrade without relaxing historical V2", () => {
    const f = fixture()
    expect(f.upgraded.event).toMatchObject({
      type: "org.vibeshape.document.upgraded-v4",
      assets: [],
    })
    expect(documentSnapshotV2Schema.safeParse(f.upgraded.snapshot).success).toBe(false)
    expect(
      documentSnapshotV4Schema.safeParse({ ...f.upgraded.snapshot, untrusted: true }).success,
    ).toBe(false)
    expect(
      value(
        replayDocumentAuthorityEvents(null, [
          f.created.event,
          f.authored.event,
          f.textured.event,
          f.upgraded.event,
          f.added.event,
        ]),
      ).snapshot,
    ).toEqual(f.added.snapshot)
    expect(
      replayDocumentAuthorityEvents(f.upgraded.snapshot, [
        { ...f.authored.event, ...envelope(4), revision: 5 },
      ]).ok,
    ).toBe(false)
  })

  it("restores source descriptors while retaining the complete historical closure", () => {
    const f = fixture()
    const undo = documentRestoredV4EventSchema.parse({
      ...envelope(5),
      schemaVersion: 4,
      type: "org.vibeshape.document.restored",
      transactionId: null,
      revision: 6,
      direction: "undo",
      targetRevision: 4,
    })
    const restored = value(reduceDocumentV4Event(f.added.snapshot, undo, f.upgraded.snapshot))
    expect(restored.snapshot.assets).toEqual([])
    expect(
      documentSourceAssetClosure(
        null,
        [
          f.created.event,
          f.authored.event,
          f.textured.event,
          f.upgraded.event,
          f.added.event,
          undo,
        ],
        restored.snapshot,
      ),
    ).toEqual([asset])
    const redo = documentRestoredV4EventSchema.parse({
      ...envelope(6),
      schemaVersion: 4,
      type: "org.vibeshape.document.restored",
      transactionId: null,
      revision: 7,
      direction: "redo",
      targetRevision: 5,
    })
    const events = [
      f.created.event,
      f.authored.event,
      f.textured.event,
      f.upgraded.event,
      f.added.event,
      undo,
      redo,
    ]
    const redone = value(replayDocumentAuthorityEvents(null, events)).snapshot
    if (redone.schemaVersion !== 4) throw new Error("Expected V4 Redo.")
    expect(redone.assets).toEqual([asset])
  })

  it("preserves asset identities and digest when copying complete authority", () => {
    const f = fixture()
    const copy = value(
      copyCompleteDocumentAuthorityHistory({
        sourceSeed: null,
        sourceLegacyEvents: [],
        sourceSnapshot: f.added.snapshot,
        sourceEvents: [
          f.created.event,
          f.authored.event,
          f.textured.event,
          f.upgraded.event,
          f.added.event,
        ],
        documentId: id(2),
        commandIds: [id(100), id(101), id(102), id(103), id(104), id(105)],
        transactionIds: [],
        name: "Copy",
        issuedAt,
        actor,
      }),
    )
    expect(copy.snapshot.schemaVersion).toBe(4)
    if (copy.snapshot.schemaVersion !== 4) throw new Error("Expected V4 copy.")
    expect(copy.snapshot.assets).toEqual([asset])
    expect(value(replayDocumentAuthorityEvents(copy.seed, copy.versionedEvents)).snapshot).toEqual(
      copy.snapshot,
    )
  })

  it("rejects duplicate identities, invalid kinds, unsafe paths and inconsistent representations", () => {
    const f = fixture()
    expect(
      applyDocumentV4Command(f.added.snapshot, {
        ...envelope(5),
        schemaVersion: 4,
        kind: "org.vibeshape.document.add-source-assets",
        payload: { assets: [asset] },
      }).ok,
    ).toBe(false)
    for (const changed of [
      { representation: "triangle-mesh" },
      { byteLength: 0 },
      { byteLength: Number.POSITIVE_INFINITY },
      { filename: "../Body.step" },
      { outputs: [id(201), id(201)] },
      { normalization: { ...asset.normalization, scaleToMillimeters: Number.NaN } },
    ])
      expect(sourceAssetSchema.safeParse({ ...asset, ...changed }).success).toBe(false)
    expect(sourceAssetSchema.safeParse({ ...asset, byteLength: 33 * 1024 * 1024 }).success).toBe(
      true,
    )
    if (f.added.event.type !== "org.vibeshape.document.source-assets-added")
      throw new Error("Expected an asset event.")
    expect(
      sourceAssetSchema.safeParse({ ...asset, format: "3mf", representation: "triangle-mesh" })
        .success,
    ).toBe(true)
    expect(
      sourceAssetSchema.safeParse({ ...asset, format: "3mf", representation: "exact-solid" })
        .success,
    ).toBe(false)
    expect(
      documentSourceAssetClosure.bind(
        null,
        null,
        [f.added.event, { ...f.added.event, assets: [{ ...asset, filename: "Changed.step" }] }],
        f.added.snapshot,
      ),
    ).toThrow()
  })
})
