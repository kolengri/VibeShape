import {
  Frustum,
  Group,
  Matrix4,
  type Mesh,
  type Object3D,
  type OrthographicCamera,
  type Plane,
  Raycaster,
  Vector2,
  Vector3,
} from "three"
import { LineMaterial } from "three/addons/lines/LineMaterial.js"
import { LineSegments2 } from "three/addons/lines/LineSegments2.js"
import { LineSegmentsGeometry } from "three/addons/lines/LineSegmentsGeometry.js"
import {
  type EdgePickBounds,
  edgeMayHit,
  edgePickBounds,
  edgePickProjection,
} from "./edge-picking-bounds"
import { viewerBodyKey } from "./mesh-geometry"
import { sameViewerGeometry } from "./model-meshes"
import { sectionPointVisible } from "./section-view"
import type { ViewerEdgeCandidate, ViewerMesh, ViewerVector3 } from "./three-viewport"

type Body = Readonly<{ source: ViewerMesh; surface: Mesh }>
type Callbacks = Readonly<{
  preselection: (candidate: ViewerEdgeCandidate | null) => void
  stack: (candidates: readonly ViewerEdgeCandidate[]) => void
  changed: () => void
}>
type EdgeHit = Readonly<{ pixels: number; depth: number }>
type PickingCandidate = Readonly<{
  candidate: ViewerEdgeCandidate
  bodyKey: string
  bounds: EdgePickBounds | null
}>
type HitContext = Readonly<{
  camera: OrthographicCamera
  pointer: Vector2
  width: number
  height: number
  planes: readonly Plane[]
  sectionPlanes: readonly Plane[] | null
  surfaces: Mesh[]
  raycaster: Raycaster
  epsilon: number
}>

function candidateKey(candidate: ViewerEdgeCandidate) {
  return JSON.stringify([viewerBodyKey(candidate), candidate.candidateId])
}

function visible(surface: Mesh) {
  for (let object: Object3D | null = surface; object; object = object.parent) {
    if (!object.visible) return false
  }
  return true
}

function sameCandidateGeometry(left: ViewerEdgeCandidate, right: ViewerEdgeCandidate) {
  return (
    candidateKey(left) === candidateKey(right) &&
    left.points.length === right.points.length &&
    left.points.every((point, index) =>
      point.every((value, axis) => value === right.points[index]?.[axis]),
    )
  )
}

/** Clips the segment before projection so clipped endpoints cannot create phantom hit targets. */
function clipSegment(start: Vector3, end: Vector3, planes: readonly Plane[]) {
  for (const plane of planes) {
    const a = plane.distanceToPoint(start)
    const b = plane.distanceToPoint(end)
    if (a < 0 && b < 0) return false
    if (a < 0) start.lerp(end, a / (a - b))
    else if (b < 0) end.lerp(start, b / (b - a))
  }
  return true
}

function positions(candidate: ViewerEdgeCandidate) {
  const result: number[] = []
  for (let index = 1; index < candidate.points.length; index += 1) {
    const start = candidate.points[index - 1]
    const end = candidate.points[index]
    if (start && end) result.push(...start, ...end)
  }
  return result
}

function compareHits(left: EdgeHit, right: EdgeHit) {
  return left.pixels - right.pixels || left.depth - right.depth
}

function surfaceDepthTolerance(surface: Mesh) {
  const sphere = surface.geometry.boundingSphere
  // Surface buffers are Float32; self-occlusion tolerance follows their precision, never zoom.
  return sphere ? (sphere.center.length() + sphere.radius) * 2 ** -23 : 0
}

/** Tests the nearest projected point against the same clipped surfaces that render the bodies. */
function segmentHit(a: ViewerVector3, b: ViewerVector3, context: HitContext): EdgeHit | null {
  const { camera, pointer, width, height, planes, raycaster, surfaces, sectionPlanes, epsilon } =
    context
  const start = new Vector3(...a)
  const end = new Vector3(...b)
  if (!clipSegment(start, end, planes)) return null
  const projectedStart = start.clone().project(camera)
  const projectedEnd = end.clone().project(camera)
  const delta = new Vector2(
    ((projectedEnd.x - projectedStart.x) * width) / 2,
    ((projectedEnd.y - projectedStart.y) * height) / 2,
  )
  const offset = new Vector2(
    ((pointer.x - projectedStart.x) * width) / 2,
    ((pointer.y - projectedStart.y) * height) / 2,
  )
  const fraction =
    delta.lengthSq() > 0 ? Math.max(0, Math.min(1, offset.dot(delta) / delta.lengthSq())) : 0
  const pixels = offset.sub(delta.multiplyScalar(fraction)).length()
  if (pixels > 6) return null
  const point = start.lerp(end, fraction)
  const projected = point.clone().project(camera)
  raycaster.setFromCamera(new Vector2(projected.x, projected.y), camera)
  const depth = point.clone().sub(raycaster.ray.origin).dot(raycaster.ray.direction)
  const occluder = raycaster
    .intersectObjects(surfaces, false)
    .find((hit) => sectionPointVisible(sectionPlanes, hit.point))
  return occluder && occluder.distance < depth - epsilon ? null : { pixels, depth }
}

function candidateHit(candidate: ViewerEdgeCandidate, context: HitContext) {
  const hits = candidate.points.slice(1).flatMap((point, index) => {
    const previous = candidate.points[index]
    const hit = previous ? segmentHit(previous, point, context) : null
    return hit ? [hit] : []
  })
  return hits.sort(compareHits)[0]
}

function candidateStack(
  candidates: readonly PickingCandidate[],
  visibleBodyKeys: ReadonlySet<string>,
  context: HitContext,
  viewProjection: Matrix4,
) {
  const { camera, pointer, width, height, planes } = context
  const projection = edgePickProjection(camera, viewProjection, planes, pointer, width, height)
  const hits: (EdgeHit & { candidate: ViewerEdgeCandidate })[] = []
  for (const { candidate, bodyKey, bounds } of candidates) {
    if (!visibleBodyKeys.has(bodyKey) || !edgeMayHit(bounds, projection, pointer, width, height))
      continue
    const hit = candidateHit(candidate, context)
    if (hit) hits.push({ candidate, ...hit })
  }
  hits.sort(
    (a, b) =>
      compareHits(a, b) || candidateKey(a.candidate).localeCompare(candidateKey(b.candidate)),
  )
  return hits.slice(0, 8).map(({ candidate }) => candidate)
}

/** Disposable CAD-edge registry, screen-space picking, and depth-tested highlight ownership. */
export class EdgePresentation {
  readonly group = new Group()
  readonly #selected = new Group()
  readonly #hovered = new Group()
  readonly #selectedMaterial = new LineMaterial({
    color: "#f59e0b",
    linewidth: 4,
    depthTest: true,
    depthWrite: false,
    toneMapped: false,
  })
  readonly #hoveredMaterial = new LineMaterial({
    color: "#65a9ee",
    linewidth: 4,
    depthTest: true,
    depthWrite: false,
    toneMapped: false,
  })
  readonly #callbacks: Callbacks
  #bodies = new Map<string, Body>()
  #candidates: readonly ViewerEdgeCandidate[] = []
  #pickingCandidates: readonly PickingCandidate[] = []
  #stack: readonly ViewerEdgeCandidate[] = []
  #preselection: ViewerEdgeCandidate | null = null
  #planes: readonly Plane[] | null = null
  #enabled = true
  #disposed = false

  constructor(callbacks: Callbacks) {
    this.#callbacks = callbacks
    this.group.add(this.#selected, this.#hovered)
  }

  setBodies(bodies: readonly Body[]) {
    if (this.#disposed) return
    const next = new Map(
      bodies
        .filter(
          ({ source, surface }) =>
            (source.appearance === undefined || source.appearance === "model") && visible(surface),
        )
        .map((body) => [viewerBodyKey(body.source), body] as const),
    )
    const retained = this.#candidates.filter((candidate) => {
      const previous = this.#bodies.get(viewerBodyKey(candidate))
      const replacement = next.get(viewerBodyKey(candidate))
      return previous && replacement && sameViewerGeometry(previous.source, replacement.source)
    })
    this.#bodies = next
    this.clearPicking()
    this.setCandidates(retained)
  }

  setCandidates(candidates: readonly ViewerEdgeCandidate[]) {
    if (this.#disposed) return
    const seen = new Set<string>()
    this.#candidates = candidates.filter((candidate) => {
      const key = candidateKey(candidate)
      if (
        !this.#bodies.has(viewerBodyKey(candidate)) ||
        candidate.points.length < 2 ||
        !candidate.points.every((point) => point.every(Number.isFinite)) ||
        seen.has(key)
      )
        return false
      seen.add(key)
      return true
    })
    this.#pickingCandidates = this.#candidates.map((candidate) => ({
      candidate,
      bodyKey: viewerBodyKey(candidate),
      bounds: edgePickBounds(candidate.points),
    }))
    this.#setStack(
      this.#stack.flatMap((previous) => {
        const current = this.#candidates.find((candidate) =>
          sameCandidateGeometry(candidate, previous),
        )
        return current ? [current] : []
      }),
    )
    const previous = this.#preselection
    this.#clearGroup(this.#selected)
    this.#clearGroup(this.#hovered)
    for (const candidate of this.#candidates) {
      if (candidate.selected) this.#addStroke(this.#selected, candidate, this.#selectedMaterial)
    }
    this.#preselection = null
    this.setPreselection(previous)
    if (previous && !this.#preselection) this.#callbacks.preselection(null)
    this.#callbacks.changed()
  }

  setEnabled(enabled: boolean) {
    if (this.#disposed || enabled === this.#enabled) return
    this.#enabled = enabled
    this.group.visible = enabled
    this.clearPicking()
    this.#callbacks.changed()
  }

  setClipping(planes: readonly Plane[] | null) {
    if (this.#disposed || planes === this.#planes) return
    this.#planes = planes
    for (const material of [this.#selectedMaterial, this.#hoveredMaterial]) {
      material.clippingPlanes = planes ? [...planes] : null
      material.needsUpdate = true
    }
    this.clearPicking()
  }

  resize(width: number, height: number) {
    this.#selectedMaterial.resolution.set(width, height)
    this.#hoveredMaterial.resolution.set(width, height)
  }

  setPreselection(candidate: ViewerEdgeCandidate | null) {
    if (this.#disposed) return
    const current =
      this.#enabled && candidate
        ? (this.#stack.find((item) => candidateKey(item) === candidateKey(candidate)) ?? null)
        : null
    if (current === this.#preselection) return
    this.#preselection = current
    this.#clearGroup(this.#hovered)
    if (current && !current.selected) this.#addStroke(this.#hovered, current, this.#hoveredMaterial)
    this.#callbacks.preselection(current)
    this.#callbacks.changed()
  }

  /** Repicks on activation and retains a keyboard-selected overlap while it remains visible. */
  pick(camera: OrthographicCamera, pointer: Vector2, width: number, height: number) {
    const stack = this.#hitStack(camera, pointer, width, height)
    const previous = this.#preselection
    this.#setStack(stack)
    const retained =
      previous && stack.find((candidate) => candidateKey(candidate) === candidateKey(previous))
    this.setPreselection(retained || stack[0] || null)
    return this.#preselection
  }

  clearPicking() {
    this.#setStack([])
    this.setPreselection(null)
  }

  dispose() {
    if (this.#disposed) return
    this.clearPicking()
    this.#disposed = true
    this.#clearGroup(this.#selected)
    this.#clearGroup(this.#hovered)
    this.#selectedMaterial.dispose()
    this.#hoveredMaterial.dispose()
    this.#candidates = []
    this.#pickingCandidates = []
    this.#bodies.clear()
    this.group.removeFromParent()
  }

  #setStack(stack: readonly ViewerEdgeCandidate[]) {
    if (
      stack.length === this.#stack.length &&
      stack.every((item, index) => item === this.#stack[index])
    )
      return
    this.#stack = stack
    this.#callbacks.stack(stack)
  }

  #addStroke(group: Group, candidate: ViewerEdgeCandidate, material: LineMaterial) {
    const stroke = new LineSegments2(
      new LineSegmentsGeometry().setPositions(positions(candidate)),
      material,
    )
    stroke.renderOrder = 5
    group.add(stroke)
  }

  #clearGroup(group: Group) {
    for (const child of [...group.children]) {
      group.remove(child)
      if (child instanceof LineSegments2) child.geometry.dispose()
    }
  }

  #hitStack(camera: OrthographicCamera, pointer: Vector2, width: number, height: number) {
    if (this.#disposed || !this.#enabled || Math.min(width, height) <= 0) return []
    camera.updateMatrixWorld()
    const viewProjection = new Matrix4().multiplyMatrices(
      camera.projectionMatrix,
      camera.matrixWorldInverse,
    )
    const frustum = new Frustum().setFromProjectionMatrix(viewProjection)
    const bodies = [...this.#bodies.values()].filter(({ surface }) => visible(surface))
    const visibleBodyKeys = new Set(bodies.map(({ source }) => viewerBodyKey(source)))
    const surfaces = bodies.map(({ surface }) => surface)
    for (const surface of surfaces) surface.updateWorldMatrix(true, false)
    const raycaster = new Raycaster()
    raycaster.near = camera.near
    raycaster.far = camera.far
    const context: HitContext = {
      camera,
      pointer,
      width,
      height,
      surfaces,
      raycaster,
      planes: [...frustum.planes, ...(this.#planes ?? [])],
      sectionPlanes: this.#planes,
      epsilon: surfaces.reduce(
        (tolerance, surface) => Math.max(tolerance, surfaceDepthTolerance(surface)),
        1e-7,
      ),
    }
    return candidateStack(this.#pickingCandidates, visibleBodyKeys, context, viewProjection)
  }
}
