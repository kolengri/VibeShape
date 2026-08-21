import { sketchFrame } from "@vibeshape/application/support-frame"
import {
  boxFeatureType,
  createLengthQuantity,
  documentSnapshotSchema,
  featureRecordSchema,
  sketchRecordSchema,
} from "@vibeshape/domain"
import { describe, expect, it } from "vitest"
import { resolveDocumentFeatureParameters } from "./document-controller"

const documentId = "0195b5ac-b213-7f2c-9c33-67a36a7f21ac"
const boxId = "0195b5ac-b220-7a2c-8c33-000000003401"
const sketchId = "0195b5ac-b220-7a2c-8c33-000000003402"
const variableId = "0195b5ac-b220-7a2c-8c33-000000003403"

function faceReference() {
  return {
    schemaVersion: 0 as const,
    featureId: boxId,
    kind: "face" as const,
    semanticRole: "primitive.box.cap.end",
    signature: {
      kind: "face" as const,
      geometryClass: "PLANE" as const,
      measure: 1,
      centroid: [0, 0, 0] as const,
      bounds: { min: [0, 0, 0] as const, max: [1, 1, 1] as const },
      boundaryCount: 4,
      adjacentGeometryClasses: [],
    },
  }
}

function variableDocument(offsetExpression: string) {
  const box = featureRecordSchema.parse({
    schemaVersion: 0,
    id: boxId,
    type: boxFeatureType.type,
    parameters: {
      width: createLengthQuantity(10),
      depth: createLengthQuantity(8),
      height: createLengthQuantity(4),
      centered: false,
      origin: {
        x: createLengthQuantity(5, "mm", "#offset"),
        y: createLengthQuantity(20),
        z: createLengthQuantity(30),
      },
    },
    dependencies: [],
    references: [],
    suppressed: false,
  })
  const sketch = sketchRecordSchema.parse({
    schemaVersion: 0,
    id: sketchId,
    label: "Variable support",
    plane: "xy",
    support: { kind: "feature-face", reference: faceReference() },
    entities: [],
    constraints: [],
  })
  return documentSnapshotSchema.parse({
    schemaVersion: 0,
    id: documentId,
    revision: 1,
    name: "Variable support test",
    variables: [{ schemaVersion: 0, id: variableId, name: "offset", expression: offsetExpression }],
    sketches: [sketch],
    features: [box],
    createdAt: "2026-08-21T00:00:00.000Z",
    updatedAt: "2026-08-21T00:00:00.000Z",
  })
}

describe("document feature parameter resolution", () => {
  it("keeps support frames aligned when a primitive origin variable changes", () => {
    const first = variableDocument("100 mm")
    const second = variableDocument("120 mm")
    const firstFeatures = resolveDocumentFeatureParameters(first)
    const secondFeatures = resolveDocumentFeatureParameters(second)
    const firstSketch = first.sketches[0]
    const secondSketch = second.sketches[0]
    if (!firstSketch || !secondSketch) throw new Error("Expected the support sketch fixture.")

    expect(sketchFrame(firstSketch, first, firstFeatures)?.origin).toEqual([100, 20, 34])
    expect(sketchFrame(secondSketch, second, secondFeatures)?.origin).toEqual([120, 20, 34])
    expect(first.features[0]?.parameters).toMatchObject({ origin: { x: { value: 5 } } })
  })
})
