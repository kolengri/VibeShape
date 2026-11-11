import { describe, expect, it } from "bun:test"
import { gltfPositionFromModel, writeGlbMeshes } from "./gltf-meshes"
import { srgbToLinear } from "./visual-meshes"

/** Axis-aligned box from min to max in millimeters, outward counter-clockwise winding. */
function box(min: [number, number, number], max: [number, number, number]) {
  const [x0, y0, z0] = min
  const [x1, y1, z1] = max
  const vertices = [
    [x0, y0, z0],
    [x1, y0, z0],
    [x1, y1, z0],
    [x0, y1, z0],
    [x0, y0, z1],
    [x1, y0, z1],
    [x1, y1, z1],
    [x0, y1, z1],
  ].flat()
  const triangles = [
    [0, 2, 1],
    [0, 3, 2],
    [4, 5, 6],
    [4, 6, 7],
    [0, 1, 5],
    [0, 5, 4],
    [1, 2, 6],
    [1, 6, 5],
    [2, 3, 7],
    [2, 7, 6],
    [3, 0, 4],
    [3, 4, 7],
  ].flat()
  return { vertices, triangles }
}

type ParsedGlb = {
  header: { magic: number; version: number; length: number }
  json: Record<string, unknown> & {
    asset: { version: string }
    scenes: { nodes: number[] }[]
    nodes: { name: string; mesh: number }[]
    meshes: {
      name: string
      primitives: { attributes: { POSITION: number }; indices: number; material: number }[]
    }[]
    materials: {
      pbrMetallicRoughness: {
        baseColorFactor: number[]
        metallicFactor: number
        roughnessFactor: number
      }
      alphaMode?: string
    }[]
    accessors: {
      bufferView: number
      componentType: number
      count: number
      type: string
      min?: number[]
      max?: number[]
    }[]
    bufferViews: { byteOffset: number; byteLength: number; target: number }[]
    buffers: { byteLength: number }[]
  }
  jsonChunkLength: number
  binChunkLength: number
  bin: DataView
}

function parseGlb(bytes: Uint8Array): ParsedGlb {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const header = {
    magic: view.getUint32(0, true),
    version: view.getUint32(4, true),
    length: view.getUint32(8, true),
  }
  const jsonChunkLength = view.getUint32(12, true)
  expect(view.getUint32(16, true)).toBe(0x4e4f534a)
  const json = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + jsonChunkLength)))
  const binHeader = 20 + jsonChunkLength
  const binChunkLength = view.getUint32(binHeader, true)
  expect(view.getUint32(binHeader + 4, true)).toBe(0x004e4942)
  const bin = new DataView(bytes.buffer, bytes.byteOffset + binHeader + 8, binChunkLength)
  return { header, json, jsonChunkLength, binChunkLength, bin }
}

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("Missing glTF record.")
  return value
}

function readPositions(parsed: ParsedGlb, accessorIndex: number) {
  const accessor = parsed.json.accessors[accessorIndex]
  if (!accessor) throw new Error("missing accessor")
  const bufferView = parsed.json.bufferViews[accessor.bufferView]
  if (!bufferView) throw new Error("missing buffer view")
  return Array.from({ length: accessor.count * 3 }, (_, index) =>
    parsed.bin.getFloat32(bufferView.byteOffset + index * 4, true),
  )
}

describe("binary glTF export", () => {
  const cube = { name: "Cube", ...box([0, 0, 0], [10, 20, 30]) }

  it("writes a valid GLB container with aligned JSON and BIN chunks", () => {
    const bytes = writeGlbMeshes({ title: "Box", meshes: [cube] })
    const parsed = parseGlb(bytes)
    expect(parsed.header).toEqual({ magic: 0x46546c67, version: 2, length: bytes.byteLength })
    expect(parsed.jsonChunkLength % 4).toBe(0)
    expect(parsed.binChunkLength % 4).toBe(0)
    expect(20 + parsed.jsonChunkLength + 8 + parsed.binChunkLength).toBe(bytes.byteLength)
    expect(parsed.json.asset.version).toBe("2.0")
    expect(parsed.json.buffers[0]?.byteLength).toBeLessThanOrEqual(parsed.binChunkLength)
    for (const view of parsed.json.bufferViews) expect(view.byteOffset % 4).toBe(0)
  })

  it("scales millimeters to meters and maps Z-up to glTF Y-up", () => {
    expect(gltfPositionFromModel(1000, 2000, 3000)).toEqual([1, 3, -2])
    const parsed = parseGlb(writeGlbMeshes({ title: "Box", meshes: [cube] }))
    const primitive = parsed.json.meshes[0]?.primitives[0]
    if (!primitive) throw new Error("missing primitive")
    const position = parsed.json.accessors[primitive.attributes.POSITION]
    const indices = parsed.json.accessors[primitive.indices]
    expect(position).toMatchObject({ componentType: 5126, type: "VEC3", count: 8 })
    expect(indices).toMatchObject({ componentType: 5125, type: "SCALAR", count: 36 })
    // Model X 0..10 mm, Y 0..20 mm, Z 0..30 mm -> glTF X 0..0.01 m, Y 0..0.03 m, Z -0.02..0 m.
    expect(position?.min).toEqual([0, 0, Math.fround(-0.02)])
    expect(position?.max).toEqual([Math.fround(0.01), Math.fround(0.03), 0])
    const values = readPositions(parsed, primitive.attributes.POSITION)
    expect(values.slice(6 * 3, 6 * 3 + 3)).toEqual([
      Math.fround(0.01),
      Math.fround(0.03),
      Math.fround(-0.02),
    ])
  })

  it("keeps one node, mesh and appearance material per body for a two-part model", () => {
    const parsed = parseGlb(
      writeGlbMeshes({
        title: "Two parts",
        meshes: [
          {
            ...cube,
            name: "Base",
            material: { color: "#ff0000", metalness: 0.8, roughness: 0.3, opacity: 1 },
          },
          {
            ...box([20, 0, 0], [25, 5, 5]),
            name: "Clear cap",
            material: { color: "#808080", metalness: 0, roughness: 0.1, opacity: 0.25 },
          },
        ],
      }),
    )
    expect(parsed.json.scenes[0]?.nodes).toEqual([0, 1])
    expect(parsed.json.nodes).toEqual([
      { name: "Base", mesh: 0 },
      { name: "Clear cap", mesh: 1 },
    ])
    expect(parsed.json.accessors).toHaveLength(4)
    expect(parsed.json.materials).toHaveLength(2)
    expect(parsed.json.materials[0]?.pbrMetallicRoughness).toEqual({
      baseColorFactor: [1, 0, 0, 1],
      metallicFactor: 0.8,
      roughnessFactor: 0.3,
    })
    const grey = Number(srgbToLinear(128 / 255).toFixed(6))
    expect(parsed.json.materials[1]).toMatchObject({
      alphaMode: "BLEND",
      pbrMetallicRoughness: { baseColorFactor: [grey, grey, grey, 0.25] },
    })
    const second = required(parsed.json.meshes[1]?.primitives[0])
    expect(second.material).toBe(1)
    const bounds = required(parsed.json.accessors[second.attributes.POSITION])
    expect(bounds.min).toEqual([Math.fround(0.02), 0, Math.fround(-0.005)])
    expect(bounds.max).toEqual([Math.fround(0.025), Math.fround(0.005), 0])
    const indexAccessor = required(parsed.json.accessors[second.indices])
    const indexView = required(parsed.json.bufferViews[indexAccessor.bufferView])
    expect(indexView.target).toBe(34963)
    expect(parsed.bin.getUint32(indexView.byteOffset + 4, true)).toBe(2)
  })

  it("shares one default material for bodies without appearance", () => {
    const parsed = parseGlb(
      writeGlbMeshes({ title: "Plain", meshes: [cube, { ...cube, name: "Copy" }] }),
    )
    expect(parsed.json.materials).toHaveLength(1)
    expect(parsed.json.materials[0]?.pbrMetallicRoughness.metallicFactor).toBe(0)
  })

  it("produces identical bytes for identical input", () => {
    const input = { title: "Box", meshes: [cube, { ...box([1, 1, 1], [2, 2, 2]), name: "Two" }] }
    expect(writeGlbMeshes(input)).toEqual(writeGlbMeshes(input))
  })

  it("rejects incomplete meshes", () => {
    expect(() =>
      writeGlbMeshes({
        title: "Bad",
        meshes: [{ name: "Bad", vertices: [0, 0, 0], triangles: [0] }],
      }),
    ).toThrow()
  })
})
