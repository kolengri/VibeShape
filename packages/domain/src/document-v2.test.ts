import { describe, expect, it } from "vitest"
import { canonicalJson } from "./canonical-json"
import { applyDocumentCommand } from "./commands"
import { documentSnapshotV1Schema } from "./document"
import { migrateDocumentSnapshot } from "./document-migration"
import {
  type DocumentSnapshotV2,
  documentSnapshotV2Schema,
  projectDocumentSnapshotV2ToV1,
} from "./document-v2"
import type { DocumentV2Event } from "./document-v2-command-schemas"
import {
  applyDocumentV2Command,
  applyDocumentV2ModelEvent,
  reduceDocumentV2Event,
} from "./document-v2-commands"
import { copyCompleteDocumentAuthorityHistory } from "./document-v2-copy"
import { applyDocumentUpgradeV2Command } from "./document-v2-migration"
import { replayDocumentAuthorityEvents } from "./document-v2-replay"
import { featureRecordV1Schema } from "./feature-graph"
import { sketchIdSchema } from "./identifiers"
import { terminalBodyOutputs } from "./model-bodies"
import { requiredPartAllocations } from "./part-bindings"
import {
  booleanFeatureType,
  boxFeatureType,
  extrusionFeatureTypeV5,
  filletFeatureType,
} from "./part-design"
import { partBodyReference } from "./parts"
import { createEmptySketch } from "./sketch-edit"
import { createLengthQuantity } from "./units"
import { applyVersionedDocumentCommand } from "./versioned-document-commands"

const id = (suffix: number) => `0195b5ac-b220-7a2c-8c33-${suffix.toString(16).padStart(12, "0")}`
const documentId = id(1)
const issuedAt = "2026-10-03T00:00:00Z"
const actor = { type: "user", userId: null } as const
const mcpActor = { type: "mcp", clientId: "org.example.agent", sessionId: id(800) } as const

function requireSuccess<T extends { ok: boolean }>(result: T): Extract<T, { ok: true }> {
  if (!result.ok) throw new Error(JSON.stringify(result))
  return result as Extract<T, { ok: true }>
}
function envelope(baseRevision: number, commandId = id(baseRevision + 10)) {
  return { schemaVersion: 2, commandId, documentId, baseRevision, issuedAt, actor }
}
function legacyCreate() {
  return {
    ...envelope(0),
    schemaVersion: 1,
    kind: "org.vibeshape.document.create",
    payload: { name: "Parts" },
  }
}
function emptyV1() {
  return requireSuccess(applyVersionedDocumentCommand(null, legacyCreate()))
}
function upgrade(snapshot = emptyV1().snapshot, allocations: unknown[] = []) {
  return requireSuccess(
    applyDocumentUpgradeV2Command(snapshot, {
      ...envelope(snapshot.revision),
      kind: "org.vibeshape.document.upgrade-v2",
      payload: { partAllocations: allocations },
    }),
  )
}
function box(featureId: string, label = "Box") {
  return {
    schemaVersion: 0,
    id: featureId,
    type: boxFeatureType.type,
    label,
    parameters: {
      width: createLengthQuantity(20),
      depth: createLengthQuantity(30),
      height: createLengthQuantity(40),
      centered: false,
    },
    dependencies: [],
    references: [],
    suppressed: false,
  }
}
function allocation(
  featureId: string,
  partId = id(100),
  name = "Housing",
  origin: "independent" | "fork" = "independent",
) {
  return { id: partId, name, origin, body: { schemaVersion: 0, featureId, outputRole: "result" } }
}
function model(
  snapshot: DocumentSnapshotV2,
  kind: string,
  payload: unknown,
  allocations: unknown[] = [],
  commandActor: unknown = actor,
) {
  const command = {
    ...envelope(snapshot.revision),
    schemaVersion: 1,
    kind,
    payload,
    actor: commandActor,
  }
  return applyDocumentV2Command(snapshot, {
    ...envelope(snapshot.revision),
    actor: commandActor,
    kind: "org.vibeshape.document.model-command",
    payload: { command, partAllocations: allocations },
  })
}
function addBox(snapshot = upgrade().snapshot, featureId = id(200), partId = id(100)) {
  return requireSuccess(
    model(
      snapshot,
      "org.vibeshape.history.insert-feature",
      { feature: box(featureId), historyAfter: snapshot.history.at(-1) ?? null },
      [allocation(featureId, partId)],
    ),
  )
}
function metadata(snapshot: DocumentSnapshotV2, change: unknown) {
  return applyDocumentV2Command(snapshot, {
    ...envelope(snapshot.revision),
    kind: "org.vibeshape.document.metadata-command",
    payload: change,
  })
}

function fillet(snapshot: DocumentSnapshotV2) {
  return requireSuccess(
    model(snapshot, "org.vibeshape.history.insert-feature", {
      historyAfter: snapshot.history.at(-1),
      feature: {
        schemaVersion: 0,
        id: id(201),
        type: filletFeatureType.type,
        parameters: { radius: createLengthQuantity(2) },
        dependencies: [id(200)],
        references: [],
        suppressed: false,
      },
    }),
  )
}

describe("V2 authored part authority", () => {
  it("upgrades once at N+1 without rewriting the V1 snapshot or event prefix", () => {
    const v1 = emptyV1()
    const bytes = canonicalJson(v1)
    const upgraded = upgrade(v1.snapshot)
    expect(upgraded.snapshot.schemaVersion).toBe(2)
    expect(upgraded.snapshot.revision).toBe(2)
    expect(upgraded.snapshot.parts).toEqual([])
    expect(canonicalJson(v1)).toBe(bytes)
    expect(documentSnapshotV1Schema.safeParse(upgraded.snapshot).success).toBe(false)
    expect(
      applyDocumentUpgradeV2Command(upgraded.snapshot, {
        ...envelope(2),
        kind: "org.vibeshape.document.upgrade-v2",
        payload: { partAllocations: [] },
      }).ok,
    ).toBe(false)
    expect(
      requireSuccess(replayDocumentAuthorityEvents(null, [v1.event, upgraded.event])).snapshot,
    ).toEqual(upgraded.snapshot)
  })

  it("captures automatic creation atomically with one model revision and preserves MCP actor", () => {
    const base = upgrade().snapshot
    const added = requireSuccess(
      model(
        base,
        "org.vibeshape.history.insert-feature",
        { feature: box(id(200)), historyAfter: null },
        [allocation(id(200))],
        mcpActor,
      ),
    )
    expect(added.snapshot.revision).toBe(base.revision + 1)
    expect(added.snapshot.parts).toEqual([
      {
        schemaVersion: 0,
        id: id(100),
        name: "Housing",
        visible: true,
        origin: "independent",
        bodyHistory: [{ schemaVersion: 0, featureId: id(200), outputRole: "result" }],
        consumedBy: null,
      },
    ])
    expect(added.event.actor).toEqual(mcpActor)
    expect(requireSuccess(reduceDocumentV2Event(base, added.event)).snapshot).toEqual(
      added.snapshot,
    )
    expect(base.parts).toEqual([])
  })

  it("lifts a translated model event with the same actor, transaction and single revision", () => {
    const base = upgrade().snapshot
    const legacy = requireSuccess(
      applyVersionedDocumentCommand(projectDocumentSnapshotV2ToV1(base), {
        ...envelope(base.revision),
        schemaVersion: 1,
        actor: mcpActor,
        kind: "org.vibeshape.history.insert-feature",
        payload: { feature: box(id(200)), historyAfter: null },
      }),
    )
    const lifted = requireSuccess(
      applyDocumentV2ModelEvent(base, legacy.event, [allocation(id(200))]),
    )
    expect(lifted.event.actor).toEqual(mcpActor)
    expect(lifted.snapshot.revision).toBe(base.revision + 1)
    expect(lifted.snapshot.parts[0]?.id).toBe(id(100))
    expect(lifted.event.transactionId).toBe(legacy.event.transactionId)
    expect(applyDocumentV2ModelEvent(base, legacy.event, []).ok).toBe(false)
  })

  it("rejects missing, duplicated and unused allocations instead of generating identity in replay", () => {
    const base = upgrade().snapshot
    const payload = { feature: box(id(200)), historyAfter: null }
    expect(model(base, "org.vibeshape.history.insert-feature", payload).ok).toBe(false)
    expect(
      model(base, "org.vibeshape.history.insert-feature", payload, [
        allocation(id(200)),
        allocation(id(200)),
      ]).ok,
    ).toBe(false)
    expect(
      model(base, "org.vibeshape.history.insert-feature", payload, [
        allocation(id(200)),
        allocation(id(201), id(101)),
      ]).ok,
    ).toBe(false)
  })

  it("advances and rewinds modifier bindings while preserving authored identity and visibility", () => {
    const added = addBox()
    const hidden = requireSuccess(
      metadata(added.snapshot, { kind: "part.set-visibility", partId: id(100), visible: false }),
    )
    const modified = fillet(hidden.snapshot)
    expect(modified.snapshot.parts[0]?.bodyHistory.map((body) => body.featureId)).toEqual([
      id(200),
      id(201),
    ])
    const removed = requireSuccess(
      model(modified.snapshot, "org.vibeshape.feature.remove", { featureId: id(201) }),
    )
    expect(removed.snapshot.parts).toEqual(hidden.snapshot.parts)
    expect(removed.snapshot.revision).toBe(modified.snapshot.revision + 1)
  })

  it("keeps human feature IDs and part names when an AI changes dimensions", () => {
    const base = addBox().snapshot
    const updated = requireSuccess(
      model(
        base,
        "org.vibeshape.feature.update",
        {
          feature: {
            ...box(id(200)),
            parameters: { ...box(id(200)).parameters, width: createLengthQuantity(22) },
          },
        },
        [],
        mcpActor,
      ),
    )
    expect(updated.snapshot.features[0]?.id).toBe(id(200))
    expect(updated.snapshot.parts).toEqual(base.parts)
    expect(updated.event.actor).toEqual(mcpActor)
  })

  it("records consumed tool parts and restores their identity when subtract is removed", () => {
    const first = addBox().snapshot
    const both = addBox(first, id(202), id(102)).snapshot
    const cut = requireSuccess(
      model(both, "org.vibeshape.history.insert-feature", {
        historyAfter: both.history.at(-1),
        feature: {
          schemaVersion: 0,
          id: id(203),
          type: booleanFeatureType.type,
          parameters: { operation: "subtract" },
          dependencies: [id(200), id(202)],
          references: [],
          suppressed: false,
        },
      }),
    )
    expect(cut.snapshot.parts.find((part) => part.id === id(102))?.consumedBy).toBe(id(203))
    const removed = requireSuccess(
      model(cut.snapshot, "org.vibeshape.feature.remove", { featureId: id(203) }),
    )
    expect(removed.snapshot.parts).toEqual(both.parts)
  })

  it("updates and replays tool retention without changing authored part identities", () => {
    const both = addBox(addBox().snapshot, id(202), id(102)).snapshot
    const feature = {
      schemaVersion: 0,
      id: id(203),
      type: booleanFeatureType.type,
      parameters: { operation: "subtract", keepTools: true },
      dependencies: [id(200), id(202)],
      references: [],
      suppressed: false,
    }
    const kept = requireSuccess(
      model(both, "org.vibeshape.history.insert-feature", {
        historyAfter: both.history.at(-1),
        feature,
      }),
    )
    expect(kept.snapshot.parts.map(({ id: partId }) => partId)).toEqual(
      both.parts.map(({ id: partId }) => partId),
    )
    expect(kept.snapshot.parts.find((part) => part.id === id(102))).toEqual(
      both.parts.find((part) => part.id === id(102)),
    )
    const target = kept.snapshot.parts[0]
    if (!target) throw new Error("Expected surviving target part")
    expect(partBodyReference(target)).toMatchObject({ featureId: id(203) })
    expect(requireSuccess(reduceDocumentV2Event(both, kept.event)).snapshot).toEqual(kept.snapshot)
    const consumed = requireSuccess(
      model(kept.snapshot, "org.vibeshape.feature.update", {
        feature: { ...feature, parameters: { operation: "subtract" } },
      }),
    )
    expect(consumed.snapshot.parts.find((part) => part.id === id(102))?.consumedBy).toBe(id(203))
    const restored = requireSuccess(
      model(consumed.snapshot, "org.vibeshape.feature.update", { feature }),
    )
    expect(restored.snapshot.parts).toEqual(kept.snapshot.parts)
    expect(
      requireSuccess(reduceDocumentV2Event(consumed.snapshot, restored.event)).snapshot,
    ).toEqual(restored.snapshot)
  })

  it("rejects forged effects, nested provenance, revision gaps, and naked legacy events", () => {
    const base = upgrade().snapshot
    const added = addBox(base)
    expect(reduceDocumentV2Event(base, { ...added.event, partEffects: [] }).ok).toBe(false)
    if (added.event.type !== "org.vibeshape.document.model-changed")
      throw new Error("Expected model event")
    expect(
      reduceDocumentV2Event(base, {
        ...added.event,
        modelEvent: { ...added.event.modelEvent, actor: mcpActor },
      }).ok,
    ).toBe(false)
    expect(reduceDocumentV2Event(base, { ...added.event, revision: 99 }).ok).toBe(false)
    expect(replayDocumentAuthorityEvents(base, [added.event.modelEvent]).ok).toBe(false)
    expect(replayDocumentAuthorityEvents(base, [{ ...added.event, schemaVersion: 99 }]).ok).toBe(
      false,
    )
  })

  it("rejects a snapshot that redirects a part lineage to an unrelated producer", () => {
    const both = addBox(addBox().snapshot, id(202), id(102)).snapshot
    const original = both.parts[0]
    expect(
      documentSnapshotV2Schema.safeParse({
        ...both,
        parts: [
          {
            ...original,
            bodyHistory: [
              ...(original?.bodyHistory ?? []),
              { schemaVersion: 0, featureId: id(202), outputRole: "result" },
            ],
          },
        ],
      }).success,
    ).toBe(false)
    expect(documentSnapshotV2Schema.safeParse({ ...both, unexpected: true }).success).toBe(false)
  })
})

describe("V2 ownership boundaries", () => {
  it("rejects snapshots with omitted roots or stale modifier bindings", () => {
    const added = addBox().snapshot
    expect(documentSnapshotV2Schema.safeParse({ ...added, parts: [] }).success).toBe(false)
    const modified = fillet(added).snapshot
    expect(documentSnapshotV2Schema.safeParse({ ...modified, parts: added.parts }).success).toBe(
      false,
    )
    const feature = modified.features[0]
    expect(
      documentSnapshotV2Schema.safeParse({
        ...modified,
        features: [
          { ...feature, semanticInputs: [{ kind: "feature", id: id(999) }] },
          ...modified.features.slice(1),
        ],
      }).success,
    ).toBe(false)
  })

  it("does not infer ownership for lookalike or unsupported producer versions", () => {
    const feature = featureRecordV1Schema.parse({
      ...box(id(200)),
      schemaVersion: 1,
      semanticInputs: [],
      type: { ...boxFeatureType.type, moduleVersion: "99.0.0" },
    })
    const source = documentSnapshotV1Schema.parse({
      ...emptyV1().snapshot,
      features: [feature],
      history: [{ kind: "feature", id: feature.id }],
    })
    expect(requiredPartAllocations(source)).toEqual([])
    expect(upgrade(source).snapshot.parts).toEqual([])
  })

  it("classifies V5 single-profile roots but leaves legacy aggregate intent unmanaged", () => {
    const sketch = createEmptySketch({
      id: sketchIdSchema.parse(id(400)),
      label: "Profiles",
      plane: "xy",
    })
    const profile = {
      schemaVersion: 0,
      sketchId: sketch.id,
      outerBoundaryEntityIds: [id(401)],
      holeBoundaryEntityIds: [],
    }
    const parameters = {
      profiles: { schemaVersion: 0, profiles: [profile] },
      distance: createLengthQuantity(10),
      symmetric: false,
      reversed: false,
      secondDistance: null,
      operation: "new",
    }
    const feature = featureRecordV1Schema.parse({
      ...box(id(200)),
      schemaVersion: 1,
      type: extrusionFeatureTypeV5.type,
      parameters,
      semanticInputs: [{ kind: "sketch", id: sketch.id }],
    })
    const source = documentSnapshotV1Schema.parse({
      ...emptyV1().snapshot,
      sketches: [sketch],
      features: [feature],
      history: [
        { kind: "sketch", id: sketch.id },
        { kind: "feature", id: feature.id },
      ],
    })
    expect(upgrade(source, [allocation(id(200))]).snapshot.parts).toHaveLength(1)
    const aggregate = documentSnapshotV1Schema.parse({
      ...source,
      features: [
        {
          ...feature,
          parameters: {
            ...parameters,
            profiles: {
              schemaVersion: 0,
              profiles: [profile, { ...profile, outerBoundaryEntityIds: [id(402)] }],
            },
          },
        },
      ],
    })
    expect(requiredPartAllocations(aggregate)).toEqual([])
    expect(upgrade(aggregate).snapshot.parts).toEqual([])
    expect(
      applyDocumentUpgradeV2Command(aggregate, {
        ...envelope(aggregate.revision),
        kind: "org.vibeshape.document.upgrade-v2",
        payload: { partAllocations: [allocation(id(200))] },
      }).ok,
    ).toBe(false)
  })

  it("preserves authored ownership while suppression leaves resolution to current geometry", () => {
    const added = addBox().snapshot
    const suppressed = requireSuccess(
      model(added, "org.vibeshape.feature.update", {
        feature: { ...box(id(200)), suppressed: true },
      }),
    )
    expect(suppressed.snapshot.parts).toEqual(added.parts)
    expect(suppressed.snapshot.features[0]?.suppressed).toBe(true)
  })

  it("retargets a modifier while preserving both root PartIds and metadata", () => {
    const both = addBox(addBox().snapshot, id(202), id(102)).snapshot
    const hidden = requireSuccess(
      metadata(both, { kind: "part.set-visibility", partId: id(100), visible: false }),
    ).snapshot
    const modified = fillet(hidden).snapshot
    const retargeted = requireSuccess(
      model(modified, "org.vibeshape.feature.update", {
        feature: {
          schemaVersion: 0,
          id: id(201),
          type: filletFeatureType.type,
          parameters: { radius: createLengthQuantity(2) },
          dependencies: [id(202)],
          references: [],
          suppressed: false,
        },
      }),
    ).snapshot
    expect(retargeted.parts[0]).toEqual(hidden.parts[0])
    expect(retargeted.parts[1]?.id).toBe(id(102))
    expect(retargeted.parts[1]?.bodyHistory.map((body) => body.featureId)).toEqual([
      id(202),
      id(201),
    ])
  })

  it("changes V5 New to Add atomically and captures a fresh identity when changed back", () => {
    const boxModel = addBox().snapshot
    const sketch = createEmptySketch({
      id: sketchIdSchema.parse(id(400)),
      label: "Profile",
      plane: "xy",
    })
    const withSketch = requireSuccess(
      model(boxModel, "org.vibeshape.history.insert-sketch", {
        sketch,
        historyAfter: boxModel.history.at(-1),
      }),
    ).snapshot
    const feature = {
      ...box(id(202)),
      type: extrusionFeatureTypeV5.type,
      parameters: {
        profiles: {
          schemaVersion: 0,
          profiles: [
            {
              schemaVersion: 0,
              sketchId: sketch.id,
              outerBoundaryEntityIds: [id(401)],
              holeBoundaryEntityIds: [],
            },
          ],
        },
        distance: createLengthQuantity(10),
        symmetric: false,
        reversed: false,
        secondDistance: null,
        operation: "new",
      },
    }
    const independent = requireSuccess(
      model(
        withSketch,
        "org.vibeshape.history.insert-feature",
        { feature, historyAfter: withSketch.history.at(-1) },
        [allocation(id(202), id(102))],
      ),
    )
    const added = requireSuccess(
      model(independent.snapshot, "org.vibeshape.feature.update", {
        feature: {
          ...feature,
          parameters: { ...feature.parameters, operation: "add" },
          dependencies: [id(200)],
        },
      }),
    )
    expect(added.snapshot.parts).toHaveLength(1)
    expect(added.snapshot.parts[0]?.id).toBe(id(100))
    expect(added.snapshot.parts[0]?.bodyHistory.map((body) => body.featureId)).toEqual([
      id(200),
      id(202),
    ])
    expect(model(added.snapshot, "org.vibeshape.feature.update", { feature }).ok).toBe(false)
    const restoredNew = requireSuccess(
      model(added.snapshot, "org.vibeshape.feature.update", { feature }, [
        allocation(id(202), id(103)),
      ]),
    )
    expect(restoredNew.snapshot.parts.map((part) => part.id)).toEqual([id(100), id(103)])
    expect(restoredNew.snapshot.parts[0]?.bodyHistory).toEqual(boxModel.parts[0]?.bodyHistory)
    expect(
      requireSuccess(
        reduceDocumentV2Event(
          added.snapshot,
          {
            ...envelope(added.snapshot.revision),
            type: "org.vibeshape.document.restored",
            transactionId: null,
            revision: added.snapshot.revision + 1,
            direction: "undo",
            targetRevision: independent.snapshot.revision,
          },
          independent.snapshot,
        ),
      ).snapshot.parts,
    ).toEqual(independent.snapshot.parts)
  })

  it("captures a historical-body fork and preserves its identity through upstream suppression", () => {
    const modified = fillet(addBox().snapshot).snapshot
    const branch = {
      schemaVersion: 0,
      id: id(202),
      type: filletFeatureType.type,
      parameters: { radius: createLengthQuantity(1) },
      dependencies: [id(200)],
      references: [],
      suppressed: false,
    }
    const payload = { feature: branch, historyAfter: modified.history.at(-1) }
    expect(model(modified, "org.vibeshape.history.insert-feature", payload).ok).toBe(false)
    const forked = requireSuccess(
      model(modified, "org.vibeshape.history.insert-feature", payload, [
        allocation(id(202), id(102), "Branch", "fork"),
      ]),
    )
    expect(forked.snapshot.parts[0]).toEqual(modified.parts[0])
    const oldModel = projectDocumentSnapshotV2ToV1(forked.snapshot)
    expect(requiredPartAllocations(oldModel)).toEqual([
      {
        body: { schemaVersion: 0, featureId: id(200), outputRole: "result" },
        origin: "independent",
      },
      { body: { schemaVersion: 0, featureId: id(202), outputRole: "result" }, origin: "fork" },
    ])
    expect(
      upgrade(oldModel, [allocation(id(200)), allocation(id(202), id(102), "Branch", "fork")])
        .snapshot.parts,
    ).toEqual(forked.snapshot.parts)
    expect(forked.snapshot.parts[1]).toMatchObject({
      id: id(102),
      origin: "fork",
      bodyHistory: [{ featureId: id(202), outputRole: "result" }],
    })
    const firstModifier = { ...branch, id: id(201), suppressed: true }
    const suppressed = requireSuccess(
      model(forked.snapshot, "org.vibeshape.feature.update", { feature: firstModifier }),
    )
    expect(suppressed.snapshot.parts[0]?.bodyHistory.map((body) => body.featureId)).toEqual([
      id(200),
    ])
    expect(suppressed.snapshot.parts[0]?.consumedBy).toBe(id(202))
    expect(suppressed.snapshot.parts[1]?.id).toBe(id(102))
    const unsuppressed = requireSuccess(
      model(suppressed.snapshot, "org.vibeshape.feature.update", {
        feature: { ...firstModifier, suppressed: false },
      }),
    )
    expect(unsuppressed.snapshot.parts.map((part) => part.id)).toEqual([id(100), id(102)])
    expect(unsuppressed.snapshot.parts[0]?.consumedBy).toBe(null)
    expect(unsuppressed.snapshot.parts[0]?.bodyHistory.map((body) => body.featureId)).toEqual([
      id(200),
      id(201),
    ])
    expect(
      requireSuccess(
        reduceDocumentV2Event(
          suppressed.snapshot,
          {
            ...envelope(suppressed.snapshot.revision),
            type: "org.vibeshape.document.restored",
            transactionId: null,
            revision: suppressed.snapshot.revision + 1,
            direction: "undo",
            targetRevision: forked.snapshot.revision,
          },
          forked.snapshot,
        ),
      ).snapshot.parts,
    ).toEqual(forked.snapshot.parts)
  })

  it("allows a modifier on an exposed upstream body and allocates its fork only when required", () => {
    const modified = fillet(addBox().snapshot).snapshot
    const feature = {
      schemaVersion: 0,
      id: id(201),
      type: filletFeatureType.type,
      parameters: { radius: createLengthQuantity(2) },
      dependencies: [id(200)],
      references: [],
      suppressed: true,
    }
    const suppressed = requireSuccess(
      model(modified, "org.vibeshape.feature.update", { feature }),
    ).snapshot
    expect(suppressed.parts[0]?.bodyHistory.map((body) => body.featureId)).toEqual([id(200)])
    const second = requireSuccess(
      model(suppressed, "org.vibeshape.history.insert-feature", {
        historyAfter: suppressed.history.at(-1),
        feature: { ...feature, id: id(202), suppressed: false },
      }),
    ).snapshot
    expect(second.parts).toHaveLength(1)
    expect(second.parts[0]?.bodyHistory.map((body) => body.featureId)).toEqual([id(200), id(202)])
    const unsuppressed = requireSuccess(
      model(
        second,
        "org.vibeshape.feature.update",
        { feature: { ...feature, suppressed: false } },
        [allocation(id(202), id(102), "Second branch", "fork")],
      ),
    ).snapshot
    expect(unsuppressed.parts.map((part) => part.id)).toEqual([id(100), id(102)])
    expect(unsuppressed.parts[0]?.bodyHistory.map((body) => body.featureId)).toEqual([
      id(200),
      id(201),
    ])
  })
})

function expectTerminalParts(
  snapshot: DocumentSnapshotV2,
  available: readonly string[],
  expected: readonly string[],
) {
  const outputs = new Map(
    available.map((featureId) => [featureId, [{ featureId, outputRole: "result" }]]),
  )
  const features = snapshot.features.map(({ semanticInputs: _inputs, ...feature }) => ({
    ...feature,
    schemaVersion: 0 as const,
  }))
  const terminal = terminalBodyOutputs(features, outputs)
  expect(terminal?.map((body) => body.featureId).sort()).toEqual([...expected].sort())
  const partBodies = snapshot.parts
    .filter((part) => part.consumedBy === null)
    .map(partBodyReference)
    .filter((body) =>
      outputs.get(body.featureId)?.some((output) => output.outputRole === body.outputRole),
    )
  expect(partBodies.map((body) => body.featureId).sort()).toEqual([...expected].sort())
}

it("keeps Boolean fork parts aligned with terminal outputs across source suppression", () => {
  const boxes = addBox(addBox().snapshot, id(204), id(104)).snapshot
  const modified = fillet(boxes).snapshot
  const cutter = {
    schemaVersion: 0,
    id: id(202),
    type: booleanFeatureType.type,
    parameters: { operation: "subtract" },
    dependencies: [id(200), id(204)],
    references: [],
    suppressed: false,
  }
  const forked = requireSuccess(
    model(
      modified,
      "org.vibeshape.history.insert-feature",
      { historyAfter: modified.history.at(-1), feature: cutter },
      [allocation(id(202), id(102), "Cut branch", "fork")],
    ),
  ).snapshot
  expectTerminalParts(forked, [id(200), id(204), id(201), id(202)], [id(201), id(202)])
  expect(forked.parts.find((part) => part.id === id(104))?.consumedBy).toBe(id(202))
  const firstModifier = {
    schemaVersion: 0,
    id: id(201),
    type: filletFeatureType.type,
    parameters: { radius: createLengthQuantity(2) },
    dependencies: [id(200)],
    references: [],
    suppressed: true,
  }
  const modifierSuppressed = requireSuccess(
    model(forked, "org.vibeshape.feature.update", { feature: firstModifier }),
  ).snapshot
  expectTerminalParts(modifierSuppressed, [id(200), id(204), id(202)], [id(202)])
  const rootSuppressed = requireSuccess(
    model(modifierSuppressed, "org.vibeshape.feature.update", {
      feature: { ...box(id(200)), suppressed: true },
    }),
  ).snapshot
  expectTerminalParts(rootSuppressed, [id(204)], [id(204)])
  expect(rootSuppressed.parts.find((part) => part.id === id(104))?.consumedBy).toBe(null)
  expect(rootSuppressed.parts.map((part) => part.id)).toEqual(forked.parts.map((part) => part.id))
  const rootRestored = requireSuccess(
    model(rootSuppressed, "org.vibeshape.feature.update", { feature: box(id(200)) }),
  ).snapshot
  expectTerminalParts(rootRestored, [id(200), id(204), id(202)], [id(202)])
  const restored = requireSuccess(
    model(rootRestored, "org.vibeshape.feature.update", {
      feature: { ...firstModifier, suppressed: false },
    }),
  ).snapshot
  expectTerminalParts(restored, [id(200), id(204), id(201), id(202)], [id(201), id(202)])
  expect(restored.parts).toEqual(forked.parts)
})

describe("V2 organizational folders", () => {
  it("extends folder membership atomically when inserting after an interior or final member", () => {
    const base = addBox(addBox().snapshot, id(202), id(102)).snapshot
    const grouped = requireSuccess(
      metadata(base, {
        kind: "folder.create",
        folder: { schemaVersion: 0, id: id(300), name: "Bodies", items: base.history },
      }),
    ).snapshot
    for (const historyAfter of grouped.history) {
      const inserted = requireSuccess(
        model(grouped, "org.vibeshape.history.insert-sketch", {
          sketch: createEmptySketch({
            id: sketchIdSchema.parse(id(303)),
            label: "Inserted",
            plane: "xy",
          }),
          historyAfter,
        }),
      )
      expect(inserted.snapshot.folders[0]?.items).toEqual(inserted.snapshot.history)
      expect(inserted.snapshot.revision).toBe(grouped.revision + 1)
      expect(
        requireSuccess(replayDocumentAuthorityEvents(grouped, [inserted.event])).snapshot,
      ).toEqual(inserted.snapshot)
    }
  })

  it("creates, renames and ungroups a contiguous folder without changing model History", () => {
    const base = addBox(addBox().snapshot, id(202), id(102)).snapshot
    const grouped = requireSuccess(
      metadata(base, {
        kind: "folder.create",
        folder: { schemaVersion: 0, id: id(300), name: "Bodies", items: base.history },
      }),
    )
    const renamed = requireSuccess(
      metadata(grouped.snapshot, { kind: "folder.rename", folderId: id(300), name: "Enclosure" }),
    )
    expect(renamed.snapshot.folders[0]?.name).toBe("Enclosure")
    const removed = requireSuccess(
      metadata(renamed.snapshot, { kind: "folder.remove", folderId: id(300) }),
    )
    expect(removed.snapshot.history).toEqual(base.history)
    expect(removed.snapshot.features).toEqual(base.features)
    expect(removed.snapshot.parts).toEqual(base.parts)
  })

  it("rejects overlapping, noncontiguous, duplicate and absent members", () => {
    const base = addBox(
      addBox(addBox().snapshot, id(202), id(102)).snapshot,
      id(204),
      id(104),
    ).snapshot
    const create = (items: unknown[], snapshot = base, folderId = id(300)) =>
      metadata(snapshot, {
        kind: "folder.create",
        folder: { schemaVersion: 0, id: folderId, name: "Folder", items },
      })
    expect(create([base.history[0], base.history[2]]).ok).toBe(false)
    expect(create([base.history[0], base.history[0]]).ok).toBe(false)
    expect(create([{ kind: "feature", id: id(999) }]).ok).toBe(false)
    const grouped = requireSuccess(create([base.history[0], base.history[1]]))
    expect(create([base.history[1], base.history[2]], grouped.snapshot, id(301)).ok).toBe(false)
  })

  it("prunes removed members and empty folders atomically with model deletion", () => {
    const base = addBox().snapshot
    const grouped = requireSuccess(
      metadata(base, {
        kind: "folder.create",
        folder: { schemaVersion: 0, id: id(300), name: "Body", items: base.history },
      }),
    )
    const removed = requireSuccess(
      model(grouped.snapshot, "org.vibeshape.feature.remove", { featureId: id(200) }),
    )
    expect(removed.snapshot.folders).toEqual([])
    expect(removed.snapshot.parts).toEqual([])
    expect(removed.snapshot.revision).toBe(grouped.snapshot.revision + 1)
  })

  it("rejects no-ops, stale metadata edits and order changes that split a folder", () => {
    const base = addBox(
      addBox(addBox().snapshot, id(202), id(102)).snapshot,
      id(204),
      id(104),
    ).snapshot
    expect(metadata(base, { kind: "part.rename", partId: id(100), name: "Housing" }).ok).toBe(false)
    const grouped = requireSuccess(
      metadata(base, {
        kind: "folder.create",
        folder: {
          schemaVersion: 0,
          id: id(300),
          name: "First two",
          items: base.history.slice(0, 2),
        },
      }),
    )
    expect(reduceDocumentV2Event(grouped.snapshot, grouped.event).ok).toBe(false)
    expect(
      model(grouped.snapshot, "org.vibeshape.history.move-item", {
        item: base.history[2],
        historyAfter: base.history[0],
      }).ok,
    ).toBe(false)
  })
})

describe("V2 replay, restoration and portable copy", () => {
  it("restores model and metadata together and replays the compensating event", () => {
    const created = emptyV1()
    const upgraded = upgrade(created.snapshot)
    const added = addBox(upgraded.snapshot)
    const renamed = requireSuccess(
      metadata(added.snapshot, { kind: "part.rename", partId: id(100), name: "Renamed" }),
    )
    const restoredEvent = {
      ...envelope(renamed.snapshot.revision),
      type: "org.vibeshape.document.restored",
      transactionId: null,
      revision: renamed.snapshot.revision + 1,
      direction: "undo",
      targetRevision: added.snapshot.revision,
    }
    const restored = requireSuccess(
      reduceDocumentV2Event(renamed.snapshot, restoredEvent, added.snapshot),
    )
    expect(restored.snapshot.parts).toEqual(added.snapshot.parts)
    expect(
      requireSuccess(
        replayDocumentAuthorityEvents(null, [
          created.event,
          upgraded.event,
          added.event,
          renamed.event,
          restoredEvent,
        ]),
      ).snapshot,
    ).toEqual(restored.snapshot)
    expect(
      reduceDocumentV2Event(
        renamed.snapshot,
        { ...restoredEvent, targetRevision: created.snapshot.revision },
        created.snapshot,
      ).ok,
    ).toBe(false)
  })

  it("copies complete mixed journals with fresh nested envelopes and preserved local IDs and actors", () => {
    const created = emptyV1()
    const upgraded = upgrade(created.snapshot)
    const added = addBox(upgraded.snapshot)
    const events = [created.event, upgraded.event, added.event].map((event) => ({
      ...event,
      transactionId: id(700),
      ...(event.type === "org.vibeshape.document.model-changed"
        ? { modelEvent: { ...event.modelEvent, transactionId: id(700) } }
        : {}),
    }))
    const copy = requireSuccess(
      copyCompleteDocumentAuthorityHistory({
        sourceLegacyEvents: [],
        sourceSeed: null,
        sourceSnapshot: added.snapshot,
        sourceEvents: events,
        documentId: id(2),
        commandIds: [id(500), id(501), id(502), id(503)],
        transactionIds: [{ source: id(700), target: id(701) }],
        name: "Parts copy",
        issuedAt,
        actor: mcpActor,
      }),
    )
    expect(copy.snapshot.id).toBe(id(2))
    expect(copy.snapshot.parts).toEqual(added.snapshot.parts)
    expect(copy.versionedEvents[2]?.actor).toEqual(actor)
    expect(copy.versionedEvents.slice(0, 3).map((event) => event.transactionId)).toEqual([
      id(701),
      id(701),
      id(701),
    ])
    expect(copy.versionedEvents.at(-1)?.actor).toEqual(mcpActor)
    expect(
      requireSuccess(replayDocumentAuthorityEvents(copy.seed, copy.versionedEvents)).snapshot,
    ).toEqual(copy.snapshot)
  })

  it("retains a complete legacy promotion prefix and refuses a seed-only copy", () => {
    const legacy = requireSuccess(applyDocumentCommand(null, legacyCreate()))
    const migrated = requireSuccess(migrateDocumentSnapshot(legacy.snapshot, [legacy.event]))
    const upgraded = upgrade(migrated.snapshot)
    const input = {
      sourceLegacyEvents: [legacy.event],
      sourceSeed: migrated.snapshot,
      sourceSnapshot: upgraded.snapshot,
      sourceEvents: [upgraded.event],
      documentId: id(2),
      commandIds: [id(500), id(501), id(502)],
      transactionIds: [],
      name: "Legacy copy",
      issuedAt,
      actor,
    }
    const copied = requireSuccess(copyCompleteDocumentAuthorityHistory(input))
    expect(copied.legacyEvents).toHaveLength(1)
    expect(copied.seed?.schemaVersion).toBe(1)
    expect(
      copyCompleteDocumentAuthorityHistory({
        ...input,
        sourceLegacyEvents: [],
        commandIds: [id(501), id(502)],
      }).ok,
    ).toBe(false)
  })

  it("requires captured root allocations when upgrading an existing model", () => {
    const v1 = emptyV1()
    const added = requireSuccess(
      applyVersionedDocumentCommand(v1.snapshot, {
        ...envelope(1),
        schemaVersion: 1,
        kind: "org.vibeshape.history.insert-feature",
        payload: { feature: box(id(200)), historyAfter: null },
      }),
    )
    const upgraded = upgrade(added.snapshot, [allocation(id(200))])
    expect(upgraded.snapshot.parts[0]?.id).toBe(id(100))
    const changed: DocumentV2Event = { ...upgraded.event, actor: upgraded.event.actor }
    expect(
      requireSuccess(replayDocumentAuthorityEvents(added.snapshot, [changed])).snapshot,
    ).toEqual(upgraded.snapshot)
  })
})
