import { STLLoader } from "three/addons/loaders/STLLoader.js"
import { identityTransform } from "./affine"
import {
  type ImportedMesh,
  type ImportLengthUnit,
  type ImportLimits,
  importLabel,
  LENGTH_UNIT_MM,
  type ParsedGeometryImport,
  requireImport,
} from "./contracts"
import { decodeImportText } from "./xml"

const NUMBER = "[+-]?(?:\\d+\\.?\\d*|\\.\\d+)(?:[eE][+-]?\\d+)?"
function requireTriangleBudget(count: number, limits: ImportLimits) {
  requireImport(count > 0, "invalid-geometry", "STL contains no triangles.")
  requireImport(
    count <= limits.triangles && count * 3 <= limits.vertices,
    "resource-limit",
    "STL exceeds its triangle or vertex budget.",
  )
}
function binaryStl(bytes: Uint8Array, limits: ImportLimits) {
  requireImport(bytes.length >= 84, "invalid-format", "Binary STL header is truncated.")
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const count = view.getUint32(80, true)
  requireTriangleBudget(count, limits)
  requireImport(
    bytes.length === 84 + count * 50,
    "invalid-format",
    "Binary STL triangle data is truncated or has trailing bytes.",
  )
  for (let triangle = 0; triangle < count; triangle++)
    for (let coordinate = 0; coordinate < 12; coordinate++)
      requireImport(
        Number.isFinite(view.getFloat32(84 + triangle * 50 + coordinate * 4, true)),
        "invalid-geometry",
        "STL numeric data must be finite.",
      )
  return [undefined]
}
function asciiStl(bytes: Uint8Array, limits: ImportLimits) {
  const text = decodeImportText(bytes)
  requireImport(
    !/[^\r\n]{4097}/.test(text),
    "resource-limit",
    "An ASCII STL line exceeds its length budget.",
  )
  const solid = /\s*solid[^\r\n]*\r?\n([\s\S]*?)endsolid[^\r\n]*(?:\r?\n|$)/gy
  const vector = `${NUMBER}\\s+${NUMBER}\\s+${NUMBER}`
  const facet = new RegExp(
    `\\s*facet\\s+normal\\s+${vector}\\s+outer\\s+loop\\s+vertex\\s+${vector}\\s+vertex\\s+${vector}\\s+vertex\\s+${vector}\\s+endloop\\s+endfacet`,
    "gy",
  )
  const names: Array<string | undefined> = []
  let offset = 0
  let count = 0
  while (offset < text.trimEnd().length) {
    solid.lastIndex = offset
    const match = solid.exec(text)
    requireImport(
      Boolean(match),
      "invalid-format",
      "ASCII STL has malformed solid or facet syntax.",
    )
    if (!match) break
    const body = match[1] ?? ""
    const name = match[0].trimStart().split(/\r?\n/, 1)[0]?.slice(5)
    names.push(importLabel(name))
    requireImport(names.length <= limits.bodies, "resource-limit", "STL has too many solids.")
    let bodyOffset = 0
    while (bodyOffset < body.trimEnd().length) {
      facet.lastIndex = bodyOffset
      const face = facet.exec(body)
      requireImport(Boolean(face), "invalid-format", "ASCII STL has malformed facet syntax.")
      if (!face) break
      for (const numeric of face[0].matchAll(/[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/g))
        requireImport(
          numeric[0].length <= 64 && Number.isFinite(Number(numeric[0])),
          "invalid-geometry",
          "STL numeric data must be finite.",
        )
      count++
      requireTriangleBudget(count, limits)
      bodyOffset = facet.lastIndex
    }
    offset = solid.lastIndex
  }
  requireTriangleBudget(count, limits)
  return names
}
export function parseStlGeometry(
  bytes: Uint8Array,
  units: ImportLengthUnit,
  limits: ImportLimits,
): ParsedGeometryImport {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const exactBinary = bytes.length >= 84 && 84 + view.getUint32(80, true) * 50 === bytes.length
  const asciiPrefix = /^\s*solid(?:\s|$)/.test(String.fromCharCode(...bytes.subarray(0, 80)))
  const names = exactBinary || !asciiPrefix ? binaryStl(bytes, limits) : asciiStl(bytes, limits)
  const buffer = Uint8Array.from(bytes).buffer
  const geometry = new STLLoader().parse(buffer)
  try {
    const positions = geometry.getAttribute("position")
    requireImport(
      Boolean(positions) && positions.count > 0,
      "invalid-geometry",
      "STL contains no triangle mesh.",
    )
    const groups = geometry.groups.length ? geometry.groups : [{ start: 0, count: positions.count }]
    const scale = LENGTH_UNIT_MM[units]
    const meshes: ImportedMesh[] = groups.map((group, index) => {
      const vertices: [number, number, number][] = []
      const triangles: [number, number, number][] = []
      for (let vertex = group.start; vertex < group.start + group.count; vertex++)
        vertices.push([
          positions.getX(vertex) * scale,
          positions.getY(vertex) * scale,
          positions.getZ(vertex) * scale,
        ])
      for (let triangle = 0; triangle < vertices.length; triangle += 3)
        triangles.push([triangle, triangle + 1, triangle + 2])
      return {
        id: `stl-mesh-${index + 1}`,
        ...(names[index] ? { label: names[index] } : {}),
        vertices,
        triangles,
      }
    })
    return {
      kind: "triangle-mesh",
      format: "stl",
      units: {
        coordinateUnit: "mm",
        sourceUnit: units,
        millimetersPerUnit: scale,
        policy: "selected",
      },
      meshes,
      nodes: meshes.map((mesh, index) => ({
        id: `stl-node-${index + 1}`,
        meshId: mesh.id,
        transform: identityTransform(),
        reversesWinding: false,
      })),
      warnings: [],
    }
  } finally {
    geometry.dispose()
  }
}
