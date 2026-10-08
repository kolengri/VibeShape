import { afterAll, beforeAll, describe, expect, it } from "bun:test"
import { writeThreeMfMeshes } from "@vibeshape/formats/three-mf-meshes"
import {
  type FeatureEvaluationInput,
  ReplicadGeometryEngine,
} from "@vibeshape/geometry-worker/engine"
import type { SurfaceTextureMeshLayer } from "@vibeshape/protocol"
import { vi } from "../../../tests/unit/support/bun-test"

const engine = new ReplicadGeometryEngine()
const documentId = "surface-texture-kernel"
const featureId = "0195b5ac-b220-7a2c-8c33-67a36a7f3101"
const contentHash = "a".repeat(64)
beforeAll(async () => {
  const fs = await import("node:fs")
  const wasm = fs.readFileSync(
    new URL("../node_modules/replicad-opencascadejs/src/replicad_single.wasm", import.meta.url),
  )
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(Uint8Array.from(wasm))),
  )
  try {
    await engine.initialize()
  } finally {
    vi.unstubAllGlobals()
  }
})
afterAll(() => {
  engine.disposeDocument(documentId)
})

function input(): FeatureEvaluationInput {
  const environment = engine.getFeatureContentEnvironment()
  if (!environment) throw new Error("Expected initialized geometry environment.")
  return {
    documentId,
    featureId,
    contentHash,
    content: {
      schemaVersion: 0,
      environment,
      feature: {
        schemaVersion: 0,
        type: {
          moduleId: "org.vibeshape.core.part-design",
          moduleVersion: "0.1.0",
          typeId: "org.vibeshape.feature.part-design.box",
          schemaVersion: 1,
        },
        parameters: { width: 10, depth: 10, height: 10, centered: false, origin: [0, 0, 0] },
        inputs: [],
        references: [],
      },
    },
    dependencies: [],
    mesh: { chordTolerance: 0.05, angularTolerance: 0.1 },
  }
}

const texture: SurfaceTextureMeshLayer = {
  id: "kernel-texture",
  enabled: true,
  targetFaceIds: null,
  mask: { base: "all", strokes: [] },
  map: { kind: "custom", width: 1, height: 1, pixels: [255] },
  mapping: { kind: "triplanar", axis: "z" },
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
}

describe("surface texture exact-kernel export", () => {
  it.each([
    { kind: "sphere", parameters: { radius: 5, origin: [0, 0, 0] }, hash: "b" },
    {
      kind: "cylinder",
      parameters: { radius: 5, height: 10, centered: false, origin: [0, 0, 0] },
      hash: "c",
    },
  ])(
    "textures the actual closed $kind tessellation with finite outward normals",
    async ({ kind, parameters, hash }) => {
      const request = input()
      request.contentHash = hash.repeat(64)
      request.content.feature.type = {
        ...request.content.feature.type,
        typeId: `org.vibeshape.feature.part-design.${kind}`,
      }
      request.content.feature.parameters = JSON.parse(JSON.stringify(parameters))
      const evaluated = await engine.evaluateFeature(request, vi.fn())
      if (!evaluated.ok) throw new Error(evaluated.diagnostic.message)
      const exported = await engine.exportPrintMeshes({
        documentId,
        features: [{ featureId, contentHash: request.contentHash, outputRole: "result" }],
        surfaceTextures: [
          {
            featureId,
            outputRole: "result",
            layers: [
              {
                ...texture,
                heightMm: 0.04,
                mapping: { kind: kind === "sphere" ? "spherical" : "cylindrical", axis: "z" },
              },
            ],
          },
        ],
        textureQuality: { maxEdgeLengthMm: 1, maxTriangles: 100_000 },
      })
      expect(exported.meshes[0]?.vertices.every(Number.isFinite)).toBe(true)
      expect(exported.meshes[0]?.triangles.length).toBeGreaterThan(36)
      const after = await engine.evaluateFeature(request, vi.fn())
      if (!after.ok) throw new Error(after.diagnostic.message)
      expect(after.result.shape).toEqual(evaluated.result.shape)
    },
  )

  it("bakes STL and 3MF meshes while preserving exact B-Rep dimensions, volume and STEP", async () => {
    const evaluated = await engine.evaluateFeature(input(), vi.fn())
    if (!evaluated.ok) throw new Error(evaluated.diagnostic.message)
    const base = { documentId, features: [{ featureId, contentHash, outputRole: "result" }] }
    const options = {
      ...base,
      surfaceTextures: [{ featureId, outputRole: "result", layers: [texture] }],
      textureQuality: { maxEdgeLengthMm: 1, maxTriangles: 50_000 },
    }
    const meshes = await engine.exportPrintMeshes(options)
    const mesh = meshes.meshes[0]
    if (!mesh) throw new Error("Expected textured print mesh.")
    expect(mesh.triangles.length / 3).toBeGreaterThan(1_000)
    expect(Math.max(...mesh.vertices.filter((_, index) => index % 3 === 2))).toBeCloseTo(10.3, 4)
    const stl = await engine.exportDocument({ ...options, format: "stl" })
    const stlView = new DataView(stl.file.buffer)
    expect(stlView.getUint32(80, true)).toBe(mesh.triangles.length / 3)
    const threeMf = writeThreeMfMeshes({
      title: "Physical surface texture",
      meshes: [{ vertices: [...mesh.vertices], triangles: [...mesh.triangles] }],
    })
    expect(threeMf.report).toMatchObject({
      objectCount: 1,
      triangleCount: mesh.triangles.length / 3,
    })
    const exactStep = await engine.exportDocument({ ...base, format: "step" })
    const texturedStep = await engine.exportDocument({ ...options, format: "step" })
    for (const file of [exactStep.file, texturedStep.file]) {
      const step = new TextDecoder().decode(file)
      expect(step.startsWith("ISO-10303-21;")).toBe(true)
      expect(step.match(/ADVANCED_FACE\(/g)).toHaveLength(6)
    }
    const after = await engine.evaluateFeature(input(), vi.fn())
    if (!after.ok) throw new Error(after.diagnostic.message)
    expect(after.result.cache.brepHit).toBe(true)
    expect(after.result.shape).toEqual(evaluated.result.shape)
    expect(after.result.shape.volume).toBeCloseTo(1_000, 7)
    const { min, max } = after.result.shape.bounds
    for (let axis = 0; axis < 3; axis += 1)
      expect((max[axis] ?? 0) - (min[axis] ?? 0)).toBeCloseTo(10, 5)
    expect(engine.getHealth().ownedShapeCount).toBe(1)
    const fs = await import("node:fs")
    fs.writeFileSync("/tmp/vibeshape-surface-texture-kernel.stl", stl.file)
    fs.writeFileSync("/tmp/vibeshape-surface-texture-kernel.3mf", threeMf.bytes)
  })

  it("rejects absent texture body roles and bounds the combined export across bodies", async () => {
    const first = input()
    const second = {
      ...input(),
      featureId: "0195b5ac-b220-7a2c-8c33-67a36a7f3102",
      contentHash: "d".repeat(64),
    }
    await engine.evaluateFeature(first, vi.fn())
    await engine.evaluateFeature(second, vi.fn())
    const features = [first, second].map(({ featureId: id, contentHash: hash }) => ({
      featureId: id,
      contentHash: hash,
      outputRole: "result",
    }))
    await expect(
      engine.exportPrintMeshes({
        documentId,
        features,
        surfaceTextures: [{ featureId, outputRole: "missing", layers: [texture] }],
      }),
    ).rejects.toMatchObject({ code: "surface-texture-invalid-target" })
    await expect(
      engine.exportPrintMeshes({
        documentId,
        features,
        surfaceTextures: [{ featureId, outputRole: "result", layers: [texture] }],
        textureQuality: { maxEdgeLengthMm: 1, maxTriangles: 3_075 },
      }),
    ).rejects.toMatchObject({ code: "surface-texture-resource-limit" })
  })
})
