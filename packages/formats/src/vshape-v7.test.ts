import { describe, expect, it } from "bun:test"
import { copyCompleteDocumentAuthorityHistory } from "@vibeshape/domain/document-v2-copy"
import { repairActor, repairId, repairIssuedAt } from "../../domain/src/history-repair.test-fixture"
import { partAppearanceJournalFixture } from "../../domain/src/part-appearance.test-fixture"
import { readAuthoredVShape, readVShapeV6, readVShapeV7, writeVShapeV7 } from "./vshape"

function accepted<T extends { ok: boolean }>(value: T): Extract<T, { ok: true }> {
  if (!value.ok) throw new Error(JSON.stringify(value))
  return value as Extract<T, { ok: true }>
}
function input() {
  return {
    ...partAppearanceJournalFixture().payload,
    exportedAt: repairIssuedAt,
    createdBy: { application: "VibeShape", version: "test", build: null },
    engine: null,
  }
}
describe("native V7 authored appearance", () => {
  it("round-trips visual material, custom color, repair intent and exact PartIds with complete replayable history", async () => {
    const source = input()
    const bytes = accepted(await writeVShapeV7(source)).value
    const read = accepted(await readVShapeV7(bytes)).value
    expect(read.snapshot).toEqual(source.snapshot)
    expect(read.snapshot.partAppearances).toEqual<unknown>([
      { partId: repairId(101), appearance: { presetId: "copper", color: "#4488cc" } },
    ])
    expect(read.versionedEvents).toEqual(source.versionedEvents)
    expect(accepted(await readAuthoredVShape(bytes)).value.version).toBe(7)
    expect((await readVShapeV6(bytes)).ok).toBe(false)
    const copy = accepted(
      copyCompleteDocumentAuthorityHistory({
        sourceLegacyEvents: [],
        sourceSeed: null,
        sourceSnapshot: read.snapshot,
        sourceEvents: read.versionedEvents,
        documentId: repairId(1400),
        commandIds: Array.from({ length: read.versionedEvents.length + 1 }, (_, n) =>
          repairId(1500 + n),
        ),
        transactionIds: [],
        name: "Appearance copy",
        issuedAt: repairIssuedAt,
        actor: repairActor,
      }),
    )
    expect(copy.snapshot).toMatchObject({
      schemaVersion: 6,
      partAppearances: source.snapshot.partAppearances,
      parts: source.snapshot.parts,
      suspendedParts: source.snapshot.suspendedParts,
    })
  })
  it("rejects omitted adoption provenance and an appearance changed without its event", async () => {
    const source = input()
    expect(
      await writeVShapeV7({ ...source, appearanceUpgradeRevision: source.repairUpgradeRevision }),
    ).toMatchObject({ ok: false, diagnostic: { code: "history-mismatch" } })
    expect(
      await writeVShapeV7({ ...source, snapshot: { ...source.snapshot, partAppearances: [] } }),
    ).toMatchObject({ ok: false, diagnostic: { code: "history-mismatch" } })
    expect(
      await writeVShapeV7({
        ...source,
        snapshot: {
          ...source.snapshot,
          partAppearances: [
            { partId: repairId(101), appearance: { presetId: "copper", color: "red" } },
          ],
        },
      }),
    ).toMatchObject({ ok: false, diagnostic: { code: "invalid-document" } })
  })
})
