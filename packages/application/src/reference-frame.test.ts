import { documentSnapshotSchema, topologySignatureSchema } from "@vibeshape/domain"
import { referenceAxisSchema, referencePlaneSchema } from "@vibeshape/domain/reference-frame"
import { describe, expect, it } from "vitest"
import type { FeatureGeometryRecord } from "./feature-rebuild"
import { resolveReferenceAxis, resolveReferencePlane } from "./reference-frame"

const featureId = "0195b5ac-b220-7a2c-8c33-000000003301"
const document = documentSnapshotSchema.parse({
  schemaVersion: 0,
  id: featureId,
  revision: 1,
  name: "Frames",
  sketches: [],
  features: [],
  createdAt: "2026-10-04T00:00:00Z",
  updatedAt: "2026-10-04T00:00:00Z",
})
const signature = topologySignatureSchema.parse({
  kind: "face",
  geometryClass: "PLANE",
  measure: 100,
  centroid: [3, 4, 5],
  bounds: { min: [-2, -1, 5], max: [8, 9, 5] },
  direction: [0, 0, 1],
  directionMode: "oriented",
  boundaryCount: 4,
  adjacentGeometryClasses: [],
})
const face = { candidateId: "face.a", kind: "face", lineageTokens: [], signature }
const support = referencePlaneSchema.parse({
  kind: "planar-face",
  reference: {
    schemaVersion: 1,
    featureId,
    outputRole: "pattern.instance.1",
    kind: "face",
    signature,
  },
})
function context(candidates: unknown[], role = "pattern.instance.1") {
  const geometry = [
    {
      featureId,
      geometry: {
        bodies: [
          {
            outputRole: role,
            shape: { valid: true, solidCount: 1 },
            topologyCandidates: candidates,
          },
        ],
      },
    },
  ] as unknown as FeatureGeometryRecord[]
  return { document, features: [], geometry }
}
describe("current body-bound reference frames", () => {
  it("resolves the selected body's current planar geometry", () => {
    expect(resolveReferencePlane(support, context([face]))).toEqual({
      origin: [3, 4, 5],
      normal: [0, 0, 1],
    })
  })
  it("fails closed for a missing role or an ambiguous stable face", () => {
    expect(resolveReferencePlane(support, context([face], "pattern.instance.0"))).toBeNull()
    expect(
      resolveReferencePlane(support, context([face, { ...face, candidateId: "face.b" }])),
    ).toBeNull()
  })
  it("retains an authored line direction after a native orientation reversal", () => {
    const edgeSignature = topologySignatureSchema.parse({
      ...signature,
      kind: "edge",
      geometryClass: "LINE",
      measure: 10,
      centroid: [5, 0, 0],
      bounds: { min: [0, 0, 0], max: [10, 0, 0] },
      direction: [1, 0, 0],
      directionMode: "axis",
      boundaryCount: 2,
    })
    const edge = {
      candidateId: "edge.a",
      kind: "edge",
      lineageTokens: [],
      signature: edgeSignature,
      referenceGeometry: { kind: "line-edge", start: [10, 0, 0], end: [0, 0, 0] },
    }
    const axis = referenceAxisSchema.parse({
      kind: "linear-edge",
      reference: {
        schemaVersion: 1,
        featureId,
        outputRole: "pattern.instance.1",
        kind: "edge",
        signature: edgeSignature,
      },
    })
    expect(resolveReferenceAxis(axis, context([edge]))).toEqual({
      origin: [10, 0, 0],
      direction: [1, 0, 0],
    })
  })
})
