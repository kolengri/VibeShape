import {
  createAngleQuantity,
  createLengthQuantity,
  type SketchEntity,
  sketchEntityIdSchema,
} from "@vibeshape/domain"
import { describe, expect, it } from "vitest"
import {
  compatibleSketchConstraintTools,
  compatibleSketchDimensionTools,
  createSketchDimensionConstraint,
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
  })

  it("offers drawing dimensions and builds their semantic definitions", () => {
    expect(compatibleSketchDimensionTools([line])).toEqual(["distance"])
    expect(compatibleSketchDimensionTools([firstPoint, secondPoint])).toEqual([
      "distance",
      "horizontal-distance",
      "vertical-distance",
    ])
    expect(compatibleSketchDimensionTools([line, { ...line, id: entityId(12) }])).toEqual(["angle"])
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
        [line, { ...line, id: entityId(12) }],
        createAngleQuantity(Math.PI / 2),
      ),
    ).toMatchObject({ type: "angle", firstEntityId: line.id, secondEntityId: entityId(12) })
    expect(
      createSketchDimensionConstraint("primary-axis-diameter", [ellipse], createLengthQuantity(30)),
    ).toMatchObject({ type: "primary-axis-diameter", curveId: ellipse.id })
  })
})
