import { describe, expect, it } from "bun:test"
import { canonicalJson } from "./canonical-json"
import { replayDocumentAuthorityEvents } from "./document-v2-replay"
import { documentSnapshotV2Schema } from "./document-v2-schema"
import { documentSnapshotV5Schema } from "./document-v5"
import {
  documentSnapshotV6Schema,
  projectDocumentSnapshotV6ToV5,
  promoteDocumentSnapshotV6,
} from "./document-v6"
import {
  applyDocumentV6AuthoredCommand,
  applyDocumentV6MetadataCommand,
  reduceDocumentV6Event,
} from "./document-v6-commands"
import {
  historyRepairFixture,
  repairActor,
  repairId,
  repairIssuedAt,
} from "./history-repair.test-fixture"
import {
  appearanceColorSchema,
  appearancePresetIdSchema,
  appearancePresets,
} from "./part-appearance"

function accepted<T extends { ok: boolean }>(value: T): Extract<T, { ok: true }> {
  if (!value.ok) throw new Error(JSON.stringify(value))
  return value as Extract<T, { ok: true }>
}
function command(baseRevision: number, appearance: unknown) {
  return {
    schemaVersion: 6,
    kind: "org.vibeshape.document.metadata-command",
    commandId: repairId(1000 + baseRevision),
    documentId: repairId(200),
    baseRevision,
    issuedAt: repairIssuedAt,
    actor: repairActor,
    payload: { kind: "part.set-appearance", partId: repairId(100), appearance },
  }
}

describe("authored visual appearance", () => {
  it("owns stable preset identifiers and rejects non-hex user color data", () => {
    expect(appearancePresetIdSchema.options).toEqual<unknown>([
      "aluminum-satin",
      "steel-brushed",
      "stainless-steel",
      "brass",
      "copper",
      "chrome",
      "anodized-black",
      "abs-white",
      "abs-black",
      "abs-grey",
      "polycarbonate-clear",
      "nylon-natural",
    ])
    expect(Object.keys(appearancePresets)).toHaveLength(12)
    expect(appearancePresets["polycarbonate-clear"]).toMatchObject({ opacity: 0.28, metalness: 0 })
    expect(String(appearanceColorSchema.parse("#12aBcF"))).toBe("#12aBcF")
    for (const color of ["red", "#fff", "#12345g", "#11223344", "url(example)", "#123456;"])
      expect(appearanceColorSchema.safeParse(color).success).toBe(false)
  })

  it.each([2, 3, 4, 5] as const)(
    "adopts V6 from V%s atomically without changing model, identity or historical parsers",
    (version) => {
      const base = historyRepairFixture()
      const lifted = promoteDocumentSnapshotV6(base)
      const source =
        version === 2
          ? base
          : version === 5
            ? projectDocumentSnapshotV6ToV5(lifted)
            : version === 3
              ? { ...base, schemaVersion: 3, surfaceTextures: [] }
              : {
                  ...base,
                  schemaVersion: 4,
                  surfaceTextures: [],
                  assets: [],
                  assembly: lifted.assembly,
                }
      const changed = accepted(
        applyDocumentV6MetadataCommand(
          source,
          command(base.revision, { presetId: "brass", color: "#e04488" }),
        ),
      )
      expect(changed.snapshot.revision).toBe(base.revision + 1)
      expect(changed.snapshot.parts).toEqual<unknown>(base.parts)
      expect(canonicalJson(changed.snapshot.features)).toBe(canonicalJson(base.features))
      expect(changed.snapshot.partAppearances).toEqual<unknown>([
        { partId: repairId(100), appearance: { presetId: "brass", color: "#e04488" } },
      ])
      expect(documentSnapshotV2Schema.safeParse(changed.snapshot).success).toBe(false)
      expect(documentSnapshotV5Schema.safeParse(changed.snapshot).success).toBe(false)
      expect(
        accepted(replayDocumentAuthorityEvents(source, [changed.event])).snapshot,
      ).toEqual<unknown>(changed.snapshot)
    },
  )

  it("replaces the whole appearance, preserves material on color edits and restores the default on reset", () => {
    const base = historyRepairFixture()
    const first = accepted(
      applyDocumentV6MetadataCommand(base, command(base.revision, { presetId: "copper" })),
    )
    const colored = accepted(
      applyDocumentV6MetadataCommand(
        first.snapshot,
        command(first.snapshot.revision, { presetId: "copper", color: "#7744cc" }),
      ),
    )
    expect(colored.snapshot.partAppearances[0]?.appearance).toEqual<unknown>({
      presetId: "copper",
      color: "#7744cc",
    })
    const changed = accepted(
      applyDocumentV6MetadataCommand(
        colored.snapshot,
        command(colored.snapshot.revision, { presetId: "chrome" }),
      ),
    )
    expect(changed.snapshot.partAppearances[0]?.appearance).toEqual<unknown>({ presetId: "chrome" })
    const reset = accepted(
      applyDocumentV6MetadataCommand(changed.snapshot, command(changed.snapshot.revision, null)),
    )
    expect(reset.snapshot.partAppearances).toEqual<unknown>([])
    expect(reduceDocumentV6Event(base, { ...first.event, baseRevision: 0 })).toMatchObject({
      ok: false,
      diagnostic: { code: "stale-revision" },
    })
    expect(
      applyDocumentV6MetadataCommand(base, {
        ...command(base.revision, { presetId: "brass" }),
        payload: {
          kind: "part.set-appearance",
          partId: repairId(999),
          appearance: { presetId: "brass" },
        },
      }).ok,
    ).toBe(false)
    expect(
      documentSnapshotV6Schema.safeParse({
        ...first.snapshot,
        partAppearances: [...first.snapshot.partAppearances, ...first.snapshot.partAppearances],
      }).success,
    ).toBe(false)
  })

  it("keeps appearance through model/metadata wrappers and restores a pre-adoption target without downgrading authority", () => {
    const base = historyRepairFixture()
    const first = accepted(
      applyDocumentV6MetadataCommand(
        base,
        command(base.revision, { presetId: null, color: "#123456" }),
      ),
    )
    const renamed = accepted(
      applyDocumentV6AuthoredCommand(first.snapshot, {
        ...command(first.snapshot.revision, null),
        schemaVersion: 3,
        payload: { kind: "part.rename", partId: repairId(100), name: "Colored housing" },
      }),
    )
    expect(renamed.snapshot.partAppearances).toEqual<unknown>(first.snapshot.partAppearances)
    expect(renamed.snapshot.parts[0]?.name).toBe("Colored housing")
    if (first.event.type !== "org.vibeshape.document.metadata-changed")
      throw new Error("Missing appearance event")
    const restoredEvent = {
      ...first.event,
      commandId: repairId(1200),
      baseRevision: renamed.snapshot.revision,
      revision: renamed.snapshot.revision + 1,
      type: "org.vibeshape.document.restored",
      direction: "undo",
      targetRevision: base.revision,
    }
    const { change: _change, ...restore } = restoredEvent
    const restored = accepted(reduceDocumentV6Event(renamed.snapshot, restore, base))
    expect(restored.snapshot.schemaVersion).toBe(6)
    expect(restored.snapshot.partAppearances).toEqual<unknown>([])
    expect(restored.snapshot.parts).toEqual<unknown>(base.parts)
    expect(
      accepted(replayDocumentAuthorityEvents(base, [first.event, renamed.event, restore])).snapshot,
    ).toEqual<unknown>(restored.snapshot)
  })
})
