import { describe, expect, it, vi } from "vitest"
import { type BodyReference, bodyReferenceSchema } from "./body-reference"
import { type DocumentSnapshotV2, projectDocumentSnapshotV2ToV1 } from "./document-v2"
import { applyDocumentV2Command, reduceDocumentV2Event } from "./document-v2-commands"
import { applyDocumentUpgradeV2Command } from "./document-v2-migration"
import { replayDocumentAuthorityEvents } from "./document-v2-replay"
import { featureRecordSchema } from "./feature-graph"
import { terminalBodyOutputs } from "./model-bodies"
import { derivePartBindings, requiredPartAllocations } from "./part-bindings"
import { boxFeatureType } from "./part-design"
import { mirrorFeatureType } from "./part-design-mirror"
import {
  SPLIT_NEGATIVE_OUTPUT_ROLE,
  SPLIT_POSITIVE_OUTPUT_ROLE,
  splitFeatureType,
} from "./part-design-split"
import * as partOperations from "./part-operation"
import { type PartAllocation, type PartRecord, partAllocationSchema } from "./parts"
import { createLengthQuantity } from "./units"
import { applyVersionedDocumentCommand } from "./versioned-document-commands"

const id = (suffix: number) => `0195b5ac-b220-7a2c-8c33-${suffix.toString(16).padStart(12, "0")}`
function success<T extends { ok: boolean }>(result: T): Extract<T, { ok: true }> {
  if (!result.ok) throw new Error(JSON.stringify(result))
  return result as Extract<T, { ok: true }>
}
function envelope(revision: number) {
  return {
    schemaVersion: 2,
    documentId: id(1),
    commandId: id(1000 + revision),
    baseRevision: revision,
    issuedAt: "2026-10-03T00:00:00Z",
    actor: { type: "user", userId: null },
  }
}
function body(feature = 2, outputRole = "result"): BodyReference {
  return bodyReferenceSchema.parse({ schemaVersion: 0, featureId: id(feature), outputRole })
}
const negative = () => body(3, SPLIT_NEGATIVE_OUTPUT_ROLE)
const positive = () => body(3, SPLIT_POSITIVE_OUTPUT_ROLE)
function allocation(
  target: BodyReference,
  partId: number,
  origin: "fork" | "independent" = "independent",
): PartAllocation {
  return partAllocationSchema.parse({
    id: id(partId),
    name: `Part ${partId}`,
    body: target,
    origin,
  })
}
function model(
  snapshot: DocumentSnapshotV2,
  kind: string,
  payload: unknown,
  allocations: readonly PartAllocation[] = [],
) {
  return applyDocumentV2Command(snapshot, {
    ...envelope(snapshot.revision),
    kind: "org.vibeshape.document.model-command",
    payload: {
      command: { ...envelope(snapshot.revision), schemaVersion: 1, kind, payload },
      partAllocations: allocations,
    },
  })
}
function insert(
  snapshot: DocumentSnapshotV2,
  feature: unknown,
  allocations: readonly PartAllocation[] = [],
) {
  return model(
    snapshot,
    "org.vibeshape.history.insert-feature",
    { feature, historyAfter: snapshot.history.at(-1) ?? null },
    allocations,
  )
}
function metadata(snapshot: DocumentSnapshotV2, payload: unknown) {
  return success(
    applyDocumentV2Command(snapshot, {
      ...envelope(snapshot.revision),
      kind: "org.vibeshape.document.metadata-command",
      payload,
    }),
  ).snapshot
}
function split(target = body(), suppressed = false) {
  return {
    schemaVersion: 0,
    id: id(3),
    type: splitFeatureType.type,
    dependencies: [target.featureId],
    references: [],
    suppressed,
    parameters: { targetBody: target, plane: "XY", offset: createLengthQuantity(10) },
  }
}
function mirror(featureId: number, target: BodyReference) {
  return {
    schemaVersion: 0,
    id: id(featureId),
    type: mirrorFeatureType.type,
    dependencies: [target.featureId],
    references: [],
    suppressed: false,
    parameters: { targetBody: target, plane: "XZ" },
  }
}
function journal() {
  const created = success(
    applyVersionedDocumentCommand(null, {
      ...envelope(0),
      schemaVersion: 1,
      kind: "org.vibeshape.document.create",
      payload: { name: "Split fixture" },
    }),
  )
  const upgraded = success(
    applyDocumentUpgradeV2Command(created.snapshot, {
      ...envelope(created.snapshot.revision),
      kind: "org.vibeshape.document.upgrade-v2",
      payload: { partAllocations: [] },
    }),
  )
  const source = {
    schemaVersion: 0,
    id: id(2),
    type: boxFeatureType.type,
    dependencies: [],
    references: [],
    suppressed: false,
    parameters: {
      width: createLengthQuantity(20),
      depth: createLengthQuantity(30),
      height: createLengthQuantity(40),
      centered: false,
    },
  }
  const root = success(
    insert(upgraded.snapshot, source, [{ ...allocation(body(), 100), name: "Housing" }]),
  )
  return { snapshot: root.snapshot, events: [created.event, upgraded.event, root.event], source }
}
function part(snapshot: DocumentSnapshotV2, partId: number): PartRecord {
  const found = snapshot.parts.find((value) => value.id === id(partId))
  if (!found) throw new Error(`Part ${partId} must remain authored.`)
  return found
}
function restore(
  snapshot: DocumentSnapshotV2,
  target: DocumentSnapshotV2,
  direction: "undo" | "redo",
) {
  const event = {
    ...envelope(snapshot.revision),
    type: "org.vibeshape.document.restored",
    transactionId: null,
    revision: snapshot.revision + 1,
    direction,
    targetRevision: target.revision,
  }
  return { event, snapshot: success(reduceDocumentV2Event(snapshot, event, target)).snapshot }
}

describe("captured exact-body fan-out", () => {
  it("advances the current source once, creates only the positive independent history, and preserves metadata", () => {
    const renamed = metadata(journal().snapshot, {
      kind: "part.rename",
      partId: id(100),
      name: "Main housing",
    })
    const before = metadata(renamed, {
      kind: "part.set-visibility",
      partId: id(100),
      visible: false,
    })
    const added = success(insert(before, split(), [allocation(positive(), 101)]))
    expect(added.snapshot.parts.map((value) => value.id)).toEqual([id(100), id(101)])
    expect(part(added.snapshot, 100)).toEqual({
      ...part(before, 100),
      bodyHistory: [body(), negative()],
    })
    expect(part(added.snapshot, 101)).toMatchObject({
      origin: "independent",
      visible: true,
      consumedBy: null,
      bodyHistory: [positive()],
    })
    expect(success(reduceDocumentV2Event(before, added.event)).snapshot).toEqual(added.snapshot)
    const edited = success(
      model(added.snapshot, "org.vibeshape.feature.update", {
        feature: {
          ...split(),
          parameters: { ...split().parameters, plane: "YZ", offset: createLengthQuantity(-4) },
        },
      }),
    ).snapshot
    expect(edited.parts).toEqual(added.snapshot.parts)
  })

  it("captures a negative fork for a historical target without consuming the later source tip", () => {
    const base = journal().snapshot
    const modified = success(insert(base, mirror(4, body()))).snapshot
    const added = success(
      insert(modified, split(), [allocation(negative(), 102, "fork"), allocation(positive(), 101)]),
    ).snapshot
    expect(added.parts.map((value) => value.id)).toEqual([id(100), id(102), id(101)])
    expect(part(added, 100)).toEqual(part(modified, 100))
    expect(part(added, 102)).toMatchObject({
      origin: "fork",
      bodyHistory: [negative()],
      consumedBy: null,
    })
    expect(part(added, 101).bodyHistory).toEqual([positive()])
    const hiddenModifier = success(
      model(added, "org.vibeshape.feature.update", {
        feature: { ...mirror(4, body()), suppressed: true },
      }),
    ).snapshot
    expect(part(hiddenModifier, 102).id).toBe(id(102))
    expect(part(hiddenModifier, 100).consumedBy).toBe(id(3))
    const hiddenSplit = success(
      model(hiddenModifier, "org.vibeshape.feature.update", { feature: split(body(), true) }),
    ).snapshot
    expect(part(hiddenSplit, 100).consumedBy).toBeNull()
    expect(part(hiddenSplit, 100).bodyHistory).toEqual([body()])
    expect(part(hiddenSplit, 102).bodyHistory).toEqual([negative()])
    expect(part(hiddenSplit, 101).bodyHistory).toEqual([positive()])
  })

  it.each(["split", "source"] as const)(
    "retains captured IDs while %s suppression skips source advancement",
    (suppressed) => {
      const fixture = journal()
      const added = success(
        insert(fixture.snapshot, split(), [allocation(positive(), 101)]),
      ).snapshot
      const feature =
        suppressed === "split" ? split(body(), true) : { ...fixture.source, suppressed: true }
      const hidden = success(model(added, "org.vibeshape.feature.update", { feature })).snapshot
      expect(hidden.parts.map((value) => value.id)).toEqual([id(100), id(101)])
      expect(part(hidden, 100).bodyHistory).toEqual([body()])
      expect(part(hidden, 101).bodyHistory).toEqual([positive()])
      const activeFeature = suppressed === "split" ? split() : fixture.source
      expect(
        success(model(hidden, "org.vibeshape.feature.update", { feature: activeFeature })).snapshot
          .parts,
      ).toEqual(added.parts)
    },
  )

  it("advances either exact split role without changing the sibling part", () => {
    const added = success(
      insert(journal().snapshot, split(), [allocation(positive(), 101)]),
    ).snapshot
    const movedPositive = success(insert(added, mirror(4, positive()))).snapshot
    expect(part(movedPositive, 100)).toEqual(part(added, 100))
    expect(part(movedPositive, 101).bodyHistory).toEqual([positive(), body(4)])
    const movedNegative = success(insert(movedPositive, mirror(5, negative()))).snapshot
    expect(part(movedNegative, 100).bodyHistory).toEqual([body(), negative(), body(5)])
    expect(part(movedNegative, 101)).toEqual(part(movedPositive, 101))
  })

  it("keeps downstream captured roots dormant when an earlier continuation becomes unavailable", () => {
    const first = success(
      insert(journal().snapshot, split(), [allocation(positive(), 101)]),
    ).snapshot
    const second = { ...split(negative()), id: id(6) }
    const secondPositive = body(6, SPLIT_POSITIVE_OUTPUT_ROLE)
    const chained = success(insert(first, second, [allocation(secondPositive, 102)])).snapshot
    const hidden = success(
      model(chained, "org.vibeshape.feature.update", { feature: split(body(), true) }),
    ).snapshot
    expect(hidden.parts.map((value) => value.id)).toEqual([id(100), id(101), id(102)])
    expect(part(hidden, 100).bodyHistory).toEqual([body()])
    expect(part(hidden, 102).bodyHistory).toEqual([secondPositive])
    expect(
      success(model(hidden, "org.vibeshape.feature.update", { feature: split() })).snapshot.parts,
    ).toEqual(chained.parts)
    const substituted = {
      ...second,
      parameters: { ...second.parameters, targetBody: body(3, "split.absent") },
    }
    const retargeted = success(
      model(hidden, "org.vibeshape.feature.update", { feature: substituted }),
    ).snapshot
    expect(retargeted.parts.map((value) => value.id)).toEqual([id(100), id(101)])
  })

  it.each([
    { name: "missing", allocations: [] },
    { name: "reused PartId", allocations: [allocation(positive(), 100)] },
    { name: "wrong output", allocations: [allocation(negative(), 101)] },
    { name: "wrong origin", allocations: [allocation(positive(), 101, "fork")] },
    {
      name: "surplus output",
      allocations: [allocation(positive(), 101), allocation(body(3, "split.extra"), 102)],
    },
  ])("rejects $name allocations before changing the snapshot", ({ allocations }) => {
    const before = journal().snapshot
    expect(insert(before, split(), allocations).ok).toBe(false)
    expect(before.parts[0]?.bodyHistory).toEqual([body()])
  })

  it("produces no partial fan-out when the exact selected body has no authored owner", () => {
    const before = journal().snapshot
    const unowned = split(body(2, "body.absent"))
    expect(insert(before, unowned, [allocation(positive(), 101)]).ok).toBe(false)
    const authored = success(insert(before, unowned)).snapshot
    expect(authored.parts).toEqual(before.parts)
    expect(requiredPartAllocations(projectDocumentSnapshotV2ToV1(authored), before.parts)).toEqual(
      [],
    )
  })

  it("rejects changed captured effect identities and histories during replay", () => {
    const before = journal().snapshot
    const added = success(insert(before, split(), [allocation(positive(), 101)]))
    if (added.event.type !== "org.vibeshape.document.model-changed")
      throw new Error("Split must create a model event.")
    const changedIds = added.event.partEffects.map((effect) =>
      effect.kind === "create" ? { ...effect, part: { ...effect.part, id: id(100) } } : effect,
    )
    expect(reduceDocumentV2Event(before, { ...added.event, partEffects: changedIds }).ok).toBe(
      false,
    )
    const changedHistory = added.event.partEffects.map((effect) =>
      effect.kind === "replace"
        ? { ...effect, part: { ...effect.part, bodyHistory: [body(), positive()] } }
        : effect,
    )
    expect(reduceDocumentV2Event(before, { ...added.event, partEffects: changedHistory }).ok).toBe(
      false,
    )
  })

  it("restores model and both captured identities through undo, redo, and full journal replay", () => {
    const fixture = journal()
    const added = success(insert(fixture.snapshot, split(), [allocation(positive(), 101)]))
    const undo = restore(added.snapshot, fixture.snapshot, "undo")
    expect(undo.snapshot.parts).toEqual(fixture.snapshot.parts)
    const redo = restore(undo.snapshot, added.snapshot, "redo")
    expect(redo.snapshot.parts).toEqual(added.snapshot.parts)
    expect(
      success(
        replayDocumentAuthorityEvents(null, [
          ...fixture.events,
          added.event,
          undo.event,
          redo.event,
        ]),
      ).snapshot,
    ).toEqual(redo.snapshot)
  })

  it("consumes only the selected producer role and retains source geometry when split evaluation fails", () => {
    const splitFeature = featureRecordSchema.parse(split(body(2, "body.primary")))
    const sourceFeature = featureRecordSchema.parse(journal().source)
    const primary = { featureId: id(2), outputRole: "body.primary" }
    const sibling = { featureId: id(2), outputRole: "body.sibling" }
    const outputs = [
      { featureId: id(3), outputRole: SPLIT_NEGATIVE_OUTPUT_ROLE },
      { featureId: id(3), outputRole: SPLIT_POSITIVE_OUTPUT_ROLE },
    ]
    expect(
      terminalBodyOutputs(
        [sourceFeature, splitFeature],
        new Map([
          [id(2), [primary, sibling]],
          [id(3), outputs],
        ]),
      ),
    ).toEqual([sibling, ...outputs])
    expect(
      terminalBodyOutputs([sourceFeature, splitFeature], new Map([[id(2), [primary, sibling]]])),
    ).toEqual([primary, sibling])
    expect(
      terminalBodyOutputs(
        [sourceFeature, splitFeature],
        new Map([
          [id(2), [sibling]],
          [id(3), outputs],
        ]),
      ),
    ).toBeNull()
  })

  it("supports multiple independent created roles through the reusable operation variant", () => {
    const before = journal().snapshot
    const added = success(insert(before, split(), [allocation(positive(), 101)])).snapshot
    const model = projectDocumentSnapshotV2ToV1(added)
    const extra = body(3, "fixture.extra")
    const classify = partOperations.classifyPartOperation
    const spy = vi.spyOn(partOperations, "classifyPartOperation").mockImplementation((feature) =>
      feature.id === id(3)
        ? {
            kind: "fan-out",
            target: body(),
            continuation: negative(),
            createdOutputs: [positive(), extra],
          }
        : classify(feature),
    )
    try {
      const allocations = [
        allocation(body(), 100),
        allocation(positive(), 101),
        allocation(extra, 102),
      ]
      const derived = derivePartBindings(model, allocations, before.parts)
      expect(derived?.map((value) => value.bodyHistory)).toEqual([
        [body(), negative()],
        [positive()],
        [extra],
      ])
      expect(requiredPartAllocations(model, before.parts)).toEqual([
        { body: positive(), origin: "independent" },
        { body: extra, origin: "independent" },
      ])
    } finally {
      spy.mockRestore()
    }
  })
})
