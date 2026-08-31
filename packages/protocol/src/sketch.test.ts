import { describe, expect, test } from "vitest"
import { sketchWireRecordSchema } from "./sketch"

const pointA = "0195b5ac-b220-7a2c-8c33-67a36a7f3202"
const pointB = "0195b5ac-b220-7a2c-8c33-67a36a7f3203"
const lineId = "0195b5ac-b220-7a2c-8c33-67a36a7f3204"
const sketchId = "0195b5ac-b220-7a2c-8c33-67a36a7f3201"
const pointC = "0195b5ac-b220-7a2c-8c33-67a36a7f3205"
const pointD = "0195b5ac-b220-7a2c-8c33-67a36a7f3206"
const arcId = "0195b5ac-b220-7a2c-8c33-67a36a7f3207"
const ellipseId = "0195b5ac-b220-7a2c-8c33-67a36a7f3208"
const ellipticalArcId = "0195b5ac-b220-7a2c-8c33-67a36a7f3209"

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

function ellipseRecord(constraints: readonly unknown[]) {
  return {
    ...record(constraints),
    entities: [
      { schemaVersion: 0, id: pointA, type: "point", x: 0, y: 0, construction: false },
      { schemaVersion: 0, id: pointB, type: "point", x: 10, y: 0, construction: false },
      { schemaVersion: 0, id: pointC, type: "point", x: 0, y: 5, construction: false },
      { schemaVersion: 0, id: pointD, type: "point", x: -10, y: 0, construction: false },
      {
        schemaVersion: 0,
        id: ellipseId,
        type: "ellipse",
        centerPointId: pointA,
        primaryAxisPointId: pointB,
        secondaryAxisPointId: pointC,
        construction: false,
      },
    ],
  }
}

function ellipticalArcRecord(constraints: readonly unknown[]) {
  return {
    ...ellipseRecord(constraints),
    entities: [
      { schemaVersion: 0, id: pointA, type: "point", x: 0, y: 0, construction: false },
      { schemaVersion: 0, id: pointB, type: "point", x: 10, y: 0, construction: false },
      { schemaVersion: 0, id: pointC, type: "point", x: 0, y: 5, construction: false },
      { schemaVersion: 0, id: pointD, type: "point", x: -10, y: 0, construction: false },
      {
        schemaVersion: 0,
        id: ellipticalArcId,
        type: "elliptical-arc",
        centerPointId: pointA,
        primaryAxisPointId: pointB,
        secondaryAxisPointId: pointC,
        startPointId: pointC,
        endPointId: pointD,
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

  test("round-trips ellipse quadrant intent and reserves its native capacity", () => {
    const quadrant = {
      schemaVersion: 0,
      id: constraintId(6_000),
      type: "ellipse-quadrant",
      pointId: pointD,
      ellipseId,
      axis: "primary",
      side: "negative",
    }
    const parsed = sketchWireRecordSchema.safeParse(ellipseRecord([quadrant]))
    expect(parsed.success).toBe(true)
    if (parsed.success) expect(parsed.data.constraints).toEqual([quadrant])

    const constraints = Array.from({ length: 1_667 }, (_, index) => ({
      ...quadrant,
      id: constraintId(7_000 + index),
    }))
    const atEntityLimit = sketchWireRecordSchema.safeParse(
      ellipseRecord(constraints.slice(0, 1_247)),
    )
    const entityOverflow = sketchWireRecordSchema.safeParse(
      ellipseRecord(constraints.slice(0, 1_248)),
    )
    const constraintOverflow = sketchWireRecordSchema.safeParse(ellipseRecord(constraints))

    expect(atEntityLimit.success).toBe(true)
    expect(entityOverflow.success).toBe(false)
    expect(constraintOverflow.success).toBe(false)
    if (entityOverflow.success || constraintOverflow.success) return
    expect(entityOverflow.error.issues).toContainEqual(
      expect.objectContaining({
        path: ["entities"],
        message: "Sketch entities exceed the native solver safety limit.",
      }),
    )
    expect(constraintOverflow.error.issues).toContainEqual(
      expect.objectContaining({
        path: ["constraints"],
        message: "Sketch constraints exceed the native solver safety limit.",
      }),
    )
  })

  test("round-trips point-on-ellipse and rejects non-ellipse targets", () => {
    const constraint = {
      schemaVersion: 0,
      id: constraintId(6_001),
      type: "point-on-ellipse",
      pointId: pointD,
      ellipseId,
    }
    const parsed = sketchWireRecordSchema.safeParse(ellipseRecord([constraint]))
    expect(parsed.success).toBe(true)
    if (parsed.success) expect(parsed.data.constraints).toEqual([constraint])
    expect(
      sketchWireRecordSchema.safeParse(record([{ ...constraint, ellipseId: arcId }])).success,
    ).toBe(false)

    const constraints = Array.from({ length: 2_001 }, (_, index) => ({
      ...constraint,
      id: constraintId(20_000 + index),
    }))
    const atEntityLimit = sketchWireRecordSchema.safeParse(
      ellipseRecord(constraints.slice(0, 1_247)),
    )
    const entityOverflow = sketchWireRecordSchema.safeParse(
      ellipseRecord(constraints.slice(0, 1_248)),
    )
    const constraintOverflow = sketchWireRecordSchema.safeParse(ellipseRecord(constraints))
    expect(atEntityLimit.success).toBe(true)
    expect(entityOverflow.success).toBe(false)
    expect(constraintOverflow.success).toBe(false)
  })

  test("round-trips live and orphaned model Pierce point references", () => {
    const featureId = "0195b5ac-b220-7a2c-8c33-67a36a7f3250"
    const reference = {
      schemaVersion: 0,
      id: "0195b5ac-b220-7a2c-8c33-67a36a7f3251",
      kind: "model-pierce-point",
      reference: {
        schemaVersion: 0,
        featureId,
        kind: "edge",
        semanticRole: "primitive.box.edge.crossing",
        signature: {
          kind: "edge",
          geometryClass: "LINE",
          measure: 10,
          centroid: [0, 0, 0],
          bounds: { min: [-5, 0, -5], max: [5, 0, 5] },
          direction: [Math.SQRT1_2, 0, Math.SQRT1_2],
          directionMode: "axis",
          boundaryCount: 2,
          adjacentGeometryClasses: [],
        },
      },
      projectedPointId: "0195b5ac-b220-7a2c-8c33-67a36a7f3252",
    } as const
    const live = sketchWireRecordSchema.safeParse({
      ...record([
        {
          schemaVersion: 0,
          id: constraintId(6_003),
          type: "coincident",
          firstPointId: pointA,
          secondPointId: reference.projectedPointId,
        },
      ]),
      externalReferences: [reference],
    })
    expect(live.success).toBe(true)
    if (live.success) expect(live.data.externalReferences).toEqual([reference])

    const orphaned = sketchWireRecordSchema.safeParse({
      ...record([]),
      externalReferences: [
        {
          ...reference,
          schemaVersion: 1,
          orphanedSource: { kind: "deleted-feature", featureId },
        },
      ],
    })
    expect(orphaned.success).toBe(true)
  })

  test("round-trips point-on-elliptical-arc and rejects full ellipse or round targets", () => {
    const constraint = {
      schemaVersion: 0,
      id: constraintId(6_002),
      type: "point-on-elliptical-arc",
      pointId: pointD,
      ellipticalArcId,
    }
    const parsed = sketchWireRecordSchema.safeParse(ellipticalArcRecord([constraint]))
    expect(parsed.success).toBe(true)
    if (parsed.success) expect(parsed.data.constraints).toEqual([constraint])
    expect(
      sketchWireRecordSchema.safeParse(
        ellipseRecord([{ ...constraint, ellipticalArcId: ellipseId }]),
      ).success,
    ).toBe(false)
    expect(
      sketchWireRecordSchema.safeParse(record([{ ...constraint, ellipticalArcId: arcId }])).success,
    ).toBe(false)

    const constraints = Array.from({ length: 2_001 }, (_, index) => ({
      ...constraint,
      id: constraintId(22_000 + index),
    }))
    expect(
      sketchWireRecordSchema.safeParse(ellipticalArcRecord(constraints.slice(0, 1_245))).success,
    ).toBe(true)
    expect(
      sketchWireRecordSchema.safeParse(ellipticalArcRecord(constraints.slice(0, 1_246))).success,
    ).toBe(false)
    const constraintOverflow = sketchWireRecordSchema.safeParse(ellipticalArcRecord(constraints))
    expect(constraintOverflow.success).toBe(false)
    if (constraintOverflow.success) return
    expect(constraintOverflow.error.issues).toContainEqual(
      expect.objectContaining({
        path: ["constraints"],
        message: "Sketch constraints exceed the native solver safety limit.",
      }),
    )
  })

  test("accepts supported reference dimensions and rejects value tampering", () => {
    const pointConstraints = [
      {
        schemaVersion: 0,
        id: constraintId(30_001),
        type: "horizontal-distance",
        firstPointId: pointA,
        secondPointId: pointB,
        mode: "reference",
      },
      {
        schemaVersion: 0,
        id: constraintId(30_002),
        type: "vertical-distance",
        firstPointId: pointA,
        secondPointId: pointB,
        mode: "reference",
      },
      {
        schemaVersion: 0,
        id: constraintId(30_003),
        type: "distance",
        firstPointId: pointA,
        secondPointId: pointB,
        mode: "reference",
      },
    ]
    expect(sketchWireRecordSchema.safeParse(record(pointConstraints)).success).toBe(true)
    expect(
      sketchWireRecordSchema.safeParse(
        arcRecord([
          {
            schemaVersion: 0,
            id: constraintId(30_004),
            type: "radius",
            curveId: arcId,
            mode: "reference",
          },
          {
            schemaVersion: 0,
            id: constraintId(30_005),
            type: "diameter",
            curveId: arcId,
            mode: "reference",
          },
        ]),
      ).success,
    ).toBe(true)
    const twoLineRecord = record([
      {
        schemaVersion: 0,
        id: constraintId(30_006),
        type: "angle",
        firstEntityId: lineId,
        secondEntityId: constraintId(30_007),
        mode: "reference",
      },
    ])
    twoLineRecord.entities.push({
      schemaVersion: 0,
      id: constraintId(30_007),
      type: "line",
      startPointId: pointA,
      endPointId: pointB,
      construction: true,
    })
    expect(sketchWireRecordSchema.safeParse(twoLineRecord).success).toBe(true)
    expect(
      sketchWireRecordSchema.safeParse(
        record([
          {
            ...pointConstraints[0],
            value: {
              schemaVersion: 0,
              dimension: "length",
              value: 1,
              unit: "mm",
              source: { value: 1, unit: "mm", expression: null },
            },
          },
        ]),
      ).success,
    ).toBe(false)
  })
})
