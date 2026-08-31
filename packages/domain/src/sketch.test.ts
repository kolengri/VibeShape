import { describe, expect, test } from "vitest"
import {
  isOrphanedModelReference,
  isReferenceSketchDimension,
  isSketchExternalModelReference,
  sketchRecordSchema,
} from "./sketch"
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

  test("accepts stable model point, line, and curve references as constraint targets", () => {
    const fixture = validSketch()
    const featureId = "018f0000-0000-7000-8000-000000000401"
    const pointId = "018f0000-0000-7000-8000-000000000402"
    const startPointId = "018f0000-0000-7000-8000-000000000403"
    const endPointId = "018f0000-0000-7000-8000-000000000404"
    const lineId = "018f0000-0000-7000-8000-000000000405"
    const circleId = "018f0000-0000-7000-8000-000000000408"
    const centerId = "018f0000-0000-7000-8000-000000000409"
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
        {
          schemaVersion: 0,
          id: "018f0000-0000-7000-8000-000000000410",
          kind: "model-curve",
          reference: {
            schemaVersion: 0,
            featureId,
            kind: "edge",
            signature: {
              ...signature,
              kind: "edge",
              geometryClass: "CIRCLE",
              measure: Math.PI * 10,
            },
          },
          sourceType: "circle",
          projectedEntityId: circleId,
          projectedType: "circle",
          projectedPointIds: [centerId],
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
        {
          schemaVersion: 0,
          id: constraintId(207),
          type: "point-on-curve",
          pointId: pointA,
          curveId: circleId,
        },
      ],
    })

    expect(parsed.success).toBe(true)
  })

  test("treats live and orphaned model Pierce points as model-owned point geometry", () => {
    const featureId = "018f0000-0000-7000-8000-000000000417"
    const projectedPointId = "018f0000-0000-7000-8000-000000000418"
    const live = {
      schemaVersion: 0,
      id: "018f0000-0000-7000-8000-000000000419",
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
      projectedPointId,
    } as const
    const parsed = sketchRecordSchema.parse({
      ...validSketch(),
      externalReferences: [live],
      constraints: [
        {
          schemaVersion: 0,
          id: constraintId(208),
          type: "coincident",
          firstPointId: pointA,
          secondPointId: projectedPointId,
        },
      ],
    })
    const reference = parsed.externalReferences?.[0]
    expect(reference && isSketchExternalModelReference(reference)).toBe(true)
    expect(reference && isOrphanedModelReference(reference)).toBe(false)

    const orphaned = sketchRecordSchema.parse({
      ...validSketch(),
      externalReferences: [
        {
          ...live,
          schemaVersion: 1,
          orphanedSource: { kind: "deleted-feature", featureId },
        },
      ],
    }).externalReferences?.[0]
    expect(orphaned && isSketchExternalModelReference(orphaned)).toBe(true)
    expect(orphaned && isOrphanedModelReference(orphaned)).toBe(true)
  })

  test("accepts elliptical model curves and rejects topology-class drift", () => {
    const reference = {
      schemaVersion: 0,
      id: "018f0000-0000-7000-8000-000000000411",
      kind: "model-curve",
      reference: {
        schemaVersion: 0,
        featureId: "018f0000-0000-7000-8000-000000000412",
        kind: "edge",
        semanticRole: "extrusion.side.ellipse",
        signature: {
          kind: "edge",
          geometryClass: "ELLIPSE",
          measure: 25.5,
          centroid: [0, 0, 0],
          bounds: { min: [-5, -3, 0], max: [5, 3, 0] },
          boundaryCount: 0,
          adjacentGeometryClasses: [],
        },
      },
      sourceType: "ellipse",
      projectedEntityId: "018f0000-0000-7000-8000-000000000413",
      projectedType: "ellipse",
      projectedPointIds: [
        "018f0000-0000-7000-8000-000000000414",
        "018f0000-0000-7000-8000-000000000415",
        "018f0000-0000-7000-8000-000000000416",
      ],
    } as const

    expect(
      sketchRecordSchema.safeParse({ ...validSketch(), externalReferences: [reference] }).success,
    ).toBe(true)
    expect(
      sketchRecordSchema.safeParse({
        ...validSketch(),
        externalReferences: [
          {
            ...reference,
            reference: {
              ...reference.reference,
              signature: { ...reference.reference.signature, geometryClass: "CIRCLE" },
            },
          },
        ],
      }).success,
    ).toBe(false)
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

  test("accepts an associative Pierce point as a coincident constraint target", () => {
    const projectedPointId = "018f0000-0000-7000-8000-000000000317"
    const reference = {
      schemaVersion: 0,
      id: "018f0000-0000-7000-8000-000000000318",
      kind: "pierce-point",
      sourceSketchId: "018f0000-0000-7000-8000-000000000319",
      sourceLineId: "018f0000-0000-7000-8000-000000000320",
      projectedPointId,
    } as const
    const parsed = sketchRecordSchema.safeParse({
      ...validSketch(),
      externalReferences: [reference],
      constraints: [
        ...validSketch().constraints,
        {
          schemaVersion: 0,
          id: constraintId(206),
          type: "coincident",
          firstPointId: pointA,
          secondPointId: projectedPointId,
        },
      ],
    })

    expect(parsed.success).toBe(true)
    expect(
      sketchRecordSchema.safeParse({
        ...validSketch(),
        externalReferences: [{ ...reference, sourceLineId: undefined }],
      }).success,
    ).toBe(false)
  })

  test("accepts point alignment constraints and rejects self or non-point references", () => {
    const fixture = validSketch()
    const valid = sketchRecordSchema.safeParse({
      ...fixture,
      constraints: [
        {
          schemaVersion: 0,
          id: constraintId(300),
          type: "horizontal-points",
          firstPointId: pointA,
          secondPointId: pointB,
        },
        {
          schemaVersion: 0,
          id: constraintId(301),
          type: "vertical-points",
          firstPointId: pointA,
          secondPointId: pointC,
        },
      ],
    })
    expect(valid.success).toBe(true)
    expect(
      sketchRecordSchema.safeParse({
        ...fixture,
        constraints: [
          {
            schemaVersion: 0,
            id: constraintId(302),
            type: "horizontal-points",
            firstPointId: pointA,
            secondPointId: pointA,
          },
        ],
      }).success,
    ).toBe(false)
    expect(
      sketchRecordSchema.safeParse({
        ...fixture,
        constraints: [
          {
            schemaVersion: 0,
            id: constraintId(303),
            type: "vertical-points",
            firstPointId: pointA,
            secondPointId: lineA,
          },
        ],
      }).success,
    ).toBe(false)
  })

  test("accepts arc midpoint intent only for point and arc targets", () => {
    const fixture = validSketch()
    expect(
      sketchRecordSchema.safeParse({
        ...fixture,
        constraints: [
          {
            schemaVersion: 0,
            id: constraintId(310),
            type: "arc-midpoint",
            pointId: pointD,
            arcId: arc,
          },
        ],
      }).success,
    ).toBe(true)
    expect(
      sketchRecordSchema.safeParse({
        ...fixture,
        constraints: [
          {
            schemaVersion: 0,
            id: constraintId(311),
            type: "arc-midpoint",
            pointId: pointD,
            arcId: circle,
          },
        ],
      }).success,
    ).toBe(false)
  })

  test("accepts ellipse quadrant intent only for point and full ellipse targets", () => {
    const fixture = validSketch()
    expect(
      sketchRecordSchema.safeParse({
        ...fixture,
        constraints: [
          {
            schemaVersion: 0,
            id: constraintId(312),
            type: "ellipse-quadrant",
            pointId: pointD,
            ellipseId: ellipse,
            axis: "secondary",
            side: "positive",
          },
        ],
      }).success,
    ).toBe(true)
    expect(
      sketchRecordSchema.safeParse({
        ...fixture,
        constraints: [
          {
            schemaVersion: 0,
            id: constraintId(313),
            type: "ellipse-quadrant",
            pointId: pointD,
            ellipseId: circle,
            axis: "primary",
            side: "negative",
          },
        ],
      }).success,
    ).toBe(false)
  })

  test("accepts point-on-ellipse only for full ellipse targets", () => {
    const fixture = validSketch()
    expect(
      sketchRecordSchema.safeParse({
        ...fixture,
        constraints: [
          {
            schemaVersion: 0,
            id: constraintId(314),
            type: "point-on-ellipse",
            pointId: pointD,
            ellipseId: ellipse,
          },
        ],
      }).success,
    ).toBe(true)
    expect(
      sketchRecordSchema.safeParse({
        ...fixture,
        constraints: [
          {
            schemaVersion: 0,
            id: constraintId(315),
            type: "point-on-ellipse",
            pointId: pointD,
            ellipseId: circle,
          },
        ],
      }).success,
    ).toBe(false)
  })

  test("accepts point-on-elliptical-arc only for bounded elliptical-arc targets", () => {
    const ellipticalArc = "018f0000-0000-7000-8000-000000000011"
    const pointE = "018f0000-0000-7000-8000-000000000012"
    const fixture = validSketch()
    const boundedFixture = {
      ...fixture,
      entities: [
        ...fixture.entities,
        {
          schemaVersion: 0,
          id: pointE,
          type: "point" as const,
          x: -20,
          y: 20,
          construction: false,
        },
        {
          schemaVersion: 0,
          id: ellipticalArc,
          type: "elliptical-arc" as const,
          centerPointId: pointA,
          primaryAxisPointId: pointB,
          secondaryAxisPointId: pointC,
          startPointId: pointD,
          endPointId: pointE,
          construction: false,
        },
      ],
    }
    const constraint = {
      schemaVersion: 0,
      id: constraintId(316),
      type: "point-on-elliptical-arc" as const,
      pointId: pointD,
      ellipticalArcId: ellipticalArc,
    }

    expect(
      sketchRecordSchema.safeParse({ ...boundedFixture, constraints: [constraint] }).success,
    ).toBe(true)
    expect(
      sketchRecordSchema.safeParse({
        ...fixture,
        constraints: [{ ...constraint, ellipticalArcId: ellipse }],
      }).success,
    ).toBe(false)
    expect(
      sketchRecordSchema.safeParse({
        ...boundedFixture,
        constraints: [{ ...constraint, ellipticalArcId: arc }],
      }).success,
    ).toBe(false)
  })

  test("reserves native solver capacity for point-on-elliptical-arc intent", () => {
    const ellipticalArc = "018f0000-0000-7000-8000-000000000011"
    const pointE = "018f0000-0000-7000-8000-000000000012"
    const fixture = validSketch()
    const entities = [
      ...[pointA, pointB, pointC, pointD, pointE, ellipticalArc]
        .map((id) =>
          id === pointE
            ? {
                schemaVersion: 0,
                id: pointE,
                type: "point" as const,
                x: -20,
                y: 20,
                construction: false,
              }
            : fixture.entities.find((entity) => entity.id === id),
        )
        .filter((entity): entity is NonNullable<typeof entity> => entity !== undefined),
      {
        schemaVersion: 0,
        id: ellipticalArc,
        type: "elliptical-arc" as const,
        centerPointId: pointA,
        primaryAxisPointId: pointB,
        secondaryAxisPointId: pointC,
        startPointId: pointD,
        endPointId: pointE,
        construction: false,
      },
    ]
    const constraints = Array.from({ length: 2_001 }, (_, index) => ({
      schemaVersion: 0,
      id: constraintId(21_000 + index),
      type: "point-on-elliptical-arc" as const,
      pointId: pointD,
      ellipticalArcId: ellipticalArc,
    }))
    const atEntityLimit = sketchRecordSchema.safeParse({
      ...fixture,
      entities,
      constraints: constraints.slice(0, 1_245),
    })
    const entityOverflow = sketchRecordSchema.safeParse({
      ...fixture,
      entities,
      constraints: constraints.slice(0, 1_246),
    })
    const constraintOverflow = sketchRecordSchema.safeParse({
      ...fixture,
      entities,
      constraints,
    })
    expect(atEntityLimit.success).toBe(true)
    expect(entityOverflow.success).toBe(false)
    expect(constraintOverflow.success).toBe(false)
    if (constraintOverflow.success) return
    expect(constraintOverflow.error.issues).toContainEqual(
      expect.objectContaining({
        path: ["constraints"],
        message: "Sketch constraints exceed the native solver safety limit.",
      }),
    )
  })

  test("reserves native solver capacity for point-on-ellipse intent", () => {
    const fixture = validSketch()
    const constraints = Array.from({ length: 2_001 }, (_, index) => ({
      schemaVersion: 0,
      id: constraintId(20_000 + index),
      type: "point-on-ellipse" as const,
      pointId: pointD,
      ellipseId: ellipse,
    }))
    const ellipseEntities = fixture.entities.filter(({ id }) =>
      [pointA, pointB, pointC, pointD, ellipse].includes(id),
    )
    const atEntityLimit = sketchRecordSchema.safeParse({
      ...fixture,
      entities: ellipseEntities,
      constraints: constraints.slice(0, 1_247),
    })
    const entityOverflow = sketchRecordSchema.safeParse({
      ...fixture,
      entities: ellipseEntities,
      constraints: constraints.slice(0, 1_248),
    })
    const constraintOverflow = sketchRecordSchema.safeParse({
      ...fixture,
      entities: ellipseEntities,
      constraints,
    })

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

  test("reserves native solver constraints for arc midpoint intent", () => {
    const fixture = validSketch()
    const result = sketchRecordSchema.safeParse({
      ...fixture,
      constraints: Array.from({ length: 5_001 }, (_, index) => ({
        schemaVersion: 0,
        id: constraintId(1_000 + index),
        type: "arc-midpoint",
        pointId: pointD,
        arcId: arc,
      })),
    })

    expect(result.success).toBe(false)
    if (result.success) return
    expect(result.error.issues).toContainEqual(
      expect.objectContaining({
        path: ["constraints"],
        message: "Sketch constraints exceed the native solver safety limit.",
      }),
    )
  })

  test("reserves native solver entities for arc midpoint auxiliary lines", () => {
    const fixture = validSketch()
    const constraints = Array.from({ length: 2_497 }, (_, index) => ({
      schemaVersion: 0,
      id: constraintId(1_000 + index),
      type: "arc-midpoint" as const,
      pointId: pointD,
      arcId: arc,
    }))
    const atLimit = sketchRecordSchema.safeParse({
      ...fixture,
      entities: fixture.entities.filter(({ id }) =>
        [pointA, pointB, pointC, pointD, arc].includes(id),
      ),
      constraints: constraints.slice(0, 2_496),
    })
    const overLimit = sketchRecordSchema.safeParse({
      ...fixture,
      entities: fixture.entities.filter(({ id }) =>
        [pointA, pointB, pointC, pointD, arc].includes(id),
      ),
      constraints,
    })

    expect(atLimit.success).toBe(true)
    expect(overLimit.success).toBe(false)
    if (overLimit.success) return
    expect(overLimit.error.issues).toContainEqual(
      expect.objectContaining({
        path: ["entities"],
        message: "Sketch entities exceed the native solver safety limit.",
      }),
    )
  })

  test("reserves native solver capacity for ellipse quadrant intent", () => {
    const fixture = validSketch()
    const constraints = Array.from({ length: 1_667 }, (_, index) => ({
      schemaVersion: 0,
      id: constraintId(10_000 + index),
      type: "ellipse-quadrant" as const,
      pointId: pointD,
      ellipseId: ellipse,
      axis: "primary" as const,
      side: "negative" as const,
    }))
    const ellipseEntities = fixture.entities.filter(({ id }) =>
      [pointA, pointB, pointC, pointD, ellipse].includes(id),
    )
    const atEntityLimit = sketchRecordSchema.safeParse({
      ...fixture,
      entities: ellipseEntities,
      constraints: constraints.slice(0, 1_247),
    })
    const entityOverflow = sketchRecordSchema.safeParse({
      ...fixture,
      entities: ellipseEntities,
      constraints: constraints.slice(0, 1_248),
    })
    const constraintOverflow = sketchRecordSchema.safeParse({
      ...fixture,
      entities: ellipseEntities,
      constraints,
    })

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

  test("accepts supported reference dimensions without a measured value", () => {
    const fixture = validSketch()
    const references = [
      { type: "horizontal-distance", firstPointId: pointA, secondPointId: pointB },
      { type: "vertical-distance", firstPointId: pointA, secondPointId: pointC },
      { type: "distance", firstPointId: pointA, secondPointId: pointD },
      { type: "angle", firstEntityId: lineA, secondEntityId: lineB },
      { type: "radius", curveId: circle },
      { type: "diameter", curveId: arc },
    ]
    const parsed = sketchRecordSchema.parse({
      ...fixture,
      constraints: references.map((reference, index) => ({
        schemaVersion: 0,
        id: constraintId(30_000 + index),
        mode: "reference",
        ...reference,
      })),
    })

    expect(parsed.constraints).toHaveLength(references.length)
    expect(parsed.constraints.every(isReferenceSketchDimension)).toBe(true)
    expect(
      sketchRecordSchema.safeParse({
        ...fixture,
        constraints: [
          {
            schemaVersion: 0,
            id: constraintId(31_000),
            type: "distance",
            firstPointId: pointA,
            secondPointId: pointB,
            mode: "reference",
            value: createLengthQuantity(20),
          },
        ],
      }).success,
    ).toBe(false)
  })
})
