import { describe, expect, it } from "vitest"
import type { SketchConstraintId, SketchEntityId, SketchId } from "./identifiers"
import type { SketchEntity, SketchRecord } from "./sketch"
import {
  appendSketchConstraint,
  appendSketchEllipse,
  appendSketchLine,
  createEmptySketch,
} from "./sketch-edit"
import {
  circularPatternSketchEntities,
  circularSketchPatternTransforms,
  linearPatternSketchEntities,
  linearSketchPatternTransforms,
  patternSketchEntities,
} from "./sketch-pattern-edit"

const sketchId = "018f0000-0000-7000-8000-000000000051" as SketchId
let nextEntityId = 1
let nextConstraintId = 1

function entityId() {
  return `018f0000-0000-7000-b051-${String(nextEntityId++).padStart(12, "0")}` as SketchEntityId
}

function constraintId() {
  return `018f0000-0000-7000-a051-${String(nextConstraintId++).padStart(12, "0")}` as SketchConstraintId
}

function empty() {
  nextEntityId = 1
  nextConstraintId = 1
  return createEmptySketch({ id: sketchId, label: "Patterns", plane: "xy" })
}

function entityById<Type extends SketchEntity["type"]>(
  sketch: SketchRecord,
  id: SketchEntityId,
  type: Type,
) {
  const entity = sketch.entities.find(
    (candidate): candidate is Extract<SketchEntity, { type: Type }> =>
      candidate.id === id && candidate.type === type,
  )
  if (!entity) throw new Error(`The fixture requires a ${type} entity.`)
  return entity
}

function requiredId(id: SketchEntityId | undefined) {
  if (!id) throw new Error("The fixture requires a created entity ID.")
  return id
}

describe("analytical sketch patterns", () => {
  it("builds closed and open circular transforms around an arbitrary center", () => {
    expect(
      circularSketchPatternTransforms({
        angleRadians: Math.PI * 2,
        center: { x: 5, y: 5 },
        closed: true,
        count: 4,
      }),
    ).toEqual([
      { rotationRadians: Math.PI / 2, translation: { x: 10, y: 0 } },
      { rotationRadians: Math.PI, translation: { x: 10, y: 10 } },
      { rotationRadians: (Math.PI * 3) / 2, translation: { x: 0, y: 10 } },
    ])
    expect(
      circularSketchPatternTransforms({
        angleRadians: Math.PI,
        center: { x: 0, y: 0 },
        closed: false,
        count: 3,
      }).map(({ rotationRadians }) => rotationRadians),
    ).toEqual([Math.PI / 2, Math.PI])
  })

  it("rejects invalid circular counts and overlapping open sweeps", () => {
    expect(() =>
      circularSketchPatternTransforms({
        angleRadians: Math.PI * 2,
        center: { x: 0, y: 0 },
        closed: false,
        count: 3,
      }),
    ).toThrow("between 0 and 360")
    expect(() =>
      circularSketchPatternTransforms({
        angleRadians: Math.PI * 2,
        center: { x: 0, y: 0 },
        closed: true,
        count: 101,
      }),
    ).toThrow("between 2 and 100")
  })

  it("builds bounded one- and two-direction linear transforms", () => {
    expect(
      linearSketchPatternTransforms({
        first: { angleRadians: 0, count: 3, spacing: 10 },
        second: { angleRadians: Math.PI / 2, count: 2, spacing: 5 },
      }).map(({ translation }) => translation),
    ).toEqual([
      { x: 10, y: 0 },
      { x: 20, y: 0 },
      { x: 0, y: 5 },
      { x: 10, y: 5 },
      { x: 20, y: 5 },
    ])
    expect(() =>
      linearSketchPatternTransforms({
        first: { angleRadians: 0, count: 11, spacing: 10 },
        second: { angleRadians: Math.PI / 2, count: 10, spacing: 5 },
      }),
    ).toThrow("at most 100")
  })

  it("clones connected geometry and its internal constraints for every occurrence", () => {
    const firstResult = appendSketchLine(empty(), {
      createEntityId: entityId,
      start: { kind: "new", point: { x: 0, y: 0 } },
      end: { kind: "new", point: { x: 4, y: 0 } },
    })
    const first = entityById(
      firstResult.sketch,
      requiredId(firstResult.createdEntityIds.at(-1)),
      "line",
    )
    const secondResult = appendSketchLine(firstResult.sketch, {
      createEntityId: entityId,
      start: { kind: "existing", pointId: first.endPointId },
      end: { kind: "new", point: { x: 4, y: 3 } },
    })
    const second = entityById(
      secondResult.sketch,
      requiredId(secondResult.createdEntityIds.at(-1)),
      "line",
    )
    const source = appendSketchConstraint(
      secondResult.sketch,
      { type: "perpendicular", firstEntityId: first.id, secondEntityId: second.id },
      constraintId,
    )

    const result = linearPatternSketchEntities(source, {
      createConstraintId: constraintId,
      createEntityId: entityId,
      definition: {
        first: { angleRadians: 0, count: 3, spacing: 10 },
        second: { angleRadians: Math.PI / 2, count: 2, spacing: 5 },
      },
      entityIds: [first.id, second.id],
    })

    expect(result.createdEntityIds).toHaveLength(25)
    expect(result.sketch.constraints).toHaveLength(6)
    const createdLines = result.createdEntityIds
      .map((id) => result.sketch.entities.find((entity) => entity.id === id))
      .filter(
        (entity): entity is Extract<SketchEntity, { type: "line" }> => entity?.type === "line",
      )
    expect(createdLines).toHaveLength(10)
    expect(createdLines[0]?.endPointId).toBe(createdLines[1]?.startPointId)
    const firstCreatedLine = createdLines[0]
    const lastOccurrenceFirstLine = createdLines.at(-2)
    if (!firstCreatedLine || !lastOccurrenceFirstLine) {
      throw new Error("The pattern fixture requires created lines.")
    }
    expect(entityById(result.sketch, firstCreatedLine.startPointId, "point")).toMatchObject({
      x: 10,
      y: 0,
    })
    expect(entityById(result.sketch, lastOccurrenceFirstLine.startPointId, "point")).toMatchObject({
      x: 20,
      y: 5,
    })
  })

  it("omits fixed and non-quarter orientation constraints from rotated copies", () => {
    const lineResult = appendSketchLine(empty(), {
      createEntityId: entityId,
      start: { kind: "new", point: { x: 1, y: 0 } },
      end: { kind: "new", point: { x: 4, y: 0 } },
    })
    const line = entityById(
      lineResult.sketch,
      requiredId(lineResult.createdEntityIds.at(-1)),
      "line",
    )
    const horizontal = appendSketchConstraint(
      lineResult.sketch,
      { type: "horizontal", lineId: line.id },
      constraintId,
    )
    const aligned = appendSketchConstraint(
      horizontal,
      {
        type: "horizontal-points",
        firstPointId: line.startPointId,
        secondPointId: line.endPointId,
      },
      constraintId,
    )
    const fixed = appendSketchConstraint(
      aligned,
      { type: "fixed", pointId: line.startPointId },
      constraintId,
    )

    const quarterTurn = patternSketchEntities(fixed, {
      createConstraintId: constraintId,
      createEntityId: entityId,
      entityIds: [line.id],
      transforms: [{ rotationRadians: Math.PI / 2, translation: { x: 0, y: 0 } }],
    })
    expect(quarterTurn.sketch.constraints.map(({ type }) => type)).toEqual([
      "horizontal",
      "horizontal-points",
      "fixed",
      "vertical",
      "vertical-points",
    ])

    const arbitrary = patternSketchEntities(fixed, {
      createConstraintId: constraintId,
      createEntityId: entityId,
      entityIds: [line.id],
      transforms: [{ rotationRadians: Math.PI / 3, translation: { x: 0, y: 0 } }],
    })
    expect(arbitrary.sketch.constraints).toHaveLength(3)
  })

  it("materializes circular occurrences and rotates compatible orientation constraints", () => {
    const lineResult = appendSketchLine(empty(), {
      createEntityId: entityId,
      start: { kind: "new", point: { x: 10, y: 0 } },
      end: { kind: "new", point: { x: 14, y: 0 } },
    })
    const line = entityById(
      lineResult.sketch,
      requiredId(lineResult.createdEntityIds.at(-1)),
      "line",
    )
    const source = appendSketchConstraint(
      lineResult.sketch,
      { type: "horizontal", lineId: line.id },
      constraintId,
    )
    const result = circularPatternSketchEntities(source, {
      createConstraintId: constraintId,
      createEntityId: entityId,
      definition: {
        angleRadians: Math.PI * 2,
        center: { x: 0, y: 0 },
        closed: true,
        count: 4,
      },
      entityIds: [line.id],
    })

    expect(result.createdEntityIds).toHaveLength(9)
    expect(result.sketch.constraints.map(({ type }) => type)).toEqual([
      "horizontal",
      "vertical",
      "horizontal",
      "vertical",
    ])
    const createdLine = result.createdEntityIds
      .map((id) => result.sketch.entities.find((entity) => entity.id === id))
      .find((entity): entity is Extract<SketchEntity, { type: "line" }> => entity?.type === "line")
    if (!createdLine) throw new Error("The circular pattern fixture requires a created line.")
    expect(entityById(result.sketch, createdLine.startPointId, "point")).toMatchObject({
      x: 0,
      y: 10,
    })
  })

  it("materializes exact ellipse occurrences with independent stable axis points", () => {
    const ellipseResult = appendSketchEllipse(empty(), {
      center: { kind: "new", point: { x: 0, y: 0 } },
      createEntityId: entityId,
      primaryAxisPoint: { kind: "new", point: { x: 5, y: 0 } },
      secondaryRadiusPoint: { x: 0, y: 2 },
    })
    const ellipse = entityById(
      ellipseResult.sketch,
      requiredId(ellipseResult.createdEntityIds.at(-1)),
      "ellipse",
    )
    const result = linearPatternSketchEntities(ellipseResult.sketch, {
      createConstraintId: constraintId,
      createEntityId: entityId,
      definition: { first: { angleRadians: 0, count: 2, spacing: 10 }, second: null },
      entityIds: [ellipse.id],
    })
    const created = result.createdEntityIds
      .map((id) => result.sketch.entities.find((entity) => entity.id === id))
      .find(
        (entity): entity is Extract<SketchEntity, { type: "ellipse" }> =>
          entity?.type === "ellipse",
      )
    if (!created) throw new Error("The pattern fixture requires a created ellipse.")
    expect(result.createdEntityIds).toHaveLength(4)
    expect(
      [created.centerPointId, created.primaryAxisPointId, created.secondaryAxisPointId].map(
        (id) => {
          const point = entityById(result.sketch, id, "point")
          return [point.x, point.y]
        },
      ),
    ).toEqual([
      [10, 0],
      [15, 0],
      [10, 2],
    ])
  })
})
