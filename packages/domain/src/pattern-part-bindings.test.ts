import { describe, expect, it } from "bun:test"
import { bodyReferenceSchema } from "./body-reference"
import { type DocumentSnapshotV2, projectDocumentSnapshotV2ToV1 } from "./document-v2"
import { applyDocumentV2Command, reduceDocumentV2Event } from "./document-v2-commands"
import { applyDocumentUpgradeV2Command } from "./document-v2-migration"
import { replayDocumentAuthorityEvents } from "./document-v2-replay"
import { documentSnapshotV4Schema, projectDocumentSnapshotV4ToV2 } from "./document-v4"
import { featureBodyDependencies } from "./feature-dependencies"
import { featureRecordSchema } from "./feature-graph"
import { sketchIdSchema } from "./identifiers"
import { terminalBodyOutputs } from "./model-bodies"
import { requiredPartAllocations } from "./part-bindings"
import { boxFeatureType, revolveFeatureTypeV7 } from "./part-design"
import { mirrorFeatureType } from "./part-design-mirror"
import { patternFeatureType, patternInstanceOutputRole } from "./part-design-pattern"
import { booleanFeatureTypeV2 } from "./part-design-subtract"
import { type PartAllocation, partAllocationSchema } from "./parts"
import { createEmptySketch } from "./sketch-edit"
import { createSketchProfileSet, sketchProfileSelectorSchema } from "./sketch-profile-selector"
import { createAngleQuantity, createLengthQuantity, createScalarQuantity } from "./units"
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
function body(feature = 2, outputRole = "result") {
  return bodyReferenceSchema.parse({ schemaVersion: 0, featureId: id(feature), outputRole })
}
const instance = (index: number, feature = 3) => body(feature, patternInstanceOutputRole(index))
function allocation(index: number, partId = 100 + index, feature = 3): PartAllocation {
  return partAllocationSchema.parse({
    id: id(partId),
    name: `Copy ${index}`,
    origin: "independent",
    body: instance(index, feature),
  })
}
function model(
  snapshot: DocumentSnapshotV2,
  kind: string,
  payload: unknown,
  partAllocations: readonly PartAllocation[] = [],
) {
  return applyDocumentV2Command(snapshot, {
    ...envelope(snapshot.revision),
    kind: "org.vibeshape.document.model-command",
    payload: {
      command: { ...envelope(snapshot.revision), schemaVersion: 1, kind, payload },
      partAllocations,
    },
  })
}
function pattern(count = 3, expression: string | null = null, suppressed = false) {
  return {
    schemaVersion: 0,
    id: id(3),
    type: patternFeatureType.type,
    dependencies: [id(2)],
    references: [],
    suppressed,
    parameters: {
      kind: "linear",
      targetBody: body(),
      count: createScalarQuantity(count, expression),
      axis: "X",
      spacing: createLengthQuantity(5),
    },
  }
}
function fixture() {
  const created = success(
    applyVersionedDocumentCommand(null, {
      ...envelope(0),
      schemaVersion: 1,
      kind: "org.vibeshape.document.create",
      payload: { name: "Pattern fixture" },
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
    model(
      upgraded.snapshot,
      "org.vibeshape.history.insert-feature",
      { feature: source, historyAfter: null },
      [
        partAllocationSchema.parse({
          id: id(100),
          name: "Housing",
          origin: "independent",
          body: body(),
        }),
      ],
    ),
  )
  return { snapshot: root.snapshot, events: [created.event, upgraded.event, root.event], source }
}
function insert(
  snapshot: DocumentSnapshotV2,
  feature = pattern(),
  allocations: readonly PartAllocation[] = [allocation(1), allocation(2)],
) {
  return model(
    snapshot,
    "org.vibeshape.history.insert-feature",
    { feature, historyAfter: snapshot.history.at(-1) },
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
function setCount(
  snapshot: DocumentSnapshotV2,
  count: number,
  allocations: readonly PartAllocation[] = [],
) {
  return model(snapshot, "org.vibeshape.feature.update", { feature: pattern(count) }, allocations)
}
function variableFixture() {
  const base = fixture()
  const variable = success(
    model(base.snapshot, "org.vibeshape.variable.add", {
      variable: { schemaVersion: 0, id: id(700), name: "copies", expression: "3" },
    }),
  )
  const added = success(insert(variable.snapshot, pattern(2, "#copies")))
  return { snapshot: added.snapshot, events: [...base.events, variable.event, added.event] }
}
function variableCount(
  snapshot: DocumentSnapshotV2,
  expression: string,
  allocations: readonly PartAllocation[] = [],
) {
  return model(
    snapshot,
    "org.vibeshape.variable.set-expression",
    { variableId: id(700), expression },
    allocations,
  )
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

describe("captured Pattern continuation and independent copies", () => {
  it("advances the source exactly once while independent copies contain no seed fallback", () => {
    const before = fixture().snapshot
    const added = success(insert(before)).snapshot
    expect(added.parts).toHaveLength(3)
    expect(added.parts[0]).toEqual<unknown>({
      ...before.parts[0],
      bodyHistory: [body(), instance(0)],
    })
    expect(added.parts.slice(1).map((part) => part.bodyHistory)).toEqual([
      [instance(1)],
      [instance(2)],
    ])
    expect(featureBodyDependencies(featureRecordSchema.parse(pattern()))).toEqual<unknown>([
      { featureId: id(2), outputRole: "result" },
    ])
  })

  it("retains captured dormant copy IDs, names, visibility, and numeric order on shrink and restore", () => {
    const added = success(insert(fixture().snapshot)).snapshot
    const named = metadata(added, {
      kind: "part.rename",
      partId: id(102),
      name: "Reusable housing copy",
    })
    const before = metadata(named, { kind: "part.set-visibility", partId: id(102), visible: false })
    const shrunk = success(setCount(before, 2)).snapshot
    expect(shrunk.parts).toEqual(before.parts)
    expect(success(setCount(shrunk, 3)).snapshot.parts).toEqual(before.parts)
    const grown = success(setCount(shrunk, 4, [allocation(3)])).snapshot
    expect(grown.parts.map((part) => part.id)).toEqual<unknown>([
      id(100),
      id(101),
      id(102),
      id(103),
    ])
    expect(grown.parts.slice(0, 3)).toEqual<unknown>(before.parts)
    const outputs = [0, 1].map((index) => ({
      featureId: id(3),
      outputRole: patternInstanceOutputRole(index),
    }))
    const source = featureRecordSchema.parse(fixture().source)
    expect(
      terminalBodyOutputs(
        [source, featureRecordSchema.parse(pattern(2))],
        new Map([
          [id(2), [{ featureId: id(2), outputRole: "result" }]],
          [id(3), outputs],
        ]),
      ),
    ).toEqual(outputs)
  })

  it.each(["pattern", "source"] as const)(
    "preserves all captured metadata while %s suppression rewinds only the continuation",
    (suppressed) => {
      const base = fixture()
      const added = success(insert(base.snapshot)).snapshot
      const hidden = success(
        model(added, "org.vibeshape.feature.update", {
          feature:
            suppressed === "pattern"
              ? pattern(3, null, true)
              : { ...base.source, suppressed: true },
        }),
      ).snapshot
      expect(hidden.parts.map((part) => part.id)).toEqual(added.parts.map((part) => part.id))
      expect(hidden.parts[0]?.bodyHistory).toEqual([body()])
      expect(hidden.parts.slice(1)).toEqual(added.parts.slice(1))
    },
  )

  it("forks a historical seed without consuming its later current tip", () => {
    const base = fixture().snapshot
    const mirror = {
      schemaVersion: 0,
      id: id(6),
      type: mirrorFeatureType.type,
      dependencies: [id(2)],
      references: [],
      suppressed: false,
      parameters: { targetBody: body(), plane: "XY" },
    }
    const later = success(
      model(base, "org.vibeshape.history.insert-feature", {
        feature: mirror,
        historyAfter: base.history.at(-1),
      }),
    ).snapshot
    const fork = partAllocationSchema.parse({
      id: id(103),
      name: "Historical seed",
      origin: "fork",
      body: instance(0),
    })
    const added = success(insert(later, pattern(), [fork, allocation(1), allocation(2)])).snapshot
    expect(added.parts[0]).toEqual(later.parts[0])
    expect(added.parts[1]).toMatchObject({
      id: id(103),
      origin: "fork",
      consumedBy: null,
      bodyHistory: [instance(0)],
    })
    expect(added.parts.slice(2).map((part) => part.bodyHistory)).toEqual([
      [instance(1)],
      [instance(2)],
    ])
  })

  it("preserves captured identities when switching between linear and circular placement intent", () => {
    const before = success(insert(fixture().snapshot)).snapshot
    const circular = {
      ...pattern(),
      parameters: {
        kind: "circular",
        targetBody: body(),
        count: createScalarQuantity(3),
        axis: "Z",
        angle: createAngleQuantity(Math.PI),
        center: {
          x: createLengthQuantity(0),
          y: createLengthQuantity(0),
          z: createLengthQuantity(0),
        },
      },
    }
    expect(
      success(model(before, "org.vibeshape.feature.update", { feature: circular })).snapshot.parts,
    ).toEqual(before.parts)
  })

  it("retains downstream copy identities when a captured seed copy is dormant or its producer is suppressed", () => {
    const first = success(insert(fixture().snapshot)).snapshot
    const second = {
      ...pattern(2),
      id: id(6),
      dependencies: [id(3)],
      parameters: { ...pattern(2).parameters, targetBody: instance(2) },
    }
    const before = success(insert(first, second, [allocation(1, 200, 6)])).snapshot
    const shrunk = success(setCount(before, 2)).snapshot
    expect(shrunk.parts).toEqual(before.parts)
    const hidden = success(
      model(before, "org.vibeshape.feature.update", { feature: pattern(3, null, true) }),
    ).snapshot
    expect(hidden.parts.map((part) => part.id)).toEqual<unknown>([
      id(100),
      id(101),
      id(102),
      id(200),
    ])
    expect(hidden.parts[2]?.bodyHistory).toEqual([instance(2)])
    expect(hidden.parts[3]?.bodyHistory).toEqual([instance(1, 6)])
    expect(
      success(model(hidden, "org.vibeshape.feature.update", { feature: pattern() })).snapshot.parts,
    ).toEqual(before.parts)
  })

  it("requires exact allocations for active growth and never captures arbitrary dormant roles", () => {
    const before = success(insert(fixture().snapshot, pattern(2), [allocation(1)])).snapshot
    expect(setCount(before, 3).ok).toBe(false)
    expect(setCount(before, 3, [allocation(2, 100)]).ok).toBe(false)
    expect(setCount(before, 2, [allocation(200, 200)]).ok).toBe(false)
    expect(setCount(before, 3, [allocation(2)]).ok).toBe(true)
  })

  it("rejects unregistered producer roles and indices in persisted bindings", () => {
    const before = success(insert(fixture().snapshot)).snapshot
    for (const outputRole of [
      "pattern.instance.256",
      "pattern.instance.02",
      "pattern.other",
      "split.positive",
    ]) {
      const part = { ...before.parts[2], bodyHistory: [body(3, outputRole)] }
      expect(
        documentSnapshotV4Schema.safeParse({
          ...before,
          schemaVersion: 4,
          assets: [],
          parts: [before.parts[0], before.parts[1], part],
        }).success,
      ).toBe(false)
    }
  })

  it("does not create a partial fan-out for a selected role without an owner", () => {
    const before = fixture().snapshot
    const feature = {
      ...pattern(),
      parameters: { ...pattern().parameters, targetBody: body(2, "body.absent") },
    }
    expect(insert(before, feature).ok).toBe(false)
    expect(success(insert(before, feature, [])).snapshot.parts).toEqual(before.parts)
  })

  it("replays captured count changes and restores the exact copy identities through undo and redo", () => {
    const base = fixture()
    const added = success(insert(base.snapshot))
    const shrunk = success(setCount(added.snapshot, 2))
    const undo = restore(shrunk.snapshot, added.snapshot, "undo")
    const redo = restore(undo.snapshot, shrunk.snapshot, "redo")
    expect(undo.snapshot.parts).toEqual(added.snapshot.parts)
    expect(redo.snapshot.parts).toEqual(shrunk.snapshot.parts)
    expect(
      success(
        replayDocumentAuthorityEvents(null, [
          ...base.events,
          added.event,
          shrunk.event,
          undo.event,
          redo.event,
        ]),
      ).snapshot,
    ).toEqual(redo.snapshot)
  })
})

describe("variable-aware Pattern allocation capture", () => {
  it("uses resolved count instead of the authored fallback value and captures growth in its variable-update event", () => {
    const before = variableFixture()
    expect(before.snapshot.parts).toHaveLength(3)
    expect(variableCount(before.snapshot, "5").ok).toBe(false)
    const projected = success(
      applyVersionedDocumentCommand(projectDocumentSnapshotV2ToV1(before.snapshot), {
        ...envelope(before.snapshot.revision),
        schemaVersion: 1,
        kind: "org.vibeshape.variable.set-expression",
        payload: { variableId: id(700), expression: "5" },
      }),
    ).snapshot
    expect(requiredPartAllocations(projected, before.snapshot.parts)).toEqual([
      { body: instance(3), origin: "independent" },
      { body: instance(4), origin: "independent" },
    ])
    const grown = success(variableCount(before.snapshot, "5", [allocation(3), allocation(4)]))
    expect(grown.snapshot.parts.map((part) => part.id)).toEqual<unknown>([
      id(100),
      id(101),
      id(102),
      id(103),
      id(104),
    ])
    expect(success(reduceDocumentV2Event(before.snapshot, grown.event)).snapshot).toEqual(
      grown.snapshot,
    )
    expect(
      success(replayDocumentAuthorityEvents(null, [...before.events, grown.event])).snapshot,
    ).toEqual(grown.snapshot)
    const v3 = documentSnapshotV4Schema.parse({
      ...grown.snapshot,
      schemaVersion: 4,
      surfaceTextures: [],
      assets: [],
    })
    expect(projectDocumentSnapshotV4ToV2(v3).variables).toEqual<unknown>(grown.snapshot.variables)
  })

  it("keeps dormant captured copies on variable shrink and reuses them on variable restore", () => {
    const before = variableFixture().snapshot
    const grown = success(variableCount(before, "5", [allocation(3), allocation(4)])).snapshot
    const shrunk = success(variableCount(grown, "2")).snapshot
    expect(shrunk.parts).toEqual(grown.parts)
    expect(success(variableCount(shrunk, "5")).snapshot.parts).toEqual(grown.parts)
  })

  it.each(["1", "257", "2.5", "4 mm", "-3"])(
    "rejects resolved count %s atomically without deleting captured metadata",
    (expression) => {
      const before = variableFixture().snapshot
      expect(variableCount(before, expression).ok).toBe(false)
      expect(before.parts.map((part) => part.id)).toEqual<unknown>([id(100), id(101), id(102)])
      expect(before.variables[0]?.expression).toBe("3")
    },
  )

  it("rejects an unavailable count variable before allocating any independent roots", () => {
    const before = fixture().snapshot
    expect(insert(before, pattern(2, "#missing"), [allocation(1)]).ok).toBe(false)
    expect(before.parts).toHaveLength(1)
  })

  it("rejects tampered captured count growth and output roles during replay", () => {
    const before = variableFixture().snapshot
    const grown = success(variableCount(before, "4", [allocation(3)]))
    if (grown.event.type !== "org.vibeshape.document.model-changed")
      throw new Error("Pattern count updates must use model events.")
    if (grown.event.modelEvent.type !== "org.vibeshape.variable.expression-changed")
      throw new Error("Count variable growth must retain its ordinary variable event.")
    const effects = grown.event.partEffects.map((effect) =>
      effect.kind === "create"
        ? { ...effect, part: { ...effect.part, bodyHistory: [instance(200)] } }
        : effect,
    )
    expect(reduceDocumentV2Event(before, { ...grown.event, partEffects: effects }).ok).toBe(false)
    expect(reduceDocumentV2Event(before, { ...grown.event, partEffects: [] }).ok).toBe(false)
    expect(
      reduceDocumentV2Event(before, {
        ...grown.event,
        modelEvent: { ...grown.event.modelEvent, expression: "5" },
      }).ok,
    ).toBe(false)
  })

  it("keeps the maximum active role set bounded without allocating unused capacity", () => {
    const before = fixture().snapshot
    const allocations = Array.from({ length: 255 }, (_, index) => allocation(index + 1))
    const added = success(insert(before, pattern(256), allocations)).snapshot
    expect(added.parts).toHaveLength(256)
    expect(added.parts.at(-1)?.bodyHistory).toEqual([instance(255)])
    expect(requiredPartAllocations(projectDocumentSnapshotV2ToV1(added), added.parts)).toEqual([])
    expect(success(setCount(added, 2)).snapshot.parts).toEqual(added.parts)
  })
})

describe("exact-body modifier Part bindings", () => {
  it.each([false, true])(
    "retains sibling Part identity and replays exact Subtract keepTools=%s",
    (keepTools) => {
      const before = success(insert(fixture().snapshot)).snapshot
      const feature = featureRecordSchema.parse({
        schemaVersion: 0,
        id: id(8),
        type: booleanFeatureTypeV2.type,
        dependencies: [id(3)],
        references: [],
        suppressed: false,
        parameters: {
          operation: "subtract",
          targetBody: instance(0),
          toolBody: instance(1),
          keepTools,
        },
      })
      const added = success(
        model(
          before,
          "org.vibeshape.history.insert-feature",
          {
            feature,
            historyAfter: before.history.at(-1),
          },
          [],
        ),
      )
      expect(added.snapshot.parts[0]?.bodyHistory.at(-1)).toEqual(body(8))
      expect(added.snapshot.parts[1]?.consumedBy).toBe<unknown>(keepTools ? null : id(8))
      expect(added.snapshot.parts[2]).toEqual(before.parts[2])
      expect(success(reduceDocumentV2Event(before, added.event)).snapshot).toEqual(added.snapshot)
      const suppressed = success(
        model(added.snapshot, "org.vibeshape.feature.set-suppressed", {
          featureId: feature.id,
          suppressed: true,
        }),
      ).snapshot
      expect(suppressed.parts).toEqual(before.parts)
    },
  )
  it.each(["add", "remove", "intersect"] as const)(
    "continues only the selected Revolve %s Part",
    (operation) => {
      const root = success(insert(fixture().snapshot)).snapshot
      const sketch = createEmptySketch({
        id: sketchIdSchema.parse(id(9)),
        label: "Profile",
        plane: "xy",
      })
      const before = success(
        model(root, "org.vibeshape.history.insert-sketch", {
          sketch,
          historyAfter: root.history.at(-1),
        }),
      ).snapshot
      const profiles = createSketchProfileSet([
        sketchProfileSelectorSchema.parse({
          schemaVersion: 0,
          sketchId: id(9),
          outerBoundaryEntityIds: [id(10)],
          holeBoundaryEntityIds: [],
        }),
      ])
      const feature = featureRecordSchema.parse({
        schemaVersion: 0,
        id: id(8),
        type: revolveFeatureTypeV7.type,
        dependencies: [id(3)],
        references: [],
        suppressed: false,
        parameters: {
          operation,
          targetBody: instance(1),
          profiles,
          axis: { kind: "origin-axis", axis: "x" },
          angle: createAngleQuantity(360, "deg"),
        },
      })
      const added = success(
        model(
          before,
          "org.vibeshape.history.insert-feature",
          {
            feature,
            historyAfter: before.history.at(-1),
          },
          [],
        ),
      )
      expect(added.snapshot.parts[1]?.bodyHistory.at(-1)).toEqual(body(8))
      expect(added.snapshot.parts[0]).toEqual(before.parts[0])
      expect(added.snapshot.parts[2]).toEqual(before.parts[2])
      expect(success(reduceDocumentV2Event(before, added.event)).snapshot).toEqual(added.snapshot)
    },
  )
})
