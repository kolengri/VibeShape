import { describe, expect, it } from "vitest"
import type { SketchConstraintId, SketchEntityId, SketchId } from "./identifiers"
import type { SketchEntity, SketchRecord } from "./sketch"
import {
  extendSketchArc,
  splitSketchArc,
  splitSketchCircle,
  trimSketchCurve,
} from "./sketch-curve-edit"
import {
  appendSketchArc,
  appendSketchCircle,
  appendSketchLine,
  createEmptySketch,
} from "./sketch-edit"

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

describe("analytical sketch curve modification", () => {
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
})
