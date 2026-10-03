import { projectDocumentSnapshotV1ToV0 } from "@vibeshape/domain"
import { projectAuthoredDocumentSnapshotToV1 } from "@vibeshape/domain/document-v2"
import { createBodyTopologyReferenceProjector } from "@vibeshape/domain/model-body-topology"
import {
  type SurfaceTextureLayer,
  surfaceTextureLayerSchema,
} from "@vibeshape/domain/surface-textures"
import { type TopologyCandidate, topologyCandidateSchema } from "@vibeshape/domain/topology"
import { DOCUMENT_PROTOCOL_VERSION, documentWorkerResponseSchema } from "@vibeshape/protocol"
import { describe, expect, it } from "vitest"
import {
  surfaceTextureProjectFixture,
  textureFixtureId,
  textureSuccess,
} from "../../../tests/fixtures/surface-texture-project"
import { createModelBodyTopologyEvidence } from "./model-body-topology"
import {
  resolveSurfaceTextureExportLayers,
  resolveSurfaceTextureMeshLayer,
} from "./surface-textures"

const fixture = surfaceTextureProjectFixture()
const snapshot = textureSuccess(
  projectDocumentSnapshotV1ToV0(projectAuthoredDocumentSnapshotToV1(fixture.snapshot)),
).snapshot
const signature = {
  kind: "face",
  geometryClass: "PLANE",
  measure: 100,
  centroid: [5, 5, 0],
  bounds: { min: [0, 0, 0], max: [10, 10, 0] },
  boundaryCount: 4,
  adjacentGeometryClasses: ["PLANE"],
}
function candidate(id: number, semanticRole?: string): TopologyCandidate {
  return topologyCandidateSchema.parse({
    candidateId: `face:${id}`,
    meshFaceId: id,
    kind: "face",
    semanticRole,
    lineageTokens: [],
    signature,
  })
}
function report(
  candidates = [candidate(7, "cap")],
  outputRole = "result",
  revision = snapshot.revision,
) {
  const shape = {
    valid: true,
    volume: 1_000,
    surfaceArea: 600,
    bounds: { min: [0, 0, 0], max: [10, 10, 10] },
    faceCount: candidates.length,
    edgeCount: 0,
    solidCount: 1,
  }
  const mesh = {
    positions: new Float32Array([0, 0, 0]),
    normals: new Float32Array([0, 0, 1]),
    indices: new Uint32Array([0, 0, 0]),
    triangleFaceIds: new Uint32Array([7]),
  }
  const response = documentWorkerResponseSchema.parse({
    protocolVersion: DOCUMENT_PROTOCOL_VERSION,
    requestId: textureFixtureId(900),
    documentId: snapshot.id,
    revision,
    generation: 1,
    type: "documentRebuilt",
    evaluation: {
      records: [
        { featureId: fixture.layer.featureId, status: "succeeded", contentHash: "a".repeat(64) },
      ],
      dirtyFeatureIds: [],
      evaluatedFeatureIds: [],
      reusedFeatureIds: [],
    },
    geometry: [
      {
        featureId: fixture.layer.featureId,
        contentHash: "a".repeat(64),
        meshPolicy: { chordTolerance: 0.01, angularTolerance: 0.1 },
        geometry: {
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
          shape,
          mesh,
          topologyCandidates: [],
          bodies: [{ outputRole, shape, mesh, topologyCandidates: candidates }],
          cache: { brepHit: false },
          timings: { evaluationMs: 1, tessellationMs: 1, totalMs: 2 },
        },
      },
    ],
    sketches: [],
    modelReferenceEvidence: [],
  })
  if (response.type !== "documentRebuilt") throw new Error("Wrong test response type")
  return { snapshot, rebuild: { ok: true as const, response } }
}
function faceLayer(source = report()): SurfaceTextureLayer {
  const evidence = createModelBodyTopologyEvidence(source.snapshot, source.rebuild, {
    featureId: fixture.layer.featureId,
    outputRole: "result",
    kind: "face",
  })
  if (!evidence.ok || !evidence.evidence.candidates[0]) throw new Error("Invalid fixture evidence")
  const reference = createBodyTopologyReferenceProjector(evidence.evidence)(
    evidence.evidence.candidates[0],
  )
  return surfaceTextureLayerSchema.parse({
    ...fixture.layer,
    target: { kind: "faces", outputRole: "result", refs: [reference] },
  })
}

describe("surface texture semantic target projection", () => {
  it("derives fresh face IDs while persisting only body-scoped semantic intent", () => {
    const layer = faceLayer()
    const persisted = JSON.parse(JSON.stringify(layer))
    expect(JSON.stringify(persisted)).not.toContain("candidateId")
    expect(JSON.stringify(persisted)).not.toContain("meshFaceId")
    expect(
      resolveSurfaceTextureMeshLayer(report([candidate(21, "cap")]), persisted).targetFaceIds,
    ).toEqual([21])
    expect(layer.target.kind).toBe("faces")
    expect(JSON.parse(JSON.stringify(layer))).toEqual(persisted)
  })

  it("refuses missing or ambiguous topology instead of silently selecting a face", () => {
    const layer = faceLayer(report([candidate(7)]))
    expect(() =>
      resolveSurfaceTextureMeshLayer(report([candidate(8), candidate(9)]), layer),
    ).toThrow("missing or ambiguous")
    const missing = candidate(8)
    expect(() =>
      resolveSurfaceTextureMeshLayer(
        report([{ ...missing, signature: { ...missing.signature, geometryClass: "SPHERE" } }]),
        layer,
      ),
    ).toThrow("missing or ambiguous")
  })

  it("requires the exact output role and current source revision", () => {
    const layer = faceLayer()
    expect(() =>
      resolveSurfaceTextureMeshLayer(report([candidate(7, "cap")], "other"), layer),
    ).toThrow("unavailable")
    expect(() =>
      resolveSurfaceTextureMeshLayer(
        report([candidate(7, "cap")], "result", snapshot.revision + 1),
        layer,
      ),
    ).toThrow("unavailable")
    if (layer.target.kind !== "faces") throw new Error("Expected face target")
    expect(
      surfaceTextureLayerSchema.safeParse({
        ...layer,
        target: {
          ...layer.target,
          refs: layer.target.refs.map((ref) => ({ ...ref, outputRole: "other" })),
        },
      }).success,
    ).toBe(false)
  })

  it("excludes disabled and unexported body layers from manufacturing groups", () => {
    const layer = faceLayer()
    expect(
      resolveSurfaceTextureExportLayers(
        report(),
        [layer],
        [{ featureId: layer.featureId, outputRole: "other" }],
      ),
    ).toEqual([])
    expect(resolveSurfaceTextureExportLayers(report(), [{ ...layer, enabled: false }])).toEqual([])
    expect(
      resolveSurfaceTextureExportLayers(report(), [layer], [{ featureId: layer.featureId }]),
    ).toMatchObject([
      { featureId: layer.featureId, outputRole: "result", layers: [{ targetFaceIds: [7] }] },
    ])
  })
})
