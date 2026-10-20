import { afterAll, beforeAll, describe, expect, it } from "bun:test"
import { getOC, measureVolume, type Shape3D } from "replicad"
import { vi } from "../../../tests/unit/support/bun-test"
import { type FeatureEvaluationInput, ReplicadGeometryEngine } from "./engine"
import { removeCollapsedNativePrintTriangles } from "./native-print-mesh"
import { meshOcctShape } from "./occt-mesh"
import { createOcctBox, createOcctSphere, intersectOcctShapes } from "./occt-shapes"

const engine = new ReplicadGeometryEngine()
const documentId = "native-print-pole-regression"
const quality = { chordTolerance: 0.05, angularTolerance: 0.1 }
beforeAll(async () => {
  const { readFileSync } = await import("node:fs")
  const bytes = readFileSync(
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
})
afterAll(() => engine.disposeDocument(documentId))

function point(vertices: readonly number[], index: number) {
  const x = vertices[index * 3]
  const y = vertices[index * 3 + 1]
  const z = vertices[index * 3 + 2]
  if (x === undefined || y === undefined || z === undefined) throw new Error("Missing test vertex.")
  return [x, y, z] as const
}

function weldedPrintMesh(mesh: { vertices: readonly number[]; triangles: readonly number[] }) {
  const keys = new Map<string, number>()
  const remap = new Map<number, number>()
  const vertices: (readonly [number, number, number])[] = []
  for (let index = 0; index < mesh.vertices.length / 3; index += 1) {
    const position = point(mesh.vertices, index)
    const key = position.map((value) => Math.round(value / 1e-7)).join(":")
    let canonical = keys.get(key)
    if (canonical === undefined) {
      canonical = vertices.length
      vertices.push(position)
      keys.set(key, canonical)
    }
    remap.set(index, canonical)
  }
  const triangles = mesh.triangles.map((index) => {
    const canonical = remap.get(index)
    if (canonical === undefined) throw new Error("Missing welded test index.")
    return canonical
  })
  return { vertices, triangles }
}

function signedTriangleVolume(
  vertices: readonly (readonly [number, number, number])[],
  a: number,
  b: number,
  c: number,
) {
  const p = vertices[a],
    q = vertices[b],
    r = vertices[c]
  if (!p || !q || !r) throw new Error("Missing welded test vertex.")
  return (
    (p[0] * (q[1] * r[2] - q[2] * r[1]) +
      p[1] * (q[2] * r[0] - q[0] * r[2]) +
      p[2] * (q[0] * r[1] - q[1] * r[0])) /
    6
  )
}

type EdgeIncidence = Map<string, { uses: number; balance: number }>

function recordTriangleEdges(edges: EdgeIncidence, [a, b, c]: readonly [number, number, number]) {
  for (const [from, to] of [
    [a, b],
    [b, c],
    [c, a],
  ] as const) {
    const key = from < to ? `${from}:${to}` : `${to}:${from}`
    const edge = edges.get(key) ?? { uses: 0, balance: 0 }
    edge.uses += 1
    edge.balance += from < to ? 1 : -1
    edges.set(key, edge)
  }
}

/** Independent manufacturing invariants after face-local seam welding at 0.1 micrometre. */
function closedSolid(source: { vertices: readonly number[]; triangles: readonly number[] }) {
  const mesh = weldedPrintMesh(source)
  const edges: EdgeIncidence = new Map()
  let volume = 0
  let collapsed = 0
  for (let offset = 0; offset < mesh.triangles.length; offset += 3) {
    const mapped = mesh.triangles.slice(offset, offset + 3)
    const [a, b, c] = mapped
    if (a === undefined || b === undefined || c === undefined)
      throw new Error("Missing test index.")
    if (new Set(mapped).size !== 3) collapsed += 1
    volume += signedTriangleVolume(mesh.vertices, a, b, c)
    recordTriangleEdges(edges, [a, b, c])
  }
  expect(collapsed).toBe(0)
  expect([...edges.values()].filter((edge) => edge.uses !== 2 || edge.balance !== 0)).toEqual([])
  expect(volume).toBeGreaterThan(0)
}

describe("native pole/seam print preparation over the pinned kernel", () => {
  it.each(["sphere", "Boolean spherical cap"])(
    "removes proven native artifacts from %s without changing its source",
    (kind) => {
      const occt = getOC()
      const sphere = createOcctSphere(occt, 4, [0, 0, 4])
      const box = createOcctBox(occt, [12, 12, 4], false, [0, 0, 4])
      let cap: Shape3D | null = null
      try {
        cap = intersectOcctShapes(occt, sphere, box)
        const shape = kind === "sphere" ? sphere : cap
        const beforeVolume = measureVolume(shape)
        const source = meshOcctShape(occt, shape, {
          tolerance: quality.chordTolerance,
          angularTolerance: quality.angularTolerance,
        })
        const original = structuredClone(source)
        const prepared = removeCollapsedNativePrintTriangles(source)
        expect(prepared.triangles.length).toBeLessThan(source.triangles.length)
        expect(source).toEqual(original)
        expect(prepared.vertices).toBe(source.vertices)
        expect(prepared.normals).toBe(source.normals)
        expect(prepared.faceGroups.map(({ faceId }) => faceId)).toEqual(
          source.faceGroups.map(({ faceId }) => faceId),
        )
        expect(prepared.faceGroups.reduce((sum, group) => sum + group.count, 0)).toBe(
          prepared.triangles.length,
        )
        closedSolid(prepared)
        expect(measureVolume(shape)).toBe(beforeVolume)
      } finally {
        cap?.delete()
        box.delete()
        sphere.delete()
      }
    },
  )

  it("prepares only export meshes, preserving viewport topology, exact body identity, B-Rep cache, and ownership", async () => {
    const environment = engine.getFeatureContentEnvironment()
    if (!environment) throw new Error("Expected initialized kernel.")
    const input: FeatureEvaluationInput = {
      documentId,
      featureId: "0195b5ac-b220-7a2c-8c33-67a36a7f3101",
      contentHash: "a".repeat(64),
      content: {
        schemaVersion: 0,
        feature: {
          schemaVersion: 0,
          type: {
            moduleId: "org.vibeshape.core.part-design",
            moduleVersion: "0.1.0",
            typeId: "org.vibeshape.feature.part-design.sphere",
            schemaVersion: 1,
          },
          parameters: { radius: 4, origin: [0, 0, 4] },
          inputs: [],
          references: [],
        },
        environment,
      },
      dependencies: [],
      mesh: quality,
    }
    try {
      const before = await engine.evaluateFeature(input, vi.fn())
      if (!before.ok) throw new Error(before.diagnostic.message)
      const originalMesh = structuredClone(before.result.mesh)
      const originalTopology = structuredClone(before.result.topologyCandidates)
      const exported = await engine.exportPrintMeshes({
        documentId,
        features: [
          { featureId: input.featureId, contentHash: input.contentHash, outputRole: "result" },
        ],
        meshQuality: quality,
      })
      const mesh = exported.meshes[0]
      if (!mesh) throw new Error("Expected print mesh.")
      expect(exported.meshes.length).toBe(1)
      expect(mesh.featureId).toBe(input.featureId)
      expect(mesh.outputRole).toBe("result")
      expect(mesh.triangles.length).toBeLessThan(before.result.mesh.indices.length)
      closedSolid(mesh)
      const faceId = before.result.mesh.triangleFaceIds[0]
      if (faceId === undefined) throw new Error("Expected sphere face evidence.")
      const textured = await engine.exportPrintMeshes({
        documentId,
        features: [
          { featureId: input.featureId, contentHash: input.contentHash, outputRole: "result" },
        ],
        meshQuality: quality,
        textureQuality: { maxEdgeLengthMm: 100, maxTriangles: 20_000 },
        surfaceTextures: [
          {
            featureId: input.featureId,
            outputRole: "result",
            layers: [
              {
                id: "native-face-evidence",
                enabled: true,
                targetFaceIds: [faceId],
                mask: { base: "all", strokes: [] },
                map: { kind: "custom", width: 1, height: 1, pixels: [0] },
                mapping: { kind: "triplanar", axis: "z" },
                heightMm: 0.05,
                sizeUMm: 5,
                sizeVMm: 5,
                rotationDeg: 0,
                offsetUMm: 0,
                offsetVMm: 0,
                direction: "outward",
                invert: false,
                boundaryFadeMm: 0,
                blend: "add",
              },
            ],
          },
        ],
      })
      const texturedMesh = textured.meshes[0]
      if (!texturedMesh) throw new Error("Expected textured print mesh.")
      expect(texturedMesh.outputRole).toBe("result")
      closedSolid(texturedMesh)
      const after = await engine.evaluateFeature(input, vi.fn())
      if (!after.ok) throw new Error(after.diagnostic.message)
      expect(after.result.cache.brepHit).toBe(true)
      expect(after.result.shape).toEqual(before.result.shape)
      expect(before.result.mesh).toEqual(originalMesh)
      expect(after.result.mesh).toEqual(originalMesh)
      expect(after.result.topologyCandidates).toEqual(originalTopology)
      expect(engine.getHealth().ownedShapeCount).toBe(1)
    } finally {
      engine.disposeDocument(documentId)
    }
    expect(engine.getHealth().ownedShapeCount).toBe(0)
  })
})
