/*
 * Edge split cases adapted from CNCKitchen stlTexturizer, copyright 2026
 * Stefan Hermann and contributors, GPL-3.0-only.
 * Source: https://github.com/CNCKitchen/stlTexturizer/blob/eedb131588c38d11010e86b022de76af414827a6/js/subdivision.js
 * Adaptation: indexed CAD meshes, retained face evidence, strict allocation limits,
 * and per-corner analytical normals. The source repository LICENSE applies.
 */

export interface TextureWorkingMesh {
  positions: number[]
  indices: number[]
  faceIds: number[]
  cornerNormals: number[]
}

function edgeLengthSquared(positions: readonly number[], a: number, b: number) {
  return (
    ((positions[a * 3] ?? 0) - (positions[b * 3] ?? 0)) ** 2 +
    ((positions[a * 3 + 1] ?? 0) - (positions[b * 3 + 1] ?? 0)) ** 2 +
    ((positions[a * 3 + 2] ?? 0) - (positions[b * 3 + 2] ?? 0)) ** 2
  )
}

type Triangle = readonly [number, number, number]
type EdgeKey = (a: number, b: number) => number

function triangle(mesh: TextureWorkingMesh, offset: number): Triangle {
  return [mesh.indices[offset] ?? 0, mesh.indices[offset + 1] ?? 0, mesh.indices[offset + 2] ?? 0]
}

function edges([a, b, c]: Triangle) {
  return [
    [a, b],
    [b, c],
    [c, a],
  ] as const
}

function markedEdges(
  mesh: TextureWorkingMesh,
  activeFaceIds: ReadonlySet<number> | null,
  threshold: number,
  edgeKey: EdgeKey,
) {
  const marked = new Set<number>()
  for (let offset = 0; offset < mesh.indices.length; offset += 3) {
    if (activeFaceIds && !activeFaceIds.has(mesh.faceIds[offset / 3] ?? -1)) continue
    for (const [a, b] of edges(triangle(mesh, offset)))
      if (edgeLengthSquared(mesh.positions, a, b) > threshold) marked.add(edgeKey(a, b))
  }
  return marked
}

function countRefinedTriangles(
  mesh: TextureWorkingMesh,
  marked: ReadonlySet<number>,
  edgeKey: EdgeKey,
) {
  let count = mesh.indices.length / 3
  for (let offset = 0; offset < mesh.indices.length; offset += 3)
    for (const [a, b] of edges(triangle(mesh, offset))) count += Number(marked.has(edgeKey(a, b)))
  return count
}

// Corner slots are [a, b, c, midpointAB, midpointBC, midpointCA].
// Each row corresponds to the AB/BC/CA split bitmask; winding remains unchanged.
const splitPatterns = [
  [0, 1, 2],
  [0, 3, 2, 3, 1, 2],
  [0, 1, 4, 0, 4, 2],
  [1, 4, 3, 0, 3, 4, 0, 4, 2],
  [0, 1, 5, 5, 1, 2],
  [0, 3, 5, 3, 1, 2, 3, 2, 5],
  [2, 5, 4, 0, 1, 4, 0, 4, 5],
  [0, 3, 5, 3, 1, 4, 5, 4, 2, 3, 4, 5],
] as const

function interpolatedNormal(a: readonly number[], b: readonly number[]) {
  const values = [0, 1, 2].map((axis) => (a[axis] ?? 0) + (b[axis] ?? 0))
  const length = Math.hypot(...values) || 1
  return values.map((value) => value / length)
}

function appendSplitTriangle(
  mesh: TextureWorkingMesh,
  offset: number,
  marked: ReadonlySet<number>,
  edgeKey: EdgeKey,
  midpoint: EdgeKey,
  result: TextureWorkingMesh,
) {
  const original = triangle(mesh, offset)
  const vertices = [...original]
  let mask = 0
  for (const [index, [a, b]] of edges(original).entries()) {
    const split = marked.has(edgeKey(a, b))
    if (split) mask |= 1 << index
    vertices.push(split ? midpoint(a, b) : -1)
  }
  const originals = [0, 1, 2].map((corner) =>
    mesh.cornerNormals.slice((offset + corner) * 3, (offset + corner) * 3 + 3),
  ) as [number[], number[], number[]]
  const normals = [
    originals[0],
    originals[1],
    originals[2],
    interpolatedNormal(originals[0], originals[1]),
    interpolatedNormal(originals[1], originals[2]),
    interpolatedNormal(originals[2], originals[0]),
  ] as const
  const corners = vertices as [number, number, number, number, number, number]
  const pattern = splitPatterns[mask] ?? splitPatterns[0]
  for (const slot of pattern) {
    result.indices.push(corners[slot])
    result.cornerNormals.push(...normals[slot])
  }
  for (let child = 0; child < pattern.length / 3; child += 1)
    result.faceIds.push(mesh.faceIds[offset / 3] ?? 0)
}

/** Globally mark edges before splitting so excluded neighbours cannot acquire T-junctions. */
export function refineTextureMesh(
  mesh: TextureWorkingMesh,
  activeFaceIds: ReadonlySet<number> | null,
  maxEdgeLengthMm: number,
  maxTriangles: number,
): TextureWorkingMesh | null {
  const vertexCount = mesh.positions.length / 3
  const edgeKey: EdgeKey = (a, b) => (a < b ? a * vertexCount + b : b * vertexCount + a)
  const marked = markedEdges(mesh, activeFaceIds, maxEdgeLengthMm ** 2, edgeKey)
  if (marked.size === 0) return null
  // Fail before allocating or partially splitting, rather than returning a cracked mesh.
  if (countRefinedTriangles(mesh, marked, edgeKey) > maxTriangles)
    throw new RangeError(
      "Surface texture refinement exceeds the triangle budget. Increase the mesh edge length or reduce the textured area.",
    )
  const result: TextureWorkingMesh = {
    positions: mesh.positions,
    indices: [],
    faceIds: [],
    cornerNormals: [],
  }
  const midpointIndices = new Map<number, number>()
  const midpoint: EdgeKey = (a, b) => {
    const key = edgeKey(a, b)
    const previous = midpointIndices.get(key)
    if (previous !== undefined) return previous
    const index = result.positions.length / 3
    for (let axis = 0; axis < 3; axis += 1)
      result.positions.push(
        ((mesh.positions[a * 3 + axis] ?? 0) + (mesh.positions[b * 3 + axis] ?? 0)) / 2,
      )
    midpointIndices.set(key, index)
    return index
  }
  for (let offset = 0; offset < mesh.indices.length; offset += 3)
    appendSplitTriangle(mesh, offset, marked, edgeKey, midpoint, result)
  return result
}
