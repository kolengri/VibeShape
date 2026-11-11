import { describe, expect, it } from "bun:test"
import type { FeatureGeometryRecord } from "@vibeshape/application/feature-rebuild"
import {
  createAngleQuantity,
  documentSnapshotSchema,
  featureRecordSchema,
  revolveFeatureParametersV8Schema,
  revolveFeatureTypeV8,
  topologySignatureSchema,
} from "@vibeshape/domain"
import { prepareRevolveEndContent } from "./revolve-content"

const id = (n: number) => `0195b5ac-b220-7a2c-8c33-${String(n).padStart(12, "0")}`
const endId = id(1)
const hash = "a".repeat(64)
const role = "pattern.instance.1"
const body = { schemaVersion: 0, featureId: endId, outputRole: role }
const signature = topologySignatureSchema.parse({
  kind: "face",
  geometryClass: "PLANE",
  measure: 100,
  centroid: [0, 2.5, -5.5],
  bounds: { min: [0, -5, -10], max: [0, 10, -1] },
  direction: [1, 0, 0],
  directionMode: "oriented",
  boundaryCount: 4,
  adjacentGeometryClasses: [],
})
const candidate = { candidateId: "face:end", kind: "face", signature, lineageTokens: [] }
const face = { ...body, schemaVersion: 1, kind: "face", signature }
function revolve(endCondition: unknown) {
  const parameters = revolveFeatureParametersV8Schema.parse({
    profiles: {
      schemaVersion: 0,
      profiles: [
        {
          schemaVersion: 0,
          sketchId: id(2),
          outerBoundaryEntityIds: [id(3)],
          holeBoundaryEntityIds: [],
        },
      ],
    },
    axis: { kind: "origin-axis", axis: "y" },
    angle: createAngleQuantity(90, "deg"),
    symmetric: false,
    reversed: false,
    secondAngle: null,
    operation: "new",
    targetBody: null,
    endCondition,
  })
  const feature = featureRecordSchema.parse({
    schemaVersion: 0,
    id: id(4),
    type: revolveFeatureTypeV8.type,
    parameters,
    dependencies: [endId],
    references: [],
    suppressed: false,
  })
  return { feature, parameters }
}
const document = documentSnapshotSchema.parse({
  schemaVersion: 0,
  id: id(5),
  revision: 1,
  name: "Revolve endpoints",
  sketches: [],
  features: [],
  createdAt: "2026-11-11T00:00:00Z",
  updatedAt: "2026-11-11T00:00:00Z",
})
function context(feature: unknown, contentHash = hash, candidates = [candidate]) {
  const geometry = [
    {
      featureId: endId,
      contentHash,
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
  return { document, features: [feature] as never, geometry }
}

describe("Revolve v8 endpoint preparation", () => {
  const upToFace = { kind: "up-to-face", targetBody: body, sourceContentHash: hash, face }

  it("binds an up-to-face endpoint to its exact body revision and stable face", () => {
    const { feature, parameters } = revolve(upToFace)
    expect(prepareRevolveEndContent(feature, parameters, context(feature))).toEqual({
      ok: true,
      endCondition: {
        kind: "up-to-face",
        inputIndex: 0,
        sourceContentHash: hash,
        outputRole: role,
        face: { schemaVersion: 1, kind: "face", outputRole: role, signature },
      },
    })
  })

  it("blocks stale revisions and missing or ambiguous faces instead of retargeting", () => {
    const { feature, parameters } = revolve(upToFace)
    expect(prepareRevolveEndContent(feature, parameters, context(feature, "b".repeat(64))).ok).toBe(
      false,
    )
    expect(prepareRevolveEndContent(feature, parameters, context(feature, hash, [])).ok).toBe(false)
    expect(
      prepareRevolveEndContent(
        feature,
        parameters,
        context(feature, hash, [candidate, { ...candidate, candidateId: "face:copy" }]),
      ).ok,
    ).toBe(false)
  })

  it("binds an up-to-body endpoint without face data", () => {
    const { feature, parameters } = revolve({
      kind: "up-to-body",
      targetBody: body,
      sourceContentHash: hash,
    })
    expect(prepareRevolveEndContent(feature, parameters, context(feature))).toEqual({
      ok: true,
      endCondition: {
        kind: "up-to-body",
        inputIndex: 0,
        sourceContentHash: hash,
        outputRole: role,
      },
    })
  })
})
