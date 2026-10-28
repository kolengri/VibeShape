import { canonicalJson } from "@vibeshape/domain/canonical-json"
import {
  type MeshImportContent,
  meshImportContentSchema,
  meshImportOutputRole,
} from "@vibeshape/domain/part-design-mesh-import"
import {
  type ImportLengthUnit,
  type ParsedGeometryImport,
  parseGeometryImport,
} from "@vibeshape/formats/import"
import {
  type FeatureEvaluationEngineResult,
  featureEvaluationEngineResultSchema,
  type GeometryEngineMetadata,
  type SourceAssetMaterialization,
} from "@vibeshape/protocol"

type MeshPayload = FeatureEvaluationEngineResult["mesh"]
type ShapeMetrics = FeatureEvaluationEngineResult["shape"]
type ImportedMeshBody = Readonly<{ nodeKey: string; shape: ShapeMetrics; mesh: MeshPayload }>
const units = { millimeter: "mm", centimeter: "cm", meter: "m", inch: "in", foot: "ft" } as const
const sourceUnits = {
  mm: "millimeter",
  cm: "centimeter",
  m: "meter",
  in: "inch",
  ft: "foot",
  um: "micrometer",
  micron: "micrometer",
  millimeter: "millimeter",
  centimeter: "centimeter",
  meter: "meter",
  inch: "inch",
  foot: "foot",
} as const

function worldPoint(point: readonly number[], matrix: readonly number[]): [number, number, number] {
  return [0, 1, 2].map(
    (axis) =>
      (matrix[axis] ?? 0) * (point[0] ?? 0) +
      (matrix[axis + 4] ?? 0) * (point[1] ?? 0) +
      (matrix[axis + 8] ?? 0) * (point[2] ?? 0) +
      (matrix[axis + 12] ?? 0),
  ) as [number, number, number]
}
type MeshPoint = readonly [number, number, number]
function triangleNormal([a, b, c]: readonly [MeshPoint, MeshPoint, MeshPoint]) {
  const ab: MeshPoint = [b[0] - a[0], b[1] - a[1], b[2] - a[2]]
  const ac: MeshPoint = [c[0] - a[0], c[1] - a[1], c[2] - a[2]]
  const cross: MeshPoint = [
    ab[1] * ac[2] - ab[2] * ac[1],
    ab[2] * ac[0] - ab[0] * ac[2],
    ab[0] * ac[1] - ab[1] * ac[0],
  ]
  const length = Math.hypot(...cross)
  if (!Number.isFinite(length)) throw new Error("An imported occurrence has non-finite geometry.")
  return { length, direction: cross.map((value) => (length === 0 ? 0 : value / length)) }
}
function writeTriangle(
  points: readonly [number, number, number][],
  normal: readonly number[],
  index: number,
  payload: {
    positions: Float32Array
    precisePositions: Float64Array
    normals: Float32Array
    indices: Uint32Array
    min: number[]
    max: number[]
  },
) {
  for (const [corner, point] of points.entries()) {
    const offset = index * 9 + corner * 3
    payload.positions.set(point, offset)
    payload.precisePositions.set(point, offset)
    payload.normals.set(normal, offset)
    payload.indices[index * 3 + corner] = index * 3 + corner
    for (let axis = 0; axis < 3; axis++) {
      payload.min[axis] = Math.min(payload.min[axis] ?? Infinity, point[axis] ?? Infinity)
      payload.max[axis] = Math.max(payload.max[axis] ?? -Infinity, point[axis] ?? -Infinity)
    }
  }
}

function bodyPayload(
  geometry: Extract<ParsedGeometryImport, { kind: "triangle-mesh" }>,
  node: Extract<ParsedGeometryImport, { kind: "triangle-mesh" }>["nodes"][number],
): ImportedMeshBody {
  const source = geometry.meshes.find(({ id }) => id === node.meshId)
  if (!source) throw new Error("An imported mesh occurrence has no source mesh.")
  const positions = new Float32Array(source.triangles.length * 9)
  const precisePositions = new Float64Array(positions.length)
  const normals = new Float32Array(positions.length)
  const indices = new Uint32Array(source.triangles.length * 3)
  const triangleFaceIds = new Uint32Array(source.triangles.length)
  const min: [number, number, number] = [Infinity, Infinity, Infinity]
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity]
  let area = 0
  for (const [triangleIndex, triangle] of source.triangles.entries()) {
    const ids = node.reversesWinding ? ([triangle[0], triangle[2], triangle[1]] as const) : triangle
    const pointAt = (index: number) => {
      const point = source.vertices[index]
      if (!point) throw new Error("An imported triangle refers to a missing vertex.")
      return worldPoint(point, node.transform)
    }
    const points: [[number, number, number], [number, number, number], [number, number, number]] = [
      pointAt(ids[0]),
      pointAt(ids[1]),
      pointAt(ids[2]),
    ]
    const normal = triangleNormal(points)
    area += normal.length / 2
    writeTriangle(points, normal.direction, triangleIndex, {
      positions,
      precisePositions,
      normals,
      indices,
      min,
      max,
    })
  }
  return {
    nodeKey: node.id,
    shape: {
      valid: true,
      volume: 0,
      surfaceArea: area,
      bounds: { min, max },
      faceCount: 0,
      edgeCount: 0,
      solidCount: 0,
    },
    mesh: { positions, precisePositions, normals, indices, triangleFaceIds },
  }
}

export async function inspectMeshSource(
  format: "stl" | "3mf",
  bytes: Uint8Array,
  selectedUnits?: ImportLengthUnit,
) {
  const result = await parseGeometryImport(
    format === "stl" ? { format, bytes, units: selectedUnits } : { format, bytes },
  )
  if (!result.ok) throw new Error(result.diagnostic.message)
  const geometry = result.geometry
  if (geometry.kind !== "triangle-mesh")
    throw new Error("The source is not triangle-mesh geometry.")
  const sourceUnit = sourceUnits[geometry.units.sourceUnit as keyof typeof sourceUnits]
  if (!sourceUnit) throw new Error("The source unit is not supported by the document authority.")
  return {
    normalization: {
      sourceUnit,
      scaleToMillimeters: geometry.units.millimetersPerUnit,
      normalizedUnit: "millimeter" as const,
    },
    outputs: geometry.nodes.map((node) => bodyPayload(geometry, node)),
    warnings: geometry.warnings,
  }
}

async function sourceDigest(bytes: Uint8Array) {
  return Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", Uint8Array.from(bytes))),
    (value) => value.toString(16).padStart(2, "0"),
  ).join("")
}
export async function rebuildImportedMesh(
  contentInput: unknown,
  materialization: SourceAssetMaterialization | undefined,
  engine: GeometryEngineMetadata,
) {
  const content: MeshImportContent = meshImportContentSchema.parse(contentInput)
  if (!materialization) throw new Error("The imported mesh source bytes are missing.")
  const { asset } = materialization
  const bytes = Uint8Array.from(materialization.bytes)
  const { parserPolicyVersion: _policy, ...source } = content.source
  if (
    asset.representation !== "triangle-mesh" ||
    canonicalJson(source) !==
      canonicalJson({
        digest: asset.digest,
        byteLength: asset.byteLength,
        format: asset.format,
        normalization: asset.normalization,
      }) ||
    canonicalJson(content.outputs.map(({ outputId }) => outputId)) !==
      canonicalJson(asset.outputs) ||
    bytes.length !== asset.byteLength ||
    (await sourceDigest(bytes)) !== asset.digest
  )
    throw new Error("The imported mesh source metadata or immutable bytes do not match.")
  const unit =
    asset.normalization.sourceUnit === "micrometer"
      ? "um"
      : units[asset.normalization.sourceUnit as keyof typeof units]
  const inspected = await inspectMeshSource(content.source.format, bytes, unit)
  if (
    canonicalJson(inspected.normalization) !== canonicalJson(asset.normalization) ||
    canonicalJson(inspected.outputs.map(({ nodeKey }) => nodeKey)) !==
      canonicalJson(content.outputs.map(({ nodeKey }) => nodeKey))
  )
    throw new Error("The captured mesh occurrence manifest or source units changed.")
  const bodies = inspected.outputs.map((body, index) => {
    const output = content.outputs[index]
    if (!output) throw new Error("The captured mesh output is missing.")
    return {
      representation: "triangle-mesh" as const,
      outputRole: meshImportOutputRole(output.outputId),
      shape: body.shape,
      mesh: body.mesh,
      topologyCandidates: [],
    }
  })
  const first = bodies[0]
  if (!first) throw new Error("The imported mesh has no occurrences.")
  const shape = {
    ...first.shape,
    surfaceArea: bodies.reduce((total, body) => total + body.shape.surfaceArea, 0),
    bounds: {
      min: [0, 1, 2].map((axis) =>
        Math.min(...bodies.map((body) => body.shape.bounds.min[axis] ?? Infinity)),
      ) as [number, number, number],
      max: [0, 1, 2].map((axis) =>
        Math.max(...bodies.map((body) => body.shape.bounds.max[axis] ?? -Infinity)),
      ) as [number, number, number],
    },
  }
  return featureEvaluationEngineResultSchema.parse({
    representation: "triangle-mesh",
    engine,
    shape,
    mesh: first.mesh,
    topologyCandidates: [],
    bodies,
    cache: { brepHit: false },
    timings: { evaluationMs: 0, tessellationMs: 0, totalMs: 0 },
  })
}
