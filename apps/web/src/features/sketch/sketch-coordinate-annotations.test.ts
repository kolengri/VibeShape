import { describe, expect, it } from "bun:test"
import { createCoordinateSketchProject } from "../../../../../tests/support/sketch-coordinate-fixture"
import {
  layoutSketchCoordinateAnnotations,
  sketchCoordinateDimensionPoint,
} from "./sketch-coordinate-annotations"

describe("sketch coordinate annotations", () => {
  it("anchors coordinates to the measured point with either point ordering", () => {
    const { sketch } = createCoordinateSketchProject()
    const entities = new Map(sketch.entities.map((entity) => [entity.id, entity]))
    const fixed = sketch.constraints.find((constraint) => constraint.type === "fixed")
    const dimension = sketch.constraints.find(
      (constraint) => constraint.type === "horizontal-distance",
    )
    if (!fixed || !dimension) throw new Error("The fixture requires a fixed origin and coordinate.")
    const fixedIds = new Set([fixed.pointId])
    expect(sketchCoordinateDimensionPoint(dimension, entities, fixedIds)).toBe(
      dimension.firstPointId,
    )
    expect(
      sketchCoordinateDimensionPoint(
        {
          ...dimension,
          firstPointId: dimension.secondPointId,
          secondPointId: dimension.firstPointId,
        },
        entities,
        fixedIds,
      ),
    ).toBe(dimension.firstPointId)
    expect(sketchCoordinateDimensionPoint(dimension, entities, new Set())).toBeNull()
    const origin = entities.get(fixed.pointId)
    if (origin?.type !== "point") throw new Error("The origin must be a point.")
    entities.set(origin.id, { ...origin, construction: false })
    expect(sketchCoordinateDimensionPoint(dimension, entities, fixedIds)).toBeNull()
    entities.set(origin.id, { ...origin, x: 3 })
    expect(sketchCoordinateDimensionPoint(dimension, entities, fixedIds)).toBeNull()
  })

  it("places the original formula pair beside its point with separate direct leaders", () => {
    const annotations = (["horizontal", "vertical"] as const).map((axis) => ({
      id: axis,
      pointId: "point",
      anchor: { x: 400, y: 300 },
      label: "#cover_length * -0.5",
      axis,
    }))
    const placements = layoutSketchCoordinateAnnotations(annotations, { width: 800, height: 600 })
    expect(placements.get("horizontal")).toMatchObject({
      left: 416,
      top: 282,
      leaderX: 416,
      leaderY: 294,
    })
    expect(placements.get("vertical")).toMatchObject({
      left: 416,
      top: 318,
      leaderX: 416,
      leaderY: 306,
    })
    expect(
      layoutSketchCoordinateAnnotations(
        [
          {
            id: "offscreen",
            pointId: "point",
            label: "10 mm",
            axis: "horizontal",
            anchor: { x: 900, y: 300 },
          },
        ],
        { width: 800, height: 600 },
      ).size,
    ).toBe(0)
  })

  it("does not attempt pixel placement before the viewport has a size", () => {
    expect(
      layoutSketchCoordinateAnnotations(
        [
          {
            id: "x",
            pointId: "point",
            anchor: { x: 10, y: 20 },
            label: "10 mm",
            axis: "horizontal",
          },
        ],
        {
          width: 0,
          height: 0,
        },
      ).size,
    ).toBe(0)
  })
})
