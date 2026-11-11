import { expect, it } from "bun:test"
import { thickenFeatureContentParametersSchema } from "./thicken-content"

const face = {
  schemaVersion: 1,
  kind: "face",
  outputRole: "result",
  signature: {
    kind: "face",
    geometryClass: "CYLINDRE",
    measure: 314,
    centroid: [0, 0, 5],
    bounds: { min: [-5, -5, 0], max: [5, 5, 10] },
    boundaryCount: 2,
    adjacentGeometryClasses: [],
  },
}
const content = { faces: [face], thickness: 2, side: "symmetric", operation: "new" }

it("validates Thicken content at the untrusted worker boundary", () => {
  expect(thickenFeatureContentParametersSchema.parse(content)).toEqual<unknown>(content)
  for (const thickness of [0, -1, 0.0009, 10_001, NaN, Infinity])
    expect(thickenFeatureContentParametersSchema.safeParse({ ...content, thickness }).success).toBe(
      false,
    )
  for (const changes of [
    { faces: [] },
    { faces: Array.from({ length: 257 }, () => face) },
    { faces: [{ ...face, featureId: "local-uuid" }] },
    { side: "both" },
    { operation: "intersect" },
    { flip: true },
  ])
    expect(
      thickenFeatureContentParametersSchema.safeParse({ ...content, ...changes }).success,
    ).toBe(false)
})
