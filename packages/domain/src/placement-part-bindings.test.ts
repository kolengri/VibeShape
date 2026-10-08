import { describe, expect, it } from "bun:test"
import type { DocumentSnapshotV2 } from "./document-v2"
import { applyDocumentV2Command, reduceDocumentV2Event } from "./document-v2-commands"
import { applyDocumentUpgradeV2Command } from "./document-v2-migration"
import { featureRecordSchema } from "./feature-graph"
import { terminalBodyOutputs } from "./model-bodies"
import { boxFeatureType } from "./part-design"
import { placementFeatureType } from "./part-design-placement"
import { partBodyReference } from "./parts"
import { createAngleQuantity, createLengthQuantity } from "./units"
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
function model(
  snapshot: DocumentSnapshotV2,
  kind: string,
  payload: unknown,
  allocations: unknown[] = [],
) {
  return success(
    applyDocumentV2Command(snapshot, {
      ...envelope(snapshot.revision),
      kind: "org.vibeshape.document.model-command",
      payload: {
        command: { ...envelope(snapshot.revision), schemaVersion: 1, kind, payload },
        partAllocations: allocations,
      },
    }),
  )
}
function currentPart(snapshot: DocumentSnapshotV2) {
  const part = snapshot.parts[0]
  if (!part || snapshot.parts.length !== 1) throw new Error("One authored part must remain.")
  return part
}
function placedFeature(offset = 10, suppressed = false) {
  return {
    schemaVersion: 0,
    id: id(3),
    type: placementFeatureType.type,
    dependencies: [id(2)],
    references: [],
    suppressed,
    parameters: {
      targetBody: { schemaVersion: 0, featureId: id(2), outputRole: "result" },
      translation: {
        x: createLengthQuantity(offset),
        y: createLengthQuantity(0),
        z: createLengthQuantity(0),
      },
      rotation: {
        x: createAngleQuantity(0),
        y: createAngleQuantity(0),
        z: createAngleQuantity(90, "deg"),
      },
    },
  }
}
function original() {
  const created = success(
    applyVersionedDocumentCommand(null, {
      ...envelope(0),
      schemaVersion: 1,
      kind: "org.vibeshape.document.create",
      payload: { name: "Placement fixture" },
    }),
  )
  const upgraded = success(
    applyDocumentUpgradeV2Command(created.snapshot, {
      ...envelope(created.snapshot.revision),
      kind: "org.vibeshape.document.upgrade-v2",
      payload: { partAllocations: [] },
    }),
  )
  return model(
    upgraded.snapshot,
    "org.vibeshape.history.insert-feature",
    {
      historyAfter: null,
      feature: {
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
      },
    },
    [
      {
        id: id(100),
        name: "Housing",
        origin: "independent",
        body: { schemaVersion: 0, featureId: id(2), outputRole: "result" },
      },
    ],
  )
}

describe("placement authored PartId advancement", () => {
  it("advances the same part through one model event, preserves identity on parameter edits, and replays captured effects", () => {
    const before = original().snapshot
    const added = model(before, "org.vibeshape.history.insert-feature", {
      feature: placedFeature(),
      historyAfter: before.history.at(-1),
    })
    expect(added.snapshot.parts).toHaveLength(1)
    expect(added.snapshot.parts[0]).toMatchObject({
      id: id(100),
      name: "Housing",
      origin: "independent",
      consumedBy: null,
    })
    expect(partBodyReference(currentPart(added.snapshot))).toMatchObject({
      featureId: id(3),
      outputRole: "result",
    })
    expect(added.snapshot.parts[0]?.bodyHistory).toEqual<unknown>([
      { schemaVersion: 0, featureId: id(2), outputRole: "result" },
      { schemaVersion: 0, featureId: id(3), outputRole: "result" },
    ])
    expect(success(reduceDocumentV2Event(before, added.event)).snapshot).toEqual(added.snapshot)
    const edited = model(added.snapshot, "org.vibeshape.feature.update", {
      feature: placedFeature(-15),
    })
    expect(edited.snapshot.parts).toEqual(added.snapshot.parts)
    expect(edited.snapshot.revision).toBe(added.snapshot.revision + 1)
  })
  it("rewinds the same identity when placement or its source is suppressed, then restores advancement", () => {
    const root = original().snapshot
    const added = model(root, "org.vibeshape.history.insert-feature", {
      feature: placedFeature(),
      historyAfter: root.history.at(-1),
    }).snapshot
    const suppressed = model(added, "org.vibeshape.feature.update", {
      feature: placedFeature(10, true),
    }).snapshot
    expect(partBodyReference(currentPart(suppressed))).toMatchObject({ featureId: id(2) })
    expect(suppressed.parts[0]?.id).toBe<unknown>(id(100))
    const restored = model(suppressed, "org.vibeshape.feature.update", {
      feature: placedFeature(),
    }).snapshot
    expect(restored.parts).toEqual(added.parts)
    const source = restored.features.find((feature) => feature.id === id(2))
    if (!source) throw new Error("Source box must remain authored.")
    const { semanticInputs: _semanticInputs, ...legacySource } = source
    const sourceSuppressed = model(restored, "org.vibeshape.feature.update", {
      feature: { ...legacySource, schemaVersion: 0, suppressed: true },
    }).snapshot
    expect(sourceSuppressed.parts[0]?.id).toBe<unknown>(id(100))
    expect(partBodyReference(currentPart(sourceSuppressed))).toMatchObject({ featureId: id(2) })
  })
  it("consumes only an exact selected constituent and retains its unselected sibling", () => {
    const raw = placedFeature()
    const placement = featureRecordSchema.parse({
      ...raw,
      parameters: {
        ...raw.parameters,
        targetBody: { ...raw.parameters.targetBody, outputRole: "body.primary" },
      },
    })
    const primary = { featureId: id(2), outputRole: "body.primary" }
    const sibling = { featureId: id(2), outputRole: "body.sibling" }
    const result = { featureId: id(3), outputRole: "result" }
    const feature = original().snapshot.features[0]
    if (!feature) throw new Error("Source must remain authored.")
    expect(
      terminalBodyOutputs(
        [{ ...feature, schemaVersion: 0 }, placement],
        new Map([
          [id(2), [primary, sibling]],
          [id(3), [result]],
        ]),
      ),
    ).toEqual([sibling, result])
    expect(
      terminalBodyOutputs(
        [{ ...feature, schemaVersion: 0 }, placement],
        new Map([
          [id(2), [sibling]],
          [id(3), [result]],
        ]),
      ),
    ).toBeNull()
  })
})
