import {
  boxFeatureType,
  createEmptySketch,
  createLengthQuantity,
  datumPlaneFeatureType,
  featureIdSchema,
  featureRecordSchema,
  sketchIdSchema,
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
