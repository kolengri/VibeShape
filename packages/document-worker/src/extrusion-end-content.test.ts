import { describe, expect, it } from "bun:test"
import type { FeatureGeometryRecord } from "@vibeshape/application/feature-rebuild"
import {
  createAngleQuantity,
  createLengthQuantity,
  documentSnapshotSchema,
  extrusionFeatureParametersV6Schema,
  extrusionFeatureParametersV7Schema,
  extrusionFeatureParametersV8Schema,
  extrusionFeatureTypeV6,
  extrusionFeatureTypeV7,
  extrusionFeatureTypeV8,
  featureRecordSchema,
  topologySignatureSchema,
} from "@vibeshape/domain"
import { prepareExtrusionEndContent } from "./extrusion-end-content"

const sourceId = "0195b5ac-b220-7a2c-8c33-67a36a7f3301"
const featureId = "0195b5ac-b220-7a2c-8c33-67a36a7f3302"
const hash = "a".repeat(64)
const role = "pattern.instance.1"
const body = { schemaVersion: 0, featureId: sourceId, outputRole: role }
const signature = topologySignatureSchema.parse({
  kind: "face",
  geometryClass: "PLANE",
  measure: 100,
  centroid: [0, 0, 18],
  bounds: { min: [-5, -5, 18], max: [5, 5, 18] },
  direction: [0, 0, 1],
  directionMode: "oriented",
  boundaryCount: 4,
  adjacentGeometryClasses: [],
})
const candidate = { candidateId: "face:end", kind: "face", signature, lineageTokens: [] }
const face = { ...body, schemaVersion: 1, kind: "face", signature }
const parameters = extrusionFeatureParametersV6Schema.parse({
  profiles: {
    schemaVersion: 0,
    profiles: [
      {
        schemaVersion: 0,
        sketchId: featureId,
        outerBoundaryEntityIds: [featureId],
        holeBoundaryEntityIds: [],
      },
    ],
  },
  distance: createLengthQuantity(7),
  symmetric: false,
  reversed: false,
  secondDistance: null,
  operation: "new",
  targetBody: null,
  startOffset: createLengthQuantity(3),
  draftAngle: createAngleQuantity(0),
  endCondition: { kind: "through-all", targetBody: body, sourceContentHash: hash },
})
const feature = featureRecordSchema.parse({
  schemaVersion: 0,
  id: featureId,
  type: extrusionFeatureTypeV6.type,
  parameters,
  dependencies: [sourceId],
  references: [],
  suppressed: false,
})
const document = documentSnapshotSchema.parse({
  schemaVersion: 0,
  id: featureId,
  revision: 1,
  name: "Endpoints",
  sketches: [],
  features: [],
  createdAt: "2026-10-04T00:00:00Z",
  updatedAt: "2026-10-04T00:00:00Z",
})
const frame: Parameters<typeof prepareExtrusionEndContent>[3] = {
  origin: [0, 0, 2],
  xAxis: [1, 0, 0],
  yAxis: [0, 1, 0],
  normal: [0, 0, 1],
}
function context(contentHash = hash, outputRole = role, candidates = [candidate]) {
  const geometry = [
    {
      featureId: sourceId,
      contentHash,
      geometry: {
        bodies: [
          {
            outputRole,
            shape: { valid: true, solidCount: 1, bounds: { min: [-5, -5, 4], max: [5, 5, 18] } },
            topologyCandidates: candidates,
          },
        ],
      },
    },
  ] as unknown as FeatureGeometryRecord[]
  return { document, features: [feature], geometry }
}
describe("captured exact extrusion end preparation", () => {
  it("resolves shared v8 dynamic support independently along each sketch normal", () => {
    const value = extrusionFeatureParametersV8Schema.parse(parameters)
    const record = featureRecordSchema.parse({
      ...feature,
      type: extrusionFeatureTypeV8.type,
      parameters: value,
    })
    expect(prepareExtrusionEndContent(record, value, context(), frame)).toMatchObject({
      ok: true,
      distance: 13.01,
    })
    const perpendicular = {
      origin: [-10, 0, 0] as [number, number, number],
      xAxis: [0, 1, 0] as [number, number, number],
      yAxis: [0, 0, 1] as [number, number, number],
      normal: [1, 0, 0] as [number, number, number],
    }
    expect(prepareExtrusionEndContent(record, value, context(), perpendicular)).toMatchObject({
      ok: true,
      distance: 12.01,
    })
    const faceEnd = extrusionFeatureParametersV8Schema.parse({
      ...value,
      endCondition: { kind: "up-to-face", targetBody: body, sourceContentHash: hash, face },
    })
    expect(prepareExtrusionEndContent(record, faceEnd, context(), perpendicular)).toEqual({
      ok: false,
    })
  })

  it("prepares v7 curved endpoints without invented plane data and rejects ambiguous or stale bodies", () => {
    const curvedSignature = topologySignatureSchema.parse({
      kind: "face",
      geometryClass: "SPHERE",
      measure: 64 * Math.PI,
      centroid: [0, 0, 8],
      bounds: { min: [-4, -4, 4], max: [4, 4, 12] },
      boundaryCount: 1,
      adjacentGeometryClasses: [],
    })
    const curved = extrusionFeatureParametersV7Schema.parse({
      ...parameters,
      endCondition: {
        kind: "up-to-face",
        targetBody: body,
        sourceContentHash: hash,
        face: { ...face, signature: curvedSignature },
      },
    })
    const owner = featureRecordSchema.parse({
      ...feature,
      type: extrusionFeatureTypeV7.type,
      parameters: curved,
    })
    const curvedCandidate = { ...candidate, signature: curvedSignature }
    const candidates = [
      curvedCandidate,
      {
        ...curvedCandidate,
        candidateId: "edge:seam",
        kind: "edge",
        meshFaceId: undefined,
        signature: topologySignatureSchema.parse({
          ...curvedSignature,
          kind: "edge",
          geometryClass: "LINE",
        }),
        referenceGeometry: { kind: "line-edge", start: [0, 0, 4], end: [0, 0, 12] },
      },
    ]
    const prepared = prepareExtrusionEndContent(
      owner,
      curved,
      context(hash, role, candidates),
      frame,
    )
    expect(prepared).toMatchObject({
      ok: true,
      endCondition: { kind: "up-to-curved-face", inputIndex: 0, outputRole: role },
    })
    if (!prepared.ok) throw new Error("Expected a resolved curved endpoint.")
    expect(prepared.endCondition).not.toHaveProperty("planeOrigin")
    expect(prepared.endCondition).not.toHaveProperty("planeNormal")
    for (const invalid of [
      context("b".repeat(64), role, candidates),
      context(hash, "pattern.instance.0", candidates),
      context(hash, role, [curvedCandidate, { ...curvedCandidate, candidateId: "face:other" }]),
      context(hash, role, []),
    ])
      expect(prepareExtrusionEndContent(owner, curved, invalid, frame)).toEqual({ ok: false })
  })
  it("derives through-all distance from the exact body's bounds and shifted start", () => {
    expect(prepareExtrusionEndContent(feature, parameters, context(), frame)).toMatchObject({
      ok: true,
      distance: 13.01,
      endCondition: {
        kind: "through-all",
        inputIndex: 0,
        outputRole: role,
        sourceContentHash: hash,
      },
    })
    expect(
      prepareExtrusionEndContent(
        feature,
        { ...parameters, reversed: true, startOffset: createLengthQuantity(-2) },
        context(),
        { ...frame, origin: [0, 0, 20] },
      ),
    ).toMatchObject({ ok: true, distance: 14.01 })
  })
  it("rejects stale revisions, missing roles, and an endpoint behind the start", () => {
    expect(prepareExtrusionEndContent(feature, parameters, context("b".repeat(64)), frame)).toEqual(
      { ok: false },
    )
    expect(
      prepareExtrusionEndContent(feature, parameters, context(hash, "pattern.instance.0"), frame),
    ).toEqual({ ok: false })
    expect(
      prepareExtrusionEndContent(feature, parameters, context(), { ...frame, origin: [0, 0, 30] }),
    ).toEqual({ ok: false })
  })
  it("preserves distance intent without binding an end body", () => {
    expect(
      prepareExtrusionEndContent(
        feature,
        { ...parameters, endCondition: { kind: "distance" } },
        context("b".repeat(64)),
        frame,
      ),
    ).toEqual({ ok: true, distance: 7, endCondition: { kind: "distance" } })
  })
  it("resolves a planar face against its exact role and retains its stable signature", () => {
    const upToFace = extrusionFeatureParametersV6Schema.parse({
      ...parameters,
      endCondition: { kind: "up-to-face", targetBody: body, sourceContentHash: hash, face },
    })
    expect(prepareExtrusionEndContent(feature, upToFace, context(), frame)).toMatchObject({
      ok: true,
      endCondition: {
        kind: "up-to-face",
        planeOrigin: [0, 0, 18],
        planeNormal: [0, 0, 1],
        face: { outputRole: role, signature },
      },
    })
    expect(
      prepareExtrusionEndContent(
        feature,
        upToFace,
        context(hash, role, [candidate, { ...candidate, candidateId: "face:other" }]),
        frame,
      ),
    ).toEqual({ ok: false })
    expect(
      prepareExtrusionEndContent(feature, upToFace, context(), { ...frame, normal: [1, 0, 0] }),
    ).toEqual({ ok: false })
  })
})
