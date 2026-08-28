import { describe, expect, test } from "vitest"
import { sketchWireRecordSchema } from "./sketch"

const pointA = "0195b5ac-b220-7a2c-8c33-67a36a7f3202"
const pointB = "0195b5ac-b220-7a2c-8c33-67a36a7f3203"
const lineId = "0195b5ac-b220-7a2c-8c33-67a36a7f3204"
const sketchId = "0195b5ac-b220-7a2c-8c33-67a36a7f3201"

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
})
