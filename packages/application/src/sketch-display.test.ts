import {
  createLengthQuantity,
  createRectangleSketch,
  documentSnapshotSchema,
  sketchConstraintIdSchema,
  sketchEntityIdSchema,
  sketchIdSchema,
  sketchRecordSchema,
} from "@vibeshape/domain"
import { documentSketchDisplaySchema } from "@vibeshape/protocol"
import { describe, expect, it } from "vitest"
import { materializeSketchDisplay } from "./sketch-display"

const sketchId = sketchIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f3201")
const firstPointId = sketchEntityIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f3211")
const secondPointId = sketchEntityIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f3212")
const lineId = sketchEntityIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f3213")
const missingFeatureId = "0195b5ac-b220-7a2c-8c33-67a36a7f3221"

function idFactory<Value>(parser: { parse: (value: string) => Value }, prefix: string) {
  let index = 0
  return () => {
    index += 1
    return parser.parse(`0195b5ac-${prefix}-7a2c-8c33-${index.toString(16).padStart(12, "0")}`)
  }
}

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

  it("materializes a saved closed profile with stable boundary identity in local sketch space", () => {
    const sketch = createRectangleSketch({
      id: sketchId,
      label: "Selectable profile",
      plane: "xy",
      width: createLengthQuantity(20),
      height: createLengthQuantity(10),
      createEntityId: idFactory(sketchEntityIdSchema, "b221"),
      createConstraintId: idFactory(sketchConstraintIdSchema, "b222"),
    })
    const points = sketch.entities.flatMap((entity) =>
      entity.type === "point" ? [{ entityId: entity.id, x: entity.x, y: entity.y }] : [],
    )
    const lines = sketch.entities.filter((entity) => entity.type === "line")
    const boundaryIds = lines.map(({ id }) => id).sort()
    const record = materializeSketchDisplay(sketchDocument(sketch), sketch, {
      points,
      circles: [],
      profileResult: {
        schemaVersion: 0,
        profiles: [
          {
            profileIndex: 0,
            outerLoopIndex: 0,
            holeLoopIndices: [],
            area: 200,
            perimeter: 60,
            bounds: { minX: 0, minY: 0, maxX: 20, maxY: 10 },
          },
        ],
        loops: [
          {
            loopIndex: 0,
            parentLoopIndex: null,
            depth: 0,
            signedArea: 200,
            perimeter: 60,
            bounds: { minX: 0, minY: 0, maxX: 20, maxY: 10 },
            sourceEntityIds: boundaryIds,
            segments: lines.map(({ id }) => ({ entityId: id, type: "line", reversed: false })),
          },
        ],
        diagnostics: [],
      },
    })

    expect(record?.profiles).toHaveLength(1)
    expect(record?.profiles[0]?.selector).toEqual({
      schemaVersion: 0,
      sketchId,
      outerBoundaryEntityIds: boundaryIds,
      holeBoundaryEntityIds: [],
    })
    expect(record?.profiles[0]?.outerLoop.segments).toHaveLength(4)
    expect(record?.frame).toEqual({
      origin: [0, 0, 0],
      xAxis: [1, 0, 0],
      yAxis: [0, 1, 0],
      normal: [0, 0, 1],
    })
  })

  it("keeps canonical hole selectors paired with their display loops", () => {
    const outerPoint = sketchEntityIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f3231")
    const firstHolePoint = sketchEntityIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f3232")
    const secondHolePoint = sketchEntityIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f3233")
    const outerId = sketchEntityIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f3234")
    const firstHoleId = sketchEntityIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f3235")
    const secondHoleId = sketchEntityIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f3236")
    const sketch = sketchRecordSchema.parse({
      schemaVersion: 0,
      id: sketchId,
      label: "Multiple holes",
      plane: "xy",
      entities: [
        { schemaVersion: 0, id: outerPoint, type: "point", x: 0, y: 0, construction: false },
        { schemaVersion: 0, id: firstHolePoint, type: "point", x: 5, y: 0, construction: false },
        { schemaVersion: 0, id: secondHolePoint, type: "point", x: 10, y: 0, construction: false },
        {
          schemaVersion: 0,
          id: outerId,
          type: "circle",
          centerPointId: outerPoint,
          radius: 20,
          construction: false,
        },
        {
          schemaVersion: 0,
          id: firstHoleId,
          type: "circle",
          centerPointId: firstHolePoint,
          radius: 2,
          construction: false,
        },
        {
          schemaVersion: 0,
          id: secondHoleId,
          type: "circle",
          centerPointId: secondHolePoint,
          radius: 5,
          construction: false,
        },
      ],
      constraints: [],
    })
    const result = materializeSketchDisplay(sketchDocument(sketch), sketch, {
      points: sketch.entities.flatMap((entity) =>
        entity.type === "point" ? [{ entityId: entity.id, x: entity.x, y: entity.y }] : [],
      ),
      circles: [],
      profileResult: {
        schemaVersion: 0,
        profiles: [
          {
            profileIndex: 0,
            outerLoopIndex: 0,
            holeLoopIndices: [2, 1],
            area: 1,
            perimeter: 1,
            bounds: { minX: -20, minY: -20, maxX: 20, maxY: 20 },
          },
        ],
        loops: [
          {
            loopIndex: 0,
            parentLoopIndex: null,
            depth: 0,
            signedArea: 1256,
            perimeter: 125,
            bounds: { minX: -20, minY: -20, maxX: 20, maxY: 20 },
            sourceEntityIds: [outerId],
            segments: [{ entityId: outerId, type: "circle", reversed: false }],
          },
          {
            loopIndex: 1,
            parentLoopIndex: 0,
            depth: 1,
            signedArea: -12,
            perimeter: 12,
            bounds: { minX: 3, minY: -2, maxX: 7, maxY: 2 },
            sourceEntityIds: [firstHoleId],
            segments: [{ entityId: firstHoleId, type: "circle", reversed: false }],
          },
          {
            loopIndex: 2,
            parentLoopIndex: 0,
            depth: 1,
            signedArea: -78,
            perimeter: 31,
            bounds: { minX: 5, minY: -5, maxX: 15, maxY: 5 },
            sourceEntityIds: [secondHoleId],
            segments: [{ entityId: secondHoleId, type: "circle", reversed: false }],
          },
        ],
        diagnostics: [],
      },
    })

    expect(result?.profiles[0]?.selector.holeBoundaryEntityIds).toEqual([
      [firstHoleId],
      [secondHoleId],
    ])
    expect(result?.profiles[0]?.holeLoops.map((loop) => loop.segments[0]?.entityId)).toEqual([
      firstHoleId,
      secondHoleId,
    ])
    expect(result).not.toBeNull()
    expect(documentSketchDisplaySchema.safeParse(result).success).toBe(true)
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
