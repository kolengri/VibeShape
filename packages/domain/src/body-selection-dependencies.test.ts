import { describe, expect, it } from "bun:test"
import { applyDocumentCommand } from "./commands"
import { documentSnapshotSchema } from "./document"
import { createDocumentDependencyGraphFromSnapshot } from "./document-graph"
import { featureRecordSchema } from "./feature-graph"
import { boxFeatureType } from "./part-design"
import { compoundFeatureType, unionFeatureType } from "./part-design-body-combination"
import { placementFeatureType } from "./part-design-placement"
import { createAngleQuantity, createLengthQuantity } from "./units"

const id = (value: number) => `0195b5ac-b220-7a2c-8c33-${String(value).padStart(12, "0")}`
const body = (value: number) => ({ schemaVersion: 0, featureId: id(value), outputRole: "result" })
const zero = createLengthQuantity(0)
const turn = createAngleQuantity(0)
const root = (value: number) =>
  featureRecordSchema.parse({
    schemaVersion: 0,
    id: id(value),
    type: boxFeatureType.type,
    parameters: {
      width: createLengthQuantity(10),
      depth: createLengthQuantity(20),
      height: createLengthQuantity(30),
      centered: false,
    },
    dependencies: [],
    references: [],
    suppressed: false,
  })

function selectionFeature(kind: "placement" | "compound" | "union") {
  const contribution = {
    placement: {
      type: placementFeatureType.type,
      parameters: {
        targetBody: body(1),
        translation: { x: zero, y: zero, z: zero },
        rotation: { x: turn, y: turn, z: turn },
      },
      dependencies: [id(1)],
    },
    compound: {
      type: compoundFeatureType.type,
      parameters: {
        slots: [
          { slotId: id(700), targetBody: body(1) },
          { slotId: id(701), targetBody: body(2) },
        ],
      },
      dependencies: [id(1), id(2)],
    },
    union: {
      type: unionFeatureType.type,
      parameters: { bodies: [body(1), body(2)] },
      dependencies: [id(1), id(2)],
    },
  }[kind]
  return featureRecordSchema.parse({
    schemaVersion: 0,
    id: id(3),
    ...contribution,
    references: [],
    suppressed: false,
  })
}

function snapshot(feature: ReturnType<typeof selectionFeature>) {
  return documentSnapshotSchema.parse({
    schemaVersion: 0,
    id: id(99),
    revision: 1,
    name: "Body selection graph fixture",
    features: [root(1), root(2), feature],
    createdAt: "2026-10-03T00:00:00Z",
    updatedAt: "2026-10-03T00:00:00Z",
  })
}

function remove(featureId: string) {
  return {
    schemaVersion: 1,
    kind: "org.vibeshape.feature.remove",
    commandId: id(1000),
    documentId: id(99),
    baseRevision: 1,
    issuedAt: "2026-10-03T00:00:00Z",
    actor: { type: "user", userId: null },
    payload: { featureId },
  }
}

describe.each(["placement", "compound", "union"] as const)(
  "V0 %s dependency completeness",
  (kind) => {
    it("recognizes trusted selections, permits leaf deletion, and retains source deletion blockers", () => {
      const feature = selectionFeature(kind)
      const current = snapshot(feature)
      const result = createDocumentDependencyGraphFromSnapshot(current)
      expect(result.ok).toBe(true)
      if (!result.ok) throw new Error(result.diagnostic.message)
      expect(result.graph.dependencyModelIssues).toEqual([])
      expect(result.graph.deletionBlockersFor({ kind: "feature", id: feature.id })).toEqual([])
      expect(result.graph.deletionBlockersFor({ kind: "feature", id: root(1).id })).toMatchObject([
        { dependent: { kind: "feature", id: feature.id }, relation: "feature-dependency" },
      ])
      const removed = applyDocumentCommand(current, remove(feature.id))
      expect(removed.ok).toBe(true)
      if (!removed.ok) throw new Error(removed.diagnostic.message)
      expect(removed.snapshot.features).toEqual([root(1), root(2)])
      expect(applyDocumentCommand(current, remove(root(1).id))).toMatchObject({
        ok: false,
        diagnostic: { code: "feature-in-use" },
      })
    })

    it("keeps suppressed selections dependency-complete without discarding their authored blockers", () => {
      const feature = { ...selectionFeature(kind), suppressed: true }
      const current = snapshot(feature)
      const result = createDocumentDependencyGraphFromSnapshot(current)
      expect(result).toMatchObject({ ok: true, graph: { dependencyModelIssues: [] } })
      expect(applyDocumentCommand(current, remove(root(1).id))).toMatchObject({
        ok: false,
        diagnostic: { code: "feature-in-use" },
      })
      expect(applyDocumentCommand(current, remove(feature.id)).ok).toBe(true)
    })

    it("refuses deletion when the recognized version carries an invalid parameter model", () => {
      const feature = { ...selectionFeature(kind), parameters: {} }
      const current = snapshot(feature)
      expect(createDocumentDependencyGraphFromSnapshot(current)).toMatchObject({
        ok: true,
        graph: { dependencyModelIssues: [{ featureId: feature.id, ownerPath: "features.2.type" }] },
      })
      expect(applyDocumentCommand(current, remove(feature.id))).toMatchObject({
        ok: false,
        diagnostic: { code: "unavailable-dependency-model" },
      })
    })

    it("refuses source deletion when valid selections omit, substitute or reorder producer dependencies", () => {
      const feature = selectionFeature(kind)
      const mismatches = [
        [],
        [root(2).id],
        kind === "placement" ? [root(1).id, root(2).id] : [...feature.dependencies].reverse(),
      ]
      for (const dependencies of mismatches) {
        const current = snapshot(featureRecordSchema.parse({ ...feature, dependencies }))
        expect(createDocumentDependencyGraphFromSnapshot(current)).toMatchObject({
          ok: true,
          graph: { dependencyModelIssues: [{ featureId: feature.id }] },
        })
        expect(applyDocumentCommand(current, remove(root(1).id))).toMatchObject({
          ok: false,
          diagnostic: {
            code: dependencies.includes(root(1).id)
              ? "feature-in-use"
              : "unavailable-dependency-model",
          },
        })
      }
    })

    it("keeps unknown versions and providers opaque instead of trusting a matching typeId", () => {
      const feature = selectionFeature(kind)
      for (const type of [
        { ...feature.type, schemaVersion: kind === "compound" || kind === "union" ? 3 : 2 },
        { ...feature.type, moduleId: "org.example.foreign" },
      ]) {
        const unsupported = featureRecordSchema.parse({ ...feature, type })
        const current = snapshot(unsupported)
        expect(createDocumentDependencyGraphFromSnapshot(current)).toMatchObject({
          ok: true,
          graph: { dependencyModelIssues: [{ featureId: feature.id }] },
        })
        expect(applyDocumentCommand(current, remove(feature.id))).toMatchObject({
          ok: false,
          diagnostic: { code: "unavailable-dependency-model" },
        })
      }
    })
  },
)
