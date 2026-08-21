import { describe, expect, it } from "vitest"
import type { SketchConstraintId, SketchEntityId, SketchId } from "./identifiers"
import type { SketchEntity, SketchRecord } from "./sketch"
import {
  appendSketchArc,
  appendSketchCircle,
  appendSketchConstraint,
  appendSketchEllipse,
  appendSketchLine,
  createEmptySketch,
} from "./sketch-edit"
import {
  mirrorSketchEntities,
  reflectSketchPoint,
  sketchEntityTransformOrigin,
  transformSketchEntities,
} from "./sketch-transform-edit"
import { createLengthQuantity } from "./units"

const sketchId = "018f0000-0000-7000-8000-000000000041" as SketchId
let nextEntityId = 1
let nextConstraintId = 1

function entityId() {
  const suffix = String(nextEntityId++).padStart(12, "0")
  return `018f0000-0000-7000-b041-${suffix}` as SketchEntityId
}

function constraintId() {
  const suffix = String(nextConstraintId++).padStart(12, "0")
  return `018f0000-0000-7000-a041-${suffix}` as SketchConstraintId
}

function empty() {
  nextEntityId = 1
  nextConstraintId = 1
  return createEmptySketch({ id: sketchId, label: "Transforms", plane: "xy" })
}

function entityById<Type extends SketchEntity["type"]>(
  sketch: SketchRecord,
  entityId: SketchEntityId,
  type: Type,
) {
  const entity = sketch.entities.find(
    (candidate): candidate is Extract<SketchEntity, { type: Type }> =>
      candidate.id === entityId && candidate.type === type,
  )
  if (!entity) throw new Error(`The fixture requires a ${type} entity.`)
  return entity
}

function lastCreatedCurve<Type extends Exclude<SketchEntity["type"], "point">>(
  result: ReturnType<typeof appendSketchLine>,
  type: Type,
) {
  const id = result.createdEntityIds.at(-1)
  if (!id) throw new Error("The fixture must create a curve.")
  return entityById(result.sketch, id, type)
}

describe("analytical sketch transforms", () => {
  it("reflects a point across horizontal and diagonal axes", () => {
    expect(reflectSketchPoint({ x: 2, y: 3 }, { x: -4, y: 0 }, { x: 6, y: 0 })).toEqual({
      x: 2,
      y: -3,
    })
    expect(reflectSketchPoint({ x: 4, y: 1 }, { x: 0, y: 0 }, { x: 2, y: 2 })).toEqual({
      x: 1,
      y: 4,
    })
    expect(() => reflectSketchPoint({ x: 1, y: 1 }, { x: 0, y: 0 }, { x: 0, y: 0 })).toThrow(
      "non-degenerate",
    )
  })

  it("mirrors connected lines once per shared point and preserves the source graph", () => {
    const axisResult = appendSketchLine(empty(), {
      construction: true,
      createEntityId: entityId,
      start: { kind: "new", point: { x: -10, y: 0 } },
      end: { kind: "new", point: { x: 10, y: 0 } },
    })
    const axis = lastCreatedCurve(axisResult, "line")
    const firstResult = appendSketchLine(axisResult.sketch, {
      createEntityId: entityId,
      start: { kind: "new", point: { x: 2, y: 2 } },
      end: { kind: "new", point: { x: 4, y: 4 } },
    })
    const first = lastCreatedCurve(firstResult, "line")
    const secondResult = appendSketchLine(firstResult.sketch, {
      createEntityId: entityId,
      start: { kind: "existing", pointId: first.endPointId },
      end: { kind: "new", point: { x: 6, y: 2 } },
    })
    const second = lastCreatedCurve(secondResult, "line")

    const result = mirrorSketchEntities(secondResult.sketch, {
      axisLineId: axis.id,
      createConstraintId: constraintId,
      createEntityId: entityId,
      entityIds: [first.id, second.id],
    })
    const mirroredLines = result.sketch.entities
      .filter((entity): entity is Extract<SketchEntity, { type: "line" }> => entity.type === "line")
      .filter(({ id }) => id !== axis.id && id !== first.id && id !== second.id)
    const mirroredPoints = result.sketch.entities.filter(
      (entity): entity is Extract<SketchEntity, { type: "point" }> =>
        entity.type === "point" &&
        result.createdEntityIds.includes(entity.id) &&
        !mirroredLines.some(({ id }) => id === entity.id),
    )

    expect(secondResult.sketch.entities).toHaveLength(8)
    expect(mirroredLines).toHaveLength(2)
    expect(mirroredPoints).toHaveLength(3)
    expect(mirroredLines[0]?.endPointId).toBe(mirroredLines[1]?.startPointId)
    expect(mirroredPoints.map(({ x, y }) => [x, y])).toEqual([
      [2, -2],
      [4, -4],
      [6, -2],
    ])
    expect(result.sketch.constraints).toHaveLength(3)
    expect(result.sketch.constraints.every(({ type }) => type === "symmetric")).toBe(true)
  })

  it("mirrors a circle with symmetric-center and equal-radius intent", () => {
    const axisResult = appendSketchLine(empty(), {
      construction: true,
      createEntityId: entityId,
      start: { kind: "new", point: { x: 0, y: -10 } },
      end: { kind: "new", point: { x: 0, y: 10 } },
    })
    const axis = lastCreatedCurve(axisResult, "line")
    const circleResult = appendSketchCircle(axisResult.sketch, {
      center: { kind: "new", point: { x: 3, y: 2 } },
      createEntityId: entityId,
      perimeterPoint: { x: 7, y: 2 },
    })
    const circleId = circleResult.createdEntityIds.at(-1)
    if (!circleId) throw new Error("The fixture must create a circle.")
    const circle = entityById(circleResult.sketch, circleId, "circle")

    const result = mirrorSketchEntities(circleResult.sketch, {
      axisLineId: axis.id,
      createConstraintId: constraintId,
      createEntityId: entityId,
      entityIds: [circle.id],
    })
    const mirrored = result.sketch.entities.find(
      (entity): entity is Extract<SketchEntity, { type: "circle" }> =>
        entity.type === "circle" && entity.id !== circle.id,
    )
    if (!mirrored) throw new Error("Sketch Mirror must create a circle.")

    expect(entityById(result.sketch, mirrored.centerPointId, "point")).toMatchObject({
      x: -3,
      y: 2,
    })
    expect(mirrored.radius).toBe(4)
    expect(result.sketch.constraints.map(({ type }) => type).sort()).toEqual(["equal", "symmetric"])
  })

  it("mirrors and translates an ellipse through its three stable axis points", () => {
    const axisResult = appendSketchLine(empty(), {
      construction: true,
      createEntityId: entityId,
      start: { kind: "new", point: { x: -10, y: 0 } },
      end: { kind: "new", point: { x: 10, y: 0 } },
    })
    const axis = lastCreatedCurve(axisResult, "line")
    const ellipseResult = appendSketchEllipse(axisResult.sketch, {
      center: { kind: "new", point: { x: 2, y: 3 } },
      createEntityId: entityId,
      primaryAxisPoint: { kind: "new", point: { x: 7, y: 3 } },
      secondaryRadiusPoint: { x: 2, y: 5 },
    })
    const ellipse = entityById(
      ellipseResult.sketch,
      ellipseResult.createdEntityIds.at(-1) as SketchEntityId,
      "ellipse",
    )

    const mirroredResult = mirrorSketchEntities(ellipseResult.sketch, {
      axisLineId: axis.id,
      createConstraintId: constraintId,
      createEntityId: entityId,
      entityIds: [ellipse.id],
    })
    const mirrored = mirroredResult.sketch.entities.find(
      (entity): entity is Extract<SketchEntity, { type: "ellipse" }> =>
        entity.type === "ellipse" && entity.id !== ellipse.id,
    )
    if (!mirrored) throw new Error("Sketch Mirror must create an ellipse.")
    expect(
      [mirrored.centerPointId, mirrored.primaryAxisPointId, mirrored.secondaryAxisPointId].map(
        (id) => {
          const point = entityById(mirroredResult.sketch, id, "point")
          return [point.x, point.y]
        },
      ),
    ).toEqual([
      [2, -3],
      [7, -3],
      [2, -5],
    ])
    expect(mirroredResult.sketch.constraints.map(({ type }) => type)).toEqual([
      "symmetric",
      "symmetric",
      "symmetric",
    ])

    const translated = transformSketchEntities(ellipseResult.sketch, {
      entityIds: [ellipse.id],
      transform: { origin: { x: 0, y: 0 }, translation: { x: 10, y: -2 } },
    })
    expect(
      [ellipse.centerPointId, ellipse.primaryAxisPointId, ellipse.secondaryAxisPointId].map(
        (id) => {
          const point = entityById(translated, id, "point")
          return [point.x, point.y]
        },
      ),
    ).toEqual([
      [12, 1],
      [17, 1],
      [12, 3],
    ])
  })

  it("uses a distinct center for a semicircle mirrored across its diameter", () => {
    const axisResult = appendSketchLine(empty(), {
      construction: true,
      createEntityId: entityId,
      start: { kind: "new", point: { x: -10, y: 0 } },
      end: { kind: "new", point: { x: 10, y: 0 } },
    })
    const axis = lastCreatedCurve(axisResult, "line")
    const arcResult = appendSketchArc(axisResult.sketch, {
      center: { x: 0, y: 0 },
      createEntityId: entityId,
      start: { x: -5, y: 0 },
      end: { x: 5, y: 0 },
    })
    const arcId = arcResult.createdEntityIds.at(-1)
    if (!arcId) throw new Error("The fixture must create an arc.")
    const arc = entityById(arcResult.sketch, arcId, "arc")

    const result = mirrorSketchEntities(arcResult.sketch, {
      axisLineId: axis.id,
      createConstraintId: constraintId,
      createEntityId: entityId,
      entityIds: [arc.id],
    })
    const mirrored = result.sketch.entities.find(
      (entity): entity is Extract<SketchEntity, { type: "arc" }> =>
        entity.type === "arc" && entity.id !== arc.id,
    )
    if (!mirrored) throw new Error("Sketch Mirror must create an arc.")

    expect(mirrored.centerPointId).not.toBe(arc.centerPointId)
    expect(mirrored.startPointId).toBe(arc.endPointId)
    expect(mirrored.endPointId).toBe(arc.startPointId)
    expect(entityById(result.sketch, mirrored.centerPointId, "point")).toMatchObject({ x: 0, y: 0 })
    expect(result.sketch.constraints).toEqual([expect.objectContaining({ type: "equal" })])
  })

  it("translates connected selected geometry once per shared point", () => {
    const firstResult = appendSketchLine(empty(), {
      createEntityId: entityId,
      start: { kind: "new", point: { x: 0, y: 0 } },
      end: { kind: "new", point: { x: 4, y: 0 } },
    })
    const first = lastCreatedCurve(firstResult, "line")
    const secondResult = appendSketchLine(firstResult.sketch, {
      createEntityId: entityId,
      start: { kind: "existing", pointId: first.endPointId },
      end: { kind: "new", point: { x: 4, y: 3 } },
    })
    const second = lastCreatedCurve(secondResult, "line")
    const constrained = appendSketchConstraint(
      secondResult.sketch,
      { type: "perpendicular", firstEntityId: first.id, secondEntityId: second.id },
      constraintId,
    )

    const transformed = transformSketchEntities(constrained, {
      entityIds: [first.id, second.id],
      transform: {
        origin: sketchEntityTransformOrigin(constrained, [first.id, second.id]),
        translation: { x: 10, y: -2 },
      },
    })

    expect(
      [first.startPointId, first.endPointId, second.endPointId].map((pointId) => {
        const point = entityById(transformed, pointId, "point")
        return [point.x, point.y]
      }),
    ).toEqual([
      [10, -2],
      [14, -2],
      [14, 1],
    ])
    expect(transformed.constraints).toEqual(constrained.constraints)
  })

  it("rotates orientation constraints through exact quarter turns", () => {
    const lineResult = appendSketchLine(empty(), {
      createEntityId: entityId,
      start: { kind: "new", point: { x: 0, y: 0 } },
      end: { kind: "new", point: { x: 4, y: 0 } },
    })
    const line = lastCreatedCurve(lineResult, "line")
    const horizontal = appendSketchConstraint(
      lineResult.sketch,
      { type: "horizontal", lineId: line.id },
      constraintId,
    )
    const fixed = appendSketchConstraint(
      horizontal,
      { type: "fixed", pointId: line.startPointId },
      constraintId,
    )
    const directed = appendSketchConstraint(
      fixed,
      {
        type: "horizontal-distance",
        firstPointId: line.startPointId,
        secondPointId: line.endPointId,
        value: createLengthQuantity(4),
      },
      constraintId,
    )

    const transformed = transformSketchEntities(directed, {
      entityIds: [line.id],
      transform: { origin: { x: 0, y: 0 }, rotationRadians: Math.PI / 2 },
    })

    const transformedEnd = entityById(transformed, line.endPointId, "point")
    expect(transformedEnd.x).toBeCloseTo(0)
    expect(transformedEnd.y).toBeCloseTo(4)
    expect(transformed.constraints).toEqual([
      expect.objectContaining({ id: horizontal.constraints[0]?.id, type: "vertical" }),
    ])
  })

  it("scales selected circles and removes dimensions that would block the result", () => {
    const circleResult = appendSketchCircle(empty(), {
      center: { kind: "new", point: { x: 2, y: 3 } },
      createEntityId: entityId,
      perimeterPoint: { x: 6, y: 3 },
    })
    const circleId = circleResult.createdEntityIds.at(-1)
    if (!circleId) throw new Error("The fixture must create a circle.")
    const circle = entityById(circleResult.sketch, circleId, "circle")
    const constrained = appendSketchConstraint(
      circleResult.sketch,
      {
        type: "radius",
        curveId: circle.id,
        value: createLengthQuantity(4),
      },
      constraintId,
    )

    const transformed = transformSketchEntities(constrained, {
      entityIds: [circle.id],
      transform: { origin: { x: 0, y: 0 }, scale: 1.5 },
    })

    expect(entityById(transformed, circle.centerPointId, "point")).toMatchObject({ x: 3, y: 4.5 })
    expect(entityById(transformed, circle.id, "circle").radius).toBe(6)
    expect(transformed.constraints).toEqual([])
  })

  it("scales selected ellipses without retaining stale axis diameters", () => {
    const ellipseResult = appendSketchEllipse(empty(), {
      center: { kind: "new", point: { x: 0, y: 0 } },
      createEntityId: entityId,
      primaryAxisPoint: { kind: "new", point: { x: 8, y: 0 } },
      secondaryRadiusPoint: { x: 0, y: 3 },
    })
    const ellipse = entityById(
      ellipseResult.sketch,
      ellipseResult.createdEntityIds.at(-1) as SketchEntityId,
      "ellipse",
    )
    const primaryConstrained = appendSketchConstraint(
      ellipseResult.sketch,
      {
        type: "primary-axis-diameter",
        curveId: ellipse.id,
        value: createLengthQuantity(16),
      },
      constraintId,
    )
    const constrained = appendSketchConstraint(
      primaryConstrained,
      {
        type: "secondary-axis-diameter",
        curveId: ellipse.id,
        value: createLengthQuantity(6),
      },
      constraintId,
    )

    const transformed = transformSketchEntities(constrained, {
      entityIds: [ellipse.id],
      transform: { origin: { x: 0, y: 0 }, scale: 2 },
    })

    expect(entityById(transformed, ellipse.primaryAxisPointId, "point")).toMatchObject({
      x: 16,
      y: 0,
    })
    expect(entityById(transformed, ellipse.secondaryAxisPointId, "point")).toMatchObject({
      x: 0,
      y: 6,
    })
    expect(transformed.constraints).toEqual([])
  })

  it("removes constraints that cross the transformed selection boundary", () => {
    const firstResult = appendSketchLine(empty(), {
      createEntityId: entityId,
      start: { kind: "new", point: { x: 0, y: 0 } },
      end: { kind: "new", point: { x: 4, y: 0 } },
    })
    const first = lastCreatedCurve(firstResult, "line")
    const secondResult = appendSketchLine(firstResult.sketch, {
      createEntityId: entityId,
      start: { kind: "new", point: { x: 0, y: 2 } },
      end: { kind: "new", point: { x: 4, y: 2 } },
    })
    const second = lastCreatedCurve(secondResult, "line")
    const constrained = appendSketchConstraint(
      secondResult.sketch,
      { type: "parallel", firstEntityId: first.id, secondEntityId: second.id },
      constraintId,
    )

    const transformed = transformSketchEntities(constrained, {
      entityIds: [first.id],
      transform: { origin: { x: 0, y: 0 }, translation: { x: 1, y: 1 } },
    })

    expect(transformed.constraints).toEqual([])
  })

  it("rejects empty selections and invalid transform parameters", () => {
    const sketch = empty()
    expect(() => sketchEntityTransformOrigin(sketch, [])).toThrow("at least one")
    expect(() =>
      transformSketchEntities(sketch, {
        entityIds: [],
        transform: { origin: { x: 0, y: 0 } },
      }),
    ).toThrow("at least one")

    const lineResult = appendSketchLine(sketch, {
      createEntityId: entityId,
      start: { kind: "new", point: { x: 0, y: 0 } },
      end: { kind: "new", point: { x: 1, y: 0 } },
    })
    const line = lastCreatedCurve(lineResult, "line")
    expect(() =>
      transformSketchEntities(lineResult.sketch, {
        entityIds: [line.id],
        transform: { origin: { x: 0, y: 0 }, scale: 0 },
      }),
    ).toThrow("positive scale")
  })
})
