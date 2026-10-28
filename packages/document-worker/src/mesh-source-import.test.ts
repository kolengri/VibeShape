import { describe, expect, it } from "bun:test"
import { documentSnapshotSchema } from "@vibeshape/domain"
import {
  meshImportFeatureType,
  meshImportOutputRole,
} from "@vibeshape/domain/part-design-mesh-import"
import { parseGeometryImport } from "@vibeshape/formats/import"
import { writeStlMeshes } from "@vibeshape/formats/stl-meshes"
import { writeThreeMf } from "@vibeshape/formats/three-mf"
import { writeThreeMfMeshes } from "@vibeshape/formats/three-mf-meshes"
import { type GeometryEngineMetadata, sourceAssetMaterializationSchema } from "@vibeshape/protocol"
import { inspectMeshSource, rebuildImportedMesh } from "./mesh-source-import"
import { validateRebuildSourceMaterialization } from "./source-materialization"

const id = (n: number) => `0195b5ac-b220-7a2c-8c33-${String(n).padStart(12, "0")}`
const engine: GeometryEngineMetadata = {
  adapter: "replicad",
  adapterVersion: "test",
  replicadVersion: "0.23.1",
  opencascadePackageVersion: "0.23.0",
  opencascadeSourceRevision: null,
  wasmBytes: 1,
  initializedInMs: 0,
  featureContentEnvironment: {
    schemaVersion: 0,
    hostApiVersion: "0.1.0",
    geometry: {
      adapterId: "org.vibeshape.geometry.replicad",
      adapterVersion: "test",
      kernelId: "org.opencascade.occt",
      kernelVersion: "7.8.1",
      kernelSourceRevision: null,
    },
    modelingTolerancePolicyVersion: 1,
    provider: { kind: "built-in" },
  },
}
async function fixture() {
  const bytes = writeStlMeshes([{ vertices: [0, 0, 0, 1, 0, 0, 0, 1, 0], triangles: [0, 1, 2] }])
  const digest = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), (value) =>
    value.toString(16).padStart(2, "0"),
  ).join("")
  const inspected = await inspectMeshSource("stl", bytes, "in")
  const outputs = inspected.outputs.map(({ nodeKey }, index) => ({
    outputId: id(index + 20),
    nodeKey,
  }))
  const source = {
    digest,
    byteLength: bytes.length,
    format: "stl" as const,
    normalization: inspected.normalization,
    parserPolicyVersion: 1 as const,
  }
  const material = sourceAssetMaterializationSchema.parse({
    asset: {
      id: id(10),
      digest,
      byteLength: bytes.length,
      filename: "Triangle.stl",
      format: "stl",
      representation: "triangle-mesh",
      normalization: inspected.normalization,
      outputs: outputs.map(({ outputId }) => outputId),
    },
    bytes,
  })
  return { bytes, inspected, outputs, source, material }
}
describe("authored triangle-mesh source materialization", () => {
  it("preserves a translated 0.8 mm grid as doubles through 3MF import, rebuild and export", async () => {
    const vertices: [number, number, number][] = [
      [132, 0, 0],
      [132.8, 0, 0],
      [132, 0.8, 0],
      [132, 0, 0.8],
    ]
    const triangles: [number, number, number][] = [
      [0, 2, 1],
      [0, 1, 3],
      [0, 3, 2],
      [1, 2, 3],
    ]
    const bytes = writeThreeMf({
      schemaVersion: 1,
      language: "en-US",
      metadata: { title: "Precise grid" },
      objects: [{ kind: "mesh", id: 1, mesh: { vertices, triangles } }],
      build: [{ objectId: 1, transform: [1, 0, 0, 0, 1, 0, 0, 0, 1, 0.01, 0.01, 0.01] }],
    }).bytes
    const inspected = await inspectMeshSource("3mf", bytes)
    const expected = triangles.flatMap((triangle) =>
      triangle.flatMap((index) => {
        const point = vertices[index]
        if (!point) throw new Error("Missing fixture vertex")
        return point.map((value) => value + 0.01)
      }),
    )
    const mesh = inspected.outputs[0]?.mesh
    expect(mesh?.precisePositions).toEqual(new Float64Array(expected))
    expect(mesh?.positions).toEqual(new Float32Array(expected))
    expect(mesh?.positions[0]).not.toBe(expected[0])
    const digest = Array.from(
      new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
      (value) => value.toString(16).padStart(2, "0"),
    ).join("")
    const outputs = inspected.outputs.map(({ nodeKey }) => ({ outputId: id(20), nodeKey }))
    const material = sourceAssetMaterializationSchema.parse({
      asset: {
        id: id(10),
        digest,
        byteLength: bytes.length,
        filename: "Grid.3mf",
        format: "3mf",
        representation: "triangle-mesh",
        normalization: inspected.normalization,
        outputs: [id(20)],
      },
      bytes,
    })
    const rebuilt = await rebuildImportedMesh(
      {
        source: {
          digest,
          byteLength: bytes.length,
          format: "3mf",
          normalization: inspected.normalization,
          parserPolicyVersion: 1,
        },
        outputs,
      },
      material,
      engine,
    )
    expect(rebuilt.mesh.precisePositions).toEqual(new Float64Array(expected))
    expect(rebuilt.bodies?.[0]?.mesh.precisePositions).toEqual(new Float64Array(expected))
    if (!rebuilt.mesh.precisePositions) throw new Error("Missing precise mesh coordinates")
    const exported = writeThreeMfMeshes({
      title: "Round trip",
      meshes: [
        {
          vertices: Array.from(rebuilt.mesh.precisePositions),
          triangles: Array.from(rebuilt.mesh.indices),
        },
      ],
    }).bytes
    const roundTrip = await inspectMeshSource("3mf", exported)
    expect(roundTrip.outputs[0]?.mesh.precisePositions).toEqual(new Float64Array(expected))
  })
  it("retains explicit units, source keys and mesh identity without exact solid claims", async () => {
    const f = await fixture()
    const result = await rebuildImportedMesh(
      { source: f.source, outputs: f.outputs },
      f.material,
      engine,
    )
    expect(result).toMatchObject({
      representation: "triangle-mesh",
      shape: { volume: 0, solidCount: 0 },
      bodies: [
        {
          representation: "triangle-mesh",
          outputRole: meshImportOutputRole(id(20)),
          shape: { solidCount: 0, faceCount: 0 },
          topologyCandidates: [],
        },
      ],
    })
    expect(result.bodies?.[0]?.shape.bounds.max).toEqual([25.4, 25.4, 0])
    const exported = writeStlMeshes([
      { vertices: Array.from(result.mesh.positions), triangles: Array.from(result.mesh.indices) },
    ])
    const parsed = await parseGeometryImport({ format: "stl", bytes: exported, units: "mm" })
    expect(parsed.ok).toBe(true)
    if (!parsed.ok || parsed.geometry.kind !== "triangle-mesh")
      throw new Error("Missing STL round trip")
    expect(parsed.geometry.meshes[0]?.vertices[1]?.[0]).toBeCloseTo(25.4, 5)
  })
  it("rejects stale source manifests, normalization, digests and missing bytes", async () => {
    const f = await fixture()
    const content = { source: f.source, outputs: f.outputs }
    await expect(rebuildImportedMesh(content, undefined, engine)).rejects.toThrow("missing")
    await expect(
      rebuildImportedMesh(
        content,
        { ...f.material, bytes: new Uint8Array(f.bytes.length) },
        engine,
      ),
    ).rejects.toThrow("immutable bytes")
    await expect(
      rebuildImportedMesh(
        { ...content, outputs: [{ outputId: id(20), nodeKey: "changed" }] },
        f.material,
        engine,
      ),
    ).rejects.toThrow("manifest")
    await expect(
      rebuildImportedMesh(
        {
          ...content,
          source: {
            ...f.source,
            normalization: { ...f.source.normalization, scaleToMillimeters: 1 },
          },
        },
        f.material,
        engine,
      ),
    ).rejects.toThrow("metadata")
  })
  it("checks source closure even when geometry can be reused", async () => {
    const f = await fixture()
    const document = documentSnapshotSchema.parse({
      schemaVersion: 0,
      id: id(1),
      revision: 1,
      name: "Mesh",
      features: [
        {
          schemaVersion: 0,
          id: id(2),
          type: meshImportFeatureType.type,
          parameters: { sourceAssetId: f.material.asset.id, source: f.source, outputs: f.outputs },
          dependencies: [],
          references: [],
          suppressed: false,
        },
      ],
      sketches: [],
      variables: [],
      createdAt: "2026-10-03T00:00:00Z",
      updatedAt: "2026-10-03T00:00:00Z",
    })
    await expect(
      validateRebuildSourceMaterialization(document, [f.material]),
    ).resolves.toBeUndefined()
    await expect(validateRebuildSourceMaterialization(document, [])).rejects.toThrow("source asset")
    await expect(
      validateRebuildSourceMaterialization(document, [
        { ...f.material, bytes: new Uint8Array(f.bytes.length) },
      ]),
    ).rejects.toThrow("digest")
  })
})
