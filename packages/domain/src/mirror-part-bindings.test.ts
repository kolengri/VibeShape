import { describe, expect, it } from "vitest"
import type { DocumentSnapshotV2 } from "./document-v2"
import { applyDocumentV2Command, reduceDocumentV2Event } from "./document-v2-commands"
import { applyDocumentUpgradeV2Command } from "./document-v2-migration"
import { featureRecordSchema } from "./feature-graph"
import { terminalBodyOutputs } from "./model-bodies"
import { boxFeatureType } from "./part-design"
import { unionFeatureTypeV2 } from "./part-design-body-combination"
import { mirrorFeatureType, mirrorFeatureTypeV2 } from "./part-design-mirror"
import { shellFeatureType, shellFeatureTypeV2 } from "./part-design-shell"
import { partBodyReference } from "./parts"
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
function modifyingFeature(
  type: "Mirror" | "Shell" | "Shell v2" | "Closed Shell",
  plane: "XY" | "XZ" | "YZ" = "XY",
  suppressed = false,
  outputRole = "result",
) {
  const targetBody = { schemaVersion: 0, featureId: id(2), outputRole }
  const parameters =
    type === "Mirror"
      ? { targetBody, plane }
      : {
          targetBody,
          thickness: createLengthQuantity(plane === "YZ" ? 2 : 1),
          direction: "inward",
          sourceContentHash: "a".repeat(64),
          openings:
            type === "Closed Shell"
              ? []
              : [
                  {
                    schemaVersion: 1,
                    featureId: id(2),
                    outputRole,
                    kind: "face",
                    signature: {
                      kind: "face",
                      geometryClass: "plane",
                      measure: 600,
                      centroid: [0, 0, 40],
                      bounds: { min: [-10, -15, 40], max: [10, 15, 40] },
                      boundaryCount: 4,
                      adjacentGeometryClasses: [],
                    },
                  },
                ],
        }
  return {
    schemaVersion: 0,
    id: id(3),
    type:
      type === "Mirror"
        ? mirrorFeatureType.type
        : type === "Shell"
          ? shellFeatureType.type
          : shellFeatureTypeV2.type,
    dependencies: [id(2)],
    references: [],
    suppressed,
    parameters,
  }
}
function original() {
  const created = success(
    applyVersionedDocumentCommand(null, {
      ...envelope(0),
      schemaVersion: 1,
      kind: "org.vibeshape.document.create",
      payload: { name: "Mirror fixture" },
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

describe.each(["Mirror", "Shell", "Shell v2", "Closed Shell"] as const)(
  "%s authored PartId advancement",
  (type) => {
    it("advances the same part through one model event, preserves identity on parameter edits, and replays captured effects", () => {
      const before = original().snapshot
      const added = model(before, "org.vibeshape.history.insert-feature", {
        feature: modifyingFeature(type),
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
      expect(added.snapshot.parts[0]?.bodyHistory).toEqual([
        { schemaVersion: 0, featureId: id(2), outputRole: "result" },
        { schemaVersion: 0, featureId: id(3), outputRole: "result" },
      ])
      expect(success(reduceDocumentV2Event(before, added.event)).snapshot).toEqual(added.snapshot)
      const edited = model(added.snapshot, "org.vibeshape.feature.update", {
        feature: modifyingFeature(type, "YZ"),
      })
      expect(edited.snapshot.parts).toEqual(added.snapshot.parts)
      expect(edited.snapshot.revision).toBe(added.snapshot.revision + 1)
    })
    it("rewinds the same identity when mirror or its source is suppressed, then restores advancement", () => {
      const root = original().snapshot
      const added = model(root, "org.vibeshape.history.insert-feature", {
        feature: modifyingFeature(type),
        historyAfter: root.history.at(-1),
      }).snapshot
      const suppressed = model(added, "org.vibeshape.feature.update", {
        feature: modifyingFeature(type, "XY", true),
      }).snapshot
      expect(partBodyReference(currentPart(suppressed))).toMatchObject({ featureId: id(2) })
      expect(suppressed.parts[0]?.id).toBe(id(100))
      const restored = model(suppressed, "org.vibeshape.feature.update", {
        feature: modifyingFeature(type),
      }).snapshot
      expect(restored.parts).toEqual(added.parts)
      const source = restored.features.find((feature) => feature.id === id(2))
      if (!source) throw new Error("Source box must remain authored.")
      const { semanticInputs: _semanticInputs, ...legacySource } = source
      const sourceSuppressed = model(restored, "org.vibeshape.feature.update", {
        feature: { ...legacySource, schemaVersion: 0, suppressed: true },
      }).snapshot
      expect(sourceSuppressed.parts[0]?.id).toBe(id(100))
      expect(partBodyReference(currentPart(sourceSuppressed))).toMatchObject({ featureId: id(2) })
    })
    it("consumes only an exact selected constituent and retains its unselected sibling", () => {
      const mirror = featureRecordSchema.parse(modifyingFeature(type, "XY", false, "body.primary"))
      const primary = { featureId: id(2), outputRole: "body.primary" }
      const sibling = { featureId: id(2), outputRole: "body.sibling" }
      const result = { featureId: id(3), outputRole: "result" }
      const feature = original().snapshot.features[0]
      if (!feature) throw new Error("Source must remain authored.")
      expect(
        terminalBodyOutputs(
          [{ ...feature, schemaVersion: 0 }, mirror],
          new Map([
            [id(2), [primary, sibling]],
            [id(3), [result]],
          ]),
        ),
      ).toEqual([sibling, result])
      expect(
        terminalBodyOutputs(
          [{ ...feature, schemaVersion: 0 }, mirror],
          new Map([
            [id(2), [sibling]],
            [id(3), [result]],
          ]),
        ),
      ).toBeNull()
    })
  },
)

describe("preserve-source Mirror authored ownership", () => {
  function copyFeature(suppressed = false, offset = 10) {
    const feature = modifyingFeature("Mirror")
    return {
      ...feature,
      type: mirrorFeatureTypeV2.type,
      suppressed,
      parameters: {
        ...feature.parameters,
        offset: createLengthQuantity(offset),
        preserveSource: true,
      },
    }
  }
  function addCopy(snapshot: DocumentSnapshotV2) {
    return model(
      snapshot,
      "org.vibeshape.history.insert-feature",
      { feature: copyFeature(), historyAfter: snapshot.history.at(-1) },
      [
        {
          id: id(101),
          name: "Reflected housing",
          origin: "independent",
          body: { schemaVersion: 0, featureId: id(3), outputRole: "result" },
        },
      ],
    )
  }
  it("captures an independent reflected PartId, preserves source metadata/history, and replays edits and suppression", () => {
    const before = original().snapshot
    const added = addCopy(before)
    expect(added.snapshot.parts).toHaveLength(2)
    expect(added.snapshot.parts[0]).toEqual(before.parts[0])
    expect(added.snapshot.parts[1]).toMatchObject({
      id: id(101),
      name: "Reflected housing",
      origin: "independent",
      consumedBy: null,
      bodyHistory: [{ schemaVersion: 0, featureId: id(3), outputRole: "result" }],
    })
    expect(success(reduceDocumentV2Event(before, added.event)).snapshot).toEqual(added.snapshot)
    const edited = model(added.snapshot, "org.vibeshape.feature.update", {
      feature: copyFeature(false, -25.4),
    })
    expect(edited.snapshot.parts).toEqual(added.snapshot.parts)
    expect(success(reduceDocumentV2Event(added.snapshot, edited.event)).snapshot).toEqual(
      edited.snapshot,
    )
    const suppressed = model(edited.snapshot, "org.vibeshape.feature.update", {
      feature: copyFeature(true, -25.4),
    }).snapshot
    expect(suppressed.parts[0]).toEqual(before.parts[0])
    const restored = model(suppressed, "org.vibeshape.feature.update", {
      feature: copyFeature(false, -25.4),
    }).snapshot
    expect(restored.parts).toEqual(added.snapshot.parts)
  })
  it("keeps exact selected source and siblings terminal while requiring the requested role", () => {
    const before = original().snapshot.features[0]
    if (!before) throw new Error("Source must remain authored.")
    const feature = featureRecordSchema.parse(copyFeature())
    const source = { featureId: id(2), outputRole: "result" }
    const sibling = { featureId: id(2), outputRole: "body.sibling" }
    const reflection = { featureId: id(3), outputRole: "result" }
    expect(
      terminalBodyOutputs(
        [{ ...before, schemaVersion: 0 }, feature],
        new Map([
          [id(2), [source, sibling]],
          [id(3), [reflection]],
        ]),
      ),
    ).toEqual([source, sibling, reflection])
    expect(
      terminalBodyOutputs(
        [{ ...before, schemaVersion: 0 }, feature],
        new Map([
          [id(2), [sibling]],
          [id(3), [reflection]],
        ]),
      ),
    ).toBeNull()
  })
  it("reallocates only the independent copy when preservation is toggled and replays both transitions", () => {
    const before = original().snapshot
    const copied = addCopy(before).snapshot
    const feature = copyFeature()
    const replaced = model(copied, "org.vibeshape.feature.update", {
      feature: { ...feature, parameters: { ...feature.parameters, preserveSource: false } },
    })
    expect(replaced.snapshot.parts).toHaveLength(1)
    expect(replaced.snapshot.parts[0]).toMatchObject({
      id: id(100),
      name: "Housing",
      consumedBy: null,
    })
    expect(partBodyReference(currentPart(replaced.snapshot))).toMatchObject({
      featureId: id(3),
      outputRole: "result",
    })
    expect(success(reduceDocumentV2Event(copied, replaced.event)).snapshot).toEqual(
      replaced.snapshot,
    )
    const restored = model(replaced.snapshot, "org.vibeshape.feature.update", { feature }, [
      {
        id: id(102),
        name: "Reflected housing",
        origin: "independent",
        body: { schemaVersion: 0, featureId: id(3), outputRole: "result" },
      },
    ])
    expect(restored.snapshot.parts).toHaveLength(2)
    expect(restored.snapshot.parts[0]).toEqual(before.parts[0])
    expect(restored.snapshot.parts[1]).toMatchObject({ id: id(102), consumedBy: null })
    expect(success(reduceDocumentV2Event(replaced.snapshot, restored.event)).snapshot).toEqual(
      restored.snapshot,
    )
  })
  it("lets a later Union select both bodies with distinct producers and consume only the reflected PartId", () => {
    const added = addCopy(original().snapshot).snapshot
    const source = { schemaVersion: 0, featureId: id(2), outputRole: "result" }
    const reflection = { schemaVersion: 0, featureId: id(3), outputRole: "result" }
    const union = model(added, "org.vibeshape.history.insert-feature", {
      historyAfter: added.history.at(-1),
      feature: {
        schemaVersion: 0,
        id: id(4),
        type: unionFeatureTypeV2.type,
        parameters: { bodies: [source, reflection] },
        dependencies: [id(2), id(3)],
        references: [],
        suppressed: false,
      },
    })
    const survivingPart = union.snapshot.parts[0]
    if (!survivingPart) throw new Error("Union must retain the source authored PartId.")
    expect(partBodyReference(survivingPart)).toMatchObject({
      featureId: id(4),
      outputRole: "result",
    })
    expect(union.snapshot.parts[0]?.id).toBe(id(100))
    expect(union.snapshot.parts[1]).toMatchObject({ id: id(101), consumedBy: id(4) })
    expect(success(reduceDocumentV2Event(added, union.event)).snapshot).toEqual(union.snapshot)
    expect(
      terminalBodyOutputs(
        union.snapshot.features.map((feature) => ({ ...feature, schemaVersion: 0 })),
        new Map([
          [id(2), [source]],
          [id(3), [reflection]],
          [id(4), [{ featureId: id(4), outputRole: "result" }]],
        ]),
      ),
    ).toEqual([{ featureId: id(4), outputRole: "result" }])
  })
})
