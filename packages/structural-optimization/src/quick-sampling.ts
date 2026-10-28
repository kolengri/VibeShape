import type { PyBuffer } from "pyodide/ffi"
import { BufferAttribute, BufferGeometry, DoubleSide, Ray, Triangle, Vector3 } from "three"
import { MeshBVH } from "three-mesh-bvh"
import type { QuickLightweightingInput } from "./quick-contract"

// Match the pinned Trimesh near-surface convention in normalized cell coordinates.
const tolerance = 1e-8
const directions = [
  new Vector3(1, 0.371, 0.529).normalize(),
  new Vector3(-0.419, 1, 0.233).normalize(),
  new Vector3(0.283, -0.617, 1).normalize(),
]

function interiorSign(bvh: MeshBVH, ray: Ray, queryDirections: readonly Vector3[]) {
  for (const direction of queryDirections) {
    ray.direction.copy(direction)
    const hit = bvh.raycastFirst(ray, DoubleSide)
    if (!hit) continue
    const normalDot = hit.face?.normal.dot(direction) ?? 0
    const barycentric = hit.barycoord
    if (
      Math.abs(normalDot) <= tolerance ||
      !barycentric ||
      Math.min(barycentric.x, barycentric.y, barycentric.z) <= tolerance
    )
      continue
    return normalDot > 0 ? 1 : -1
  }
  return NaN
}

/** Worker-local acceleration; ambiguous signs return NaN for exact Trimesh fallback. */
export function createQuickSampling(input: QuickLightweightingInput) {
  const origin = [Infinity, Infinity, Infinity]
  for (let index = 0; index < input.mesh.vertices.length; index++) {
    const axis = index % 3
    origin[axis] = Math.min(origin[axis] as number, input.mesh.vertices[index] as number)
  }
  const coordinates = Float64Array.from(
    input.mesh.vertices,
    (value, index) => (value - (origin[index % 3] as number)) / input.cellSizeMm,
  )
  const geometry = new BufferGeometry()
  geometry.setAttribute("position", new BufferAttribute(coordinates, 3))
  geometry.setIndex(new BufferAttribute(Uint32Array.from(input.mesh.indices), 1))
  const bvh = new MeshBVH(geometry, { indirect: true, verbose: false })
  const positions = geometry.getAttribute("position")
  const indices = geometry.index as BufferAttribute
  const point = new Vector3()
  const closest = { point: new Vector3(), distance: 0, faceIndex: 0 }
  const ray = new Ray(point)
  const triangle = new Triangle()
  const surfaceDirection = new Vector3()
  const queryDirections = [surfaceDirection, ...directions]

  function signedDistance() {
    const nearest = bvh.closestPointToPoint(point, closest, 0, Infinity)
    if (!nearest || !Number.isFinite(nearest.distance)) return NaN
    const distance = nearest.distance
    if (distance <= tolerance) return distance
    // A ray aimed at a source triangle also reaches outside points whose fixed
    // rays all miss. Edge/vertex/tangent hits remain ambiguous on every ray.
    const face = nearest.faceIndex * 3
    triangle.setFromAttributeAndIndices(
      positions,
      indices.getX(face),
      indices.getX(face + 1),
      indices.getX(face + 2),
    )
    triangle.getMidpoint(surfaceDirection).sub(point).normalize()
    return distance * interiorSign(bvh, ray, queryDirections)
  }

  return {
    sample(points: PyBuffer): Float64Array {
      const view = points.getBuffer("f64")
      try {
        if (!(view.data instanceof Float64Array) || !view.c_contiguous || view.ndim !== 1)
          throw new Error("Quick sampling requires contiguous float64 XYZ coordinates.")
        const values = view.data.subarray(view.offset, view.offset + (view.shape[0] as number))
        const result = new Float64Array(values.length / 3)
        for (let index = 0; index < result.length; index++) {
          point.fromArray(values, index * 3)
          result[index] = signedDistance()
        }
        return result
      } finally {
        view.release()
      }
    },
    dispose() {
      geometry.dispose()
    },
  }
}
