import type { FeatureGeometryRecord } from "@vibeshape/application/feature-rebuild"
import type { SupportFrame } from "@vibeshape/application/support-frame"
import {
  featureIdSchema,
  sketchEntityIdSchema,
  sketchRecordSchema,
  type TopologySignature,
} from "@vibeshape/domain"
import type { TopologyCandidate } from "@vibeshape/protocol"
import { describe, expect, it } from "vitest"
import {
  applyExternalModelCandidate,
  externalModelGeometryCandidates,
} from "./external-model-geometry"

const featureId = featureIdSchema.parse("0195b5ac-b220-7a2c-8c33-000000005001")
const hiddenFeatureId = featureIdSchema.parse("0195b5ac-b220-7a2c-8c33-000000005002")
const sketchId = "0195b5ac-b220-7a2c-8c33-000000005003"
const selectedPointId = sketchEntityIdSchema.parse("0195b5ac-b220-7a2c-8c33-000000005004")
const labels = {
  line: (feature: string, ordinal: number) => `${feature} · Edge ${ordinal}`,
  point: (feature: string, ordinal: number) => `${feature} · Vertex ${ordinal}`,
}
const targetFrame: SupportFrame = {
  origin: [0, 0, 0],
  xAxis: [1, 0, 0],
  yAxis: [0, 1, 0],
  normal: [0, 0, 1],
}

function signature(
  kind: TopologySignature["kind"],
  geometryClass: string,
  centroid: readonly [number, number, number],
): TopologySignature {
  return {
    kind,
    geometryClass,
    measure: kind === "vertex" ? 0 : 10,
    centroid: [...centroid],
    bounds: { min: [...centroid], max: [...centroid] },
    boundaryCount: kind === "vertex" ? 0 : 2,
    adjacentGeometryClasses: [],
  }
}

function pointCandidate(
  candidateId: string,
  position: readonly [number, number, number],
  semanticRole = `vertex:${candidateId}`,
): TopologyCandidate {
  return {
    candidateId,
    kind: "vertex",
    semanticRole,
    lineageTokens: [],
    signature: signature("vertex", "POINT", position),
    referenceGeometry: { kind: "vertex", position: [...position] },
  }
}

function lineCandidate(
  candidateId: string,
  start: readonly [number, number, number],
  end: readonly [number, number, number],
): TopologyCandidate {
  return {
    candidateId,
    kind: "edge",
    semanticRole: `edge:${candidateId}`,
    lineageTokens: [],
    signature: signature("edge", "LINE", [
      (start[0] + end[0]) / 2,
      (start[1] + end[1]) / 2,
      (start[2] + end[2]) / 2,
    ]),
    referenceGeometry: { kind: "line-edge", start: [...start], end: [...end] },
  }
}

function geometryRecord(
  id: string,
  topologyCandidates: readonly TopologyCandidate[],
): FeatureGeometryRecord {
  return {
    featureId: featureIdSchema.parse(id),
    geometry: { topologyCandidates },
  } as unknown as FeatureGeometryRecord
}

function draft(externalReferences: unknown[] = []) {
  return sketchRecordSchema.parse({
    schemaVersion: 0,
    id: sketchId,
    label: "Detail sketch",
    plane: "xy",
    entities: [
      {
        schemaVersion: 0,
        id: selectedPointId,
        type: "point",
        x: 0,
        y: 0,
      },
    ],
    constraints: [],
    externalReferences,
  })
}

const features = [
  { id: featureId, label: "Mount" },
  { id: hiddenFeatureId, label: "Hidden body" },
] as const

describe("external model geometry candidates", () => {
  it("offers exact vertices and linear edges from visible model features", () => {
    const candidates = externalModelGeometryCandidates(
      [
        geometryRecord(featureId, [
          pointCandidate("vertex-1", [1, 2, 3]),
          lineCandidate("edge-1", [0, 0, 0], [10, 0, 0]),
          {
            candidateId: "circle-1",
            kind: "edge",
            lineageTokens: [],
            signature: signature("edge", "CIRCLE", [0, 0, 0]),
          },
        ]),
        geometryRecord(hiddenFeatureId, [pointCandidate("hidden-vertex", [9, 9, 9])]),
      ],
      features as never,
      [featureId],
      draft(),
      targetFrame,
      labels,
    )

    expect(candidates).toHaveLength(2)
    expect(candidates).toContainEqual(
      expect.objectContaining({
        candidateId: "vertex-1",
        kind: "model-point",
        label: "Mount · Vertex 1",
        position: [1, 2, 3],
        reference: expect.objectContaining({
          featureId,
          kind: "vertex",
          semanticRole: "vertex:vertex-1",
        }),
      }),
    )
    expect(candidates).toContainEqual(
      expect.objectContaining({
        candidateId: "edge-1",
        kind: "model-line",
        label: "Mount · Edge 1",
        start: { world: [0, 0, 0], x: 0, y: 0 },
        end: { world: [10, 0, 0], x: 10, y: 0 },
      }),
    )
    expect(JSON.stringify(candidates[0]?.reference)).not.toContain("candidateId")
    expect(JSON.stringify(candidates[0]?.reference)).not.toContain("referenceGeometry")
  })

  it("does not offer a model element already referenced by stable semantic identity", () => {
    const current = pointCandidate("rebuilt-vertex", [4, 5, 6], "box:corner:min-min-min")
    const existingReference = {
      schemaVersion: 0,
      id: "0195b5ac-b220-7a2c-8c33-000000005005",
      kind: "model-point",
      reference: {
        schemaVersion: 0,
        featureId,
        kind: "vertex",
        semanticRole: "box:corner:min-min-min",
        signature: signature("vertex", "POINT", [1, 2, 3]),
      },
      projectedPointId: "0195b5ac-b220-7a2c-8c33-000000005006",
    }

    expect(
      externalModelGeometryCandidates(
        [geometryRecord(featureId, [current])],
        features as never,
        [featureId],
        draft([existingReference]),
        targetFrame,
        labels,
      ),
    ).toEqual([])
  })

  it("keeps ambiguous candidates available instead of hiding an arbitrary match", () => {
    const sharedRole = "coincident:vertex"
    const existingReference = {
      schemaVersion: 0,
      id: "0195b5ac-b220-7a2c-8c33-000000005007",
      kind: "model-point",
      reference: {
        schemaVersion: 0,
        featureId,
        kind: "vertex",
        semanticRole: sharedRole,
        signature: signature("vertex", "POINT", [0, 0, 0]),
      },
      projectedPointId: "0195b5ac-b220-7a2c-8c33-000000005008",
    }
    const candidates = externalModelGeometryCandidates(
      [
        geometryRecord(featureId, [
          pointCandidate("first", [0, 0, 0], sharedRole),
          pointCandidate("second", [0, 0, 0], sharedRole),
        ]),
      ],
      features as never,
      [featureId],
      draft([existingReference]),
      targetFrame,
      labels,
    )

    expect(candidates.map(({ candidateId }) => candidateId)).toEqual(["first", "second"])
  })
})

describe("apply external model candidate", () => {
  it("creates a projected model point and attaches it to one selected authored point", () => {
    const [candidate] = externalModelGeometryCandidates(
      [geometryRecord(featureId, [pointCandidate("vertex-1", [1, 2, 3])])],
      features as never,
      [featureId],
      draft(),
      targetFrame,
      labels,
    )
    if (!candidate) throw new Error("Expected a model point candidate.")

    const result = sketchRecordSchema.parse(
      applyExternalModelCandidate(draft(), candidate, [selectedPointId]),
    )
    const reference = result.externalReferences?.[0]
    expect(reference).toEqual(
      expect.objectContaining({ kind: "model-point", reference: candidate.reference }),
    )
    expect(result.constraints).toContainEqual(
      expect.objectContaining({
        type: "coincident",
        firstPointId: selectedPointId,
        secondPointId: reference?.kind === "model-point" ? reference.projectedPointId : undefined,
      }),
    )
  })

  it("creates distinct projected identities for a model line", () => {
    const [candidate] = externalModelGeometryCandidates(
      [geometryRecord(featureId, [lineCandidate("edge-1", [0, 0, 0], [10, 0, 0])])],
      features as never,
      [featureId],
      draft(),
      targetFrame,
      labels,
    )
    if (!candidate) throw new Error("Expected a model line candidate.")

    const result = sketchRecordSchema.parse(applyExternalModelCandidate(draft(), candidate, []))
    const reference = result.externalReferences?.[0]
    expect(reference?.kind).toBe("model-line")
    if (reference?.kind !== "model-line") throw new Error("Expected a model line reference.")
    expect(
      new Set([
        reference.projectedLineId,
        reference.projectedStartPointId,
        reference.projectedEndPointId,
      ]).size,
    ).toBe(3)
  })
})
