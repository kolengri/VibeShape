import { copyCompleteDocumentAuthorityHistory } from "@vibeshape/domain/document-v2-copy"
import { applyHistoryRepairCommand } from "@vibeshape/domain/document-v5-commands"
import { describe, expect, it } from "vitest"
import {
  historyRepairJournalFixture,
  repairActor,
  repairId,
  repairIssuedAt,
} from "../../domain/src/history-repair.test-fixture"
import { readAuthoredVShape, readVShapeV5, readVShapeV6, writeVShapeV6 } from "./vshape"

function success<T extends { ok: boolean }>(result: T): Extract<T, { ok: true }> {
  if (!result.ok) throw new Error(JSON.stringify(result))
  return result as Extract<T, { ok: true }>
}
function portable() {
  const fixture = historyRepairJournalFixture()
  return {
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
    exportedAt: repairIssuedAt,
    createdBy: { application: "VibeShape", version: "0.0.0", build: null },
    engine: null,
  }
}
describe("portable disconnected History authority", () => {
  it("round-trips and copies explicit repair events with restored descendant and Part identities", async () => {
    const input = portable()
    const independent = input.snapshot.features[3]
    const root = input.snapshot.repairIntents[0]
    if (!independent || root?.kind !== "feature") throw new Error("Missing repair fixtures.")
    const { semanticInputs: _semanticInputs, ...box } = independent
    const repaired = success(
      applyHistoryRepairCommand(input.snapshot, {
        schemaVersion: 5,
        kind: "org.vibeshape.history.repair",
        commandId: repairId(790),
        documentId: input.snapshot.id,
        baseRevision: input.snapshot.revision,
        issuedAt: repairIssuedAt,
        actor: repairActor,
        payload: {
          item: {
            kind: "feature",
            feature: { ...box, schemaVersion: 0, id: root.authored.id, label: root.authored.label },
          },
        },
      }),
    )
    expect(repaired.snapshot.repairIntents).toEqual([])
    const archive = success(
      await writeVShapeV6({
        ...input,
        snapshot: repaired.snapshot,
        versionedEvents: [...input.versionedEvents, repaired.event],
      }),
    ).value
    const read = success(await readVShapeV6(archive)).value
    expect(read.snapshot).toEqual(repaired.snapshot)
    expect(read.versionedEvents.at(-1)).toEqual(repaired.event)
    const copy = success(
      copyCompleteDocumentAuthorityHistory({
        sourceLegacyEvents: [],
        sourceSeed: null,
        sourceSnapshot: read.snapshot,
        sourceEvents: read.versionedEvents,
        documentId: repairId(800),
        commandIds: Array.from({ length: read.versionedEvents.length + 1 }, (_, index) =>
          repairId(810 + index),
        ),
        transactionIds: [],
        name: "Copied repaired project",
        issuedAt: repairIssuedAt,
        actor: repairActor,
      }),
    )
    expect(copy.snapshot).toMatchObject({
      schemaVersion: 5,
      repairIntents: [],
      suspendedParts: [],
      parts: repaired.snapshot.parts,
    })
  })
  it("round-trips complete writable repair intent, descendants and suspended part identities through V6", async () => {
    const input = portable()
    const archive = success(await writeVShapeV6(input)).value
    const read = success(await readVShapeV6(archive)).value
    expect(read.snapshot).toEqual(input.snapshot)
    expect(read.versionedEvents).toEqual(input.versionedEvents)
    expect(success(await readAuthoredVShape(archive)).value.version).toBe(6)
    expect((await readVShapeV5(archive)).ok).toBe(false)
    const copy = success(
      copyCompleteDocumentAuthorityHistory({
        sourceLegacyEvents: [],
        sourceSeed: null,
        sourceSnapshot: read.snapshot,
        sourceEvents: read.versionedEvents,
        documentId: repairId(700),
        commandIds: Array.from({ length: read.versionedEvents.length + 1 }, (_, index) =>
          repairId(710 + index),
        ),
        transactionIds: [],
        name: "Copied repair project",
        issuedAt: repairIssuedAt,
        actor: repairActor,
      }),
    )
    expect(copy.snapshot.schemaVersion).toBe(5)
    if (copy.snapshot.schemaVersion !== 5) throw new Error("Missing copied repair authority")
    expect(copy.snapshot.repairIntents).toEqual(read.snapshot.repairIntents)
    expect(copy.snapshot.suspendedParts).toEqual(read.snapshot.suspendedParts)
  })
  it("rejects forged adoption provenance and missing authored repair state", async () => {
    const input = portable()
    expect(
      (await writeVShapeV6({ ...input, repairUpgradeRevision: input.repairUpgradeRevision - 1 }))
        .ok,
    ).toBe(false)
    expect(
      (await writeVShapeV6({ ...input, snapshot: { ...input.snapshot, repairIntents: [] } })).ok,
    ).toBe(false)
    expect(
      (await writeVShapeV6({ ...input, versionedEvents: input.versionedEvents.slice(0, -1) })).ok,
    ).toBe(false)
  })
})
