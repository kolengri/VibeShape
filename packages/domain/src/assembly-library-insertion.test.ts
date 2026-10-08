import { describe, expect, it } from "bun:test"
import {
  assemblyLibraryFixture,
  libraryFixtureId,
  libraryFixtureTimestamp,
} from "../../../scripts/assembly-library-fixture"
import { authorityEnvelope, evidenceValue } from "../../../scripts/authority-persistence-fixture"
import { sourceAssetsFixture } from "../../../scripts/source-assets-fixture"
import { copyCompleteDocumentAuthorityHistory } from "./document-v2-copy"
import { replayDocumentAuthorityEvents } from "./document-v2-replay"
import { type DocumentSnapshotV4, documentSnapshotV4Schema } from "./document-v4"
import { documentRestoredV4EventSchema } from "./document-v4-command-schemas"
import { applyDocumentV4Command, reduceDocumentV4Event } from "./document-v4-commands"
import { documentSourceAssetClosure } from "./source-asset-closure"

async function fixture() {
  const foreign = assemblyLibraryFixture()
  const local = await sourceAssetsFixture()
  const definition = {
    ...foreign.definition,
    id: libraryFixtureId(500),
    libraryBinding: { itemId: libraryFixtureId(90), version: 1 },
  }
  const base = local.upgraded.snapshot
  const changes = [
    { kind: "definition.insert-pinned", definition },
    {
      kind: "instance.create",
      instance: {
        schemaVersion: 1,
        id: libraryFixtureId(501),
        definitionId: definition.id,
        name: "Library occurrence",
        grounded: true,
        worldFrame: { translation: [0, 0, 0], quaternion: [0, 0, 0, 1] },
      },
    },
  ]
  const inserted = evidenceValue(command(base, changes))
  const prefix = [
    local.authored.created.event,
    local.authored.added.event,
    local.authored.upgraded.event,
    local.textureUpgraded.event,
    local.upgraded.event,
  ]
  return { foreign, base, definition, changes, inserted, prefix }
}
function command(snapshot: DocumentSnapshotV4, changes: unknown) {
  return applyDocumentV4Command(snapshot, {
    ...authorityEnvelope(snapshot.revision),
    schemaVersion: 4,
    kind: "org.vibeshape.document.assembly-command",
    payload: { changes },
  })
}

describe("frozen library insertion authority", () => {
  it("inserts foreign frozen producers and verified descriptor intent without a live source Part", async () => {
    const { foreign, base, inserted, definition } = await fixture()
    expect(base.assets).toEqual([])
    expect(
      base.features.some(
        ({ id }) => id === foreign.definition.pinnedModels[0]?.selectedBody.featureId,
      ),
    ).toBe(false)
    expect(inserted.snapshot.assets).toEqual([foreign.asset])
    expect(inserted.snapshot.assembly.definitions[0]).toEqual<unknown>(definition)
    expect(inserted.snapshot.parts).toEqual(base.parts)
    expect(inserted.snapshot.assembly.instances[0]?.definitionId).toBe<unknown>(definition.id)
  })
  it("relinks only explicitly, preserves occurrence identity and detaches without mutating frozen geometry", async () => {
    const { inserted, definition } = await fixture()
    const replacement = {
      ...definition,
      pinRevision: 2,
      sourceFrame: { translation: [5, 0, 0], quaternion: [0, 0, 0, 1] },
      libraryBinding: { ...definition.libraryBinding, version: 2 },
    }
    const relinked = evidenceValue(
      command(inserted.snapshot, [{ kind: "definition.relink-pinned", definition: replacement }]),
    )
    expect(relinked.snapshot.assembly.instances).toEqual(inserted.snapshot.assembly.instances)
    expect(relinked.snapshot.assembly.definitions[0]).toEqual<unknown>(replacement)
    const detached = evidenceValue(
      command(relinked.snapshot, [
        { kind: "definition.detach-library", definitionId: definition.id },
      ]),
    )
    const { libraryBinding: _binding, ...copy } = replacement
    expect(detached.snapshot.assembly.definitions[0]).toEqual<unknown>(copy)
    expect(
      command(detached.snapshot, [
        { kind: "definition.detach-library", definitionId: definition.id },
      ]).ok,
    ).toBe(false)
    expect(
      command(inserted.snapshot, [
        { kind: "definition.relink-pinned", definition: { ...replacement, pinRevision: 3 } },
      ]).ok,
    ).toBe(false)
  })
  it("rejects malformed pins, identity reuse and descriptor drift without changing the source authority", async () => {
    const { base, inserted, definition, foreign } = await fixture()
    const before = JSON.stringify(base)
    const pinned = definition.pinnedModels[0]
    if (!pinned) throw new Error("The fixture requires one frozen source.")
    for (const invalid of [
      { ...definition, pinRevision: 2 },
      { ...definition, id: base.features[0]?.id },
      { ...definition, pinnedModels: [] },
      { ...definition, libraryBinding: { itemId: libraryFixtureId(90), version: 0 } },
      {
        ...definition,
        pinnedModels: [
          { ...pinned, selectedBody: { ...pinned.selectedBody, outputRole: "result" } },
        ],
      },
    ])
      expect(command(base, [{ kind: "definition.insert-pinned", definition: invalid }]).ok).toBe(
        false,
      )
    expect(JSON.stringify(base)).toBe(before)
    expect(command(inserted.snapshot, [{ kind: "definition.insert-pinned", definition }]).ok).toBe(
      false,
    )
    const drifted = documentSnapshotV4Schema.parse({
      ...base,
      assets: [{ ...foreign.asset, filename: "Changed provenance.stl" }],
    })
    expect(command(drifted, [{ kind: "definition.insert-pinned", definition }]).ok).toBe(false)
    const collided = documentSnapshotV4Schema.parse({
      ...base,
      assets: [{ ...foreign.asset, id: libraryFixtureId(82) }],
    })
    expect(command(collided, [{ kind: "definition.insert-pinned", definition }]).ok).toBe(false)
    const replay = evidenceValue(reduceDocumentV4Event(base, inserted.event))
    expect(replay.snapshot).toEqual(inserted.snapshot)
  })
  it("retains historical byte closure through Undo, Redo, complete replay and copied provenance", async () => {
    const { base, inserted, prefix, foreign, definition } = await fixture()
    const undo = documentRestoredV4EventSchema.parse({
      ...authorityEnvelope(inserted.snapshot.revision),
      schemaVersion: 4,
      revision: inserted.snapshot.revision + 1,
      transactionId: null,
      type: "org.vibeshape.document.restored",
      direction: "undo",
      targetRevision: base.revision,
    })
    const undone = evidenceValue(reduceDocumentV4Event(inserted.snapshot, undo, base))
    expect(undone.snapshot.assets).toEqual([])
    expect(
      documentSourceAssetClosure(null, [...prefix, inserted.event, undo], undone.snapshot),
    ).toEqual([foreign.asset])
    const redo = documentRestoredV4EventSchema.parse({
      ...authorityEnvelope(undone.snapshot.revision),
      schemaVersion: 4,
      revision: undone.snapshot.revision + 1,
      transactionId: null,
      type: "org.vibeshape.document.restored",
      direction: "redo",
      targetRevision: inserted.snapshot.revision,
    })
    const redone = evidenceValue(reduceDocumentV4Event(undone.snapshot, redo, inserted.snapshot))
    expect(redone.snapshot.assembly.definitions[0]).toEqual<unknown>(definition)
    const events = [...prefix, inserted.event, undo, redo]
    expect(evidenceValue(replayDocumentAuthorityEvents(null, events)).snapshot).toEqual(
      redone.snapshot,
    )
    const copied = evidenceValue(
      copyCompleteDocumentAuthorityHistory({
        sourceSeed: null,
        sourceLegacyEvents: [],
        sourceEvents: events,
        sourceSnapshot: redone.snapshot,
        documentId: libraryFixtureId(700),
        commandIds: Array.from({ length: events.length + 1 }, (_, n) => libraryFixtureId(800 + n)),
        transactionIds: [],
        name: "Copied library assembly",
        issuedAt: libraryFixtureTimestamp,
        actor: { type: "user", userId: null },
      }),
    )
    expect(copied.snapshot.schemaVersion).toBe(4)
    if (copied.snapshot.schemaVersion !== 4)
      throw new Error("A frozen library copy must retain V4 authority.")
    expect(copied.snapshot.assembly.definitions[0]).toEqual<unknown>(definition)
    expect(copied.snapshot.assets).toEqual([foreign.asset])
  })
})
