import type { ShapeMesh } from "replicad"

function coincidentPosition(vertices: readonly number[], left: number, right: number) {
  const offset = left * 3
  const other = right * 3
  const x = vertices[offset]
  const y = vertices[offset + 1]
  const z = vertices[offset + 2]
  return (
    Number.isFinite(x) &&
    Number.isFinite(y) &&
    Number.isFinite(z) &&
    x === vertices[other] &&
    y === vertices[other + 1] &&
    z === vertices[other + 2]
  )
}

function collapsedNativeTriangle(source: ShapeMesh, offset: number) {
  const first = source.triangles[offset]
  const second = source.triangles[offset + 1]
  const third = source.triangles[offset + 2]
  if (first === undefined || second === undefined || third === undefined) return false
  return (
    coincidentPosition(source.vertices, first, second) ||
    coincidentPosition(source.vertices, second, third) ||
    coincidentPosition(source.vertices, third, first)
  )
}

/** Native print preparation only. Final solid/manifold validation remains with the print writer. */
export function removeCollapsedNativePrintTriangles(source: ShapeMesh): ShapeMesh {
  if (source.triangles.length % 3 !== 0) return source
  let firstCollapsed = 0
  while (
    firstCollapsed < source.triangles.length &&
    !collapsedNativeTriangle(source, firstCollapsed)
  )
    firstCollapsed += 3
  if (firstCollapsed === source.triangles.length) return source

  // Exact coincident endpoints prove zero area. No area epsilon, tolerance weld, or Float32 rounding
  // may erase a legitimate small triangle; arbitrary malformed meshes must still fail validation.
  const retainedOffsets = new Uint32Array(source.triangles.length / 3 + 1)
  let retained = 0
  for (let offset = 0; offset < source.triangles.length; offset += 3) {
    if (!collapsedNativeTriangle(source, offset)) retained += 3
    retainedOffsets[offset / 3 + 1] = retained
  }
  const triangles = source.triangles.filter(
    (_, index) =>
      retainedOffsets[Math.floor(index / 3)] !== retainedOffsets[Math.floor(index / 3) + 1],
  )
  const faceGroups = source.faceGroups.map((group) => {
    const start = retainedOffsets[group.start / 3]
    const end = retainedOffsets[(group.start + group.count) / 3]
    if (start === undefined || end === undefined)
      throw new Error("Native print tessellation has an invalid face range.")
    return { ...group, start, count: end - start }
  })
  return { ...source, triangles, faceGroups }
}
