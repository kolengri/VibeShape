import {
  createAngleQuantity,
  createLengthQuantity,
  type SketchEntity,
  type SketchRecord,
  sketchEntityIdSchema,
} from "@vibeshape/domain"
import { describe, expect, it } from "vitest"
import {
  compatibleSketchConstraintTools,
  compatibleSketchDimensionTools,
  compatibleSketchDimensionToolsForSelection,
  createSketchDimensionConstraint,
  nextSketchDimensionSelection,
} from "./sketch-constraint-tools"

function entityId(index: number) {
  return sketchEntityIdSchema.parse(
    `0195b5ac-b221-7a2c-8c33-${index.toString(16).padStart(12, "0")}`,
  )
}

const firstPoint = {
  schemaVersion: 0,
  id: entityId(1),
  type: "point",
  x: -5,
  y: 0,
  construction: false,
} as const satisfies SketchEntity
const secondPoint = {
  ...firstPoint,
  id: entityId(2),
  x: 5,
} as const satisfies SketchEntity
const line = {
  schemaVersion: 0,
  id: entityId(3),
  type: "line",
  startPointId: firstPoint.id,
  endPointId: secondPoint.id,
  construction: false,
} as const satisfies SketchEntity
const circle = {
  schemaVersion: 0,
  id: entityId(4),
  type: "circle",
  centerPointId: firstPoint.id,
  radius: 5,
  construction: false,
} as const satisfies SketchEntity
const arc = {
  schemaVersion: 0,
  id: entityId(5),
  type: "arc",
  centerPointId: firstPoint.id,
  startPointId: secondPoint.id,
  endPointId: entityId(6),
  construction: false,
} as const satisfies SketchEntity
const ellipse = {
  schemaVersion: 0,
  id: entityId(7),
  type: "ellipse",
  centerPointId: firstPoint.id,
  primaryAxisPointId: secondPoint.id,
  secondaryAxisPointId: entityId(8),
  construction: false,
} as const satisfies SketchEntity
const ellipticalArc = {
  ...ellipse,
  id: entityId(9),
  type: "elliptical-arc",
  startPointId: entityId(10),
  endPointId: entityId(11),
} as const satisfies SketchEntity
const secondLine = { ...line, id: entityId(12) } as const satisfies SketchEntity
const dimensionSketch = {
  constraints: [],
  entities: [firstPoint, secondPoint, line, secondLine, circle, ellipse],
} as unknown as SketchRecord

describe("sketch constraint tools", () => {
  it("offers only constraints compatible with the current semantic selection", () => {
    expect(compatibleSketchConstraintTools([line]).map(({ kind }) => kind)).toEqual([
      "horizontal",
      "vertical",
    ])
    expect(compatibleSketchConstraintTools([firstPoint, line]).map(({ kind }) => kind)).toEqual([
      "midpoint",
      "point-on-line",
    ])
    expect(
      compatibleSketchConstraintTools([firstPoint, secondPoint, line]).map(({ kind }) => kind),
    ).toEqual(["symmetric"])
    expect(compatibleSketchConstraintTools([circle, arc]).map(({ kind }) => kind)).toEqual([
      "equal",
      "concentric",
    ])
    expect(compatibleSketchConstraintTools([firstPoint, secondPoint])).toEqual([
      {
        kind: "coincident",
        definition: {
          type: "coincident",
          firstPointId: firstPoint.id,
          secondPointId: secondPoint.id,
        },
      },
      {
        kind: "horizontal",
        definition: {
          type: "horizontal-points",
          firstPointId: firstPoint.id,
          secondPointId: secondPoint.id,
        },
      },
      {
        kind: "vertical",
        definition: {
          type: "vertical-points",
          firstPointId: firstPoint.id,
          secondPointId: secondPoint.id,
        },
      },
    ])
  })

  it("offers drawing dimensions and builds their semantic definitions", () => {
    expect(compatibleSketchDimensionTools([line])).toEqual(["distance"])
    expect(compatibleSketchDimensionTools([firstPoint, secondPoint])).toEqual([
      "distance",
      "horizontal-distance",
      "vertical-distance",
    ])
    expect(compatibleSketchDimensionTools([line, secondLine])).toEqual(["angle"])
    expect(compatibleSketchDimensionTools([circle])).toEqual(["radius", "diameter"])
    expect(compatibleSketchDimensionTools([ellipse])).toEqual([
      "primary-axis-diameter",
      "secondary-axis-diameter",
    ])
    expect(compatibleSketchDimensionTools([ellipticalArc])).toEqual([
      "primary-axis-diameter",
      "secondary-axis-diameter",
    ])

    expect(
      createSketchDimensionConstraint("distance", [line], createLengthQuantity(10)),
    ).toMatchObject({
      type: "distance",
      firstPointId: firstPoint.id,
      secondPointId: secondPoint.id,
    })
    expect(
      createSketchDimensionConstraint(
        "angle",
        [line, secondLine],
        createAngleQuantity(Math.PI / 2),
      ),
    ).toMatchObject({ type: "angle", firstEntityId: line.id, secondEntityId: entityId(12) })
    expect(
      createSketchDimensionConstraint("primary-axis-diameter", [ellipse], createLengthQuantity(30)),
    ).toMatchObject({ type: "primary-axis-diameter", curveId: ellipse.id })
  })

  it("builds a compatible dimension selection without modifier keys", () => {
    expect(nextSketchDimensionSelection(dimensionSketch, [], firstPoint.id)).toEqual([
      firstPoint.id,
    ])
    expect(nextSketchDimensionSelection(dimensionSketch, [firstPoint.id], secondPoint.id)).toEqual([
      firstPoint.id,
      secondPoint.id,
    ])
    expect(
      nextSketchDimensionSelection(dimensionSketch, [firstPoint.id, secondPoint.id], line.id),
    ).toEqual([line.id])
    expect(nextSketchDimensionSelection(dimensionSketch, [line.id], secondLine.id)).toEqual([
      line.id,
      secondLine.id,
    ])
    expect(nextSketchDimensionSelection(dimensionSketch, [line.id], line.id)).toEqual([])
    expect(nextSketchDimensionSelection(dimensionSketch, [firstPoint.id], circle.id)).toEqual([
      circle.id,
    ])
  })

  it("does not offer a driving dimension for read-only external geometry alone", () => {
    expect(compatibleSketchDimensionToolsForSelection(dimensionSketch, [entityId(99)])).toEqual([])
    expect(compatibleSketchDimensionToolsForSelection(dimensionSketch, [line.id])).toEqual([
      "distance",
    ])
  })
})
