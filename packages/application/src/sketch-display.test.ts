import {
  documentSnapshotSchema,
  sketchEntityIdSchema,
  sketchIdSchema,
  sketchRecordSchema,
} from "@vibeshape/domain"
import { describe, expect, it } from "vitest"
import { materializeSketchDisplay } from "./sketch-display"

const sketchId = sketchIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f3201")
const firstPointId = sketchEntityIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f3211")
const secondPointId = sketchEntityIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f3212")
const lineId = sketchEntityIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f3213")
const missingFeatureId = "0195b5ac-b220-7a2c-8c33-67a36a7f3221"

function sourceSketch(support?: unknown) {
  return sketchRecordSchema.parse({
    schemaVersion: 0,
    id: sketchId,
    label: "Display",
    plane: "xz",
    ...(support ? { support } : {}),
    entities: [
      {
        schemaVersion: 0,
        id: firstPointId,
        type: "point",
        x: 2,
        y: 3,
        construction: false,
      },
      {
        schemaVersion: 0,
        id: secondPointId,
        type: "point",
        x: 7,
        y: 11,
        construction: false,
      },
      {
        schemaVersion: 0,
        id: lineId,
        type: "line",
        startPointId: firstPointId,
        endPointId: secondPointId,
        construction: false,
      },
    ],
    constraints: [],
  })
}

function documentFor(sketches: readonly unknown[]) {
  return documentSnapshotSchema.parse({
    schemaVersion: 0,
    id: "0195b5ac-b213-7f2c-9c33-67a36a7f21ac",
    revision: 4,
    name: "Sketch display",
    variables: [],
    sketches,
    features: [],
    createdAt: "2026-08-20T00:00:00.000Z",
    updatedAt: "2026-08-20T00:00:00.000Z",
  })
}

describe("materializeSketchDisplay", () => {
  it("projects authored points and curves through the sketch origin frame", () => {
    const sketch = sourceSketch()
    const record = materializeSketchDisplay(sketchDocument(sketch), sketch)

    expect(record).not.toBeNull()
    expect(Array.from(record?.curvePositions ?? [])).toEqual([2, 0, 3, 7, 0, 11])
    expect(Array.from(record?.pointPositions ?? [])).toEqual([2, 0, 3, 7, 0, 11])
  })

  it("uses solved point coordinates when a valid solve is available", () => {
    const sketch = sourceSketch()
    const result = {
      points: [
        { entityId: firstPointId, x: 20, y: 30 },
        { entityId: secondPointId, x: 70, y: 110 },
      ],
      circles: [],
    }
    const record = materializeSketchDisplay(sketchDocument(sketch), sketch, result)

    expect(Array.from(record?.curvePositions ?? [])).toEqual([20, 0, 30, 70, 0, 110])
  })

  it("fails closed when sketch support cannot be resolved", () => {
    const sketch = sourceSketch({
      kind: "feature-face",
      reference: {
        schemaVersion: 0,
        featureId: missingFeatureId,
        kind: "face",
        semanticRole: "primitive.box.cap.end",
        signature: {
          kind: "face",
          geometryClass: "PLANE",
          measure: 1,
          centroid: [0, 0, 0],
          bounds: { min: [0, 0, 0], max: [1, 1, 1] },
          boundaryCount: 4,
          adjacentGeometryClasses: [],
        },
      },
    })

    expect(materializeSketchDisplay(documentFor([]), sketch)).toBeNull()
  })
})

function sketchDocument(sketch: ReturnType<typeof sourceSketch>) {
  return documentFor([sketch])
}
