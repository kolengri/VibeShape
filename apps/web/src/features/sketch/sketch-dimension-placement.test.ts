import { type SketchEntity, type SketchEntityId, sketchEntityIdSchema } from "@vibeshape/domain"
import { describe, expect, it } from "vitest"
import {
  inferSketchDimensionKind,
  type SketchDimensionGeometry,
  sketchDimensionCanonicalValue,
} from "./sketch-dimension-placement"

const firstPointId = sketchEntityIdSchema.parse("0195b5ac-b220-7a2c-8c33-000000006001")
const secondPointId = sketchEntityIdSchema.parse("0195b5ac-b220-7a2c-8c33-000000006002")

function geometry(entities: readonly SketchEntity[]): SketchDimensionGeometry {
  const points = new Map<string, { x: number; y: number }>([
    [firstPointId, { x: 0, y: 0 }],
    [secondPointId, { x: 30, y: 20 }],
  ])
  return {
    entities,
    point: (id: SketchEntityId) => points.get(id) ?? null,
    solvedCircleRadius: () => null,
  }
}

describe("sketch dimension placement", () => {
  const points: readonly SketchEntity[] = [
    { schemaVersion: 0, id: firstPointId, type: "point", x: 0, y: 0, construction: false },
    { schemaVersion: 0, id: secondPointId, type: "point", x: 30, y: 20, construction: false },
  ]

  it("uses pointer direction to disambiguate point distances", () => {
    const dimensions = ["distance", "horizontal-distance", "vertical-distance"] as const
    expect(inferSketchDimensionKind(dimensions, geometry(points), { x: 15, y: 60 })).toBe(
      "horizontal-distance",
    )
    expect(inferSketchDimensionKind(dimensions, geometry(points), { x: 70, y: 10 })).toBe(
      "vertical-distance",
    )
    expect(inferSketchDimensionKind(dimensions, geometry(points), { x: 45, y: 40 })).toBe(
      "distance",
    )
  })

  it("derives exact initial values from the selected geometry", () => {
    expect(sketchDimensionCanonicalValue("distance", geometry(points))).toBeCloseTo(
      Math.hypot(30, 20),
    )
    expect(sketchDimensionCanonicalValue("horizontal-distance", geometry(points))).toBe(30)
    expect(sketchDimensionCanonicalValue("vertical-distance", geometry(points))).toBe(20)
  })
})
