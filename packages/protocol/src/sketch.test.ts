import { describe, expect, test } from "vitest"
import { sketchWireRecordSchema } from "./sketch"

const pointA = "0195b5ac-b220-7a2c-8c33-67a36a7f3202"
const pointB = "0195b5ac-b220-7a2c-8c33-67a36a7f3203"
const lineId = "0195b5ac-b220-7a2c-8c33-67a36a7f3204"
const sketchId = "0195b5ac-b220-7a2c-8c33-67a36a7f3201"
const pointC = "0195b5ac-b220-7a2c-8c33-67a36a7f3205"
const pointD = "0195b5ac-b220-7a2c-8c33-67a36a7f3206"
const arcId = "0195b5ac-b220-7a2c-8c33-67a36a7f3207"

function constraintId(index: number) {
  return `0195b5ac-b220-7a2c-8c33-${String(index).padStart(12, "0")}`
}

function record(constraints: readonly unknown[]) {
  return {
    schemaVersion: 0,
    id: sketchId,
    label: "Alignment",
    plane: "xy",
    entities: [
      { schemaVersion: 0, id: pointA, type: "point", x: 0, y: 0, construction: false },
      { schemaVersion: 0, id: pointB, type: "point", x: 4, y: 2, construction: false },
      {
        schemaVersion: 0,
        id: lineId,
        type: "line",
        startPointId: pointA,
        endPointId: pointB,
        construction: false,
      },
    ],
    constraints,
  }
}

function arcRecord(constraints: readonly unknown[]) {
  return {
    ...record(constraints),
    entities: [
      { schemaVersion: 0, id: pointA, type: "point", x: 0, y: 0, construction: false },
      { schemaVersion: 0, id: pointB, type: "point", x: 10, y: 0, construction: false },
      { schemaVersion: 0, id: pointC, type: "point", x: 0, y: 10, construction: false },
      { schemaVersion: 0, id: pointD, type: "point", x: 7, y: 7, construction: false },
      {
        schemaVersion: 0,
        id: arcId,
        type: "arc",
        centerPointId: pointA,
        startPointId: pointB,
        endPointId: pointC,
        construction: false,
      },
    ],
  }
}

describe("sketch alignment wire constraints", () => {
  test("round-trips horizontal-points and vertical-points", () => {
    const input = record([
      {
        schemaVersion: 0,
        id: "0195b5ac-b220-7a2c-8c33-67a36a7f3301",
        type: "horizontal-points",
        firstPointId: pointA,
        secondPointId: pointB,
      },
      {
        schemaVersion: 0,
        id: "0195b5ac-b220-7a2c-8c33-67a36a7f3302",
        type: "vertical-points",
        firstPointId: pointA,
        secondPointId: pointB,
      },
    ])
    const parsed = sketchWireRecordSchema.parse(input)
    expect(parsed.constraints).toEqual(input.constraints)
  })

  test("rejects self and non-point references", () => {
    expect(
      sketchWireRecordSchema.safeParse(
        record([
          {
            schemaVersion: 0,
            id: "0195b5ac-b220-7a2c-8c33-67a36a7f3303",
            type: "horizontal-points",
            firstPointId: pointA,
            secondPointId: pointA,
          },
        ]),
      ).success,
    ).toBe(false)
    expect(
      sketchWireRecordSchema.safeParse(
        record([
          {
            schemaVersion: 0,
            id: "0195b5ac-b220-7a2c-8c33-67a36a7f3304",
            type: "vertical-points",
            firstPointId: pointA,
            secondPointId: lineId,
          },
        ]),
      ).success,
    ).toBe(false)
  })

  test("reserves native constraints and auxiliary entities for arc midpoint intent", () => {
    const constraints = Array.from({ length: 5_001 }, (_, index) => ({
      schemaVersion: 0,
      id: constraintId(index + 1),
      type: "arc-midpoint",
      pointId: pointD,
      arcId,
    }))
    const nativeConstraintOverflow = sketchWireRecordSchema.safeParse(arcRecord(constraints))
    const atEntityLimit = sketchWireRecordSchema.safeParse(arcRecord(constraints.slice(0, 2_496)))
    const entityOverflow = sketchWireRecordSchema.safeParse(arcRecord(constraints.slice(0, 2_497)))

    expect(atEntityLimit.success).toBe(true)
    expect(nativeConstraintOverflow.success).toBe(false)
    expect(entityOverflow.success).toBe(false)
    if (nativeConstraintOverflow.success || entityOverflow.success) return
    expect(nativeConstraintOverflow.error.issues).toContainEqual(
      expect.objectContaining({
        path: ["constraints"],
        message: "Sketch constraints exceed the native solver safety limit.",
      }),
    )
    expect(entityOverflow.error.issues).toContainEqual(
      expect.objectContaining({
        path: ["entities"],
        message: "Sketch entities exceed the native solver safety limit.",
      }),
    )
  })
})
