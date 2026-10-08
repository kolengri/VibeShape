import { afterAll, beforeAll, describe, expect, it } from "bun:test"
import { vi } from "../../../tests/unit/support/bun-test"
import { type FeatureEvaluationInput, ReplicadGeometryEngine } from "./engine"

const engine = new ReplicadGeometryEngine()
const documentId = "export-quality-kernel"
const featureId = "0195b5ac-b220-7a2c-8c33-67a36a7f3101"
const contentHash = "a".repeat(64)
const features = [{ featureId, contentHash }]
const coarse = { chordTolerance: 0.2, angularTolerance: 0.3 }
const fine = { chordTolerance: 0.01, angularTolerance: 0.05 }
let input: FeatureEvaluationInput
beforeAll(async () => {
  const filesystem = await import("node:fs")
  const bytes = filesystem.readFileSync(
    new URL("../node_modules/replicad-opencascadejs/src/replicad_single.wasm", import.meta.url),
  )
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(Uint8Array.from(bytes))),
  )
  try {
    await engine.initialize()
  } finally {
    vi.unstubAllGlobals()
  }
  const environment = engine.getFeatureContentEnvironment()
  if (!environment) throw new Error("Geometry environment is unavailable.")
  input = {
    documentId,
    featureId,
    contentHash,
    content: {
      schemaVersion: 0,
      feature: {
        schemaVersion: 0,
        type: {
          moduleId: "org.vibeshape.core.part-design",
          moduleVersion: "0.1.0",
          typeId: "org.vibeshape.feature.part-design.cylinder",
          schemaVersion: 1,
        },
        parameters: { radius: 20, height: 10, centered: false, origin: [0, 0, 0] },
        inputs: [],
        references: [],
      },
      environment,
    },
    dependencies: [],
    mesh: { chordTolerance: 0.005, angularTolerance: 0.01 },
  }
  const result = await engine.evaluateFeature(input, vi.fn())
  if (!result.ok) throw new Error(result.diagnostic.message)
})
afterAll(() => engine.disposeDocument(documentId))
function stlTriangles(file: Uint8Array) {
  const view = new DataView(file.buffer, file.byteOffset, file.byteLength)
  const count = view.getUint32(80, true)
  expect(file.length).toBe(84 + 50 * count)
  for (let triangle = 0; triangle < count; triangle++) {
    for (let vertex = 0; vertex < 3; vertex++) {
      const offset = 84 + triangle * 50 + 12 + vertex * 12
      const x = view.getFloat32(offset, true),
        y = view.getFloat32(offset + 4, true),
        z = view.getFloat32(offset + 8, true)
      expect(Number.isFinite(x + y + z)).toBe(true)
      expect(Math.hypot(x, y)).toBeLessThanOrEqual(20.0001)
      expect(z).toBeGreaterThanOrEqual(-0.0001)
      expect(z).toBeLessThanOrEqual(10.0001)
    }
  }
  return count
}
describe("exact export tessellation over the pinned kernel", () => {
  it("remeshes STL from fine to coarse and back regardless of cached viewport triangulation", async () => {
    const counts: number[] = []
    for (const meshQuality of [fine, coarse, fine]) {
      const result = await engine.exportDocument({
        documentId,
        features,
        format: "stl",
        meshQuality,
      })
      expect(result.bodyCount).toBe(1)
      counts.push(stlTriangles(result.file))
    }
    expect(counts[0]).toBeGreaterThan(counts[1] ?? Infinity)
    expect(counts[2]).toBe(counts[0])
    const initial = await engine.exportDocument({ documentId, features, format: "stl" })
    const explicit = await engine.exportDocument({
      documentId,
      features,
      format: "stl",
      meshQuality: { chordTolerance: 0.05, angularTolerance: 0.1 },
    })
    expect(stlTriangles(initial.file)).toBe(stlTriangles(explicit.file))
  })
  it("uses requested print-mesh quality while preserving default tolerances and exact source volume", async () => {
    const before = await engine.evaluateFeature(input, vi.fn())
    const detailed = await engine.exportPrintMeshes({ documentId, features, meshQuality: fine })
    const simplified = await engine.exportPrintMeshes({ documentId, features, meshQuality: coarse })
    expect(detailed.meshes[0]?.triangles.length).toBeGreaterThan(
      simplified.meshes[0]?.triangles.length ?? Infinity,
    )
    const defaultMesh = await engine.exportPrintMeshes({ documentId, features })
    const explicit = await engine.exportPrintMeshes({
      documentId,
      features,
      meshQuality: { chordTolerance: 0.02, angularTolerance: 0.1 },
    })
    expect(defaultMesh.meshes[0]?.triangles.length).toBe(explicit.meshes[0]?.triangles.length)
    const after = await engine.evaluateFeature(input, vi.fn())
    if (!before.ok || !after.ok)
      throw new Error("Source geometry must remain available after export.")
    expect(after.result.shape).toEqual(before.result.shape)
    expect(after.result.shape.volume).toBeCloseTo(Math.PI * 20 ** 2 * 10, 5)
  })
  it("rejects unsafe quality before meshing and keeps the source exportable", async () => {
    await expect(
      engine.exportPrintMeshes({
        documentId,
        features,
        meshQuality: { chordTolerance: 0, angularTolerance: 0.05 },
      }),
    ).rejects.toThrow()
    const exported = await engine.exportDocument({
      documentId,
      features,
      format: "stl",
      meshQuality: coarse,
    })
    expect(stlTriangles(exported.file)).toBeGreaterThan(0)
  })
})
