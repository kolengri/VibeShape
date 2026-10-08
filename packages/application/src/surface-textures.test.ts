import { describe, expect, it } from "bun:test"
import { projectDocumentSnapshotV1ToV0 } from "@vibeshape/domain"
import { projectAuthoredDocumentSnapshotToV1 } from "@vibeshape/domain/document-v2"
import { createBodyTopologyReferenceProjector } from "@vibeshape/domain/model-body-topology"
import {
  type SurfaceTextureLayer,
  surfaceTextureLayerSchema,
} from "@vibeshape/domain/surface-textures"
import {
  DOCUMENT_PROTOCOL_VERSION,
  documentWorkerResponseSchema,
  type TopologyCandidate,
  topologyCandidateSchema,
} from "@vibeshape/protocol"
import {
  surfaceTextureProjectFixture,
  textureFixtureId,
  textureSuccess,
} from "../../../tests/fixtures/surface-texture-project"
import { vi } from "../../../tests/unit/support/bun-test"
import { createModelBodyTopologyEvidence } from "./model-body-topology"
import {
  previewSurfaceTextureRelief,
  projectSurfaceTextureFaceReference,
  resolveSurfaceTextureExportLayers,
  resolveSurfaceTextureMeshLayer,
  type SurfaceTextureReliefWorker,
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
function candidate(id: number, semanticRole?: string, meshFaceId = id): TopologyCandidate {
  return topologyCandidateSchema.parse({
    candidateId: `face:${id}`,
    meshFaceId,
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
  it("joins semantic candidates to actual mesh face IDs without persisting either transient ID", () => {
    const source = report([candidate(7, "cap", 700)])
    const reference = projectSurfaceTextureFaceReference(source, {
      featureId: fixture.layer.featureId,
      outputRole: "result",
      meshFaceId: 700,
    })
    expect(reference).not.toBeNull()
    expect(JSON.stringify(reference)).not.toContain("700")
    expect(
      projectSurfaceTextureFaceReference(source, {
        featureId: fixture.layer.featureId,
        outputRole: "result",
        meshFaceId: 7,
      }),
    ).toBeNull()
    const layer = surfaceTextureLayerSchema.parse({
      ...fixture.layer,
      target: { kind: "faces", outputRole: "result", refs: [reference] },
    })
    expect(
      resolveSurfaceTextureMeshLayer(report([candidate(21, "cap", 211)]), layer).targetFaceIds,
    ).toEqual([211])
    const unmapped = candidate(21, "cap", 211)
    delete unmapped.meshFaceId
    expect(() => resolveSurfaceTextureMeshLayer(report([unmapped]), layer)).toThrow("current mesh")
  })
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

describe("shared native surface relief preview lifecycle", () => {
  function sourceFixture() {
    const current = report()
    const mesh = current.rebuild.response.geometry?.[0]?.geometry.mesh
    if (!mesh) throw new Error("The source fixture mesh is missing")
    return {
      current,
      source: { featureId: fixture.layer.featureId, outputRole: "result", ...mesh },
    }
  }

  it("resolves current face IDs and copies every mesh buffer before worker ownership", async () => {
    const { current, source } = sourceFixture()
    const terminate = vi.fn()
    const preview = vi.fn<SurfaceTextureReliefWorker["preview"]>(async (context, mesh, layers) => {
      expect(context).toMatchObject({
        documentId: snapshot.id,
        revision: snapshot.revision,
        outputRole: "result",
      })
      expect(layers[0]?.targetFaceIds).toEqual([7])
      for (const field of ["positions", "normals", "indices", "triangleFaceIds"] as const) {
        expect(mesh[field]).not.toBe(source[field])
        expect(mesh[field].buffer).not.toBe(source[field].buffer)
      }
      mesh.positions[0] = 99
      return mesh
    })
    const results = await previewSurfaceTextureRelief({
      report: current,
      layers: [faceLayer(current)],
      sources: [source],
      createWorker: () => ({ preview, terminate }),
    })
    expect(results[0]?.source).toBe(source)
    expect(results[0]?.mesh.positions[0]).toBe(99)
    expect(source.positions[0]).toBe(0)
    expect(terminate).toHaveBeenCalledTimes(1)
  })

  it("rejects hidden, duplicate or stale topology sources before creating a worker", async () => {
    const { current, source } = sourceFixture()
    const createWorker = vi.fn<() => SurfaceTextureReliefWorker>()
    await expect(
      previewSurfaceTextureRelief({
        report: current,
        layers: [fixture.layer],
        requiredLayers: [fixture.layer],
        sources: [],
        createWorker,
      }),
    ).rejects.toThrow("Show the textured body")
    await expect(
      previewSurfaceTextureRelief({
        report: current,
        layers: [fixture.layer],
        sources: [source, source],
        createWorker,
      }),
    ).rejects.toThrow("ambiguous")
    await expect(
      previewSurfaceTextureRelief({
        report: report([candidate(7)], "result", snapshot.revision + 1),
        layers: [faceLayer(current)],
        sources: [source],
        createWorker,
      }),
    ).rejects.toThrow("unavailable")
    expect(createWorker).not.toHaveBeenCalled()
    expect(
      await previewSurfaceTextureRelief({
        report: current,
        layers: [{ ...fixture.layer, enabled: false }],
        sources: [source],
        createWorker,
      }),
    ).toEqual([])
  })

  it("terminates once on native rejection and abort, including a worker that does not settle on termination", async () => {
    const { current, source } = sourceFixture()
    const failed = {
      preview: vi.fn<SurfaceTextureReliefWorker["preview"]>(async () => {
        throw new Error("Invalid displacement")
      }),
      terminate: vi.fn(),
    }
    await expect(
      previewSurfaceTextureRelief({
        report: current,
        layers: [fixture.layer],
        sources: [source],
        createWorker: () => failed,
      }),
    ).rejects.toThrow("Invalid displacement")
    expect(failed.terminate).toHaveBeenCalledTimes(1)
    let aborted = false
    let listener: () => void = () => undefined
    const signal = {
      get aborted() {
        return aborted
      },
      addEventListener: (_type: "abort", callback: () => void) => {
        listener = callback
      },
      removeEventListener: vi.fn(),
    }
    const blocked = {
      preview: vi.fn<SurfaceTextureReliefWorker["preview"]>(() => new Promise(() => undefined)),
      terminate: vi.fn(),
    }
    const pending = previewSurfaceTextureRelief({
      report: current,
      layers: [fixture.layer],
      sources: [source],
      createWorker: () => blocked,
      signal,
    })
    aborted = true
    listener()
    await expect(pending).rejects.toThrow("cancelled")
    expect(blocked.terminate).toHaveBeenCalledTimes(1)
    expect(signal.removeEventListener).toHaveBeenCalledTimes(1)
  })
})
