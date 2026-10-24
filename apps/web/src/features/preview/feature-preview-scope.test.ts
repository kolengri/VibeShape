import { describe, expect, it } from "bun:test"
import {
  boxFeatureType,
  createLengthQuantity,
  type DocumentSnapshot,
  documentSnapshotSchema,
  type FeatureRecord,
  featureRecordSchema,
  sketchRecordSchema,
} from "@vibeshape/domain"
import { scopeFeaturePreviewDocument } from "./feature-preview-scope"

const id = (n: number) => `0195b5ac-b220-7a2c-8c33-${String(n).padStart(12, "0")}`
function feature(n: number, dependencies: number[] = []) {
  return featureRecordSchema.parse({
    schemaVersion: 0,
    id: id(n),
    type: boxFeatureType.type,
    parameters: {},
    dependencies: dependencies.map(id),
    references: [],
    suppressed: false,
  })
}
function document(features: FeatureRecord[], sketches: DocumentSnapshot["sketches"] = []) {
  return documentSnapshotSchema.parse({
    schemaVersion: 0,
    id: id(100),
    revision: 1,
    name: "Scoped preview",
    variables: [],
    features,
    sketches,
    createdAt: "2026-10-24T00:00:00Z",
    updatedAt: "2026-10-24T00:00:00Z",
  })
}

describe("exact feature preview scope", () => {
  it("retains a changed branch, descendants and their other inputs without rebuilding sibling consumers", () => {
    const snapshot = document([
      feature(1),
      feature(2),
      feature(3, [1]),
      feature(4, [3, 2]),
      feature(5, [1]),
      feature(6),
    ])
    const scoped = scopeFeaturePreviewDocument(snapshot, feature(3).id)
    expect(scoped.features.map(({ id }) => String(id))).toEqual([id(1), id(2), id(3), id(4)])
    expect(snapshot.features).toHaveLength(6)
  })

  it("keeps sketch support and profile inputs recursively while omitting unrelated sketches", () => {
    const sketch = (n: number) =>
      sketchRecordSchema.parse({
        schemaVersion: 0,
        id: id(n),
        label: "Profile",
        plane: "xy",
        entities: [],
        constraints: [],
      })
    const source = feature(1)
    const supported = sketchRecordSchema.parse({
      ...sketch(10),
      support: {
        kind: "feature-face",
        reference: {
          schemaVersion: 0,
          kind: "face",
          featureId: source.id,
          signature: {
            kind: "face",
            geometryClass: "PLANE",
            measure: 1,
            centroid: [0, 0, 0],
            bounds: { min: [0, 0, 0], max: [1, 1, 0] },
            boundaryCount: 4,
            adjacentGeometryClasses: [],
          },
        },
      },
    })
    const extrusion = featureRecordSchema.parse({
      ...feature(2),
      type: {
        ...boxFeatureType.type,
        typeId: "org.vibeshape.feature.part-design.extrusion",
        schemaVersion: 2,
      },
      parameters: {
        profile: {
          schemaVersion: 0,
          sketchId: supported.id,
          outerBoundaryEntityIds: [id(12)],
          holeBoundaryEntityIds: [],
        },
        distance: createLengthQuantity(2),
        symmetric: false,
        operation: "new",
      },
    })
    const candidate = feature(3, [2])
    const snapshot = document([source, extrusion, candidate, feature(4)], [supported, sketch(11)])
    const scoped = scopeFeaturePreviewDocument(snapshot, candidate.id)
    expect(scoped.features.map(({ id }) => String(id))).toEqual([id(1), id(2), id(3)])
    expect(scoped.sketches.map(({ id }) => String(id))).toEqual([id(10)])
  })

  it("falls back to the full document for unknown dependency models or invalid graphs", () => {
    const candidate = feature(2, [1])
    const opaque = featureRecordSchema.parse({
      ...feature(3),
      type: { ...boxFeatureType.type, typeId: "org.vibeshape.feature.extension.opaque" },
    })
    const unknown = document([feature(1), candidate, opaque])
    expect(scopeFeaturePreviewDocument(unknown, candidate.id)).toBe(unknown)
    const cyclic = { ...unknown, features: [feature(1, [2]), candidate] }
    expect(scopeFeaturePreviewDocument(cyclic, candidate.id)).toBe(cyclic)
  })
})
