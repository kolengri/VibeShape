import { describe, expect, it } from "vitest"
import type { SketchConstraintId, SketchEntityId, SketchId } from "./identifiers"
import {
  appendSketchArc,
  appendSketchCircle,
  appendSketchCenterRectangle,
  appendSketchConstraint,
  appendSketchLine,
  appendSketchPoint,
  appendSketchRectangle,
  createEmptySketch,
  moveSketchPoint,
  removeSketchConstraints,
  removeSketchEntities,
  setSketchDimensionValue,
  setSketchEntityConstruction,
} from "./sketch-edit"
import { createAngleQuantity, createLengthQuantity } from "./units"

const sketchId = "018f0000-0000-7000-8000-000000000001" as SketchId
let nextEntityId = 1
let nextConstraintId = 1

function entityId() {
  const suffix = String(nextEntityId++).padStart(12, "0")
  return `018f0000-0000-7000-9000-${suffix}` as SketchEntityId
}

function constraintId() {
  const suffix = String(nextConstraintId++).padStart(12, "0")
  return `018f0000-0000-7000-a000-${suffix}` as SketchConstraintId
}

function empty() {
  nextEntityId = 1
  nextConstraintId = 1
  return createEmptySketch({ id: sketchId, label: "Profile", plane: "xy" })
}

describe("sketch editing", () => {
  it("appends a standalone analytical point", () => {
    const result = appendSketchPoint(empty(), {
      construction: true,
      createEntityId: entityId,
      point: { x: 3, y: -4 },
    })

    expect(result.createdEntityIds).toHaveLength(1)
    expect(result.sketch.entities).toEqual([
      expect.objectContaining({ type: "point", x: 3, y: -4, construction: true }),
    ])
  })

  it("creates an empty sketch and appends connected lines through existing point targets", () => {
    const first = appendSketchLine(empty(), {
      createEntityId: entityId,
      start: { kind: "new", point: { x: 0, y: 0 } },
      end: { kind: "new", point: { x: 20, y: 0 } },
    })
    const endPointId = first.sketch.entities.find((entity) => entity.type === "line")?.endPointId
    expect(endPointId).toBeDefined()
    if (!endPointId) return

    const second = appendSketchLine(first.sketch, {
      createEntityId: entityId,
      start: { kind: "existing", pointId: endPointId },
      end: { kind: "new", point: { x: 20, y: 10 } },
    })

    expect(second.sketch.entities.filter(({ type }) => type === "point")).toHaveLength(3)
    expect(second.sketch.entities.filter(({ type }) => type === "line")).toHaveLength(2)
    expect(second.sketch.entities.at(-1)).toMatchObject({ type: "line", startPointId: endPointId })
  })

  it("adds a rectangle with shared corners and automatic horizontal and vertical constraints", () => {
    const result = appendSketchRectangle(empty(), {
      createConstraintId: constraintId,
      createEntityId: entityId,
      firstCorner: { x: -5, y: -3 },
      oppositeCorner: { x: 5, y: 3 },
    })

    expect(result.sketch.entities).toHaveLength(8)
    expect(result.sketch.constraints.map(({ type }) => type)).toEqual([
      "horizontal",
      "vertical",
      "horizontal",
      "vertical",
    ])
  })

  it("adds a center rectangle with persistent symmetric construction intent", () => {
    const result = appendSketchCenterRectangle(empty(), {
      center: { kind: "new", point: { x: 2, y: -1 } },
      corner: { x: 7, y: 2 },
      createConstraintId: constraintId,
      createEntityId: entityId,
    })
    const points = result.sketch.entities.filter(({ type }) => type === "point")
    const lines = result.sketch.entities.filter(({ type }) => type === "line")

    expect(points).toHaveLength(5)
    expect(points).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ x: 2, y: -1, construction: true }),
        expect.objectContaining({ x: -3, y: -4 }),
        expect.objectContaining({ x: 7, y: 2 }),
      ]),
    )
    expect(lines.filter(({ construction }) => construction)).toHaveLength(4)
    expect(result.sketch.constraints.map(({ type }) => type)).toEqual([
      "horizontal",
      "vertical",
      "horizontal",
      "vertical",
      "parallel",
      "equal",
    ])
  })

  it("reuses an inferred center point without duplicating its identity", () => {
    const withCenter = appendSketchPoint(empty(), {
      createEntityId: entityId,
      point: { x: 0, y: 0 },
    })
    const centerId = withCenter.createdEntityIds[0]
    expect(centerId).toBeDefined()
    if (!centerId) return

    const result = appendSketchCenterRectangle(withCenter.sketch, {
      center: { kind: "existing", pointId: centerId },
      corner: { x: 5, y: 3 },
      createConstraintId: constraintId,
      createEntityId: entityId,
    })

    expect(result.sketch.entities.filter(({ type }) => type === "point")).toHaveLength(5)
    expect(result.sketch.entities.filter(({ id }) => id === centerId)).toHaveLength(1)
  })

  it("adds circles and projects arc endpoints onto the authored radius", () => {
    const circle = appendSketchCircle(empty(), {
      center: { kind: "new", point: { x: 2, y: 2 } },
      createEntityId: entityId,
      perimeterPoint: { x: 7, y: 2 },
    })
    expect(circle.sketch.entities.at(-1)).toMatchObject({ type: "circle", radius: 5 })

    const arc = appendSketchArc(circle.sketch, {
      center: { x: 0, y: 0 },
      createEntityId: entityId,
      start: { x: 10, y: 0 },
      end: { x: 0, y: 3 },
    })
    const end = arc.sketch.entities.at(-2)
    expect(end).toMatchObject({ type: "point", x: 0, y: 10 })
  })

  it("adds validated constraints and rejects incompatible selections", () => {
    const line = appendSketchLine(empty(), {
      createEntityId: entityId,
      start: { kind: "new", point: { x: 0, y: 0 } },
      end: { kind: "new", point: { x: 10, y: 5 } },
    }).sketch
    const lineId = line.entities.find((entity) => entity.type === "line")?.id
    expect(lineId).toBeDefined()
    if (!lineId) return

    const constrained = appendSketchConstraint(line, { type: "horizontal", lineId }, constraintId)
    expect(constrained.constraints).toHaveLength(1)
    expect(appendSketchConstraint(constrained, { type: "horizontal", lineId }, constraintId)).toBe(
      constrained,
    )
    expect(() =>
      appendSketchConstraint(line, { type: "fixed", pointId: lineId }, constraintId),
    ).toThrow()
  })

  it("cascades geometry and constraint removal without deleting shared points", () => {
    const first = appendSketchLine(empty(), {
      createEntityId: entityId,
      start: { kind: "new", point: { x: 0, y: 0 } },
      end: { kind: "new", point: { x: 10, y: 0 } },
    }).sketch
    const firstLine = first.entities.find((entity) => entity.type === "line")
    expect(firstLine).toBeDefined()
    if (!firstLine) return
    const second = appendSketchLine(first, {
      createEntityId: entityId,
      start: { kind: "existing", pointId: firstLine.endPointId },
      end: { kind: "new", point: { x: 10, y: 10 } },
    }).sketch
    const constrained = appendSketchConstraint(
      second,
      { type: "horizontal", lineId: firstLine.id },
      constraintId,
    )

    const removed = removeSketchEntities(constrained, [firstLine.id])

    expect(removed.entities.filter(({ type }) => type === "line")).toHaveLength(1)
    expect(removed.entities.some(({ id }) => id === firstLine.endPointId)).toBe(true)
    expect(removed.constraints).toEqual([])
  })

  it("moves points, toggles construction state, and removes constraints independently", () => {
    const line = appendSketchLine(empty(), {
      createEntityId: entityId,
      start: { kind: "new", point: { x: 0, y: 0 } },
      end: { kind: "new", point: { x: 10, y: 0 } },
    }).sketch
    const point = line.entities.find((entity) => entity.type === "point")
    const segment = line.entities.find((entity) => entity.type === "line")
    expect(point && segment).toBeTruthy()
    if (!point || !segment) return
    const moved = moveSketchPoint(line, point.id, { x: -2, y: 4 })
    const construction = setSketchEntityConstruction(moved, [segment.id], true)
    const constrained = appendSketchConstraint(
      construction,
      { type: "fixed", pointId: point.id },
      constraintId,
    )

    expect(construction.entities.find(({ id }) => id === point.id)).toMatchObject({ x: -2, y: 4 })
    expect(construction.entities.find(({ id }) => id === segment.id)).toMatchObject({
      construction: true,
    })
    const constraint = constrained.constraints[0]
    expect(constraint).toBeDefined()
    if (!constraint) return
    expect(removeSketchConstraints(constrained, [constraint.id]).constraints).toEqual([])
  })

  it("updates a driving dimension while preserving its identity and references", () => {
    const sketch = appendSketchLine(empty(), {
      createEntityId: entityId,
      start: { kind: "new", point: { x: 0, y: 0 } },
      end: { kind: "new", point: { x: 10, y: 0 } },
    }).sketch
    const line = sketch.entities.find((entity) => entity.type === "line")
    expect(line).toBeDefined()
    if (!line) return
    const constrained = appendSketchConstraint(
      sketch,
      {
        type: "distance",
        firstPointId: line.startPointId,
        secondPointId: line.endPointId,
        value: createLengthQuantity(10, "mm", "10 mm"),
      },
      constraintId,
    )
    const dimension = constrained.constraints[0]
    expect(dimension).toBeDefined()
    if (!dimension) return

    const updated = setSketchDimensionValue(
      constrained,
      dimension.id,
      createLengthQuantity(25, "mm", "#width"),
    )

    expect(updated.constraints[0]).toEqual({
      ...dimension,
      value: createLengthQuantity(25, "mm", "#width"),
    })
  })

  it("rejects missing, geometric, and dimensionally incompatible constraint edits", () => {
    const sketch = appendSketchLine(empty(), {
      createEntityId: entityId,
      start: { kind: "new", point: { x: 0, y: 0 } },
      end: { kind: "new", point: { x: 10, y: 0 } },
    }).sketch
    const line = sketch.entities.find((entity) => entity.type === "line")
    expect(line).toBeDefined()
    if (!line) return
    const geometric = appendSketchConstraint(
      sketch,
      { type: "horizontal", lineId: line.id },
      constraintId,
    )
    const horizontal = geometric.constraints[0]
    expect(horizontal).toBeDefined()
    if (!horizontal) return
    expect(() =>
      setSketchDimensionValue(geometric, horizontal.id, createLengthQuantity(20)),
    ).toThrow("Only dimensional")

    const dimensional = appendSketchConstraint(
      sketch,
      {
        type: "distance",
        firstPointId: line.startPointId,
        secondPointId: line.endPointId,
        value: createLengthQuantity(10),
      },
      constraintId,
    )
    const distance = dimensional.constraints[0]
    expect(distance).toBeDefined()
    if (!distance) return
    expect(() =>
      setSketchDimensionValue(dimensional, distance.id, createAngleQuantity(Math.PI / 2)),
    ).toThrow()
    expect(() =>
      setSketchDimensionValue(
        dimensional,
        "018f0000-0000-7000-a000-999999999999" as SketchConstraintId,
        createLengthQuantity(20),
      ),
    ).toThrow("existing constraint")
  })
})
