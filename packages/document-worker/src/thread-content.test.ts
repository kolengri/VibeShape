import { describe, expect, it } from "bun:test"
import type { FeatureGeometryRecord } from "@vibeshape/application/feature-rebuild"
import {
  createAngleQuantity,
  createLengthQuantity,
  createScalarQuantity,
  documentSnapshotSchema,
  featureRecordSchema,
  topologySignatureSchema,
} from "@vibeshape/domain"
import { threadFeatureTypeV2 } from "@vibeshape/domain/part-design-thread"
import { prepareThreadContent } from "./thread-content"

const targetId = "0195b5ac-b220-7a2c-8c33-67a36a7f3401"
const axisId = "0195b5ac-b220-7a2c-8c33-67a36a7f3402"
const threadId = "0195b5ac-b220-7a2c-8c33-67a36a7f3403"
const role = "pattern.instance.1"
const signature = topologySignatureSchema.parse({
  kind: "edge",
  geometryClass: "LINE",
  measure: 10,
  centroid: [5, 0, 0],
  bounds: { min: [0, 0, 0], max: [10, 0, 0] },
  direction: [1, 0, 0],
  directionMode: "axis",
  boundaryCount: 2,
  adjacentGeometryClasses: [],
})
const candidate = {
  candidateId: "edge:axis",
  kind: "edge",
  signature,
  lineageTokens: [],
  referenceGeometry: { kind: "line-edge", start: [10, 0, 0], end: [0, 0, 0] },
}
const feature = featureRecordSchema.parse({
  schemaVersion: 0,
  id: threadId,
  type: threadFeatureTypeV2.type,
  parameters: {
    targetBody: { schemaVersion: 0, featureId: targetId, outputRole: "result" },
    kind: "external",
    handedness: "right",
    axis: {
      kind: "linear-edge",
      reference: { schemaVersion: 1, featureId: axisId, outputRole: role, kind: "edge", signature },
    },
    nominalDiameter: createLengthQuantity(10),
    pitch: createLengthQuantity(2),
    length: createLengthQuantity(8),
    depth: createLengthQuantity(0.5),
    clearance: createLengthQuantity(0.05),
    starts: createScalarQuantity(1),
    phase: createAngleQuantity(0),
    runIn: createLengthQuantity(0.5),
    runOut: createLengthQuantity(0.5),
  },
  dependencies: [targetId, axisId],
  references: [],
  suppressed: false,
})
const document = documentSnapshotSchema.parse({
  schemaVersion: 0,
  id: threadId,
  revision: 1,
  name: "Thread axes",
  features: [],
  sketches: [],
  createdAt: "2026-10-04T00:00:00Z",
  updatedAt: "2026-10-04T00:00:00Z",
})
function context(outputRole = role, candidates = [candidate]) {
  const geometry = [
    {
      featureId: axisId,
      geometry: {
        bodies: [
          { outputRole, shape: { valid: true, solidCount: 1 }, topologyCandidates: candidates },
        ],
      },
    },
  ] as unknown as FeatureGeometryRecord[]
  return { document, features: [feature], geometry }
}
describe("selected thread axis preparation", () => {
  it("retains signed position zero after native edge reversal and projects numeric v2 content", () => {
    expect(prepareThreadContent(feature, context())).toMatchObject({
      ok: true,
      parameters: {
        axis: "custom",
        origin: [0, 0, 0],
        direction: [1, 0, 0],
        supportFeatureId: axisId,
        nominalDiameter: 10,
        pitch: 2,
        length: 8,
        starts: 1,
        phase: 0,
      },
    })
  })
  it("blocks a missing named output and ambiguous current geometry", () => {
    expect(prepareThreadContent(feature, context("pattern.instance.0"))).toMatchObject({
      ok: false,
      diagnostic: { code: "org.vibeshape.feature.thread-axis-missing" },
    })
    expect(
      prepareThreadContent(
        feature,
        context(role, [candidate, { ...candidate, candidateId: "edge:other" }]),
      ),
    ).toMatchObject({ ok: false, diagnostic: { values: { reason: "axis-unresolved" } } })
  })
  it("leaves legacy XYZ content to its unchanged preparation route", () => {
    const legacy = featureRecordSchema.parse({
      ...feature,
      type: { ...feature.type, schemaVersion: 1 },
      parameters: {
        ...feature.parameters,
        axis: "Z",
        origin: {
          x: createLengthQuantity(0),
          y: createLengthQuantity(0),
          z: createLengthQuantity(0),
        },
      },
      dependencies: [targetId],
    })
    expect(prepareThreadContent(legacy, context())).toBeNull()
  })
})
