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
        type: "point-on-line",
        pointId: pointC,
        lineId: lineA,
      },
      {
        schemaVersion: 0,
        id: constraintId(110),
        type: "point-on-curve",
        pointId: pointD,
        curveId: circle,
      },
      { schemaVersion: 0, id: constraintId(111), type: "fixed", pointId: pointA },
      {
        schemaVersion: 0,
        id: constraintId(112),
        type: "horizontal-distance",
        firstPointId: pointA,
        secondPointId: pointB,
        value: createLengthQuantity(20),
      },
      {
        schemaVersion: 0,
        id: constraintId(113),
        type: "vertical-distance",
        firstPointId: pointA,
        secondPointId: pointC,
        value: createLengthQuantity(20),
      },
      {
        schemaVersion: 0,
        id: constraintId(114),
        type: "distance",
        firstPointId: pointA,
        secondPointId: pointD,
        value: createLengthQuantity(28.2842712474619),
      },
      {
        schemaVersion: 0,
        id: constraintId(115),
        type: "angle",
        firstEntityId: lineA,
        secondEntityId: lineB,
        value: createAngleQuantity(90, "deg"),
      },
      {
        schemaVersion: 0,
        id: constraintId(116),
        type: "radius",
        curveId: circle,
        value: createLengthQuantity(5),
      },
      {
        schemaVersion: 0,
        id: constraintId(117),
        type: "diameter",
        curveId: arc,
        value: createLengthQuantity(40),
      },
    ],
  } as const
}

describe("sketchRecordSchema", () => {
  test("accepts analytical P0 entities, construction state, and every P0 constraint family", () => {
    const parsed = sketchRecordSchema.parse(validSketch())

    expect(parsed.entities).toHaveLength(8)
    expect(parsed.constraints.map((constraint) => constraint.type)).toEqual([
      "coincident",
      "horizontal",
      "vertical",
      "parallel",
      "perpendicular",
      "equal",
      "tangent",
      "concentric",
      "point-on-line",
      "point-on-curve",
      "fixed",
      "horizontal-distance",
      "vertical-distance",
      "distance",
      "angle",
      "radius",
      "diameter",
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
    const missingEntityTarget = {
      ...fixture,
      entities: fixture.entities.filter((entity) => entity.id !== pointB),
      constraints: [],
    }

    expect(sketchRecordSchema.safeParse(duplicate).success).toBe(false)
    expect(sketchRecordSchema.safeParse(wrongConstraintTarget).success).toBe(false)
    expect(sketchRecordSchema.safeParse(missingEntityTarget).success).toBe(false)
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
})
