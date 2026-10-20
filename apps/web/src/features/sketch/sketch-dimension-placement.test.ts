import { describe, expect, it } from "bun:test"
import { type SketchEntity, type SketchEntityId, sketchEntityIdSchema } from "@vibeshape/domain"
import {
  inferSketchDimensionKind,
  type SketchDimensionGeometry,
  sketchDimensionCanonicalValue,
  sketchLinearDimensionLines,
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

  it("places aligned dimensions parallel to the baseline with perpendicular extensions", () => {
    expect(
      sketchLinearDimensionLines(
        "distance",
        [
          { x: 0, y: 0 },
          { x: 6, y: 8 },
        ],
        { x: -4, y: 3 },
      ),
    ).toEqual({
      dimension: [
        { x: -4, y: 3 },
        { x: 2, y: 11 },
      ],
      extensions: [
        [
          { x: 0, y: 0 },
          { x: -4, y: 3 },
        ],
        [
          { x: 6, y: 8 },
          { x: 2, y: 11 },
        ],
      ],
    })
  })

  it("places horizontal and vertical dimensions through the chosen annotation offset", () => {
    const witnesses = [
      { x: 0, y: 0 },
      { x: 30, y: 20 },
    ]
    expect(
      sketchLinearDimensionLines("horizontal-distance", witnesses, { x: 10, y: 50 })?.dimension,
    ).toEqual([
      { x: 0, y: 50 },
      { x: 30, y: 50 },
    ])
    expect(
      sketchLinearDimensionLines("vertical-distance", witnesses, { x: 50, y: 10 })?.dimension,
    ).toEqual([
      { x: 50, y: 0 },
      { x: 50, y: 20 },
    ])
  })

  it("does not apply linear annotations to circular or angular dimensions or collapsed baselines", () => {
    const witnesses = [
      { x: 0, y: 0 },
      { x: 30, y: 20 },
    ]
    expect(sketchLinearDimensionLines("radius", witnesses, { x: 10, y: 50 })).toBeNull()
    expect(sketchLinearDimensionLines("angle", witnesses, { x: 10, y: 50 })).toBeNull()
    expect(
      sketchLinearDimensionLines(
        "distance",
        [
          { x: 0, y: 0 },
          { x: 0, y: 0 },
        ],
        { x: 10, y: 50 },
      ),
    ).toBeNull()
    expect(
      sketchLinearDimensionLines(
        "horizontal-distance",
        [
          { x: 0, y: 0 },
          { x: 0, y: 20 },
        ],
        { x: 10, y: 50 },
      ),
    ).toBeNull()
  })
})
