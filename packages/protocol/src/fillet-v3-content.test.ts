import { expect, it } from "bun:test"
import { filletFeatureContentParametersV3Schema } from "./geometry-worker"

const signature = {
  kind: "edge",
  geometryClass: "LINE",
  measure: 20,
  centroid: [0, 0, 0],
  bounds: { min: [0, 0, 0], max: [20, 0, 0] },
  boundaryCount: 2,
  adjacentGeometryClasses: ["PLANE", "PLANE"],
}
const edge = { schemaVersion: 1, kind: "edge", outputRole: "pattern.instance.1", signature }
const face = {
  ...edge,
  kind: "face",
  signature: { ...signature, kind: "face", geometryClass: "PLANE", boundaryCount: 4 },
}
const content = {
  radius: 2,
  targets: [
    { kind: "edge", edge, variableRadius: { startRadius: 1, endRadius: 3, reverse: false } },
    { kind: "face", face },
  ],
}

it("accepts exact typed Fillet V3 edge, variable-radius and face targets at the worker boundary", () => {
  expect(filletFeatureContentParametersV3Schema.safeParse(content).success).toBe(true)
  expect(
    filletFeatureContentParametersV3Schema.safeParse({
      radius: 0.001,
      targets: [{ kind: "edge", edge }],
    }).success,
  ).toBe(true)
})

it("rejects transient identifiers, wrong kinds, invalid radii and degenerate variable laws", () => {
  for (const patch of [
    { targets: [] },
    { radius: 0 },
    { radius: Infinity },
    { radius: 100_001 },
    { targets: [{ kind: "edge", edge: { ...edge, nativeIndex: 4 } }] },
    { targets: [{ kind: "edge", edge: { ...edge, signature: face.signature } }] },
    { targets: [{ kind: "face", face: edge }] },
    {
      targets: [
        { kind: "face", face, variableRadius: { startRadius: 1, endRadius: 2, reverse: false } },
      ],
    },
    {
      targets: [
        { kind: "edge", edge, variableRadius: { startRadius: 2, endRadius: 2, reverse: false } },
      ],
    },
    { targets: [{ kind: "edge", edge, variableRadius: { startRadius: 1, endRadius: 2 } }] },
    { flip: true },
  ])
    expect(filletFeatureContentParametersV3Schema.safeParse({ ...content, ...patch }).success).toBe(
      false,
    )
})
