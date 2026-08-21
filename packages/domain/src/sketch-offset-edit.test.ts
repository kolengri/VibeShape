import { describe, expect, it } from "vitest"
import { sketchConstraintIdSchema, sketchEntityIdSchema, sketchIdSchema } from "./identifiers"
import { sketchRecordSchema } from "./sketch"
import { removeSketchEntities } from "./sketch-edit"
import {
  appendSketchLineOffset,
  connectedSketchOffsetLineIds,
  sketchLineOffsetGeometry,
  sketchLineSignedDistance,
} from "./sketch-offset-edit"
import { createLengthQuantity } from "./units"

function sequentialIdFactory<Value>(parse: (value: string) => Value, group: string) {
  let index = 0
  return () => {
    index += 1
    return parse(`0195b5ac-${group}-7a2c-8c33-${index.toString(16).padStart(12, "0")}`)
  }
}

const createSourceEntityId = sequentialIdFactory(
  (value) => sketchEntityIdSchema.parse(value),
  "c101",
)

function lineChain(points: readonly Readonly<{ x: number; y: number }>[], closed = false) {
  const pointEntities = points.map((point) => ({
    schemaVersion: 0 as const,
    id: createSourceEntityId(),
    type: "point" as const,
    construction: false,
    ...point,
  }))
  const segmentCount = closed ? pointEntities.length : pointEntities.length - 1
  const lines = Array.from({ length: segmentCount }, (_, index) => ({
    schemaVersion: 0 as const,
    id: createSourceEntityId(),
    type: "line" as const,
    construction: false,
    startPointId: pointEntities[index]?.id,
    endPointId: pointEntities[(index + 1) % pointEntities.length]?.id,
  }))
  const sketch = sketchRecordSchema.parse({
    schemaVersion: 0,
    id: sketchIdSchema.parse("0195b5ac-c100-7a2c-8c33-000000000001"),
    label: "Offset fixture",
    plane: "xy",
    entities: [...pointEntities, ...lines],
    constraints: [],
  })
  return { lines, sketch }
}

describe("analytical sketch line offsets", () => {
  it("measures a signed distance from the stored line direction", () => {
    const fixture = lineChain([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
    ])
    const lineId = fixture.lines[0]?.id
    if (!lineId) throw new Error("The offset fixture requires a line.")

    expect(sketchLineSignedDistance(fixture.sketch, lineId, { x: 4, y: 3 })).toBe(3)
    expect(sketchLineSignedDistance(fixture.sketch, lineId, { x: 4, y: -2 })).toBe(-2)
  })

  it("creates a parametrically constrained parallel line without mutating its source", () => {
    const fixture = lineChain([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
    ])
    const source = fixture.lines[0]
    if (!source) throw new Error("The offset fixture requires a line.")
    const createEntityId = sequentialIdFactory((value) => sketchEntityIdSchema.parse(value), "c102")
    const createConstraintId = sequentialIdFactory(
      (value) => sketchConstraintIdSchema.parse(value),
      "c103",
    )

    const result = appendSketchLineOffset(fixture.sketch, {
      createConstraintId,
      createEntityId,
      lineIds: [source.id],
      referenceLineId: source.id,
      value: createLengthQuantity(5),
    })

    expect(fixture.sketch.entities).toHaveLength(3)
    expect(result.createdEntityIds).toHaveLength(3)
    const createdLine = result.sketch.entities.find(
      (entity) => entity.type === "line" && entity.id !== source.id,
    )
    if (createdLine?.type !== "line") throw new Error("Offset must create one line.")
    const createdPoints = [createdLine.startPointId, createdLine.endPointId].map((pointId) =>
      result.sketch.entities.find(({ id }) => id === pointId),
    )
    expect(createdPoints).toEqual([
      expect.objectContaining({ type: "point", x: 0, y: 5 }),
      expect.objectContaining({ type: "point", x: 10, y: 5 }),
    ])
    expect(result.sketch.constraints).toEqual([
      expect.objectContaining({
        type: "offset",
        endpointPairs: [
          { sourcePointId: source.startPointId, offsetPointId: createdLine.startPointId },
          { sourcePointId: source.endPointId, offsetPointId: createdLine.endPointId },
        ],
        linePairs: [
          {
            sourceLineId: source.id,
            offsetLineId: createdLine.id,
            distanceScale: 1,
          },
        ],
        value: createLengthQuantity(5),
      }),
    ])
    expect(removeSketchEntities(result.sketch, [source.id]).constraints).toEqual([])
  })

  it("miters connected open and closed line chains", () => {
    const open = lineChain([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
    ])
    const openReference = open.lines[0]?.id
    if (!openReference) throw new Error("The open chain requires a reference line.")
    expect(
      sketchLineOffsetGeometry(open.sketch, {
        distance: 2,
        lineIds: open.lines.map(({ id }) => id),
        referenceLineId: openReference,
      }).lines,
    ).toEqual([
      expect.objectContaining({
        distanceScale: 1,
        start: { x: 0, y: 2 },
        end: { x: 8, y: 2 },
      }),
      expect.objectContaining({
        distanceScale: 1,
        start: { x: 8, y: 2 },
        end: { x: 8, y: 10 },
      }),
    ])

    const closed = lineChain(
      [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 10 },
        { x: 0, y: 10 },
      ],
      true,
    )
    const closedReference = closed.lines[0]?.id
    if (!closedReference) throw new Error("The closed chain requires a reference line.")
    expect(
      sketchLineOffsetGeometry(closed.sketch, {
        distance: 2,
        lineIds: closed.lines.map(({ id }) => id),
        referenceLineId: closedReference,
      }).lines,
    ).toEqual([
      expect.objectContaining({ start: { x: 2, y: 2 }, end: { x: 8, y: 2 } }),
      expect.objectContaining({ start: { x: 8, y: 2 }, end: { x: 8, y: 8 } }),
      expect.objectContaining({ start: { x: 8, y: 8 }, end: { x: 2, y: 8 } }),
      expect.objectContaining({ start: { x: 2, y: 8 }, end: { x: 2, y: 2 } }),
    ])
  })

  it("records the stored-direction scale for reversed source segments", () => {
    const fixture = lineChain([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
    ])
    const [first, second] = fixture.lines
    if (!first || !second) throw new Error("The reversed chain fixture is incomplete.")
    const reversedSketch = sketchRecordSchema.parse({
      ...fixture.sketch,
      entities: fixture.sketch.entities.map((entity) =>
        entity.id === second.id
          ? {
              ...entity,
              startPointId: second.endPointId,
              endPointId: second.startPointId,
            }
          : entity,
      ),
    })

    expect(
      sketchLineOffsetGeometry(reversedSketch, {
        distance: 2,
        lineIds: [first.id, second.id],
        referenceLineId: first.id,
      }).lines.map(({ distanceScale }) => distanceScale),
    ).toEqual([1, -1])
  })

  it("falls back to one source at a branch and rejects invalid offset requests", () => {
    const branched = lineChain([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
    ])
    const branchPoint = branched.sketch.entities.find(
      (entity) => entity.type === "point" && entity.x === 10 && entity.y === 0,
    )
    const reference = branched.lines[0]
    if (!branchPoint || !reference) throw new Error("The branch fixture is incomplete.")
    const branchEnd = createSourceEntityId()
    const branchLine = createSourceEntityId()
    const sketch = sketchRecordSchema.parse({
      ...branched.sketch,
      entities: [
        ...branched.sketch.entities,
        {
          schemaVersion: 0,
          id: branchEnd,
          type: "point",
          construction: false,
          x: 20,
          y: 0,
        },
        {
          schemaVersion: 0,
          id: branchLine,
          type: "line",
          construction: false,
          startPointId: branchPoint.id,
          endPointId: branchEnd,
        },
      ],
    })

    expect(connectedSketchOffsetLineIds(sketch, reference.id)).toEqual([reference.id])
    expect(() =>
      sketchLineOffsetGeometry(branched.sketch, {
        distance: 0,
        lineIds: [reference.id],
        referenceLineId: reference.id,
      }),
    ).toThrow(/nonzero/)
    expect(() =>
      sketchLineOffsetGeometry(sketch, {
        distance: 2,
        lineIds: [...branched.lines.map(({ id }) => id), branchLine],
        referenceLineId: reference.id,
      }),
    ).toThrow(/branching/)
  })
})
