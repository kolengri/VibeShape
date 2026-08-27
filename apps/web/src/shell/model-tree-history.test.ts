import {
  boxFeatureType,
  createEmptySketch,
  createLengthQuantity,
  datumPlaneFeatureType,
  featureIdSchema,
  featureRecordSchema,
  sketchEntityIdSchema,
  sketchIdSchema,
  sketchRecordSchema,
} from "@vibeshape/domain"
import { describe, expect, it } from "vitest"
import { selectModelTreeHistory } from "./model-tree-history"

const sketch = createEmptySketch({
  id: sketchIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f2603"),
  label: "Profile",
  plane: "xy",
})
const feature = featureRecordSchema.parse({
  schemaVersion: 0,
  id: featureIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f2602"),
  type: boxFeatureType.type,
  parameters: {
    width: createLengthQuantity(20, "mm", "20 mm"),
    depth: createLengthQuantity(20, "mm", "20 mm"),
    height: createLengthQuantity(20, "mm", "20 mm"),
    centered: false,
  },
  dependencies: [],
  references: [],
  suppressed: false,
  label: "Box 1",
})
const datum = featureRecordSchema.parse({
  schemaVersion: 0,
  id: featureIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f2605"),
  type: datumPlaneFeatureType.type,
  parameters: {
    mode: "offset",
    support: { kind: "origin-plane", plane: "xy" },
    offset: createLengthQuantity(5),
  },
  dependencies: [],
  references: [],
  suppressed: false,
  label: "Offset plane",
})

function brokenReferenceChain() {
  const source = createEmptySketch({
    id: sketchIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f2701"),
    label: "Source",
    plane: "xy",
  })
  const missingPointId = sketchEntityIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f2702")
  const middle = sketchRecordSchema.parse({
    schemaVersion: 0,
    id: "0195b5ac-b220-7a2c-8c33-67a36a7f2703",
    label: "Middle",
    plane: "xy",
    entities: [],
    constraints: [],
    externalReferences: [
      {
        schemaVersion: 0,
        id: "0195b5ac-b220-7a2c-8c33-67a36a7f2704",
        sourceSketchId: source.id,
        sourcePointId: missingPointId,
        projectedPointId: "0195b5ac-b220-7a2c-8c33-67a36a7f2705",
      },
    ],
  })
  const middleReference = middle.externalReferences?.[0]
  if (!middleReference || !("projectedPointId" in middleReference)) {
    throw new Error("The intermediate point reference is required.")
  }
  const target = sketchRecordSchema.parse({
    schemaVersion: 0,
    id: "0195b5ac-b220-7a2c-8c33-67a36a7f2706",
    label: "Target",
    plane: "xy",
    entities: [],
    constraints: [],
    externalReferences: [
      {
        schemaVersion: 0,
        id: "0195b5ac-b220-7a2c-8c33-67a36a7f2707",
        sourceSketchId: middle.id,
        sourcePointId: middleReference.projectedPointId,
        projectedPointId: "0195b5ac-b220-7a2c-8c33-67a36a7f2708",
      },
    ],
  })
  return { source, middle, target }
}

function modelReferenceChain() {
  const source = sketchRecordSchema.parse({
    schemaVersion: 0,
    id: "0195b5ac-b220-7a2c-8c33-67a36a7f2710",
    label: "Model source",
    plane: "xy",
    entities: [],
    constraints: [],
    externalReferences: [
      {
        schemaVersion: 0,
        id: "0195b5ac-b220-7a2c-8c33-67a36a7f2711",
        kind: "model-point",
        reference: {
          schemaVersion: 0,
          featureId: feature.id,
          kind: "vertex",
          signature: {
            kind: "vertex",
            geometryClass: "POINT",
            measure: 0,
            centroid: [0, 0, 0],
            bounds: { min: [0, 0, 0], max: [0, 0, 0] },
            boundaryCount: 0,
            adjacentGeometryClasses: [],
          },
        },
        projectedPointId: "0195b5ac-b220-7a2c-8c33-67a36a7f2712",
      },
    ],
  })
  const sourceReference = source.externalReferences?.[0]
  if (!sourceReference || !("projectedPointId" in sourceReference)) {
    throw new Error("The projected model point is required.")
  }
  const dependent = sketchRecordSchema.parse({
    schemaVersion: 0,
    id: "0195b5ac-b220-7a2c-8c33-67a36a7f2713",
    label: "Model dependent",
    plane: "xy",
    entities: [],
    constraints: [],
    externalReferences: [
      {
        schemaVersion: 0,
        id: "0195b5ac-b220-7a2c-8c33-67a36a7f2714",
        sourceSketchId: source.id,
        sourcePointId: sourceReference.projectedPointId,
        projectedPointId: "0195b5ac-b220-7a2c-8c33-67a36a7f2715",
      },
    ],
  })
  return { dependent, source, sourceReference }
}

describe("selectModelTreeHistory", () => {
  it("interleaves graph history and derives terminal bodies without mutating the snapshot", () => {
    const snapshot = { sketches: [sketch], features: [feature] }
    const before = JSON.stringify(snapshot)
    const view = selectModelTreeHistory(snapshot)

    expect(view.graphFailed).toBe(false)
    expect(view.rows.map((row) => `${row.kind}:${row.ref.id}`)).toEqual([
      `feature:${feature.id}`,
      `sketch:${sketch.id}`,
    ])
    expect(view.bodyFeatures.map(({ id }) => id)).toEqual([feature.id])
    expect(JSON.stringify(snapshot)).toBe(before)
  })

  it("fails closed with deterministic separate lists when graph input is invalid", () => {
    const invalidFeature = { ...feature, dependencies: [feature.id] }
    const view = selectModelTreeHistory({ sketches: [sketch], features: [invalidFeature] })

    expect(view.graphFailed).toBe(true)
    expect(view.rows.map((row) => row.kind)).toEqual(["sketch", "feature"])
    expect(view.bodyFeatures).toEqual([])
    expect(view.diagnostic).toBeTruthy()
  })

  it("classifies datum history without exposing it as a terminal body", () => {
    const view = selectModelTreeHistory({ sketches: [sketch], features: [feature, datum] })

    expect(view.rows.find((row) => row.ref.id === datum.id)?.datum).toBe(true)
    expect(view.bodyFeatures.map(({ id }) => id)).toEqual([feature.id])
  })

  it("projects direct and chained sketch-reference failures onto their History rows", () => {
    const { source, middle, target } = brokenReferenceChain()
    const view = selectModelTreeHistory({ sketches: [source, middle, target], features: [] })

    expect(view.rows.find(({ ref }) => ref.id === source.id)?.referenceHealth?.status).toBe(
      "healthy",
    )
    expect(view.rows.find(({ ref }) => ref.id === middle.id)?.referenceHealth).toMatchObject({
      status: "broken",
      directBrokenReferenceIds: [middle.externalReferences?.[0]?.id],
      transitiveBrokenReferenceIds: [],
    })
    expect(view.rows.find(({ ref }) => ref.id === target.id)?.referenceHealth).toMatchObject({
      status: "broken",
      directBrokenReferenceIds: [],
      transitiveBrokenReferenceIds: [target.externalReferences?.[0]?.id],
    })
  })

  it("merges exact worker model evidence and propagates failure through History", () => {
    const { dependent, source, sourceReference } = modelReferenceChain()
    const snapshot = { sketches: [source, dependent], features: [feature] }

    const unavailable = selectModelTreeHistory(snapshot)
    expect(unavailable.rows.find(({ ref }) => ref.id === source.id)?.referenceHealth?.status).toBe(
      "unknown",
    )
    expect(
      unavailable.rows.find(({ ref }) => ref.id === dependent.id)?.referenceHealth?.status,
    ).toBe("unknown")

    const broken = selectModelTreeHistory(snapshot, [
      { sketchId: source.id, referenceId: sourceReference.id, status: "broken" },
    ])
    expect(broken.rows.find(({ ref }) => ref.id === source.id)?.referenceHealth).toMatchObject({
      status: "broken",
      directBrokenReferenceIds: [sourceReference.id],
    })
    expect(broken.rows.find(({ ref }) => ref.id === dependent.id)?.referenceHealth).toMatchObject({
      status: "broken",
      directBrokenReferenceIds: [],
      transitiveBrokenReferenceIds: [dependent.externalReferences?.[0]?.id],
    })

    const resolved = selectModelTreeHistory(snapshot, [
      { sketchId: source.id, referenceId: sourceReference.id, status: "resolved" },
    ])
    expect(resolved.rows.find(({ ref }) => ref.id === source.id)?.referenceHealth?.status).toBe(
      "healthy",
    )
    expect(resolved.rows.find(({ ref }) => ref.id === dependent.id)?.referenceHealth?.status).toBe(
      "healthy",
    )
  })

  it("builds one bounded label lookup for a large independent history", () => {
    const features = Array.from({ length: 2_000 }, (_, index) =>
      featureRecordSchema.parse({
        ...feature,
        id: featureIdSchema.parse(
          `0195b5ac-b220-7a2c-8c33-${index.toString(16).padStart(12, "0")}`,
        ),
        label: `Feature ${index}`,
      }),
    )

    const view = selectModelTreeHistory({ sketches: [], features })

    expect(view.graphFailed).toBe(false)
    expect(view.labelsByRef.size).toBe(features.length)
    expect(view.labelsByRef.get(`feature:${features.at(-1)?.id}`)).toBe("Feature 1999")
  })
})
