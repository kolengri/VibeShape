import { describe, expect, test } from "vitest"
import { sketchRecordSchema } from "./sketch"
import { createAngleQuantity, createLengthQuantity } from "./units"

const sketchId = "018f0000-0000-7000-8000-000000000001"
const pointA = "018f0000-0000-7000-8000-000000000002"
const pointB = "018f0000-0000-7000-8000-000000000003"
const pointC = "018f0000-0000-7000-8000-000000000004"
const pointD = "018f0000-0000-7000-8000-000000000005"
const lineA = "018f0000-0000-7000-8000-000000000006"
const lineB = "018f0000-0000-7000-8000-000000000007"
const circle = "018f0000-0000-7000-8000-000000000008"
const arc = "018f0000-0000-7000-8000-000000000009"
const ellipse = "018f0000-0000-7000-8000-000000000010"

function constraintId(index: number) {
  return `018f0000-0000-7000-8000-${String(index).padStart(12, "0")}`
}

function validSketch() {
  return {
    schemaVersion: 0,
    id: sketchId,
    label: "Bracket profile",
    plane: "xy",
    entities: [
      { schemaVersion: 0, id: pointA, type: "point", x: 0, y: 0, construction: false },
      { schemaVersion: 0, id: pointB, type: "point", x: 20, y: 0, construction: false },
      { schemaVersion: 0, id: pointC, type: "point", x: 0, y: 20, construction: false },
      { schemaVersion: 0, id: pointD, type: "point", x: 20, y: 20, construction: false },
      {
        schemaVersion: 0,
        id: lineA,
        type: "line",
        startPointId: pointA,
        endPointId: pointB,
        construction: false,
      },
      {
        schemaVersion: 0,
        id: lineB,
        type: "line",
        startPointId: pointC,
        endPointId: pointD,
        construction: true,
      },
      {
        schemaVersion: 0,
        id: circle,
        type: "circle",
        centerPointId: pointC,
        radius: 5,
        construction: false,
      },
      {
        schemaVersion: 0,
        id: arc,
        type: "arc",
        centerPointId: pointA,
        startPointId: pointB,
        endPointId: pointC,
        construction: false,
      },
      {
        schemaVersion: 0,
        id: ellipse,
        type: "ellipse",
        centerPointId: pointA,
        primaryAxisPointId: pointB,
        secondaryAxisPointId: pointC,
        construction: false,
      },
    ],
    constraints: [
      {
        schemaVersion: 0,
        id: constraintId(101),
        type: "coincident",
        firstPointId: pointA,
        secondPointId: pointC,
      },
      { schemaVersion: 0, id: constraintId(102), type: "horizontal", lineId: lineA },
      { schemaVersion: 0, id: constraintId(103), type: "vertical", lineId: lineB },
      {
        schemaVersion: 0,
        id: constraintId(104),
        type: "parallel",
        firstEntityId: lineA,
        secondEntityId: lineB,
      },
      {
        schemaVersion: 0,
        id: constraintId(105),
        type: "perpendicular",
        firstEntityId: lineA,
        secondEntityId: lineB,
      },
      {
        schemaVersion: 0,
        id: constraintId(106),
        type: "equal",
        firstEntityId: lineA,
        secondEntityId: lineB,
      },
      {
        schemaVersion: 0,
        id: constraintId(107),
        type: "tangent",
        arcId: arc,
        lineId: lineA,
      },
      {
        schemaVersion: 0,
        id: constraintId(108),
        type: "concentric",
        firstEntityId: circle,
        secondEntityId: arc,
      },
      {
        schemaVersion: 0,
        id: constraintId(109),
        type: "midpoint",
        pointId: pointC,
        lineId: lineA,
      },
      {
        schemaVersion: 0,
        id: constraintId(110),
        type: "symmetric",
        firstPointId: pointA,
        secondPointId: pointB,
        lineId: lineB,
      },
      {
        schemaVersion: 0,
        id: constraintId(111),
        type: "point-on-line",
        pointId: pointC,
        lineId: lineA,
      },
      {
        schemaVersion: 0,
        id: constraintId(112),
        type: "point-on-curve",
        pointId: pointD,
        curveId: circle,
      },
      { schemaVersion: 0, id: constraintId(113), type: "fixed", pointId: pointA },
      {
        schemaVersion: 0,
        id: constraintId(114),
        type: "horizontal-distance",
        firstPointId: pointA,
        secondPointId: pointB,
        value: createLengthQuantity(20),
      },
      {
        schemaVersion: 0,
        id: constraintId(115),
        type: "vertical-distance",
        firstPointId: pointA,
        secondPointId: pointC,
        value: createLengthQuantity(20),
      },
      {
        schemaVersion: 0,
        id: constraintId(116),
        type: "distance",
        firstPointId: pointA,
        secondPointId: pointD,
        value: createLengthQuantity(28.2842712474619),
      },
      {
        schemaVersion: 0,
        id: constraintId(117),
        type: "offset",
        endpointPairs: [],
        linePairs: [{ sourceLineId: lineA, offsetLineId: lineB, distanceScale: 1 }],
        value: createLengthQuantity(20),
      },
      {
        schemaVersion: 0,
        id: constraintId(118),
        type: "angle",
        firstEntityId: lineA,
        secondEntityId: lineB,
        value: createAngleQuantity(90, "deg"),
      },
      {
        schemaVersion: 0,
        id: constraintId(119),
        type: "radius",
        curveId: circle,
        value: createLengthQuantity(5),
      },
      {
        schemaVersion: 0,
        id: constraintId(120),
        type: "diameter",
        curveId: arc,
        value: createLengthQuantity(40),
      },
      {
        schemaVersion: 0,
        id: constraintId(121),
        type: "primary-axis-diameter",
        curveId: ellipse,
        value: createLengthQuantity(40),
      },
      {
        schemaVersion: 0,
        id: constraintId(122),
        type: "secondary-axis-diameter",
        curveId: ellipse,
        value: createLengthQuantity(40),
      },
    ],
  } as const
}

describe("sketchRecordSchema", () => {
  test("accepts analytical P0 entities, construction state, and every P0 constraint family", () => {
    const parsed = sketchRecordSchema.parse(validSketch())

    expect(parsed.entities).toHaveLength(9)
    expect(parsed.constraints.map((constraint) => constraint.type)).toEqual([
      "coincident",
      "horizontal",
      "vertical",
      "parallel",
      "perpendicular",
      "equal",
      "tangent",
      "concentric",
      "midpoint",
      "symmetric",
      "point-on-line",
      "point-on-curve",
      "fixed",
      "horizontal-distance",
      "vertical-distance",
      "distance",
      "offset",
      "angle",
      "radius",
      "diameter",
      "primary-axis-diameter",
      "secondary-axis-diameter",
    ])
  })

  test("rejects duplicate identities and missing or incompatible semantic references", () => {
    const fixture = validSketch()
    const duplicate = {
      ...fixture,
      entities: [...fixture.entities, { ...fixture.entities[0] }],
    }
    const wrongConstraintTarget = {
      ...fixture,
      constraints: [
        {
          schemaVersion: 0,
          id: constraintId(200),
          type: "horizontal",
          lineId: circle,
        },
      ],
    }
    const wrongEllipseDimensionTarget = {
      ...fixture,
      constraints: [
        {
          schemaVersion: 0,
          id: constraintId(204),
          type: "primary-axis-diameter",
          curveId: circle,
          value: createLengthQuantity(10),
        },
      ],
    }
    const missingEntityTarget = {
      ...fixture,
      entities: fixture.entities.filter((entity) => entity.id !== pointB),
      constraints: [],
    }
    const sameOffsetLine = {
      ...fixture,
      constraints: [
        {
          schemaVersion: 0,
          id: constraintId(201),
          type: "offset",
          endpointPairs: [],
          linePairs: [{ sourceLineId: lineA, offsetLineId: lineA, distanceScale: 1 }],
          value: createLengthQuantity(5),
        },
      ],
    }
    const incompleteOffsetEndpoints = {
      ...fixture,
      constraints: [
        {
          schemaVersion: 0,
          id: constraintId(202),
          type: "offset",
          endpointPairs: [{ sourcePointId: pointA, offsetPointId: pointC }],
          linePairs: [{ sourceLineId: lineA, offsetLineId: lineB, distanceScale: 1 }],
          value: createLengthQuantity(5),
        },
      ],
    }
    const zeroOffset = {
      ...fixture,
      constraints: [
        {
          schemaVersion: 0,
          id: constraintId(203),
          type: "offset",
          endpointPairs: [],
          linePairs: [{ sourceLineId: lineA, offsetLineId: lineB, distanceScale: 1 }],
          value: createLengthQuantity(0),
        },
      ],
    }

    expect(sketchRecordSchema.safeParse(duplicate).success).toBe(false)
    expect(sketchRecordSchema.safeParse(wrongConstraintTarget).success).toBe(false)
    expect(sketchRecordSchema.safeParse(wrongEllipseDimensionTarget).success).toBe(false)
    expect(sketchRecordSchema.safeParse(missingEntityTarget).success).toBe(false)
    expect(sketchRecordSchema.safeParse(sameOffsetLine).success).toBe(false)
    expect(sketchRecordSchema.safeParse(incompleteOffsetEndpoints).success).toBe(false)
    expect(sketchRecordSchema.safeParse(zeroOffset).success).toBe(false)
  })

  test("rejects degenerate analytical records and non-finite or out-of-budget geometry", () => {
    const fixture = validSketch()
    const degenerateLine = {
      ...fixture,
      entities: fixture.entities.map((entity) =>
        entity.id === lineA ? { ...entity, endPointId: pointA } : entity,
      ),
      constraints: [],
    }
    const invalidCoordinate = {
      ...fixture,
      entities: fixture.entities.map((entity) =>
        entity.id === pointA ? { ...entity, x: Number.POSITIVE_INFINITY } : entity,
      ),
      constraints: [],
    }

    expect(sketchRecordSchema.safeParse(degenerateLine).success).toBe(false)
    expect(sketchRecordSchema.safeParse(invalidCoordinate).success).toBe(false)
  })

  test("accepts a read-only external line as a constraint target", () => {
    const fixture = validSketch()
    const projectedStartPointId = "018f0000-0000-7000-8000-000000000301"
    const projectedEndPointId = "018f0000-0000-7000-8000-000000000302"
    const projectedLineId = "018f0000-0000-7000-8000-000000000303"
    const parsed = sketchRecordSchema.safeParse({
      ...fixture,
      externalReferences: [
        {
          schemaVersion: 0,
          id: "018f0000-0000-7000-8000-000000000304",
          kind: "line",
          sourceSketchId: "018f0000-0000-7000-8000-000000000305",
          sourceLineId: "018f0000-0000-7000-8000-000000000306",
          projectedLineId,
          projectedStartPointId,
          projectedEndPointId,
        },
      ],
      constraints: [
        {
          schemaVersion: 0,
          id: constraintId(204),
          type: "parallel",
          firstEntityId: lineA,
          secondEntityId: projectedLineId,
        },
      ],
    })

    expect(parsed.success).toBe(true)
  })

  test("accepts stable model vertex and line references as constraint targets", () => {
    const fixture = validSketch()
    const featureId = "018f0000-0000-7000-8000-000000000401"
    const pointId = "018f0000-0000-7000-8000-000000000402"
    const startPointId = "018f0000-0000-7000-8000-000000000403"
    const endPointId = "018f0000-0000-7000-8000-000000000404"
    const lineId = "018f0000-0000-7000-8000-000000000405"
    const signature = {
      geometryClass: "POINT",
      measure: 0,
      centroid: [0, 0, 0],
      bounds: { min: [0, 0, 0], max: [0, 0, 0] },
      boundaryCount: 0,
      adjacentGeometryClasses: [],
    } as const
    const parsed = sketchRecordSchema.safeParse({
      ...fixture,
      externalReferences: [
        {
          schemaVersion: 0,
          id: "018f0000-0000-7000-8000-000000000406",
          kind: "model-point",
          reference: {
            schemaVersion: 0,
            featureId,
            kind: "vertex",
            signature: { ...signature, kind: "vertex" },
          },
          projectedPointId: pointId,
        },
        {
          schemaVersion: 0,
          id: "018f0000-0000-7000-8000-000000000407",
          kind: "model-line",
          reference: {
            schemaVersion: 0,
            featureId,
            kind: "edge",
            signature: {
              ...signature,
              kind: "edge",
              geometryClass: "LINE",
              measure: 10,
              bounds: { min: [0, 0, 0], max: [10, 0, 0] },
              direction: [1, 0, 0],
              directionMode: "axis",
              boundaryCount: 2,
            },
          },
          projectedLineId: lineId,
          projectedStartPointId: startPointId,
          projectedEndPointId: endPointId,
        },
      ],
      constraints: [
        {
          schemaVersion: 0,
          id: constraintId(206),
          type: "parallel",
          firstEntityId: lineA,
          secondEntityId: lineId,
        },
      ],
    })

    expect(parsed.success).toBe(true)
  })

  test("accepts a read-only external curve as an associative constraint target", () => {
    const fixture = validSketch()
    const projectedCircleId = "018f0000-0000-7000-8000-000000000307"
    const projectedCenterId = "018f0000-0000-7000-8000-000000000308"
    const parsed = sketchRecordSchema.safeParse({
      ...fixture,
      externalReferences: [
        {
          schemaVersion: 0,
          id: "018f0000-0000-7000-8000-000000000309",
          kind: "curve",
          sourceSketchId: "018f0000-0000-7000-8000-000000000310",
          sourceEntityId: "018f0000-0000-7000-8000-000000000311",
          sourceType: "circle",
          projectedEntityId: projectedCircleId,
          projectedType: "circle",
          projectedPointIds: [projectedCenterId],
        },
      ],
      constraints: [
        {
          schemaVersion: 0,
          id: constraintId(205),
          type: "point-on-curve",
          pointId: pointA,
          curveId: projectedCircleId,
        },
      ],
    })

    expect(parsed.success).toBe(true)
  })
})
