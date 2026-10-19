import {
  BufferAttribute,
  BufferGeometry,
  DoubleSide,
  Group,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  Vector3,
} from "three"

export type ViewerToolPlane = Readonly<{
  origin: readonly [number, number, number]
  normal: readonly [number, number, number]
  size: number
}>

/** A transient tool guide has no topology or selection identity. */
export function toolPlaneCorners(plane: ViewerToolPlane) {
  if (
    !plane.origin.every(Number.isFinite) ||
    !plane.normal.every(Number.isFinite) ||
    !Number.isFinite(plane.size) ||
    plane.size <= 0 ||
    plane.size > 200_000 ||
    Math.abs(Math.hypot(...plane.normal) - 1) > 1e-6
  )
    return null
  const normal = new Vector3(...plane.normal)
  const tangent = new Vector3()
    .crossVectors(normal, Math.abs(normal.z) < 0.9 ? new Vector3(0, 0, 1) : new Vector3(0, 1, 0))
    .normalize()
  const bitangent = new Vector3().crossVectors(normal, tangent)
  const center = new Vector3(...plane.origin)
  return [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ].map(([x, y]) =>
    center
      .clone()
      .addScaledVector(tangent, ((x ?? 0) * plane.size) / 2)
      .addScaledVector(bitangent, ((y ?? 0) * plane.size) / 2),
  )
}

export class ToolPlaneDecoration {
  readonly group = new Group()
  readonly #surfaceGeometry = new BufferGeometry()
  readonly #outlineGeometry = new BufferGeometry()
  readonly #surfaceMaterial = new MeshBasicMaterial({
    color: "#589ad9",
    transparent: true,
    opacity: 0.12,
    side: DoubleSide,
    depthWrite: false,
  })
  readonly #outlineMaterial = new LineBasicMaterial({
    color: "#589ad9",
    transparent: true,
    opacity: 0.8,
    depthWrite: false,
  })
  readonly #surface = new Mesh(this.#surfaceGeometry, this.#surfaceMaterial)
  readonly #outline = new LineSegments(this.#outlineGeometry, this.#outlineMaterial)
  readonly #positions = new BufferAttribute(new Float32Array(18), 3)
  readonly #outlinePositions = new BufferAttribute(new Float32Array(24), 3)
  constructor() {
    this.#surfaceGeometry.setAttribute("position", this.#positions)
    this.#outlineGeometry.setAttribute("position", this.#outlinePositions)
    this.group.add(this.#surface, this.#outline)
    this.group.visible = false
  }
  setPlane(plane: ViewerToolPlane | null) {
    const corners = plane ? toolPlaneCorners(plane) : null
    this.group.visible = corners !== null
    if (!corners) return
    for (const [index, corner] of [0, 1, 2, 0, 2, 3].entries()) {
      const point = corners[corner]
      if (point) this.#positions.setXYZ(index, point.x, point.y, point.z)
    }
    for (const [index, corner] of [0, 1, 1, 2, 2, 3, 3, 0].entries()) {
      const point = corners[corner]
      if (point) this.#outlinePositions.setXYZ(index, point.x, point.y, point.z)
    }
    this.#positions.needsUpdate = true
    this.#outlinePositions.needsUpdate = true
    this.#surfaceGeometry.computeBoundingSphere()
    this.#outlineGeometry.computeBoundingSphere()
  }
  dispose() {
    this.#surfaceGeometry.dispose()
    this.#outlineGeometry.dispose()
    this.#surfaceMaterial.dispose()
    this.#outlineMaterial.dispose()
    this.group.clear()
  }
}
