import { describe, expect, it } from "vitest"
import type { SketchConstraintId, SketchEntityId, SketchId } from "./identifiers"
import type { SketchEntity, SketchRecord } from "./sketch"
import {
  extendSketchArc,
  extendSketchEllipticalArc,
  findSketchCurvesCrossedBySegment,
  splitSketchArc,
  splitSketchCircle,
  splitSketchEllipse,
  splitSketchEllipticalArc,
  trimSketchCurve,
} from "./sketch-curve-edit"
import {
  appendSketchArc,
  appendSketchCircle,
  appendSketchConstraint,
  appendSketchEllipse,
  appendSketchEllipticalArc,
  appendSketchLine,
  createEmptySketch,
} from "./sketch-edit"
import { createLengthQuantity } from "./units"

const sketchId = "018f0000-0000-7000-8000-000000000031" as SketchId
let nextEntityId = 1
let nextConstraintId = 1

function entityId() {
  const suffix = String(nextEntityId++).padStart(12, "0")
  return `018f0000-0000-7000-b000-${suffix}` as SketchEntityId
}

function constraintId() {
  const suffix = String(nextConstraintId++).padStart(12, "0")
  return `018f0000-0000-7000-a031-${suffix}` as SketchConstraintId
}

function empty() {
  nextEntityId = 1
  nextConstraintId = 1
  return createEmptySketch({ id: sketchId, label: "Curves", plane: "xy" })
}

function curveByType<Type extends SketchEntity["type"]>(sketch: SketchRecord, type: Type) {
  const entity = sketch.entities.find(
    (candidate): candidate is Extract<SketchEntity, { type: Type }> => candidate.type === type,
  )
  if (!entity) throw new Error(`The fixture requires a ${type} entity.`)
  return entity
}

function appendUpperBoundaries(sketch: SketchRecord) {
  const first = appendSketchLine(sketch, {
    createEntityId: entityId,
    start: { kind: "new", point: { x: 3, y: 0 } },
    end: { kind: "new", point: { x: 3, y: 6 } },
  })
  return appendSketchLine(first.sketch, {
    createEntityId: entityId,
    start: { kind: "new", point: { x: -3, y: 0 } },
    end: { kind: "new", point: { x: -3, y: 6 } },
  }).sketch
}

function appendEllipse(sketch = empty()) {
  return appendSketchEllipse(sketch, {
    center: { kind: "new", point: { x: 0, y: 0 } },
    createEntityId: entityId,
    primaryAxisPoint: { kind: "new", point: { x: 10, y: 0 } },
    secondaryRadiusPoint: { x: 0, y: 5 },
  }).sketch
}

function appendUpperEllipticalArc(sketch = empty()) {
  return appendSketchEllipticalArc(sketch, {
    center: { kind: "new", point: { x: 0, y: 0 } },
    createEntityId: entityId,
    endPoint: { kind: "new", point: { x: -10, y: 0 } },
    primaryAxisPoint: { kind: "new", point: { x: 10, y: 0 } },
    secondaryAxisPoint: { x: 0, y: 5 },
    startPoint: { kind: "new", point: { x: 10, y: 0 } },
  }).sketch
}

describe("analytical sketch curve modification", () => {
  it("queries all authored analytical curve kinds in pointer-path order", () => {
    const lineSketch = appendSketchLine(empty(), {
      createEntityId: entityId,
      start: { kind: "new", point: { x: -2, y: -4 } },
      end: { kind: "new", point: { x: -2, y: 4 } },
    }).sketch
    const line = curveByType(lineSketch, "line")
    const arcSketch = appendSketchArc(lineSketch, {
      center: { x: 0, y: 0 },
      createEntityId: entityId,
      start: { x: 5, y: 0 },
      end: { x: -5, y: 0 },
    }).sketch
    const arc = curveByType(arcSketch, "arc")
    const circleSketch = appendSketchCircle(arcSketch, {
      center: { kind: "new", point: { x: 0, y: 0 } },
      createEntityId: entityId,
      perimeterPoint: { x: 3, y: 0 },
    }).sketch
    const circle = curveByType(circleSketch, "circle")
    const ellipseSketch = appendEllipse(circleSketch)
    const ellipse = curveByType(ellipseSketch, "ellipse")
    const fixture = appendUpperEllipticalArc(ellipseSketch)
    const ellipticalArc = curveByType(fixture, "elliptical-arc")

    const hits = findSketchCurvesCrossedBySegment(fixture, { x: 0, y: -8 }, { x: 0, y: 8 })

    expect(hits.map(({ curveId }) => curveId)).toEqual([
      ellipse.id,
      circle.id,
      arc.id,
      ellipticalArc.id,
    ])
    expect(hits).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ curveId: arc.id, point: { x: 0, y: 5 } }),
        expect.objectContaining({ curveId: circle.id, point: { x: 0, y: -3 } }),
        expect.objectContaining({ curveId: ellipse.id, point: { x: 0, y: -5 } }),
        expect.objectContaining({ curveId: ellipticalArc.id, point: { x: 0, y: 5 } }),
      ]),
    )
    expect(hits.every(({ parameter }) => parameter >= 0 && parameter <= 1)).toBe(true)
    expect(findSketchCurvesCrossedBySegment(lineSketch, { x: -4, y: 0 }, { x: 0, y: 0 })).toEqual([
      expect.objectContaining({ curveId: line.id, point: { x: -2, y: 0 } }),
    ])
  })

  it("returns one tangent or endpoint hit and safely ignores degenerate paths", () => {
    const fixture = appendUpperEllipticalArc(
      appendSketchCircle(empty(), {
        center: { kind: "new", point: { x: 0, y: 0 } },
        createEntityId: entityId,
        perimeterPoint: { x: 5, y: 0 },
      }).sketch,
    )
    const circle = curveByType(fixture, "circle")
    const ellipticalArc = curveByType(fixture, "elliptical-arc")

    const tangent = findSketchCurvesCrossedBySegment(fixture, { x: -8, y: 5 }, { x: 8, y: 5 })
    expect(tangent.filter(({ curveId }) => curveId === circle.id)).toHaveLength(1)
    expect(tangent.find(({ curveId }) => curveId === circle.id)?.point).toEqual({ x: 0, y: 5 })

    const endpoint = findSketchCurvesCrossedBySegment(fixture, { x: 10, y: -1 }, { x: 10, y: 1 })
    expect(endpoint).toEqual([
      expect.objectContaining({ curveId: ellipticalArc.id, point: { x: 10, y: 0 } }),
    ])
    expect(findSketchCurvesCrossedBySegment(fixture, { x: 1, y: 1 }, { x: 1, y: 1 })).toEqual([])
  })

  it("splits an open arc at one projected point while retaining its identity", () => {
    const fixture = appendSketchArc(empty(), {
      center: { x: 0, y: 0 },
      createEntityId: entityId,
      start: { x: 5, y: 0 },
      end: { x: -5, y: 0 },
    }).sketch
    const arc = curveByType(fixture, "arc")

    const result = splitSketchArc(fixture, {
      arcId: arc.id,
      createEntityId: entityId,
      point: { x: 0, y: 7 },
    })
    const arcs = result.sketch.entities.filter((entity) => entity.type === "arc")
    const splitPoint = result.sketch.entities.find(
      ({ id }) => id === arcs.find(({ id }) => id === arc.id)?.endPointId,
    )

    expect(arcs).toHaveLength(2)
    expect(arcs.some(({ id }) => id === arc.id)).toBe(true)
    expect(splitPoint).toMatchObject({ type: "point", x: 0, y: 5 })
    expect(arcs[1]?.startPointId).toBe(splitPoint?.id)
    expect(result.sketch.constraints).toEqual([])
  })

  it("splits a closed circle at two distinct points into complementary arcs", () => {
    const fixture = appendSketchCircle(empty(), {
      center: { kind: "new", point: { x: 0, y: 0 } },
      createEntityId: entityId,
      perimeterPoint: { x: 5, y: 0 },
    }).sketch
    const circle = curveByType(fixture, "circle")

    const result = splitSketchCircle(fixture, {
      circleId: circle.id,
      createConstraintId: constraintId,
      createEntityId: entityId,
      firstPoint: { x: 7, y: 0 },
      secondPoint: { x: 0, y: 8 },
    })
    const arcs = result.sketch.entities.filter((entity) => entity.type === "arc")

    expect(result.sketch.entities.filter((entity) => entity.type === "circle")).toEqual([])
    expect(arcs).toHaveLength(2)
    expect(arcs[0]).toMatchObject({ id: circle.id })
    expect(arcs[0]?.startPointId).toBe(arcs[1]?.endPointId)
    expect(arcs[0]?.endPointId).toBe(arcs[1]?.startPointId)
    expect(arcs[0]?.centerPointId).not.toBe(arcs[1]?.centerPointId)
    expect(result.sketch.constraints).toEqual([expect.objectContaining({ type: "equal" })])
  })

  it("splits a full ellipse into complementary arcs with shared stable axes", () => {
    const fixture = appendEllipse()
    const ellipse = curveByType(fixture, "ellipse")
    const constrained = appendSketchConstraint(
      fixture,
      {
        type: "primary-axis-diameter",
        curveId: ellipse.id,
        value: createLengthQuantity(20),
      },
      constraintId,
    )

    const result = splitSketchEllipse(constrained, {
      createEntityId: entityId,
      ellipseId: ellipse.id,
      firstPoint: { x: 12, y: 0 },
      secondPoint: { x: 0, y: 8 },
    })
    const arcs = result.sketch.entities.filter((entity) => entity.type === "elliptical-arc")

    expect(result.sketch.entities.filter((entity) => entity.type === "ellipse")).toEqual([])
    expect(arcs).toHaveLength(2)
    expect(arcs[0]).toMatchObject({
      id: ellipse.id,
      centerPointId: ellipse.centerPointId,
      primaryAxisPointId: ellipse.primaryAxisPointId,
      secondaryAxisPointId: ellipse.secondaryAxisPointId,
    })
    expect(arcs[0]?.startPointId).toBe(arcs[1]?.endPointId)
    expect(arcs[0]?.endPointId).toBe(arcs[1]?.startPointId)
    expect(result.sketch.constraints).toEqual([
      expect.objectContaining({ type: "primary-axis-diameter", curveId: ellipse.id }),
    ])
  })

  it("splits an elliptical arc at one projected point while retaining its identity", () => {
    const fixture = appendUpperEllipticalArc()
    const arc = curveByType(fixture, "elliptical-arc")

    const result = splitSketchEllipticalArc(fixture, {
      arcId: arc.id,
      createEntityId: entityId,
      point: { x: 0, y: 8 },
    })
    const arcs = result.sketch.entities.filter((entity) => entity.type === "elliptical-arc")
    const retained = arcs.find(({ id }) => id === arc.id)
    const splitPoint = result.sketch.entities.find(({ id }) => id === retained?.endPointId)
    if (splitPoint?.type !== "point") throw new Error("The split must create a point entity.")

    expect(arcs).toHaveLength(2)
    expect(splitPoint.x).toBeCloseTo(0)
    expect(splitPoint.y).toBeCloseTo(5)
    expect(arcs[1]?.startPointId).toBe(splitPoint.id)
    expect(arcs[0]?.centerPointId).toBe(arcs[1]?.centerPointId)
  })

  it("trims the clicked interior arc portion between bounded intersections", () => {
    const arcFixture = appendSketchArc(empty(), {
      center: { x: 0, y: 0 },
      createEntityId: entityId,
      start: { x: 5, y: 0 },
      end: { x: -5, y: 0 },
    }).sketch
    const arc = curveByType(arcFixture, "arc")
    const fixture = appendUpperBoundaries(arcFixture)

    const result = trimSketchCurve(fixture, {
      createConstraintId: constraintId,
      createEntityId: entityId,
      curveId: arc.id,
      point: { x: 0, y: 5 },
    })

    expect(result.sketch.entities.filter((entity) => entity.type === "arc")).toHaveLength(2)
    expect(result.sketch.entities.filter((entity) => entity.type === "line")).toHaveLength(2)
    expect(result.sketch.constraints.filter(({ type }) => type === "point-on-line")).toHaveLength(2)
    expect(result.sketch.constraints.filter(({ type }) => type === "equal")).toHaveLength(1)
  })

  it("trims a circle into the complementary retained arc", () => {
    const circleFixture = appendSketchCircle(empty(), {
      center: { kind: "new", point: { x: 0, y: 0 } },
      createEntityId: entityId,
      perimeterPoint: { x: 5, y: 0 },
    }).sketch
    const circle = curveByType(circleFixture, "circle")
    const fixture = appendUpperBoundaries(circleFixture)

    const result = trimSketchCurve(fixture, {
      createConstraintId: constraintId,
      createEntityId: entityId,
      curveId: circle.id,
      point: { x: 0, y: 5 },
    })
    const retained = curveByType(result.sketch, "arc")

    expect(result.sketch.entities.filter((entity) => entity.type === "circle")).toEqual([])
    expect(retained.id).toBe(circle.id)
    expect(result.sketch.constraints.filter(({ type }) => type === "point-on-line")).toHaveLength(2)
  })

  it("trims an ellipse into the complementary retained elliptical arc", () => {
    const ellipseFixture = appendEllipse()
    const ellipse = curveByType(ellipseFixture, "ellipse")
    const fixture = appendUpperBoundaries(ellipseFixture)

    const result = trimSketchCurve(fixture, {
      createConstraintId: constraintId,
      createEntityId: entityId,
      curveId: ellipse.id,
      point: { x: 0, y: 5 },
    })
    const retained = curveByType(result.sketch, "elliptical-arc")

    expect(result.sketch.entities.filter((entity) => entity.type === "ellipse")).toEqual([])
    expect(retained.id).toBe(ellipse.id)
    expect(retained.centerPointId).toBe(ellipse.centerPointId)
    expect(result.sketch.constraints.filter(({ type }) => type === "point-on-line")).toHaveLength(2)
  })

  it("trims an elliptical-arc interior between line boundaries", () => {
    const arcFixture = appendUpperEllipticalArc()
    const arc = curveByType(arcFixture, "elliptical-arc")
    const fixture = appendUpperBoundaries(arcFixture)

    const result = trimSketchCurve(fixture, {
      createConstraintId: constraintId,
      createEntityId: entityId,
      curveId: arc.id,
      point: { x: 0, y: 5 },
    })
    const arcs = result.sketch.entities.filter((entity) => entity.type === "elliptical-arc")

    expect(arcs).toHaveLength(2)
    expect(arcs[0]?.centerPointId).toBe(arcs[1]?.centerPointId)
    expect(result.sketch.constraints.filter(({ type }) => type === "point-on-line")).toHaveLength(2)
  })

  it("uses analytical round boundaries when trimming lines and arcs", () => {
    const lineFixture = appendSketchLine(empty(), {
      createEntityId: entityId,
      start: { kind: "new", point: { x: -10, y: 0 } },
      end: { kind: "new", point: { x: 10, y: 0 } },
    }).sketch
    const line = curveByType(lineFixture, "line")
    const lineWithCircle = appendSketchCircle(lineFixture, {
      center: { kind: "new", point: { x: 0, y: 0 } },
      createEntityId: entityId,
      perimeterPoint: { x: 5, y: 0 },
    }).sketch
    const trimmedLine = trimSketchCurve(lineWithCircle, {
      createConstraintId: constraintId,
      createEntityId: entityId,
      curveId: line.id,
      point: { x: 0, y: 0 },
    }).sketch

    expect(trimmedLine.entities.filter((entity) => entity.type === "line")).toHaveLength(2)
    expect(trimmedLine.constraints.filter(({ type }) => type === "point-on-curve")).toHaveLength(2)

    const arcFixture = appendSketchArc(empty(), {
      center: { x: 0, y: 0 },
      createEntityId: entityId,
      start: { x: 5, y: 0 },
      end: { x: -5, y: 0 },
    }).sketch
    const arc = curveByType(arcFixture, "arc")
    const arcWithCircle = appendSketchCircle(arcFixture, {
      center: { kind: "new", point: { x: 0, y: 3 } },
      createEntityId: entityId,
      perimeterPoint: { x: 4, y: 3 },
    }).sketch
    const trimmedArc = trimSketchCurve(arcWithCircle, {
      createConstraintId: constraintId,
      createEntityId: entityId,
      curveId: arc.id,
      point: { x: 0, y: 5 },
    }).sketch

    expect(trimmedArc.entities.filter((entity) => entity.type === "arc")).toHaveLength(2)
    expect(trimmedArc.constraints.filter(({ type }) => type === "point-on-curve")).toHaveLength(2)
  })

  it("extends the clicked-near arc endpoint to the nearest bounded intersection", () => {
    const arcFixture = appendSketchArc(empty(), {
      center: { x: 0, y: 0 },
      createEntityId: entityId,
      start: { x: 5, y: 0 },
      end: { x: 0, y: 5 },
    }).sketch
    const arc = curveByType(arcFixture, "arc")
    const fixture = appendSketchLine(arcFixture, {
      createEntityId: entityId,
      start: { kind: "new", point: { x: -5, y: -1 } },
      end: { kind: "new", point: { x: -5, y: 1 } },
    }).sketch

    const result = extendSketchArc(fixture, {
      arcId: arc.id,
      createConstraintId: constraintId,
      createEntityId: entityId,
      point: { x: 0, y: 5 },
    })
    const extended = result.sketch.entities.find(({ id }) => id === arc.id)
    const endPoint =
      extended?.type === "arc"
        ? result.sketch.entities.find(({ id }) => id === extended.endPointId)
        : null

    expect(extended).toMatchObject({ type: "arc", id: arc.id })
    expect(endPoint).toMatchObject({ type: "point", x: -5, y: 0 })
    expect(result.sketch.constraints).toEqual([
      expect.objectContaining({ type: "point-on-line", pointId: endPoint?.id }),
    ])
  })

  it("extends an elliptical-arc endpoint to a bounded line intersection", () => {
    const arcFixture = appendSketchEllipticalArc(empty(), {
      center: { kind: "new", point: { x: 0, y: 0 } },
      createEntityId: entityId,
      endPoint: { kind: "new", point: { x: 0, y: 5 } },
      primaryAxisPoint: { kind: "new", point: { x: 10, y: 0 } },
      secondaryAxisPoint: { x: 0, y: 5 },
      startPoint: { kind: "new", point: { x: 10, y: 0 } },
    }).sketch
    const arc = curveByType(arcFixture, "elliptical-arc")
    const fixture = appendSketchLine(arcFixture, {
      createEntityId: entityId,
      start: { kind: "new", point: { x: -10, y: -1 } },
      end: { kind: "new", point: { x: -10, y: 1 } },
    }).sketch

    const result = extendSketchEllipticalArc(fixture, {
      arcId: arc.id,
      createConstraintId: constraintId,
      createEntityId: entityId,
      point: { x: 0, y: 5 },
    })
    const extended = result.sketch.entities.find(({ id }) => id === arc.id)
    const endPoint =
      extended?.type === "elliptical-arc"
        ? result.sketch.entities.find(({ id }) => id === extended.endPointId)
        : null

    expect(extended).toMatchObject({ type: "elliptical-arc", id: arc.id })
    expect(endPoint).toMatchObject({ type: "point", x: -10, y: 0 })
    expect(result.sketch.constraints).toEqual([
      expect.objectContaining({ type: "point-on-line", pointId: endPoint?.id }),
    ])
  })
})
