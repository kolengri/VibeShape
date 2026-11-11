import { strToU8 } from "fflate"
import {
  collectVisualMaterials,
  fixedDecimal,
  srgbChannels,
  srgbToLinear,
  type VisualMeshExportInput,
  visualMeshExportInputSchema,
  visualMeshName,
} from "./visual-meshes"

const GLB_MAGIC = 0x46546c67
const GLB_VERSION = 2
const JSON_CHUNK = 0x4e4f534a
const BIN_CHUNK = 0x004e4942
const ARRAY_BUFFER = 34962
const ELEMENT_ARRAY_BUFFER = 34963
const FLOAT = 5126
const UNSIGNED_INT = 5125
const TRIANGLES = 4

/** glTF lengths are meters; VibeShape authoring coordinates are millimeters. */
export const GLTF_METERS_PER_MILLIMETER = 0.001

/**
 * Maps a right-handed Z-up millimeter coordinate to glTF's right-handed Y-up meter frame.
 * The mapping is a -90 degree rotation about X: (x, y, z) -> (x, z, -y). It preserves
 * handedness and triangle winding, so outward faces stay counter-clockwise.
 */
export function gltfPositionFromModel(x: number, y: number, z: number): [number, number, number] {
  const scale = GLTF_METERS_PER_MILLIMETER
  const mapped: [number, number, number] = [x * scale, z * scale, -y * scale]
  return mapped.map((value) => (value === 0 ? 0 : value)) as [number, number, number]
}

type Accessor = Readonly<Record<string, unknown>>
type BufferView = Readonly<{
  buffer: 0
  byteOffset: number
  byteLength: number
  target: number
}>

function positionsFor(vertices: readonly number[]) {
  const positions = new Float32Array(vertices.length)
  for (let offset = 0; offset < vertices.length; offset += 3) {
    const mapped = gltfPositionFromModel(
      vertices[offset] as number,
      vertices[offset + 1] as number,
      vertices[offset + 2] as number,
    )
    positions.set(mapped, offset)
  }
  const min = [Infinity, Infinity, Infinity]
  const max = [-Infinity, -Infinity, -Infinity]
  for (let offset = 0; offset < positions.length; offset += 3)
    for (let axis = 0; axis < 3; axis++) {
      // Bounds use the stored float32 values so validators compare equal numbers.
      const value = positions[offset + axis] as number
      min[axis] = Math.min(min[axis] as number, value)
      max[axis] = Math.max(max[axis] as number, value)
    }
  return { positions, min, max }
}

function gltfMaterial(material: ReturnType<typeof collectVisualMaterials>["materials"][number]) {
  const [red, green, blue] = srgbChannels(material.color).map((channel) =>
    Number(fixedDecimal(srgbToLinear(channel))),
  )
  return {
    pbrMetallicRoughness: {
      baseColorFactor: [red, green, blue, Number(fixedDecimal(material.opacity))],
      metallicFactor: Number(fixedDecimal(material.metalness)),
      roughnessFactor: Number(fixedDecimal(material.roughness)),
    },
    ...(material.opacity < 1 ? { alphaMode: "BLEND" } : {}),
  }
}

function padded(bytes: Uint8Array, fill: number) {
  const length = Math.ceil(bytes.byteLength / 4) * 4
  if (length === bytes.byteLength) return bytes
  const result = new Uint8Array(length).fill(fill)
  result.set(bytes)
  return result
}

/**
 * Writes a deterministic binary glTF 2.0 asset with one node and mesh per body. Normals are
 * omitted, so conforming viewers derive flat normals from the indexed triangles.
 */
export function writeGlbMeshes(input: VisualMeshExportInput): Uint8Array<ArrayBuffer> {
  const parsed = visualMeshExportInputSchema.parse(input)
  const { materials, meshMaterials } = collectVisualMaterials(parsed.meshes)
  const accessors: Accessor[] = []
  const bufferViews: BufferView[] = []
  const chunks: Uint8Array[] = []
  let byteOffset = 0
  const appendView = (bytes: Uint8Array, target: number) => {
    bufferViews.push({ buffer: 0, byteOffset, byteLength: bytes.byteLength, target })
    chunks.push(bytes)
    // Float32 and Uint32 payloads are four-byte multiples, preserving component alignment.
    byteOffset += bytes.byteLength
    return bufferViews.length - 1
  }
  const meshes = parsed.meshes.map((mesh, index) => {
    const name = visualMeshName(mesh.name, index)
    const { positions, min, max } = positionsFor(mesh.vertices)
    const positionView = appendView(new Uint8Array(positions.buffer), ARRAY_BUFFER)
    accessors.push({
      bufferView: positionView,
      componentType: FLOAT,
      count: positions.length / 3,
      type: "VEC3",
      min,
      max,
    })
    const indices = Uint32Array.from(mesh.triangles)
    const indexView = appendView(new Uint8Array(indices.buffer), ELEMENT_ARRAY_BUFFER)
    accessors.push({
      bufferView: indexView,
      componentType: UNSIGNED_INT,
      count: indices.length,
      type: "SCALAR",
    })
    return {
      name,
      primitives: [
        {
          attributes: { POSITION: accessors.length - 2 },
          indices: accessors.length - 1,
          material: meshMaterials[index],
          mode: TRIANGLES,
        },
      ],
    }
  })
  const json = {
    asset: { version: "2.0", generator: "VibeShape" },
    scene: 0,
    scenes: [
      {
        ...(parsed.title.trim() ? { name: visualMeshName(parsed.title, 0) } : {}),
        nodes: meshes.map((_, index) => index),
      },
    ],
    nodes: meshes.map(({ name }, index) => ({ name, mesh: index })),
    meshes,
    materials: materials.map((material, index) => ({
      name: `Material ${index + 1}`,
      ...gltfMaterial(material),
    })),
    accessors,
    bufferViews,
    buffers: [{ byteLength: byteOffset }],
  }
  const jsonBytes = padded(strToU8(JSON.stringify(json)), 0x20)
  const binary = new Uint8Array(byteOffset)
  let cursor = 0
  for (const chunk of chunks) {
    binary.set(chunk, cursor)
    cursor += chunk.byteLength
  }
  const binBytes = padded(binary, 0)
  const total = 12 + 8 + jsonBytes.byteLength + 8 + binBytes.byteLength
  const output = new Uint8Array(total)
  const view = new DataView(output.buffer)
  view.setUint32(0, GLB_MAGIC, true)
  view.setUint32(4, GLB_VERSION, true)
  view.setUint32(8, total, true)
  view.setUint32(12, jsonBytes.byteLength, true)
  view.setUint32(16, JSON_CHUNK, true)
  output.set(jsonBytes, 20)
  const binHeader = 20 + jsonBytes.byteLength
  view.setUint32(binHeader, binBytes.byteLength, true)
  view.setUint32(binHeader + 4, BIN_CHUNK, true)
  output.set(binBytes, binHeader + 8)
  return output
}
