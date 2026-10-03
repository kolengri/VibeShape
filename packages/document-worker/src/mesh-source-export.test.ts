import type { FeatureRebuildState } from "@vibeshape/application/feature-rebuild"
import { type ModelBodyGeometry, terminalBodyGeometry } from "@vibeshape/application/model-bodies"
import { featureIdSchema } from "@vibeshape/domain"
import { ReplicadGeometryEngine } from "@vibeshape/geometry-worker/engine"
import { surfaceTextureMeshLayerSchema } from "@vibeshape/protocol"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { collectDocumentPrintMeshes } from "./mesh-source-export"

vi.mock("@vibeshape/application/model-bodies", () => ({ terminalBodyGeometry: vi.fn() }))

const state: FeatureRebuildState = {
  documentId: "mixed-export",
  revision: 1,
  generation: 1,
  features: [],
  geometry: [],
  evaluation: { records: [], dirtyFeatureIds: [], evaluatedFeatureIds: [], reusedFeatureIds: [] },
  environment: {
    schemaVersion: 0,
    hostApiVersion: "0.1.0",
    geometry: {
      adapterId: "org.vibeshape.geometry.replicad",
      adapterVersion: "mixed-export-test",
      kernelId: "org.opencascade.occt",
      kernelVersion: "0.23.0",
      kernelSourceRevision: null,
    },
    modelingTolerancePolicyVersion: 1,
    provider: { kind: "built-in" },
  },
  mesh: { chordTolerance: 0.05, angularTolerance: 0.1 },
}
function body(index: number, representation: "exact-solid" | "triangle-mesh"): ModelBodyGeometry {
  return {
    featureId: featureIdSchema.parse(`0195b5ac-b220-7a2c-8c33-${String(index).padStart(12, "0")}`),
    contentHash: "a".repeat(64),
    outputRole: "result",
    representation,
    topologyCandidates: [],
    shape: {
      valid: true,
      volume: representation === "exact-solid" ? 1 : 0,
      surfaceArea: 1,
      solidCount: representation === "exact-solid" ? 1 : 0,
      faceCount: 0,
      edgeCount: 0,
      bounds: { min: [0, 0, 0], max: [1, 1, 1] },
    },
    mesh: {
      positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
      normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
      indices: new Uint32Array([0, 1, 2]),
      triangleFaceIds: new Uint32Array([0]),
    },
  }
}
const exact = body(1, "exact-solid")
const mesh = body(2, "triangle-mesh")
function selection(value: ModelBodyGeometry) {
  return {
    featureId: value.featureId,
    contentHash: value.contentHash,
    outputRole: value.outputRole,
  }
}
function textureOptions(value: ModelBodyGeometry, enabled = true) {
  return {
    textureQuality: { maxEdgeLengthMm: 1, maxTriangles: 2_000 },
    surfaceTextures: [
      {
        featureId: value.featureId,
        outputRole: "result",
        layers: [
          surfaceTextureMeshLayerSchema.parse({
            id: "layer",
            enabled,
            targetFaceIds: null,
            mask: { base: "all", strokes: [] },
            map: { kind: "builtin", pattern: "ridges" },
            mapping: { kind: "planar", axis: "z" },
            heightMm: 0.3,
            sizeUMm: 5,
            sizeVMm: 5,
            rotationDeg: 0,
            offsetUMm: 0,
            offsetVMm: 0,
            direction: "outward",
            invert: false,
            boundaryFadeMm: 0,
            blend: "add",
          }),
        ],
      },
    ],
  }
}
beforeEach(() => vi.mocked(terminalBodyGeometry).mockReturnValue([exact, mesh]))

describe("mixed exact and imported mesh export", () => {
  it("forwards relief options only with exact native selections and retains authored selection order", async () => {
    const engine = new ReplicadGeometryEngine()
    const nativeMesh = {
      featureId: exact.featureId,
      outputRole: "result",
      vertices: [10, 0, 0, 11, 0, 0, 10, 1, 0],
      triangles: [0, 1, 2],
    }
    const exported = vi
      .spyOn(engine, "exportPrintMeshes")
      .mockResolvedValue({ meshes: [nativeMesh] })
    const options = textureOptions(exact)
    const result = await collectDocumentPrintMeshes(
      engine,
      state.documentId,
      state,
      [selection(mesh), selection(exact)],
      options,
    )
    expect(exported).toHaveBeenCalledWith({
      documentId: state.documentId,
      features: [selection(exact)],
      ...options,
    })
    expect(result.meshes).toEqual([
      {
        featureId: mesh.featureId,
        outputRole: mesh.outputRole,
        vertices: Array.from(mesh.mesh.positions),
        triangles: Array.from(mesh.mesh.indices),
      },
      nativeMesh,
    ])
  })
  it.each([false, true])(
    "rejects an enabled mesh relief target with mixed selection %s",
    async (mixed) => {
      const engine = new ReplicadGeometryEngine()
      const exported = vi.spyOn(engine, "exportPrintMeshes")
      const features = mixed ? [selection(mesh), selection(exact)] : [selection(mesh)]
      await expect(
        collectDocumentPrintMeshes(engine, state.documentId, state, features, textureOptions(mesh)),
      ).rejects.toThrow(/selected exact solid body/)
      expect(exported).not.toHaveBeenCalled()
    },
  )
  it("retains ordinary mesh export when its optional relief layer is disabled", async () => {
    const engine = new ReplicadGeometryEngine()
    const exported = vi.spyOn(engine, "exportPrintMeshes")
    const result = await collectDocumentPrintMeshes(
      engine,
      state.documentId,
      state,
      [selection(mesh)],
      textureOptions(mesh, false),
    )
    expect(result.meshes[0]?.vertices).toEqual(Array.from(mesh.mesh.positions))
    expect(exported).not.toHaveBeenCalled()
  })
})
