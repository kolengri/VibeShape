import { describe, expect, it } from "bun:test"
import { documentSnapshotSchema, topologySignatureSchema } from "@vibeshape/domain"
import { bodyFaceRefSchema } from "@vibeshape/domain/body-topology-reference"
import { referenceAxisSchema, referencePlaneSchema } from "@vibeshape/domain/reference-frame"
import type { FeatureGeometryRecord } from "./feature-rebuild"
import {
  resolveReferenceAxis,
  resolveReferenceFace,
  resolveReferencePlane,
} from "./reference-frame"

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
  it("resolves a finite nonplanar face through the shared strict role-bound projection", () => {
    const curvedSignature = topologySignatureSchema.parse({
      kind: "face",
      geometryClass: "SPHERE",
      measure: 64 * Math.PI,
      centroid: [0, 0, 8],
      bounds: { min: [-4, -4, 4], max: [4, 4, 12] },
      boundaryCount: 1,
      adjacentGeometryClasses: [],
    })
    const curved = { ...face, signature: curvedSignature }
    if (support.kind !== "planar-face") throw new Error("Expected a body face fixture.")
    const reference = bodyFaceRefSchema.parse({ ...support.reference, signature: curvedSignature })
    const edge = {
      ...face,
      kind: "edge",
      referenceGeometry: { kind: "line-edge", start: [0, 0, 4], end: [0, 0, 12] },
    }
    expect(resolveReferenceFace(reference, context([curved, edge]))).toEqual<unknown>(curved)
    expect(resolveReferenceFace(reference, context([curved], "pattern.instance.0"))).toBeNull()
    expect(
      resolveReferenceFace(
        reference,
        context([curved, { ...curved, candidateId: "face.duplicate" }]),
      ),
    ).toBeNull()
    expect(resolveReferenceFace(reference, context([]))).toBeNull()
  })
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
  it.each([
    { sign: 1, reversed: false },
    { sign: 1, reversed: true },
    { sign: -1, reversed: false },
    { sign: -1, reversed: true },
  ])(
    "retains the authored line anchor and direction for $sign with native reversal $reversed",
    ({ sign, reversed }) => {
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
        referenceGeometry: {
          kind: "line-edge",
          start: reversed ? [10, 0, 0] : [0, 0, 0],
          end: reversed ? [0, 0, 0] : [10, 0, 0],
        },
      }
      const axis = referenceAxisSchema.parse({
        kind: "linear-edge",
        reference: {
          schemaVersion: 1,
          featureId,
          outputRole: "pattern.instance.1",
          kind: "edge",
          signature: { ...edgeSignature, direction: [sign, 0, 0] },
        },
      })
      expect(resolveReferenceAxis(axis, context([edge]))).toEqual({
        origin: [sign === 1 ? 0 : 10, 0, 0],
        direction: [sign, 0, 0],
      })
    },
  )
})
