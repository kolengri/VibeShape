import { describe, expect, it } from "bun:test"
import { documentSnapshotSchema } from "@vibeshape/domain/document"
import { featureRecordSchema } from "@vibeshape/domain/feature-graph"
import { type FeatureId, featureIdSchema } from "@vibeshape/domain/identifiers"
import { boxFeatureType } from "@vibeshape/domain/part-design"
import { DOCUMENT_PROTOCOL_VERSION } from "@vibeshape/protocol"
import {
  distanceBetweenMeasurementPoints,
  inspectTopologyMeasurements,
  parallelPlaneSeparation,
  type TopologyMeasurementElement,
  topologyDirectionAngle,
} from "./model-topology-measurements"

const documentId = "0195b5ac-b220-7a2c-8c33-000000000001"
const featureIds: readonly [FeatureId, FeatureId] = [
  featureIdSchema.parse("0195b5ac-b220-7a2c-8c33-000000000002"),
  featureIdSchema.parse("0195b5ac-b220-7a2c-8c33-000000000003"),
]
const hash = "a".repeat(64)

function snapshot() {
  return documentSnapshotSchema.parse({
    schemaVersion: 0,
    id: documentId,
    revision: 4,
    name: "Topology",
    createdAt: "2026-09-13T00:00:00.000Z",
    updatedAt: "2026-09-13T00:00:00.000Z",
    features: featureIds.map((id) =>
      featureRecordSchema.parse({
        schemaVersion: 0,
        id,
        type: boxFeatureType.type,
        parameters: {},
        dependencies: [],
        references: [],
        suppressed: false,
      }),
    ),
  })
}

const signature = {
  kind: "edge" as const,
  geometryClass: "LINE",
  measure: 10,
  centroid: [5, 0, 0] as [number, number, number],
  bounds: {
    min: [0, 0, 0] as [number, number, number],
    max: [10, 0, 0] as [number, number, number],
  },
  boundaryCount: 2,
  adjacentGeometryClasses: ["PLANE", "PLANE"],
}

function candidate(candidateId: string, semanticRole?: string) {
  return {
    candidateId,
    kind: "edge" as const,
    ...(semanticRole ? { semanticRole } : {}),
    lineageTokens: [],
    signature,
    edgePolyline: [
      [0, 0, 0],
      [10, 0, 0],
    ],
  }
}

const mesh = {
  positions: new Float32Array([0, 0, 0]),
  normals: new Float32Array([0, 0, 1]),
  indices: new Uint32Array([0, 0, 0]),
  triangleFaceIds: new Uint32Array([0]),
}

const shape = {
  valid: true,
  volume: 120,
  surfaceArea: 88,
  bounds: { min: [0, 0, 0], max: [10, 12, 1] },
  faceCount: 6,
  edgeCount: 2,
  solidCount: 1,
}

function body(outputRole: string, topologyCandidates: unknown[]) {
  return { outputRole, shape, mesh, topologyCandidates }
}

function engineGeometry(bodies: unknown[], rootCandidates: unknown[] = [], rootSolidCount = 1) {
  return {
    engine: {
      adapter: "replicad",
      adapterVersion: "test-build",
      replicadVersion: "0.23.1",
      opencascadePackageVersion: "0.23.0",
      opencascadeSourceRevision: null,
      wasmBytes: 1,
      initializedInMs: 1,
      featureContentEnvironment: {
        schemaVersion: 0,
        hostApiVersion: "0.1.0",
        geometry: {
          adapterId: "org.vibeshape.geometry.replicad",
          adapterVersion: "test-build",
          kernelId: "org.opencascade.occt",
          kernelVersion: "7.9.2",
          kernelSourceRevision: null,
        },
        modelingTolerancePolicyVersion: 1,
        provider: { kind: "built-in" },
      },
    },
    shape: { ...shape, solidCount: rootSolidCount },
    topologyCandidates: rootCandidates,
    mesh,
    bodies,
    cache: { brepHit: false },
    timings: { evaluationMs: 1, tessellationMs: 1, totalMs: 2 },
  }
}

function response(
  geometries: unknown[],
  overrides: Record<string, unknown> = {},
  records: unknown[] = featureIds.map((featureId) => ({
    featureId,
    status: "succeeded",
    contentHash: hash,
  })),
) {
  return {
    protocolVersion: DOCUMENT_PROTOCOL_VERSION,
    requestId: "0195b5ac-b220-7a2c-8c33-000000000010",
    documentId,
    revision: 4,
    generation: 7,
    type: "documentRebuilt",
    evaluation: { records, dirtyFeatureIds: [], evaluatedFeatureIds: [], reusedFeatureIds: [] },
    geometry: geometries,
    sketches: [],
    modelReferenceEvidence: [],
    ...overrides,
  }
}

function geometry(featureId: string, bodies: unknown[], rootSolidCount = 1) {
  return {
    featureId,
    contentHash: hash,
    meshPolicy: { chordTolerance: 0.01, angularTolerance: 0.1 },
    geometry: engineGeometry(bodies, [], rootSolidCount),
  }
}

function measuredCandidates() {
  const edge = {
    ...candidate("edge"),
    referenceGeometry: { kind: "line-edge", start: [0, 0, 0], end: [10, 0, 0] },
    signature: { ...signature, direction: [1, 0, 0], directionMode: "axis" },
  }
  const circle = {
    ...candidate("circle"),
    referenceGeometry: {
      kind: "circle-edge",
      center: [0, 0, 0],
      xAxis: [1, 0, 0],
      yAxis: [0, 1, 0],
      normal: [0, 0, 1],
      radius: 5,
    },
    signature: {
      ...signature,
      geometryClass: "CIRCLE",
      measure: 10 * Math.PI,
      centroid: [0, 0, 0],
      bounds: { min: [-5, -5, 0], max: [5, 5, 0] },
      boundaryCount: 0,
    },
  }
  const faces = Array.from({ length: 6 }, (_, i) => ({
    candidateId: `face-${i}`,
    lineageTokens: [],
    kind: "face",
    signature: {
      ...signature,
      kind: "face",
      geometryClass: "PLANE",
      measure: 88 / 6,
      direction: [0, 0, 1],
      directionMode: "oriented",
      centroid: [5, 0, i],
      bounds: { min: [0, 0, i], max: [10, 0, i] },
    },
  }))
  return [edge, circle, ...faces]
}

function measuredRebuild(overrides: Record<string, unknown> = {}) {
  return {
    ok: true as const,
    response: response(
      featureIds.map((id) => geometry(id, [body("result", measuredCandidates())])),
      overrides,
    ),
  }
}

describe("revision-bound topology measurements", () => {
  it("preserves analytical edge length, radius and points rather than using display polylines", () => {
    const elements = inspectTopologyMeasurements(snapshot(), measuredRebuild(), {
      schemaVersion: 0,
      featureId: featureIds[0],
      outputRole: "result",
    })
    expect(elements).toHaveLength(8)
    expect(elements?.[0]).toMatchObject({
      kind: "edge",
      measure: 10,
      direction: [1, 0, 0],
      points: [
        { kind: "centroid", position: [5, 0, 0] },
        { kind: "start", position: [0, 0, 0] },
        { kind: "end", position: [10, 0, 0] },
      ],
    })
    expect(elements?.[1]).toMatchObject({ radius: 5, measure: 10 * Math.PI })
    expect(elements?.[2]).toMatchObject({ kind: "face", measure: 88 / 6 })
  })
  it("rejects stale or missing exact body evidence", () => {
    const target = { schemaVersion: 0 as const, featureId: featureIds[0], outputRole: "result" }
    expect(
      inspectTopologyMeasurements(snapshot(), measuredRebuild({ revision: 3 }), target),
    ).toBeNull()
    expect(
      inspectTopologyMeasurements(snapshot(), measuredRebuild(), {
        ...target,
        outputRole: "missing",
      }),
    ).toBeNull()
    expect(inspectTopologyMeasurements(snapshot(), { ok: false }, target)).toBeNull()
  })
})

const plane = (
  direction: readonly [number, number, number],
  centroid: readonly [number, number, number],
): TopologyMeasurementElement => ({
  id: "plane",
  kind: "face",
  geometryClass: "PLANE",
  measure: 10,
  points: [],
  direction,
  centroid,
})

describe("explicit point and direction measurements", () => {
  it("measures spatial point distance, acute unoriented angles and parallel support plane separation", () => {
    expect(distanceBetweenMeasurementPoints([0, 0, 0], [3, 4, 12])).toBe(13)
    const first = plane([0, 0, 1], [0, 0, 0])
    const opposite = plane([0, 0, -1], [10, 20, 7])
    expect(topologyDirectionAngle(first, opposite)).toBe(0)
    expect(parallelPlaneSeparation(first, opposite)).toBe(7)
    const orthogonal = plane([1, 0, 0], [3, 0, 0])
    expect(topologyDirectionAngle(first, orthogonal)).toBe(Math.PI / 2)
    expect(parallelPlaneSeparation(first, orthogonal)).toBeNull()
    expect(
      topologyDirectionAngle(first, {
        ...first,
        direction: undefined,
      } as unknown as TopologyMeasurementElement),
    ).toBeNull()
    expect(parallelPlaneSeparation(first, { ...first, geometryClass: "CYLINDER" })).toBeNull()
  })
})
