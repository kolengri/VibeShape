// Centroid inward-ray sampling adapted from Extrudo, c05d910 (GPL-3.0-or-later).
// Copyright (c) 2026 The Extrudo contributors. See docs/product/print-readiness.md.
import type { PrintPreparationMesh } from "@vibeshape/protocol"
import { BufferAttribute, BufferGeometry, DoubleSide, Ray, Vector3 } from "three"
import { MeshBVH } from "three-mesh-bvh"

export type PrintReadinessSettings = { minimumWallMm: number; overhangAngleDeg: number }
export type PrintReadinessBody = {
  name: string
  triangleCount: number
  topology: "closed" | "open-or-invalid" | "complexity-limit"
  thinTriangles: number[]
  overhangTriangles: number[]
  unknownTriangles: number
  minimumThicknessMm: number | null
  thinAreaMm2: number
  overhangAreaMm2: number
}
export type PrintReadinessResult = PrintReadinessSettings & {
  status: "no-findings" | "warnings" | "unknown"
  bodies: PrintReadinessBody[]
}
export const MAX_READINESS_TRIANGLES = 100_000
const CHUNK = 256
type Options = {
  signal?: { readonly aborted: boolean } | undefined
  onProgress?: ((completed: number, total: number) => void) | undefined
  yield?: (() => Promise<void>) | undefined
}
const yieldTask = () => Promise.resolve()
async function nextChunk(options: Options) {
  await (options.yield ?? yieldTask)()
  checkAbort(options.signal)
}
function checkAbort(signal?: { readonly aborted: boolean }) {
  if (signal?.aborted) {
    const error = new Error("Print readiness was canceled.")
    error.name = "AbortError"
    throw error
  }
}
function emptyBody(mesh: PrintPreparationMesh): PrintReadinessBody {
  return {
    name: mesh.name,
    triangleCount: mesh.triangles.length / 3,
    topology: "open-or-invalid",
    thinTriangles: [],
    overhangTriangles: [],
    unknownTriangles: 0,
    minimumThicknessMm: null,
    thinAreaMm2: 0,
    overhangAreaMm2: 0,
  }
}

type EdgeState = { count: number; direction: number }
function weldedVertexIds(mesh: PrintPreparationMesh) {
  const unique = new Map<string, number>()
  return Array.from({ length: mesh.vertices.length / 3 }, (_, i) => {
    // Exact duplicates are safe to weld. A near-coincident crack remains unknown.
    const key = mesh.vertices.slice(3 * i, 3 * i + 3).join(":")
    const existing = unique.get(key)
    if (existing !== undefined) return existing
    const id = unique.size
    unique.set(key, id)
    return id
  })
}
function addEdges(edges: Map<string, EdgeState>, ids: number[], triangle: number[]) {
  for (let e = 0; e < 3; e++) {
    const x = ids[triangle[e] as number] as number,
      y = ids[triangle[(e + 1) % 3] as number] as number
    if (x === y) return false
    const key = x < y ? `${x}:${y}` : `${y}:${x}`
    const prior = edges.get(key) ?? { count: 0, direction: 0 }
    prior.count++
    prior.direction += x < y ? 1 : -1
    edges.set(key, prior)
  }
  return true
}
/** Edge closure includes face-local duplicate vertices; identities are disposable analysis data. */
function closedOutward(mesh: PrintPreparationMesh, epsilon: number) {
  const ids = weldedVertexIds(mesh)
  const edges = new Map<string, EdgeState>()
  const a = new Vector3(),
    b = new Vector3(),
    c = new Vector3(),
    cross = new Vector3()
  let volume = 0
  // Subtract a local origin to keep translated models numerically stable.
  const origin = new Vector3().fromArray(mesh.vertices)
  for (let t = 0; t < mesh.triangles.length; t += 3) {
    const triangle = mesh.triangles.slice(t, t + 3)
    a.fromArray(mesh.vertices, 3 * (triangle[0] as number)).sub(origin)
    b.fromArray(mesh.vertices, 3 * (triangle[1] as number)).sub(origin)
    c.fromArray(mesh.vertices, 3 * (triangle[2] as number)).sub(origin)
    cross.crossVectors(b.clone().sub(a), c.clone().sub(a))
    if (cross.lengthSq() <= epsilon ** 4 || !addEdges(edges, ids, triangle)) return false
    volume += a.dot(cross.crossVectors(b, c)) / 6
  }
  return (
    volume > epsilon ** 3 &&
    edges.size > 0 &&
    [...edges.values()].every(({ count, direction }) => count === 2 && direction === 0)
  )
}
function admitMesh(mesh: PrintPreparationMesh, result: PrintReadinessBody) {
  if (
    result.triangleCount > MAX_READINESS_TRIANGLES ||
    mesh.vertices.length > MAX_READINESS_TRIANGLES * 9
  ) {
    result.topology = "complexity-limit"
    result.unknownTriangles = result.triangleCount
    return false
  }
  const valid =
    mesh.vertices.length >= 12 &&
    mesh.triangles.length >= 12 &&
    mesh.vertices.length % 3 === 0 &&
    mesh.triangles.length % 3 === 0 &&
    mesh.vertices.every(Number.isFinite) &&
    mesh.triangles.every((i) => Number.isInteger(i) && i >= 0 && i < mesh.vertices.length / 3)
  if (!valid) result.unknownTriangles = result.triangleCount
  return valid
}
function createAnalysisGeometry(mesh: PrintPreparationMesh) {
  const geometry = new BufferGeometry()
  geometry.setAttribute("position", new BufferAttribute(new Float64Array(mesh.vertices), 3))
  geometry.setIndex(new BufferAttribute(new Uint32Array(mesh.triangles), 1))
  geometry.computeBoundingBox()
  return geometry
}
function triangleSampler(
  mesh: PrintPreparationMesh,
  bvh: MeshBVH | null,
  epsilon: number,
  settings: PrintReadinessSettings,
  bedZ: number,
  result: PrintReadinessBody,
) {
  const a = new Vector3(),
    b = new Vector3(),
    c = new Vector3(),
    normal = new Vector3(),
    edge = new Vector3(),
    ray = new Ray()
  const threshold = Math.sin((settings.overhangAngleDeg * Math.PI) / 180)
  return (t: number) => {
    a.fromArray(mesh.vertices, 3 * (mesh.triangles[t * 3] as number))
    b.fromArray(mesh.vertices, 3 * (mesh.triangles[t * 3 + 1] as number))
    c.fromArray(mesh.vertices, 3 * (mesh.triangles[t * 3 + 2] as number))
    normal.crossVectors(edge.subVectors(b, a), c.clone().sub(a))
    const area = normal.length() / 2
    if (area <= epsilon ** 2) {
      result.unknownTriangles++
      return
    }
    normal.normalize()
    if (-normal.z > threshold + 1e-9 && Math.max(a.z, b.z, c.z) > bedZ + epsilon) {
      result.overhangTriangles.push(t)
      result.overhangAreaMm2 += area
    }
    if (!bvh) {
      result.unknownTriangles++
      return
    }
    ray.direction.copy(normal).negate()
    ray.origin
      .copy(a)
      .add(b)
      .add(c)
      .multiplyScalar(1 / 3)
      .addScaledVector(ray.direction, epsilon)
    const hit = bvh.raycastFirst(ray, DoubleSide, epsilon / 2)
    if (!hit || !Number.isFinite(hit.distance)) {
      result.unknownTriangles++
      return
    }
    const thickness = hit.distance + epsilon
    result.minimumThicknessMm = Math.min(result.minimumThicknessMm ?? Infinity, thickness)
    if (thickness < settings.minimumWallMm - epsilon) {
      result.thinTriangles.push(t)
      result.thinAreaMm2 += area
    }
  }
}
async function analyzeBody(
  mesh: PrintPreparationMesh,
  settings: PrintReadinessSettings,
  options: Options,
  progressOffset: number,
  total: number,
  bedZ: number,
) {
  const result = emptyBody(mesh)
  if (!admitMesh(mesh, result)) return result
  await nextChunk(options)
  const geometry = createAnalysisGeometry(mesh)
  try {
    const extent = geometry.boundingBox?.getSize(new Vector3()).length() ?? 0
    const epsilon = Math.max(1e-6, extent * 1e-7)
    const closed = closedOutward(mesh, epsilon)
    result.topology = closed ? "closed" : "open-or-invalid"
    const bvh = closed ? new MeshBVH(geometry, { indirect: true, verbose: false }) : null
    const sample = triangleSampler(mesh, bvh, epsilon, settings, bedZ, result)
    for (let start = 0; start < result.triangleCount; start += CHUNK) {
      await nextChunk(options)
      for (let t = start; t < Math.min(start + CHUNK, result.triangleCount); t++) sample(t)
      options.onProgress?.(progressOffset + Math.min(start + CHUNK, result.triangleCount), total)
    }
    return result
  } finally {
    geometry.dispose()
  }
}

/** Samples oriented millimeter meshes; no result certifies printability or global minimum thickness. */
export async function analyzePrintReadiness(
  meshes: readonly PrintPreparationMesh[],
  settings: PrintReadinessSettings,
  options: Options = {},
): Promise<PrintReadinessResult> {
  if (
    !Number.isFinite(settings.minimumWallMm) ||
    settings.minimumWallMm <= 0 ||
    !Number.isFinite(settings.overhangAngleDeg) ||
    settings.overhangAngleDeg < 0 ||
    settings.overhangAngleDeg > 90
  )
    throw new Error("Invalid print readiness thresholds.")
  checkAbort(options.signal)
  if (meshes.length > 8) throw new Error("Print readiness supports at most eight design bodies.")
  const bodies: PrintReadinessBody[] = []
  const total = meshes.reduce((sum, mesh) => sum + mesh.triangles.length / 3, 0)
  let bedZ = Infinity
  for (const mesh of meshes) {
    if (mesh.vertices.length > MAX_READINESS_TRIANGLES * 9) continue
    for (let i = 2; i < mesh.vertices.length; i += 3)
      bedZ = Math.min(bedZ, mesh.vertices[i] as number)
  }
  let completed = 0
  options.onProgress?.(0, total)
  for (const mesh of meshes) {
    checkAbort(options.signal)
    bodies.push(await analyzeBody(mesh, settings, options, completed, total, bedZ))
    completed += mesh.triangles.length / 3
  }
  checkAbort(options.signal)
  return {
    ...settings,
    bodies,
    status:
      bodies.length === 0 ||
      bodies.some((body) => body.triangleCount === 0) ||
      bodies.some((body) => body.topology !== "closed" || body.unknownTriangles > 0)
        ? "unknown"
        : bodies.some((body) => body.thinTriangles.length || body.overhangTriangles.length)
          ? "warnings"
          : "no-findings",
  }
}
