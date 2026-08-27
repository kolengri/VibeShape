import type { FeatureGeometryRecord } from "@vibeshape/application/feature-rebuild"
import type { SupportFrame } from "@vibeshape/application/support-frame"
import {
  featureIdSchema,
  type PlanarFaceTopoRef,
  sketchEntityIdSchema,
  sketchRecordSchema,
  type TopologySignature,
} from "@vibeshape/domain"
import type { TopologyCandidate } from "@vibeshape/protocol"
import { describe, expect, it } from "vitest"
import {
  applyExternalModelCandidate,
  applyExternalModelCandidateSelection,
  applyExternalModelIntersection,
  availableExternalModelGeometryCandidates,
  externalModelGeometryCandidates,
  externalModelReferenceLabels,
  planarFaceCanIntersectSketch,
  projectExternalModelGeometryCandidates,
  repairExternalModelGeometryCandidates,
  resolvePlanarFaceSupportLabel,
} from "./external-model-geometry"

const featureId = featureIdSchema.parse("0195b5ac-b220-7a2c-8c33-000000005001")
const hiddenFeatureId = featureIdSchema.parse("0195b5ac-b220-7a2c-8c33-000000005002")
const sketchId = "0195b5ac-b220-7a2c-8c33-000000005003"
const selectedPointId = sketchEntityIdSchema.parse("0195b5ac-b220-7a2c-8c33-000000005004")
const labels = {
  curve: (feature: string, kind: "arc" | "circle", ordinal: number) =>
    `${feature} · ${kind} ${ordinal}`,
  face: (feature: string, ordinal: number) => `${feature} · Face ${ordinal}`,
  line: (feature: string, ordinal: number) => `${feature} · Edge ${ordinal}`,
  point: (feature: string, ordinal: number) => `${feature} · Vertex ${ordinal}`,
  problem: (feature: string, kind: string, status: string) => `${feature} · ${status} ${kind}`,
  unknownFeature: "Unknown feature",
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

function circleCandidate(candidateId: string): TopologyCandidate {
  return {
    candidateId,
    kind: "edge",
    semanticRole: `edge:${candidateId}`,
    lineageTokens: [],
    signature: signature("edge", "CIRCLE", [2, 3, 0]),
    referenceGeometry: {
      kind: "circle-edge",
      center: [2, 3, 0],
      xAxis: [1, 0, 0],
      yAxis: [0, 1, 0],
      normal: [0, 0, 1],
      radius: 5,
    },
  }
}

function faceCandidate(candidateId: string, semanticRole: string): TopologyCandidate {
  return {
    candidateId,
    kind: "face",
    meshFaceId: 1,
    semanticRole,
    lineageTokens: [],
    signature: {
      ...signature("face", "PLANE", [0, 0, 5]),
      direction: [0, 0, 1],
      directionMode: "oriented",
    },
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
  it("resolves stable support-face labels across renamed features and rebuild order", () => {
    const firstFace = faceCandidate("face-a", "primitive.box.face.a")
    const secondFace = faceCandidate("face-b", "primitive.box.face.b")
    const reference: PlanarFaceTopoRef = {
      schemaVersion: 0,
      featureId,
      kind: "face",
      semanticRole: secondFace.semanticRole,
      signature: {
        ...secondFace.signature,
        kind: "face",
        geometryClass: "PLANE",
      },
    }
    const label = (candidateOrder: readonly TopologyCandidate[], featureName = "Mount") =>
      resolvePlanarFaceSupportLabel(
        [geometryRecord(featureId, candidateOrder)],
        [{ id: featureId, label: featureName }] as never,
        reference,
        labels,
      )

    expect(label([firstFace, secondFace])).toBe("Mount · Face 2")
    expect(label([secondFace, firstFace], "Renamed mount")).toBe("Renamed mount · Face 2")
    expect(
      resolvePlanarFaceSupportLabel(
        [geometryRecord(featureId, [firstFace])],
        features as never,
        reference,
        labels,
      ),
    ).toBeNull()
  })

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

  it("offers one exact projected curve candidate for a circular model edge", () => {
    const candidates = externalModelGeometryCandidates(
      [geometryRecord(featureId, [circleCandidate("circle-1")])],
      features as never,
      [featureId],
      draft(),
      targetFrame,
      labels,
    )

    expect(candidates).toHaveLength(1)
    expect(candidates[0]).toEqual(
      expect.objectContaining({
        candidateId: "circle-1",
        kind: "model-curve",
        label: "Mount · circle 1",
        projectedType: "circle",
        sourceType: "circle",
      }),
    )
    expect(candidates[0]?.kind === "model-curve" ? candidates[0].points : []).toHaveLength(65)
  })

  it("does not duplicate a circular edge after its transient candidate identity changes", () => {
    const current = circleCandidate("rebuilt-circle")
    current.semanticRole = "primitive.cylinder.edge.start"
    const existingReference = {
      schemaVersion: 0,
      id: "0195b5ac-b220-7a2c-8c33-000000005009",
      kind: "model-curve",
      reference: {
        schemaVersion: 0,
        featureId,
        kind: "edge",
        semanticRole: "primitive.cylinder.edge.start",
        signature: signature("edge", "CIRCLE", [2, 3, 0]),
      },
      sourceType: "circle",
      projectedEntityId: "0195b5ac-b220-7a2c-8c33-000000005010",
      projectedType: "circle",
      projectedPointIds: ["0195b5ac-b220-7a2c-8c33-000000005011"],
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

  it("reuses projected circular samples while draft-only availability changes", () => {
    const records = [geometryRecord(featureId, [circleCandidate("circle-1")])]
    const projected = projectExternalModelGeometryCandidates(
      records,
      features as never,
      [featureId],
      targetFrame,
      labels,
    )
    const available = availableExternalModelGeometryCandidates(projected, records, draft())

    expect(available[0]).toBe(projected[0])
    expect(available[0]?.kind === "model-curve" ? available[0].points : []).toBe(
      projected[0]?.kind === "model-curve" ? projected[0].points : undefined,
    )
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

describe("external model reference labels", () => {
  it("resolves persisted topology intent back to friendly feature geometry labels", () => {
    const edge = lineCandidate("rebuilt-edge", [0, 0, 5], [10, 0, 5])
    edge.semanticRole = "primitive.box.edge.y.x-min.z-max"
    const face = faceCandidate("rebuilt-face", "primitive.box.face.z-max")
    const vertex = pointCandidate(
      "rebuilt-vertex",
      [0, 0, 5],
      "primitive.box.vertex.x-min.y-min.z-max",
    )
    const curve = circleCandidate("rebuilt-curve")
    curve.semanticRole = "primitive.cylinder.edge.start"
    const sketch = draft([
      {
        schemaVersion: 0,
        id: "0195b5ac-b220-7a2c-8c33-000000005020",
        kind: "model-line",
        reference: {
          schemaVersion: 0,
          featureId,
          kind: "edge",
          semanticRole: edge.semanticRole,
          signature: signature("edge", "LINE", [100, 100, 100]),
        },
        projectedLineId: "0195b5ac-b220-7a2c-8c33-000000005021",
        projectedStartPointId: "0195b5ac-b220-7a2c-8c33-000000005022",
        projectedEndPointId: "0195b5ac-b220-7a2c-8c33-000000005023",
      },
      {
        schemaVersion: 0,
        id: "0195b5ac-b220-7a2c-8c33-000000005024",
        kind: "model-intersection",
        reference: {
          schemaVersion: 0,
          featureId,
          kind: "face",
          semanticRole: face.semanticRole,
          signature: face.signature,
        },
        projectedLineId: "0195b5ac-b220-7a2c-8c33-000000005025",
        projectedStartPointId: "0195b5ac-b220-7a2c-8c33-000000005026",
        projectedEndPointId: "0195b5ac-b220-7a2c-8c33-000000005027",
      },
      {
        schemaVersion: 0,
        id: "0195b5ac-b220-7a2c-8c33-000000005034",
        kind: "model-point",
        reference: {
          schemaVersion: 0,
          featureId,
          kind: "vertex",
          semanticRole: vertex.semanticRole,
          signature: vertex.signature,
        },
        projectedPointId: "0195b5ac-b220-7a2c-8c33-000000005035",
      },
      {
        schemaVersion: 0,
        id: "0195b5ac-b220-7a2c-8c33-000000005036",
        kind: "model-curve",
        reference: {
          schemaVersion: 0,
          featureId,
          kind: "edge",
          semanticRole: curve.semanticRole,
          signature: curve.signature,
        },
        sourceType: "circle",
        projectedEntityId: "0195b5ac-b220-7a2c-8c33-000000005037",
        projectedType: "circle",
        projectedPointIds: ["0195b5ac-b220-7a2c-8c33-000000005038"],
      },
    ])

    expect([
      ...externalModelReferenceLabels(
        [geometryRecord(featureId, [edge, face, vertex, curve])],
        features as never,
        sketch.externalReferences,
        labels,
      ).values(),
    ]).toEqual(["Mount · Edge 1", "Mount · Face 1", "Mount · Vertex 1", "Mount · circle 1"])

    const renamedFeatures = features.map((feature) =>
      feature.id === featureId ? { ...feature, label: "Renamed mount" } : feature,
    )
    expect([
      ...externalModelReferenceLabels(
        [geometryRecord(featureId, [edge, face, vertex, curve])],
        renamedFeatures as never,
        sketch.externalReferences,
        labels,
      ).values(),
    ]).toEqual([
      "Renamed mount · Edge 1",
      "Renamed mount · Face 1",
      "Renamed mount · Vertex 1",
      "Renamed mount · circle 1",
    ])
  })

  it("keeps a semantic edge ordinal stable across evaluation-order changes", () => {
    const roleA = "primitive.box.edge.a"
    const roleB = "primitive.box.edge.b"
    const firstA = lineCandidate("edge:0", [0, 0, 0], [10, 0, 0])
    const firstB = lineCandidate("edge:1", [0, 10, 0], [10, 10, 0])
    firstA.semanticRole = roleA
    firstB.semanticRole = roleB
    const rebuiltB = lineCandidate("edge:0", [0, 10, 0], [10, 10, 0])
    const rebuiltA = lineCandidate("edge:1", [0, 0, 0], [10, 0, 0])
    rebuiltA.semanticRole = roleA
    rebuiltB.semanticRole = roleB
    const sketch = draft([
      {
        schemaVersion: 0,
        id: "0195b5ac-b220-7a2c-8c33-000000005039",
        kind: "model-line",
        reference: {
          schemaVersion: 0,
          featureId,
          kind: "edge",
          semanticRole: roleB,
          signature: firstB.signature,
        },
        projectedLineId: "0195b5ac-b220-7a2c-8c33-000000005040",
        projectedStartPointId: "0195b5ac-b220-7a2c-8c33-000000005041",
        projectedEndPointId: "0195b5ac-b220-7a2c-8c33-000000005042",
      },
    ])

    const labelFor = (candidates: readonly TopologyCandidate[]) => [
      ...externalModelReferenceLabels(
        [geometryRecord(featureId, candidates)],
        features as never,
        sketch.externalReferences,
        labels,
      ).values(),
    ]

    expect(labelFor([firstA, firstB])).toEqual(["Mount · Edge 2"])
    expect(labelFor([rebuiltB, rebuiltA])).toEqual(["Mount · Edge 2"])
  })

  it("names missing and ambiguous topology without exposing stable internal roles", () => {
    const sharedRole = "primitive.box.vertex.x-min.y-min.z-min"
    const sketch = draft([
      {
        schemaVersion: 0,
        id: "0195b5ac-b220-7a2c-8c33-000000005028",
        kind: "model-point",
        reference: {
          schemaVersion: 0,
          featureId,
          kind: "vertex",
          semanticRole: sharedRole,
          signature: signature("vertex", "POINT", [0, 0, 0]),
        },
        projectedPointId: "0195b5ac-b220-7a2c-8c33-000000005029",
      },
      {
        schemaVersion: 0,
        id: "0195b5ac-b220-7a2c-8c33-000000005030",
        kind: "model-line",
        reference: {
          schemaVersion: 0,
          featureId,
          kind: "edge",
          semanticRole: "primitive.box.edge.removed",
          signature: signature("edge", "LINE", [0, 0, 0]),
        },
        projectedLineId: "0195b5ac-b220-7a2c-8c33-000000005031",
        projectedStartPointId: "0195b5ac-b220-7a2c-8c33-000000005032",
        projectedEndPointId: "0195b5ac-b220-7a2c-8c33-000000005033",
      },
    ])
    const presentations = externalModelReferenceLabels(
      [
        geometryRecord(featureId, [
          pointCandidate("first", [0, 0, 0], sharedRole),
          pointCandidate("second", [0, 0, 0], sharedRole),
        ]),
      ],
      features as never,
      sketch.externalReferences,
      labels,
    )

    expect([...presentations.values()]).toEqual([
      "Mount · ambiguous vertex",
      "Mount · missing edge",
    ])
    expect(JSON.stringify([...presentations.values()])).not.toContain("primitive.box")
  })
})

describe("apply external model candidate", () => {
  it("limits repair to compatible geometry from the same feature and preserves projected IDs", () => {
    const original = lineCandidate("original", [0, 0, 0], [10, 0, 0])
    const replacement = lineCandidate("replacement", [0, 5, 0], [10, 5, 0])
    replacement.semanticRole = "primitive.box.edge.replacement"
    const otherFeature = lineCandidate("other-feature", [0, 10, 0], [10, 10, 0])
    const referenceId = "0195b5ac-b220-7a2c-8c33-000000005043"
    const sketch = draft([
      {
        schemaVersion: 0,
        id: referenceId,
        kind: "model-line",
        reference: {
          schemaVersion: 0,
          featureId,
          kind: "edge",
          semanticRole: original.semanticRole,
          signature: original.signature,
        },
        projectedLineId: "0195b5ac-b220-7a2c-8c33-000000005044",
        projectedStartPointId: "0195b5ac-b220-7a2c-8c33-000000005045",
        projectedEndPointId: "0195b5ac-b220-7a2c-8c33-000000005046",
      },
    ])
    const candidates = [
      ...externalModelGeometryCandidates(
        [geometryRecord(featureId, [replacement])],
        features as never,
        [featureId],
        draft(),
        targetFrame,
        labels,
      ),
      ...externalModelGeometryCandidates(
        [geometryRecord(hiddenFeatureId, [otherFeature])],
        features as never,
        [hiddenFeatureId],
        draft(),
        targetFrame,
        labels,
      ),
    ]
    const repairCandidates = repairExternalModelGeometryCandidates(
      candidates,
      sketch,
      referenceId as never,
    )

    expect(repairCandidates).toHaveLength(1)
    const repairCandidate = repairCandidates[0]
    if (!repairCandidate) throw new Error("A compatible replacement candidate is required.")
    expect(repairCandidate).toMatchObject({ featureId, kind: "model-line" })
    const repaired = applyExternalModelCandidateSelection(
      sketch,
      repairCandidate,
      [],
      referenceId as never,
    )
    expect(repaired.externalReferences?.[0]).toEqual({
      ...sketch.externalReferences?.[0],
      reference: repairCandidate.reference,
    })
  })

  it("rejects planar faces parallel to the sketch before persisting an intersection", () => {
    const reference: PlanarFaceTopoRef = {
      schemaVersion: 0,
      featureId,
      kind: "face",
      signature: {
        ...signature("face", "PLANE", [0, 0, 10]),
        kind: "face",
        geometryClass: "PLANE",
        direction: [0, 0, 1],
        directionMode: "oriented",
      },
    }

    expect(planarFaceCanIntersectSketch(reference, targetFrame)).toBe(false)
    expect(
      planarFaceCanIntersectSketch(
        { ...reference, signature: { ...reference.signature, direction: [1, 0, 0] } },
        targetFrame,
      ),
    ).toBe(true)
  })

  it("persists one stable planar-face intersection without transient selection identity", () => {
    const reference: PlanarFaceTopoRef = {
      schemaVersion: 0,
      featureId,
      kind: "face",
      semanticRole: "primitive.box.side.x-max",
      signature: {
        ...signature("face", "PLANE", [10, 0, 5]),
        kind: "face",
        geometryClass: "PLANE",
        direction: [1, 0, 0],
        directionMode: "oriented",
        boundaryCount: 4,
      },
    }

    const result = sketchRecordSchema.parse(applyExternalModelIntersection(draft(), reference))
    const external = result.externalReferences?.[0]
    expect(external).toEqual(expect.objectContaining({ kind: "model-intersection", reference }))
    if (external?.kind !== "model-intersection") {
      throw new Error("Expected a model intersection reference.")
    }
    expect(
      new Set([
        external.projectedLineId,
        external.projectedStartPointId,
        external.projectedEndPointId,
      ]).size,
    ).toBe(3)
    expect(JSON.stringify(external)).not.toContain("meshFaceId")
    expect(JSON.stringify(external)).not.toContain("candidateId")
  })

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

  it("persists only stable model-curve intent and projected identities", () => {
    const [candidate] = externalModelGeometryCandidates(
      [geometryRecord(featureId, [circleCandidate("circle-1")])],
      features as never,
      [featureId],
      draft(),
      targetFrame,
      labels,
    )
    if (candidate?.kind !== "model-curve") throw new Error("Expected a model curve candidate.")

    const result = sketchRecordSchema.parse(applyExternalModelCandidate(draft(), candidate, []))
    const reference = result.externalReferences?.[0]
    expect(reference).toEqual(
      expect.objectContaining({
        kind: "model-curve",
        reference: candidate.reference,
        sourceType: "circle",
        projectedType: "circle",
      }),
    )
    expect(JSON.stringify(reference)).not.toContain("candidateId")
    expect(JSON.stringify(reference)).not.toContain("referenceGeometry")
  })
})
