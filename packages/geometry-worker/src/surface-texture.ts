import {
  MAX_SURFACE_TEXTURE_TRIANGLES,
  type SurfaceTextureMesh,
  type SurfaceTextureMeshLayer,
  type SurfaceTexturePattern,
  type SurfaceTextureQuality,
  surfaceTextureMeshLayersSchema,
  surfaceTextureQualitySchema,
} from "@vibeshape/protocol"
import { refineTextureMesh, type TextureWorkingMesh } from "./surface-texture-subdivision"

export class SurfaceTextureError extends Error {
  constructor(
    readonly code:
      | "surface-texture-invalid-mesh"
      | "surface-texture-resource-limit"
      | "surface-texture-invalid-target"
      | "surface-texture-invalid-displacement"
      | "cancelled",
    message: string,
  ) {
    super(message)
    this.name = "SurfaceTextureError"
  }
}

type Vector = readonly [number, number, number]
type Stroke = SurfaceTextureMeshLayer["mask"]["strokes"][number]

function fract(value: number) {
  return value - Math.floor(value)
}

function smoothstep(value: number) {
  const clamped = Math.max(0, Math.min(1, value))
  return clamped * clamped * (3 - 2 * clamped)
}

function latticeNoise(x: number, y: number) {
  let value = (Math.imul(x, 374_761_393) + Math.imul(y, 668_265_263)) | 0
  value = Math.imul(value ^ (value >>> 13), 1_274_126_177)
  return ((value ^ (value >>> 16)) >>> 0) / 4_294_967_295
}

function periodicNoise(u: number, v: number) {
  const x = fract(u) * 16
  const y = fract(v) * 16
  const ix = Math.floor(x)
  const iy = Math.floor(y)
  const dx = smoothstep(x - ix)
  const dy = smoothstep(y - iy)
  const a = latticeNoise(ix, iy)
  const b = latticeNoise((ix + 1) % 16, iy)
  const c = latticeNoise(ix, (iy + 1) % 16)
  const d = latticeNoise((ix + 1) % 16, (iy + 1) % 16)
  return (a * (1 - dx) + b * dx) * (1 - dy) + (c * (1 - dx) + d * dx) * dy
}

/** Seamless, original procedural grayscale maps; also used by the editor gallery. */
export function sampleSurfaceTexturePattern(pattern: SurfaceTexturePattern, u: number, v: number) {
  const x = fract(u)
  const y = fract(v)
  switch (pattern) {
    case "ridges":
      return (1 + Math.cos(x * Math.PI * 2)) / 2
    case "dots":
      return 1 - smoothstep(Math.hypot(x - 0.5, y - 0.5) / 0.4)
    case "knurling":
      return ((1 + Math.cos((x + y) * Math.PI * 2)) * (1 + Math.cos((x - y) * Math.PI * 2))) / 4
    case "hexagons": {
      const row = Math.floor(y * 2)
      const dx = Math.abs(fract(x + row * 0.5) - 0.5) * 2
      const dy = Math.abs(fract(y * 2) - 0.5) * 2
      const radius = Math.max(dx, dx * 0.5 + dy * 0.75)
      return 1 - smoothstep(Math.abs(radius - 0.65) / 0.15)
    }
    case "wood":
      return (
        (1 +
          Math.sin(
            (x * 6 + Math.sin(y * Math.PI * 2) * 0.25 + periodicNoise(x, y) * 0.3) * Math.PI * 2,
          )) /
        2
      )
    case "noise":
      return periodicNoise(x, y)
  }
}

function point(positions: readonly number[] | Float32Array | Float64Array, vertex: number): Vector {
  return [
    positions[vertex * 3] ?? 0,
    positions[vertex * 3 + 1] ?? 0,
    positions[vertex * 3 + 2] ?? 0,
  ]
}

function subtract(a: Vector, b: Vector): Vector {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}

function dot(a: Vector, b: Vector) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}

function cross(a: Vector, b: Vector): Vector {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
}

function unit(value: Vector): Vector {
  const length = Math.hypot(...value)
  return length > 1e-12 ? [value[0] / length, value[1] / length, value[2] / length] : [0, 0, 0]
}

function triangleNormal(
  positions: readonly number[] | Float32Array,
  a: number,
  b: number,
  c: number,
) {
  return cross(
    subtract(point(positions, b), point(positions, a)),
    subtract(point(positions, c), point(positions, a)),
  )
}

function sourceAttributesAreValid(source: SurfaceTextureMesh) {
  return (
    source.positions.length % 3 === 0 &&
    source.normals.length === source.positions.length &&
    source.positions.every(Number.isFinite) &&
    source.normals.every(Number.isFinite)
  )
}

function sourceTrianglesAreValid(source: SurfaceTextureMesh) {
  const count = source.indices.length / 3
  return (
    count >= 4 &&
    Number.isInteger(count) &&
    source.triangleFaceIds.length === count &&
    source.indices.every((index) => index < source.positions.length / 3)
  )
}

function validateSource(source: SurfaceTextureMesh) {
  if (
    source.indices.length / 3 > MAX_SURFACE_TEXTURE_TRIANGLES ||
    source.positions.length > MAX_SURFACE_TEXTURE_TRIANGLES * 9
  )
    throw new SurfaceTextureError(
      "surface-texture-resource-limit",
      "The source mesh exceeds the surface texture memory budget. Use a coarser source tessellation.",
    )
  if (!sourceAttributesAreValid(source) || !sourceTrianglesAreValid(source))
    throw new SurfaceTextureError(
      "surface-texture-invalid-mesh",
      "Surface texturing requires a finite, indexed, closed solid mesh with complete face evidence.",
    )
}

function triangleVertices(mesh: TextureWorkingMesh, offset: number): Vector {
  return [mesh.indices[offset] ?? 0, mesh.indices[offset + 1] ?? 0, mesh.indices[offset + 2] ?? 0]
}

function triangleEdges([a, b, c]: Vector) {
  return [
    [a, b],
    [b, c],
    [c, a],
  ] as const
}

function addWeightedNormal(
  buffer: Float32Array | Float64Array,
  vertex: number,
  normal: Vector,
  weight = 1,
) {
  const previous = point(buffer, vertex)
  buffer.set(
    [
      previous[0] + normal[0] * weight,
      previous[1] + normal[1] * weight,
      previous[2] + normal[2] * weight,
    ],
    vertex * 3,
  )
}

function weldVertexPositions(source: SurfaceTextureMesh) {
  const positions: number[] = []
  const vertexMap = new Map<string, number>()
  const remap = new Uint32Array(source.positions.length / 3)
  for (let index = 0; index < remap.length; index += 1) {
    const p = point(source.positions, index)
    const key = p.map((coordinate) => Math.round(coordinate * 1_000_000)).join(":")
    let canonical = vertexMap.get(key)
    if (canonical === undefined) {
      canonical = positions.length / 3
      vertexMap.set(key, canonical)
      positions.push(...p)
    }
    remap[index] = canonical
  }
  return { positions, remap }
}

function appendSourceTriangle(
  source: SurfaceTextureMesh,
  offset: number,
  remap: Uint32Array,
  mesh: TextureWorkingMesh,
) {
  const sourceVertices = [
    source.indices[offset] ?? 0,
    source.indices[offset + 1] ?? 0,
    source.indices[offset + 2] ?? 0,
  ] as const
  const vertices = sourceVertices.map((vertex) => remap[vertex] ?? 0) as [number, number, number]
  const normal = triangleNormal(mesh.positions, ...vertices)
  // OCCT can include zero-area triangles at analytic poles and seam endpoints.
  // Removing them is safe only if the remaining mesh passes the closed-edge check.
  if (Math.hypot(...normal) < 1e-12) return
  mesh.indices.push(...vertices)
  mesh.faceIds.push(source.triangleFaceIds[offset / 3] ?? 0)
  for (const vertex of sourceVertices) {
    const analyticalNormal = unit(point(source.normals, vertex))
    mesh.cornerNormals.push(
      ...(dot(analyticalNormal, normal) > 0 ? analyticalNormal : unit(normal)),
    )
  }
}

function weldSource(source: SurfaceTextureMesh): TextureWorkingMesh {
  validateSource(source)
  const { positions, remap } = weldVertexPositions(source)
  const mesh: TextureWorkingMesh = { positions, indices: [], faceIds: [], cornerNormals: [] }
  for (let offset = 0; offset < source.indices.length; offset += 3)
    appendSourceTriangle(source, offset, remap, mesh)
  validateClosedMesh(mesh)
  return mesh
}

function validateClosedMesh(mesh: TextureWorkingMesh) {
  const vertexCount = mesh.positions.length / 3
  const edges = new Map<number, { count: number; orientation: number }>()
  let volume = 0
  for (let offset = 0; offset < mesh.indices.length; offset += 3) {
    const vertices = triangleVertices(mesh, offset)
    volume +=
      dot(
        point(mesh.positions, vertices[0]),
        cross(point(mesh.positions, vertices[1]), point(mesh.positions, vertices[2])),
      ) / 6
    for (const [a, b] of triangleEdges(vertices)) {
      const key = a < b ? a * vertexCount + b : b * vertexCount + a
      const edge = edges.get(key) ?? { count: 0, orientation: 0 }
      edge.count += 1
      edge.orientation += a < b ? 1 : -1
      edges.set(key, edge)
    }
  }
  const invalidEdges = [...edges.values()].some(
    (edge) => edge.count !== 2 || edge.orientation !== 0,
  )
  if (volume <= 0 || invalidEdges)
    throw new SurfaceTextureError(
      "surface-texture-invalid-mesh",
      "The source mesh has open, non-manifold, or reversed seams. Select one closed body and rebuild it.",
    )
}

function vertexNormals(mesh: TextureWorkingMesh) {
  const result = new Float64Array(mesh.positions.length)
  for (let offset = 0; offset < mesh.indices.length; offset += 3) {
    const vertices = triangleVertices(mesh, offset)
    for (const corner of [0, 1, 2] as const) {
      const vertex = vertices[corner]
      const a = unit(
        subtract(
          point(mesh.positions, vertices[(corner + 1) % 3] ?? 0),
          point(mesh.positions, vertex),
        ),
      )
      const b = unit(
        subtract(
          point(mesh.positions, vertices[(corner + 2) % 3] ?? 0),
          point(mesh.positions, vertex),
        ),
      )
      const angle = Math.acos(Math.max(-1, Math.min(1, dot(a, b))))
      addWeightedNormal(result, vertex, point(mesh.cornerNormals, offset + corner), angle)
    }
  }
  for (let vertex = 0; vertex < result.length / 3; vertex += 1)
    result.set(unit(point(result, vertex)), vertex * 3)
  return result
}

function sharpCreaseVertices(mesh: TextureWorkingMesh, normals: Float64Array) {
  const protectedVertices = new Uint8Array(mesh.positions.length / 3)
  const maximumDeviation = Math.cos((25 * Math.PI) / 180)
  for (let corner = 0; corner < mesh.indices.length; corner += 1) {
    const vertex = mesh.indices[corner] ?? 0
    if (dot(point(mesh.cornerNormals, corner), point(normals, vertex)) < maximumDeviation)
      protectedVertices[vertex] = 1
  }
  return protectedVertices
}

function sampleMap(layer: SurfaceTextureMeshLayer, rawU: number, rawV: number) {
  const angle = (layer.rotationDeg * Math.PI) / 180
  const u = (rawU * Math.cos(angle) - rawV * Math.sin(angle) + layer.offsetUMm) / layer.sizeUMm
  const v = (rawU * Math.sin(angle) + rawV * Math.cos(angle) + layer.offsetVMm) / layer.sizeVMm
  if (layer.map.kind === "builtin") return sampleSurfaceTexturePattern(layer.map.pattern, u, v)
  const map = layer.map
  // Pixel centers wrap seamlessly; upload row zero is the top of the map.
  const x = fract(u) * map.width - 0.5
  const y = fract(-v) * map.height - 0.5
  const ix = Math.floor(x)
  const iy = Math.floor(y)
  const pixel = (px: number, py: number) =>
    (map.pixels[
      (((py % map.height) + map.height) % map.height) * map.width +
        (((px % map.width) + map.width) % map.width)
    ] ?? 0) / 255
  const dx = x - ix
  const dy = y - iy
  return (
    (pixel(ix, iy) * (1 - dx) + pixel(ix + 1, iy) * dx) * (1 - dy) +
    (pixel(ix, iy + 1) * (1 - dx) + pixel(ix + 1, iy + 1) * dx) * dy
  )
}

function alignedTexturePoint(p: Vector, axis: SurfaceTextureMeshLayer["mapping"]["axis"]): Vector {
  if (axis === "x") return [p[1], p[2], p[0]]
  if (axis === "y") return [p[2], p[0], p[1]]
  return p
}

function triplanarHeight(layer: SurfaceTextureMeshLayer, p: Vector, n: Vector) {
  const weights: Vector = [Math.abs(n[0]) ** 4, Math.abs(n[1]) ** 4, Math.abs(n[2]) ** 4]
  const total = weights[0] + weights[1] + weights[2] || 1
  return (
    (sampleMap(layer, p[1], p[2]) * weights[0] +
      sampleMap(layer, p[2], p[0]) * weights[1] +
      sampleMap(layer, p[0], p[1]) * weights[2]) /
    total
  )
}

function projectedHeight(
  layer: SurfaceTextureMeshLayer,
  position: Vector,
  normal: Vector,
  center: Vector,
  radius: number,
) {
  const p = alignedTexturePoint(position, layer.mapping.axis)
  if (layer.mapping.kind === "planar") return sampleMap(layer, p[0], p[1])
  if (layer.mapping.kind === "triplanar")
    return triplanarHeight(layer, p, alignedTexturePoint(normal, layer.mapping.axis))
  const centered = alignedTexturePoint(subtract(position, center), layer.mapping.axis)
  const angle = Math.atan2(centered[1], centered[0])
  if (layer.mapping.kind === "cylindrical") return sampleMap(layer, angle * radius, centered[2])
  const length = Math.hypot(...centered) || 1
  return sampleMap(
    layer,
    angle * radius,
    Math.asin(Math.max(-1, Math.min(1, centered[2] / length))) * radius,
  )
}

function sourceFrame(mesh: TextureWorkingMesh) {
  const min: [number, number, number] = [Infinity, Infinity, Infinity]
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity]
  for (let offset = 0; offset < mesh.positions.length; offset += 3)
    for (let axis = 0; axis < 3; axis += 1) {
      min[axis] = Math.min(min[axis] ?? Infinity, mesh.positions[offset + axis] ?? 0)
      max[axis] = Math.max(max[axis] ?? -Infinity, mesh.positions[offset + axis] ?? 0)
    }
  const center: Vector = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2]
  const radii = [0, 1, 2].map(
    (axis) =>
      Math.max(
        (max[(axis + 1) % 3] ?? 0) - (min[(axis + 1) % 3] ?? 0),
        (max[(axis + 2) % 3] ?? 0) - (min[(axis + 2) % 3] ?? 0),
      ) / 2,
  )
  const minimumDimensionMm = Math.min(
    ...max.map((coordinate, axis) => coordinate - (min[axis] ?? 0)),
  )
  return { center, radii: radii as [number, number, number], minimumDimensionMm }
}

function brushStrokeBounds(stroke: Stroke, cellSize: number) {
  const coordinate = (axis: 0 | 1 | 2, sign: number) =>
    Math.floor((stroke.center[axis] + sign * stroke.radiusMm) / cellSize)
  return {
    min: [coordinate(0, -1), coordinate(1, -1), coordinate(2, -1)] as const,
    max: [coordinate(0, 1), coordinate(1, 1), coordinate(2, 1)] as const,
  }
}

function indexBrushStrokes(strokes: readonly Stroke[], cellSize: number) {
  const cells = new Map<string, Stroke[]>()
  for (const stroke of strokes) {
    const { min, max } = brushStrokeBounds(stroke, cellSize)
    for (let x = min[0]; x <= max[0]; x += 1)
      for (let y = min[1]; y <= max[1]; y += 1)
        for (let z = min[2]; z <= max[2]; z += 1) {
          const key = `${x}:${y}:${z}`
          const bucket = cells.get(key) ?? []
          bucket.push(stroke)
          cells.set(key, bucket)
        }
  }
  return cells
}

function brushStrokeWeight(stroke: Stroke, position: Vector, normal: Vector) {
  if (dot(normal, stroke.normal) < 0.25) return 0
  const distance = Math.hypot(...subtract(position, stroke.center))
  if (distance >= stroke.radiusMm) return 0
  const innerRadius = stroke.radiusMm * stroke.hardness
  return innerRadius >= stroke.radiusMm
    ? 1
    : 1 - smoothstep((distance - innerRadius) / (stroke.radiusMm - innerRadius))
}

function brushSampler(layer: SurfaceTextureMeshLayer) {
  const strokes = layer.mask.strokes
  const cellSize = Math.max(0.001, ...strokes.map((stroke) => stroke.radiusMm))
  const cells = indexBrushStrokes(strokes, cellSize)
  let samples = 0
  return (position: Vector, normal: Vector) => {
    const key = position.map((coordinate) => Math.floor(coordinate / cellSize)).join(":")
    let coverage = layer.mask.base === "all" ? 1 : 0
    for (const stroke of cells.get(key) ?? []) {
      if (++samples > 20_000_000)
        throw new SurfaceTextureError(
          "surface-texture-resource-limit",
          "The brush mask exceeds the processing budget. Clear old strokes or use a coarser texture mesh.",
        )
      const weight = brushStrokeWeight(stroke, position, normal)
      coverage =
        stroke.mode === "paint" ? coverage + (1 - coverage) * weight : coverage * (1 - weight)
    }
    return coverage
  }
}

type DistanceEntry = { vertex: number; distance: number }

class DistanceHeap {
  readonly entries: DistanceEntry[] = []

  push(vertex: number, distance: number) {
    const entry = { vertex, distance }
    this.entries.push(entry)
    let index = this.entries.length - 1
    while (index > 0) {
      const parentIndex = Math.floor((index - 1) / 2)
      const parent = this.entries[parentIndex]
      if (!parent || parent.distance <= distance) break
      this.entries[index] = parent
      index = parentIndex
    }
    this.entries[index] = entry
  }

  pop() {
    const current = this.entries[0]
    const last = this.entries.pop()
    if (!current || !last) return undefined
    if (this.entries.length > 0) this.siftDown(last)
    return current
  }

  private siftDown(last: DistanceEntry) {
    let index = 0
    while (index * 2 + 1 < this.entries.length) {
      let childIndex = index * 2 + 1
      const right = this.entries[childIndex + 1]
      const left = this.entries[childIndex]
      if (right && left && right.distance < left.distance) childIndex += 1
      const child = this.entries[childIndex]
      if (!child || last.distance <= child.distance) break
      this.entries[index] = child
      index = childIndex
    }
    this.entries[index] = last
  }
}

function selectedVertexRegion(mesh: TextureWorkingMesh, faceIds: ReadonlySet<number> | null) {
  const selected = new Uint8Array(mesh.positions.length / 3)
  const boundary = new Uint8Array(selected.length)
  for (let offset = 0; offset < mesh.indices.length; offset += 3) {
    const included = faceIds === null || faceIds.has(mesh.faceIds[offset / 3] ?? -1)
    for (let corner = 0; corner < 3; corner += 1) {
      const vertex = mesh.indices[offset + corner] ?? 0
      if (included) selected[vertex] = 1
      else boundary[vertex] = 1
    }
  }
  return { selected, boundary }
}

function selectedRegionNeighbours(mesh: TextureWorkingMesh, selected: Uint8Array) {
  const neighbours: number[][] = Array.from({ length: selected.length }, () => [])
  for (let offset = 0; offset < mesh.indices.length; offset += 3) {
    const vertices = mesh.indices.slice(offset, offset + 3)
    for (let corner = 0; corner < 3; corner += 1) {
      const a = vertices[corner] ?? 0
      const b = vertices[(corner + 1) % 3] ?? 0
      if (selected[a] && selected[b]) {
        neighbours[a]?.push(b)
        neighbours[b]?.push(a)
      }
    }
  }
  return neighbours
}

function boundaryDistanceHeap(selected: Uint8Array, boundary: Uint8Array, distances: Float64Array) {
  const heap = new DistanceHeap()
  for (let vertex = 0; vertex < selected.length; vertex += 1)
    if (selected[vertex] && boundary[vertex]) {
      distances[vertex] = 0
      heap.push(vertex, 0)
    }
  return heap
}

function visitBoundaryNeighbours(
  mesh: TextureWorkingMesh,
  current: DistanceEntry,
  neighbours: readonly number[],
  distances: Float64Array,
  heap: DistanceHeap,
  fadeMm: number,
) {
  const position = point(mesh.positions, current.vertex)
  for (const neighbour of neighbours) {
    const distance =
      current.distance + Math.hypot(...subtract(point(mesh.positions, neighbour), position))
    if (distance < (distances[neighbour] ?? Infinity) && distance < fadeMm) {
      distances[neighbour] = distance
      heap.push(neighbour, distance)
    }
  }
}

function boundaryDistances(
  mesh: TextureWorkingMesh,
  selected: Uint8Array,
  boundary: Uint8Array,
  fadeMm: number,
) {
  const neighbours = selectedRegionNeighbours(mesh, selected)
  const distances = new Float64Array(selected.length).fill(Infinity)
  const heap = boundaryDistanceHeap(selected, boundary, distances)
  let current = heap.pop()
  while (current) {
    if (current.distance === distances[current.vertex] && current.distance < fadeMm)
      visitBoundaryNeighbours(
        mesh,
        current,
        neighbours[current.vertex] ?? [],
        distances,
        heap,
        fadeMm,
      )
    current = heap.pop()
  }
  return distances
}

function targetWeights(mesh: TextureWorkingMesh, layer: SurfaceTextureMeshLayer) {
  const faceIds = layer.targetFaceIds === null ? null : new Set(layer.targetFaceIds)
  const { selected, boundary } = selectedVertexRegion(mesh, faceIds)
  const weights = Float64Array.from(selected, (value, vertex) => (boundary[vertex] ? 0 : value))
  if (layer.boundaryFadeMm === 0 || faceIds === null) return weights
  const distances = boundaryDistances(mesh, selected, boundary, layer.boundaryFadeMm)
  return weights.map(
    (weight, vertex) => weight * smoothstep((distances[vertex] ?? Infinity) / layer.boundaryFadeMm),
  )
}

function displacedMesh(
  mesh: TextureWorkingMesh,
  displacement: Float64Array,
  normals: Float64Array,
): SurfaceTextureMesh {
  const positions = Float32Array.from(
    mesh.positions,
    (coordinate, index) =>
      coordinate + (displacement[Math.floor(index / 3)] ?? 0) * (normals[index] ?? 0),
  )
  const renderNormals = new Float32Array(positions.length)
  for (let offset = 0; offset < mesh.indices.length; offset += 3) {
    const vertices = triangleVertices(mesh, offset)
    const before = triangleNormal(mesh.positions, ...vertices)
    const after = triangleNormal(positions, ...vertices)
    if (!after.every(Number.isFinite) || dot(before, after) <= 0)
      throw new SurfaceTextureError(
        "surface-texture-invalid-displacement",
        "Texture displacement folds or collapses the mesh. Reduce height or increase texture size.",
      )
    for (const vertex of vertices) addWeightedNormal(renderNormals, vertex, after)
  }
  for (let vertex = 0; vertex < positions.length / 3; vertex += 1)
    renderNormals.set(unit(point(renderNormals, vertex)), vertex * 3)
  return {
    positions,
    normals: renderNormals,
    indices: Uint32Array.from(mesh.indices),
    triangleFaceIds: Uint32Array.from(mesh.faceIds),
  }
}

type TextureProcessingControl = {
  checkCancelled: () => void
  onProgress?: (fraction: number) => void
}

function validateLayerTargets(
  mesh: TextureWorkingMesh,
  layers: readonly SurfaceTextureMeshLayer[],
  quality: SurfaceTextureQuality,
) {
  const available = new Set(mesh.faceIds)
  for (const layer of layers)
    if (layer.targetFaceIds?.some((id) => !available.has(id)))
      throw new SurfaceTextureError(
        "surface-texture-invalid-target",
        "A selected texture face is missing from the current body. Repair the face selection before preview or export.",
      )
  if (mesh.faceIds.length > quality.maxTriangles)
    throw new SurfaceTextureError(
      "surface-texture-resource-limit",
      "The source mesh already exceeds the selected triangle budget. Increase the budget or use a coarser source mesh.",
    )
}

async function refineSurfaceForLayers(
  source: TextureWorkingMesh,
  layers: readonly SurfaceTextureMeshLayer[],
  quality: SurfaceTextureQuality,
  control: TextureProcessingControl,
) {
  if (layers.length === 0) return source
  const activeFaces = layers.some((layer) => layer.targetFaceIds === null)
    ? null
    : new Set(layers.flatMap((layer) => layer.targetFaceIds ?? []))
  let mesh = source
  for (let iteration = 0; iteration < 24; iteration += 1) {
    control.checkCancelled()
    let refined: TextureWorkingMesh | null
    try {
      refined = refineTextureMesh(mesh, activeFaces, quality.maxEdgeLengthMm, quality.maxTriangles)
    } catch (error) {
      if (error instanceof RangeError)
        throw new SurfaceTextureError("surface-texture-resource-limit", error.message)
      throw error
    }
    if (!refined) return mesh
    mesh = refined
    control.onProgress?.(Math.min(0.6, (iteration + 1) / 16))
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
  }
  throw new SurfaceTextureError(
    "surface-texture-resource-limit",
    "Texture refinement did not converge. Increase the mesh edge length.",
  )
}

function physicalLayerHeight(layer: SurfaceTextureMeshLayer, sample: number) {
  const gray = layer.invert ? 1 - sample : sample
  switch (layer.direction) {
    case "outward":
      return layer.heightMm * gray
    case "inward":
      return -layer.heightMm * gray
    case "centered":
      return layer.heightMm * (gray - 0.5)
  }
}

type DisplacementContext = ReturnType<typeof sourceFrame> & {
  mesh: TextureWorkingMesh
  normals: Float64Array
  displacement: Float64Array
  protectedVertices: Uint8Array
}

function validateInwardDisplacement(context: DisplacementContext) {
  if (context.displacement.some((distance) => distance <= -context.minimumDimensionMm * 0.49))
    throw new SurfaceTextureError(
      "surface-texture-invalid-displacement",
      "Inward relief exceeds the body's size and can cross the opposite surface. Reduce the texture height.",
    )
}

async function applyLayerDisplacement(
  context: DisplacementContext,
  layer: SurfaceTextureMeshLayer,
  control: TextureProcessingControl,
) {
  control.checkCancelled()
  const { mesh, normals, displacement, center, radii } = context
  const weights = targetWeights(mesh, layer)
  const coverage = brushSampler(layer)
  const axisIndices = { x: 0, y: 1, z: 2 } as const
  const radius = radii[axisIndices[layer.mapping.axis]]
  for (let vertex = 0; vertex < displacement.length; vertex += 1) {
    if (vertex % 4_096 === 0) {
      await new Promise<void>((resolve) => setTimeout(resolve, 0))
      control.checkCancelled()
    }
    const weight = weights[vertex] ?? 0
    if (weight === 0 || context.protectedVertices[vertex]) continue
    const p = point(mesh.positions, vertex)
    const n = point(normals, vertex)
    const strength = weight * coverage(p, n)
    if (strength === 0) continue
    const height = physicalLayerHeight(layer, projectedHeight(layer, p, n, center, radius))
    const previous = displacement[vertex] ?? 0
    displacement[vertex] =
      layer.blend === "add"
        ? previous + height * strength
        : previous * (1 - strength) + height * strength
  }
}

/** Produces owned manufacturing buffers; never mutates or replaces the source B-Rep. */
export async function textureSurfaceMesh(
  source: SurfaceTextureMesh,
  layerInputs: readonly SurfaceTextureMeshLayer[],
  qualityInput: SurfaceTextureQuality,
  options: { isCancelled?: () => boolean; onProgress?: (fraction: number) => void } = {},
) {
  const layers = surfaceTextureMeshLayersSchema.parse(layerInputs).filter((layer) => layer.enabled)
  const quality = surfaceTextureQualitySchema.parse(qualityInput)
  const control: TextureProcessingControl = {
    checkCancelled: () => {
      if (options.isCancelled?.())
        throw new SurfaceTextureError("cancelled", "Surface texture processing was cancelled.")
    },
    ...(options.onProgress ? { onProgress: options.onProgress } : {}),
  }
  control.checkCancelled()
  const sourceMesh = weldSource(source)
  validateLayerTargets(sourceMesh, layers, quality)
  const mesh = await refineSurfaceForLayers(sourceMesh, layers, quality, control)
  const context: DisplacementContext = {
    ...sourceFrame(mesh),
    mesh,
    normals: vertexNormals(mesh),
    displacement: new Float64Array(mesh.positions.length / 3),
    protectedVertices: new Uint8Array(mesh.positions.length / 3),
  }
  // Keep sharp CAD joins fixed; averaging their normals can fold thin rim triangles.
  context.protectedVertices = sharpCreaseVertices(mesh, context.normals)
  for (const [index, layer] of layers.entries()) {
    await applyLayerDisplacement(context, layer, control)
    control.onProgress?.(0.6 + (0.3 * (index + 1)) / layers.length)
  }
  control.checkCancelled()
  validateInwardDisplacement(context)
  const result = displacedMesh(mesh, context.displacement, context.normals)
  control.onProgress?.(1)
  return {
    mesh: result,
    statistics: {
      sourceTriangleCount: source.indices.length / 3,
      triangleCount: result.indices.length / 3,
      vertexCount: result.positions.length / 3,
    },
  }
}

/** Binary STL serializer for the same displaced triangles used by the viewport and 3MF. */
export function encodeSurfaceTextureStl(meshes: readonly SurfaceTextureMesh[]) {
  const triangleCount = meshes.reduce((total, mesh) => total + mesh.indices.length / 3, 0)
  if (triangleCount > MAX_SURFACE_TEXTURE_TRIANGLES)
    throw new SurfaceTextureError(
      "surface-texture-resource-limit",
      "The combined STL exceeds the surface texture triangle budget. Export fewer bodies or use a coarser mesh.",
    )
  const file = new Uint8Array(84 + triangleCount * 50)
  const view = new DataView(file.buffer)
  view.setUint32(80, triangleCount, true)
  let offset = 84
  for (const mesh of meshes)
    for (let triangle = 0; triangle < mesh.indices.length; triangle += 3) {
      const a = mesh.indices[triangle] ?? 0
      const b = mesh.indices[triangle + 1] ?? 0
      const c = mesh.indices[triangle + 2] ?? 0
      const values = [
        ...unit(triangleNormal(mesh.positions, a, b, c)),
        ...point(mesh.positions, a),
        ...point(mesh.positions, b),
        ...point(mesh.positions, c),
      ]
      for (const [index, value] of values.entries())
        view.setFloat32(offset + index * 4, value, true)
      offset += 50
    }
  return file
}
