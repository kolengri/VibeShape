import { expect, it } from "bun:test"
import { chamferFeatureContentParametersV3Schema } from "./geometry-worker"

const signature = {
  kind: "edge",
  geometryClass: "LINE",
  measure: 20,
  centroid: [0, 0, 0],
  bounds: { min: [0, 0, 0], max: [20, 0, 0] },
  boundaryCount: 2,
  adjacentGeometryClasses: ["PLANE", "PLANE"],
}
const edge = { schemaVersion: 1, kind: "edge", outputRole: "result", signature }
const face = {
  ...edge,
  kind: "face",
  signature: { ...signature, kind: "face", geometryClass: "PLANE", boundaryCount: 4 },
}
const content = {
  mode: "two-distances",
  distance: 2,
  secondDistance: 3,
  measurement: "offset",
  flip: false,
  tangentPropagation: true,
  targets: [{ kind: "edge", edge, sideFace: face }],
  directionOverrides: [edge],
}

it("accepts exact typed Chamfer V3 edge, side and face targets at the worker boundary", () => {
  expect(chamferFeatureContentParametersV3Schema.safeParse(content).success).toBe(true)
  expect(
    chamferFeatureContentParametersV3Schema.safeParse({
      ...content,
      targets: [{ kind: "face", face }],
    }).success,
  ).toBe(true)
})

it("rejects wrong-kind signatures, transient identifiers, invalid quantities and incoherent mode fields", () => {
  for (const patch of [
    { targets: [] },
    { distance: Infinity },
    { secondDistance: undefined },
    { angle: 0.4 },
    { targets: [{ kind: "edge", edge: { ...edge, nativeIndex: 4 }, sideFace: face }] },
    { targets: [{ kind: "edge", edge: { ...edge, signature: face.signature }, sideFace: face }] },
    { targets: [{ kind: "edge", edge }] },
    { mode: "distance-angle", secondDistance: undefined, angle: Math.PI / 2 },
    { mode: "equal-distance", secondDistance: undefined, flip: true },
    { directionOverrides: [{ ...edge, kind: "face" }] },
  ])
    expect(
      chamferFeatureContentParametersV3Schema.safeParse({ ...content, ...patch }).success,
    ).toBe(false)
})
