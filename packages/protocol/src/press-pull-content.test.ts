import { expect, it } from "bun:test"
import { pressPullFeatureContentParametersSchema } from "./geometry-worker"

const face = {
  schemaVersion: 1,
  kind: "face",
  outputRole: "result",
  signature: {
    kind: "face",
    geometryClass: "PLANE",
    measure: 240,
    centroid: [0, 0, 10],
    bounds: { min: [-10, -6, 10], max: [10, 6, 10] },
    boundaryCount: 4,
    adjacentGeometryClasses: [],
  },
}
const content = { distance: -2, sourceContentHash: "a".repeat(64), face }
it("validates signed planar Press Pull content at the untrusted worker boundary", () => {
  expect(pressPullFeatureContentParametersSchema.parse(content)).toEqual<unknown>(content)
  for (const distance of [0, NaN, Infinity, -Infinity, 0.00001, 100001, -100001])
    expect(
      pressPullFeatureContentParametersSchema.safeParse({ ...content, distance }).success,
    ).toBe(false)
  for (const changes of [
    { candidateId: "face:1" },
    { meshFaceId: 1 },
    { featureId: "local-uuid" },
    { signature: { ...face.signature, geometryClass: "CYLINDRE" } },
  ])
    expect(
      pressPullFeatureContentParametersSchema.safeParse({
        ...content,
        face: { ...face, ...changes },
      }).success,
    ).toBe(false)
})
