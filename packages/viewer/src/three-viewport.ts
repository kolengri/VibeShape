import {
  AmbientLight,
  AxesHelper,
  Box3,
  BufferAttribute,
  BufferGeometry,
  Color,
  DirectionalLight,
  DoubleSide,
  EdgesGeometry,
  Group,
  LineBasicMaterial,
  LineDashedMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  MOUSE,
  OrthographicCamera,
  PerspectiveCamera,
  PlaneGeometry,
  Points,
  PointsMaterial,
  Raycaster,
  Scene,
  Sphere,
  Vector2,
  Vector3,
  WebGLRenderer,
} from "three"
import { OrbitControls } from "three/addons/controls/OrbitControls.js"
import {
  defaultViewerOriginPlaneVisibility,
  type ViewerOriginPlane,
  type ViewerOriginPlaneVisibility,
  viewerOriginPlanes,
} from "./origin-planes"
import { viewerBodyColor } from "./viewer-appearance"

export {
  defaultViewerOriginPlaneVisibility,
  type ViewerOriginPlane,
  type ViewerOriginPlaneVisibility,
  viewerOriginPlanes,
} from "./origin-planes"

const DEFAULT_VIEW_HEIGHT = 100
const FIT_PADDING = 1.35
const MAX_PIXEL_RATIO = 2
const ORIGIN_PLANE_SIZE = 64
const ORIENTATION_INSET_MARGIN = 8
const ORIENTATION_INSET_SIZE = 80

export type ViewerMesh = Readonly<{
  appearance?: "datum" | "model" | "preview"
  featureId: string
  positions: Float32Array
  normals: Float32Array
  indices: Uint32Array
  triangleFaceIds: Uint32Array
}>

export type ViewerSketch = Readonly<{
  sketchId: string
  curvePositions: Float32Array
  constructionCurvePositions: Float32Array
  pointPositions: Float32Array
  constructionPointPositions: Float32Array
}>

export type ViewerSketchPointCandidate = Readonly<{
  kind?: "point"
  label: string
  position: ViewerVector3
  sourcePointId: string
  sourceSketchId: string
}>

export type ViewerSketchLineCandidate = Readonly<{
  kind: "line"
  label: string
  start: ViewerVector3
  end: ViewerVector3
  sourceLineId: string
  sourceSketchId: string
}>

export type ViewerSketchCurveCandidate = Readonly<{
  kind: "curve"
  label: string
  points: readonly ViewerVector3[]
  sourceEntityId: string
  sourceSketchId: string
  sourceType: "arc" | "circle" | "ellipse" | "elliptical-arc"
}>

export type ViewerModelPointCandidate = Readonly<{
  kind: "model-point"
  label: string
  featureId: string
  candidateId: string
  position: ViewerVector3
}>

export type ViewerModelLineCandidate = Readonly<{
  kind: "model-line"
  label: string
  featureId: string
  candidateId: string
  start: ViewerVector3
  end: ViewerVector3
}>

export type ViewerModelCurveCandidate = Readonly<{
  kind: "model-curve"
  label: string
  featureId: string
  candidateId: string
  points: readonly ViewerVector3[]
  sourceType: "arc" | "circle"
}>

export type ViewerSketchReferenceCandidate =
  | ViewerSketchPointCandidate
  | ViewerSketchLineCandidate
  | ViewerSketchCurveCandidate
  | ViewerModelPointCandidate
  | ViewerModelLineCandidate
  | ViewerModelCurveCandidate

export type ViewerVector3 = readonly [number, number, number]

/** A finite, orthonormal, right-handed sketch coordinate frame. */
export type ViewerFrame = Readonly<{
  origin: ViewerVector3
  xAxis: ViewerVector3
  yAxis: ViewerVector3
  normal: ViewerVector3
}>

export type ViewerCameraPose = Readonly<{
  position: ViewerVector3
  target: ViewerVector3
  up: ViewerVector3
}>

export type ViewerInteractionMode = "select" | "camera-only" | "sketch-reference-select"

export type OrthographicFrustum = Readonly<{
  left: number
  right: number
  top: number
  bottom: number
}>

export type ViewerSketchProjectionBounds = Readonly<{
  minX: number
  minY: number
  width: number
  height: number
}>

type ViewerCameraClipping = Readonly<{ far: number; near: number }>

export type GeometryViewport = Readonly<{
  clearSketchProjection: () => void
  orientToFrame: (frame: ViewerFrame) => boolean
  setSketchProjection: (frame: ViewerFrame, bounds: ViewerSketchProjectionBounds) => boolean
  setInteractionMode: (mode: ViewerInteractionMode) => void
  setFeaturePreselection: (mesh: ViewerMesh | null) => void
  setFeatureSelection: (mesh: ViewerMesh | null) => void
  setMeshes: (meshes: readonly ViewerMesh[]) => void
  setSketchReferenceCandidates: (candidates: readonly ViewerSketchReferenceCandidate[]) => void
  setSketches: (sketches: readonly ViewerSketch[]) => void
  setOriginPlaneSelection: (selectedPlane: ViewerOriginPlane | null) => void
  setOriginPlaneVisibility: (visibility: ViewerOriginPlaneVisibility) => void
  fit: () => void
  clearSelection: () => void
  dispose: () => void
}>

export type ViewerSelection = Readonly<{
  featureId: string
  faceId: number
  faceOrdinal: number
}>

export type GeometryViewportOptions = Readonly<{
  onOriginPlanePreselectionChange?: (plane: ViewerOriginPlane | null) => void
  onOriginPlaneSelectionChange?: (plane: ViewerOriginPlane) => void
  onSelectionChange?: (selection: ViewerSelection | null) => void
  onSketchReferencePreselectionChange?: (candidate: ViewerSketchReferenceCandidate | null) => void
  onSketchReferenceSelectionChange?: (candidate: ViewerSketchReferenceCandidate) => void
}>

export function orthographicFrustum(viewHeight: number, aspect: number): OrthographicFrustum {
  const safeHeight =
    Number.isFinite(viewHeight) && viewHeight > 0 ? viewHeight : DEFAULT_VIEW_HEIGHT
  const safeAspect = Number.isFinite(aspect) && aspect > 0 ? aspect : 1
  const halfHeight = safeHeight / 2
  const halfWidth = halfHeight * safeAspect
  return { left: -halfWidth, right: halfWidth, top: halfHeight, bottom: -halfHeight }
}

function viewerCameraClipping(
  cameraPosition: ViewerVector3,
  boundsCenter: ViewerVector3,
  boundsRadius: number,
): ViewerCameraClipping {
  const distance = Math.hypot(
    cameraPosition[0] - boundsCenter[0],
    cameraPosition[1] - boundsCenter[1],
    cameraPosition[2] - boundsCenter[2],
  )
  const padding = Math.max(Number.isFinite(boundsRadius) ? boundsRadius * 2.5 : 0, 1)
  const near = Math.max(distance - padding, 0.01)
  return { near, far: Math.max(distance + padding, near + 1) }
}

function viewerViewHeightForBounds(
  currentViewHeight: number,
  target: ViewerVector3,
  boundsCenter: ViewerVector3,
  boundsRadius: number,
) {
  const targetDistance = Math.hypot(
    target[0] - boundsCenter[0],
    target[1] - boundsCenter[1],
    target[2] - boundsCenter[2],
  )
  const radius = Number.isFinite(boundsRadius) ? Math.max(boundsRadius, 0) : 0
  return Math.max(currentViewHeight, (targetDistance + radius) * 2 * FIT_PADDING, 1)
}

const FRAME_TOLERANCE = 1e-6

function finiteVector(vector: unknown): vector is ViewerVector3 {
  return Array.isArray(vector) && vector.length === 3 && vector.every(Number.isFinite)
}

function dot(left: ViewerVector3, right: ViewerVector3) {
  return left[0] * right[0] + left[1] * right[1] + left[2] * right[2]
}

/** Returns false for malformed, non-finite, non-orthonormal, or left-handed frames. */
export function isValidViewerFrame(frame: ViewerFrame): boolean {
  if (!frame || !finiteVector(frame.origin)) return false
  if (!finiteVector(frame.xAxis) || !finiteVector(frame.yAxis) || !finiteVector(frame.normal)) {
    return false
  }
  const { xAxis, yAxis, normal } = frame
  const unit = (vector: ViewerVector3) => Math.abs(dot(vector, vector) - 1) <= FRAME_TOLERANCE
  if (!unit(xAxis) || !unit(yAxis) || !unit(normal)) return false
  if (
    Math.abs(dot(xAxis, yAxis)) > FRAME_TOLERANCE ||
    Math.abs(dot(xAxis, normal)) > FRAME_TOLERANCE ||
    Math.abs(dot(yAxis, normal)) > FRAME_TOLERANCE
  ) {
    return false
  }
  const handedness =
    (xAxis[1] * yAxis[2] - xAxis[2] * yAxis[1]) * normal[0] +
    (xAxis[2] * yAxis[0] - xAxis[0] * yAxis[2]) * normal[1] +
    (xAxis[0] * yAxis[1] - xAxis[1] * yAxis[0]) * normal[2]
  return handedness >= 1 - FRAME_TOLERANCE
}

export function isValidViewerProjectionBounds(bounds: ViewerSketchProjectionBounds): boolean {
  return (
    !!bounds &&
    Number.isFinite(bounds.minX) &&
    Number.isFinite(bounds.minY) &&
    Number.isFinite(bounds.width) &&
    Number.isFinite(bounds.height) &&
    bounds.width > 0 &&
    bounds.height > 0
  )
}

/** Returns the orthographic height required by SVG's xMidYMid meet behavior. */
export function viewerSketchProjectionViewHeight(
  bounds: ViewerSketchProjectionBounds,
  aspect: number,
): number {
  if (!isValidViewerProjectionBounds(bounds)) return DEFAULT_VIEW_HEIGHT
  const safeAspect = Number.isFinite(aspect) && aspect > 0 ? aspect : 1
  return Math.max(bounds.height, bounds.width / safeAspect)
}

export function viewerSketchProjectionTarget(
  frame: ViewerFrame,
  bounds: ViewerSketchProjectionBounds,
): ViewerVector3 | null {
  if (!isValidViewerFrame(frame) || !isValidViewerProjectionBounds(bounds)) return null
  const centerX = bounds.minX + bounds.width / 2
  const centerY = bounds.minY + bounds.height / 2
  return [
    frame.origin[0] + frame.xAxis[0] * centerX + frame.yAxis[0] * centerY,
    frame.origin[1] + frame.xAxis[1] * centerX + frame.yAxis[1] * centerY,
    frame.origin[2] + frame.xAxis[2] * centerX + frame.yAxis[2] * centerY,
  ]
}

/** Derives an orthographic camera pose without mutating a renderer or camera. */
export function viewerCameraPoseForFrame(
  frame: ViewerFrame,
  distance: number,
): ViewerCameraPose | null {
  if (!isValidViewerFrame(frame) || !Number.isFinite(distance) || distance <= 0) return null
  return {
    position: [
      frame.origin[0] + frame.normal[0] * distance,
      frame.origin[1] + frame.normal[1] * distance,
      frame.origin[2] + frame.normal[2] * distance,
    ],
    target: [...frame.origin],
    up: [...frame.yAxis],
  }
}

export function createViewerGeometry(mesh: ViewerMesh) {
  const geometry = new BufferGeometry()
  geometry.setAttribute("position", new BufferAttribute(mesh.positions, 3))
  geometry.setAttribute("normal", new BufferAttribute(mesh.normals, 3))
  geometry.setIndex(new BufferAttribute(mesh.indices, 1))
  geometry.userData = { featureId: mesh.featureId, triangleFaceIds: mesh.triangleFaceIds }
  geometry.computeBoundingBox()
  geometry.computeBoundingSphere()
  return geometry
}

export function createViewerSketchGeometry(positions: Float32Array) {
  const geometry = new BufferGeometry()
  geometry.setAttribute("position", new BufferAttribute(positions, 3))
  geometry.computeBoundingBox()
  geometry.computeBoundingSphere()
  return geometry
}

export function viewerFaceOrdinal(mesh: ViewerMesh, faceId: number) {
  const seen = new Set<number>()
  for (const candidate of mesh.triangleFaceIds) {
    if (seen.has(candidate)) continue
    seen.add(candidate)
    if (candidate === faceId) return seen.size
  }
  return null
}

export function createFaceHighlightGeometry(mesh: ViewerMesh, faceId: number) {
  const triangleCount = mesh.triangleFaceIds.reduce(
    (count, candidate) => count + Number(candidate === faceId),
    0,
  )
  if (triangleCount === 0) return null
  const positions = new Float32Array(triangleCount * 9)
  const normals = new Float32Array(triangleCount * 9)
  let targetOffset = 0
  for (let triangle = 0; triangle < mesh.triangleFaceIds.length; triangle += 1) {
    if (mesh.triangleFaceIds[triangle] !== faceId) continue
    for (let corner = 0; corner < 3; corner += 1) {
      const vertexIndex = mesh.indices[triangle * 3 + corner]
      if (vertexIndex === undefined) return null
      const sourceOffset = vertexIndex * 3
      const x = mesh.positions[sourceOffset]
      const y = mesh.positions[sourceOffset + 1]
      const z = mesh.positions[sourceOffset + 2]
      const normalX = mesh.normals[sourceOffset]
      const normalY = mesh.normals[sourceOffset + 1]
      const normalZ = mesh.normals[sourceOffset + 2]
      if (
        x === undefined ||
        y === undefined ||
        z === undefined ||
        normalX === undefined ||
        normalY === undefined ||
        normalZ === undefined
      ) {
        return null
      }
      positions[targetOffset] = x
      positions[targetOffset + 1] = y
      positions[targetOffset + 2] = z
      normals[targetOffset] = normalX
      normals[targetOffset + 1] = normalY
      normals[targetOffset + 2] = normalZ
      targetOffset += 3
    }
  }
  const geometry = new BufferGeometry()
  geometry.setAttribute("position", new BufferAttribute(positions, 3))
  geometry.setAttribute("normal", new BufferAttribute(normals, 3))
  return geometry
}

function setCameraFrustum(camera: OrthographicCamera, viewHeight: number, aspect: number) {
  const frustum = orthographicFrustum(viewHeight, aspect)
  camera.left = frustum.left
  camera.right = frustum.right
  camera.top = frustum.top
  camera.bottom = frustum.bottom
  camera.updateProjectionMatrix()
}

function disposeModelGroup(group: Group) {
  for (const child of [...group.children]) {
    group.remove(child)
    if (child instanceof Mesh || child instanceof LineSegments || child instanceof Points) {
      child.geometry.dispose()
    }
  }
}

function disposeMaterials(materials: readonly (MeshStandardMaterial | LineBasicMaterial)[]) {
  for (const material of materials) material.dispose()
}

function sameSelection(left: ViewerSelection | null, right: ViewerSelection | null) {
  return left?.featureId === right?.featureId && left?.faceId === right?.faceId
}

function sketchReferenceCandidateKey(candidate: ViewerSketchReferenceCandidate | null) {
  if (!candidate) return null
  if (
    candidate.kind === "model-point" ||
    candidate.kind === "model-line" ||
    candidate.kind === "model-curve"
  ) {
    return `${candidate.kind}:${candidate.featureId}:${candidate.candidateId}`
  }
  const entityId =
    candidate.kind === "line"
      ? candidate.sourceLineId
      : candidate.kind === "curve"
        ? candidate.sourceEntityId
        : candidate.sourcePointId
  return `${candidate.kind ?? "point"}:${candidate.sourceSketchId}:${entityId}`
}

function isViewerSketchPointCandidate(
  candidate: ViewerSketchReferenceCandidate,
): candidate is ViewerSketchPointCandidate | ViewerModelPointCandidate {
  return candidate.kind === "point" || candidate.kind === "model-point"
}

function isViewerSketchLineCandidate(
  candidate: ViewerSketchReferenceCandidate,
): candidate is
  | ViewerSketchLineCandidate
  | ViewerSketchCurveCandidate
  | ViewerModelLineCandidate
  | ViewerModelCurveCandidate {
  return (
    candidate.kind === "line" ||
    candidate.kind === "curve" ||
    candidate.kind === "model-line" ||
    candidate.kind === "model-curve"
  )
}

function sketchReferenceEntityId(
  candidate:
    | ViewerSketchLineCandidate
    | ViewerSketchCurveCandidate
    | ViewerModelLineCandidate
    | ViewerModelCurveCandidate,
) {
  if (candidate.kind === "line") return candidate.sourceLineId
  if (candidate.kind === "curve") return candidate.sourceEntityId
  return candidate.candidateId
}

function sketchReferenceLinePositions(
  candidate:
    | ViewerSketchLineCandidate
    | ViewerSketchCurveCandidate
    | ViewerModelLineCandidate
    | ViewerModelCurveCandidate,
) {
  if (candidate.kind === "line" || candidate.kind === "model-line") {
    return new Float32Array([...candidate.start, ...candidate.end])
  }
  const positions: number[] = []
  for (let index = 1; index < candidate.points.length; index += 1) {
    const start = candidate.points[index - 1]
    const end = candidate.points[index]
    if (start && end) positions.push(...start, ...end)
  }
  return new Float32Array(positions)
}

function sameSketchReferenceCandidate(
  left: ViewerSketchReferenceCandidate | null,
  right: ViewerSketchReferenceCandidate | null,
) {
  return sketchReferenceCandidateKey(left) === sketchReferenceCandidateKey(right)
}

function orientOriginPlane(mesh: Mesh, plane: ViewerOriginPlane) {
  if (plane === "xz") mesh.rotation.x = Math.PI / 2
  if (plane === "yz") mesh.rotation.y = Math.PI / 2
}

function originPlaneColor(plane: ViewerOriginPlane) {
  if (plane === "xy") return "#4c8dff"
  if (plane === "xz") return "#35a66f"
  return "#e15b64"
}

class ThreeGeometryViewport implements GeometryViewport {
  readonly #canvas: HTMLCanvasElement
  readonly #renderer: WebGLRenderer
  readonly #scene = new Scene()
  readonly #camera = new OrthographicCamera(-50, 50, 50, -50, 0.01, 10_000)
  readonly #orientationScene = new Scene()
  readonly #orientationCamera = new PerspectiveCamera(35, 1, 0.1, 10)
  readonly #orientationAxes = new AxesHelper(1.05)
  readonly #controls: OrbitControls
  readonly #modelGroup = new Group()
  readonly #sketchGroup = new Group()
  readonly #sketchPointCandidateGroup = new Group()
  readonly #sketchPointPreselectionGroup = new Group()
  readonly #originPlaneGroup = new Group()
  readonly #featurePreselectionGroup = new Group()
  readonly #featureSelectionGroup = new Group()
  readonly #preselectionGroup = new Group()
  readonly #selectionGroup = new Group()
  readonly #raycaster = new Raycaster()
  readonly #pointer = new Vector2()
  readonly #meshSources = new Map<string, ViewerMesh>()
  readonly #surfaceMeshes: Mesh[] = []
  readonly #originPlaneMeshes = new Map<Mesh, ViewerOriginPlane>()
  readonly #originPlaneMeshesByPlane = new Map<ViewerOriginPlane, Mesh>()
  readonly #originPlaneEdges = new Map<LineSegments, ViewerOriginPlane>()
  readonly #originPlaneEdgesByPlane = new Map<ViewerOriginPlane, LineSegments>()
  readonly #originPlaneMaterials = new Map<ViewerOriginPlane, MeshBasicMaterial>()
  readonly #originPlaneEdgeMaterials: LineBasicMaterial[] = []
  readonly #modelSurfaceMaterials: MeshStandardMaterial[] = []
  readonly #modelEdgeMaterials: LineBasicMaterial[] = []
  readonly #sketchCurveMaterial = new LineBasicMaterial({
    color: new Color("#65a9ee"),
    depthTest: false,
    transparent: true,
    opacity: 0.96,
  })
  readonly #sketchConstructionCurveMaterial = new LineDashedMaterial({
    color: new Color("#65a9ee"),
    dashSize: 4,
    depthTest: false,
    gapSize: 3,
    transparent: true,
    opacity: 0.55,
  })
  readonly #sketchPointMaterial = new PointsMaterial({
    color: new Color("#d7ebff"),
    depthTest: false,
    size: 3,
    sizeAttenuation: false,
  })
  readonly #sketchConstructionPointMaterial = new PointsMaterial({
    color: new Color("#65a9ee"),
    depthTest: false,
    opacity: 0.55,
    size: 2,
    sizeAttenuation: false,
    transparent: true,
  })
  readonly #sketchPointCandidateMaterial = new PointsMaterial({
    color: new Color("#65a9ee"),
    depthTest: false,
    depthWrite: false,
    opacity: 0,
    size: 10,
    sizeAttenuation: false,
    transparent: true,
  })
  readonly #sketchPointPreselectionMaterial = new PointsMaterial({
    color: new Color("#f59e0b"),
    depthTest: false,
    size: 14,
    sizeAttenuation: false,
  })
  readonly #sketchLineCandidateMaterial = new LineBasicMaterial({
    color: new Color("#65a9ee"),
    depthTest: false,
    depthWrite: false,
    opacity: 0,
    transparent: true,
  })
  readonly #sketchLinePreselectionMaterial = new LineBasicMaterial({
    color: new Color("#f59e0b"),
    depthTest: false,
  })
  readonly #previewSurfaceMaterial = new MeshBasicMaterial({
    color: new Color("#4c8dff"),
    transparent: true,
    opacity: 0.34,
    depthWrite: false,
    side: DoubleSide,
  })
  readonly #previewEdgeMaterial = new LineBasicMaterial({
    color: new Color("#65a9ee"),
    transparent: true,
    opacity: 0.9,
  })
  readonly #datumSurfaceMaterial = new MeshBasicMaterial({
    color: new Color("#65a9ee"),
    transparent: true,
    opacity: 0.16,
    depthWrite: false,
    side: DoubleSide,
  })
  readonly #datumEdgeMaterial = new LineBasicMaterial({
    color: new Color("#65a9ee"),
    transparent: true,
    opacity: 0.8,
  })
  readonly #preselectionMaterial = new MeshBasicMaterial({
    color: new Color("#65a9ee"),
    transparent: true,
    opacity: 0.3,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    side: DoubleSide,
  })
  readonly #selectionMaterial = new MeshBasicMaterial({
    color: new Color("#f59e0b"),
    transparent: true,
    opacity: 0.5,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -3,
    side: DoubleSide,
  })
  readonly #featurePreselectionMaterial = new MeshBasicMaterial({
    color: new Color("#65a9ee"),
    depthTest: false,
    depthWrite: false,
    opacity: 0.14,
    side: DoubleSide,
    transparent: true,
  })
  readonly #featurePreselectionEdgeMaterial = new LineBasicMaterial({
    color: new Color("#65a9ee"),
    depthTest: false,
    opacity: 0.76,
    transparent: true,
  })
  readonly #featureSelectionMaterial = new MeshBasicMaterial({
    color: new Color("#f59e0b"),
    depthTest: false,
    depthWrite: false,
    opacity: 0.22,
    side: DoubleSide,
    transparent: true,
  })
  readonly #featureSelectionEdgeMaterial = new LineBasicMaterial({
    color: new Color("#f59e0b"),
    depthTest: false,
    opacity: 0.96,
    transparent: true,
  })
  readonly #resizeObserver: ResizeObserver
  readonly #onOriginPlanePreselectionChange: (plane: ViewerOriginPlane | null) => void
  readonly #onOriginPlaneSelectionChange: (plane: ViewerOriginPlane) => void
  readonly #onSelectionChange: (selection: ViewerSelection | null) => void
  readonly #onSketchReferencePreselectionChange: (
    candidate: ViewerSketchReferenceCandidate | null,
  ) => void
  readonly #onSketchReferenceSelectionChange: (candidate: ViewerSketchReferenceCandidate) => void
  #viewHeight = DEFAULT_VIEW_HEIGHT
  #disposed = false
  #pointerDown: Readonly<{ x: number; y: number }> | null = null
  #originPlaneSelection: ViewerOriginPlane | null = null
  #originPlanePreselection: ViewerOriginPlane | null = null
  #originPlaneVisibility: ViewerOriginPlaneVisibility = defaultViewerOriginPlaneVisibility
  #featurePreselection: ViewerMesh | null = null
  #featureSelection: ViewerMesh | null = null
  #preselection: ViewerSelection | null = null
  #selection: ViewerSelection | null = null
  #sketchPointCandidates: readonly (ViewerSketchPointCandidate | ViewerModelPointCandidate)[] = []
  #sketchPointObject: Points | null = null
  #sketchLineObjects = new Map<
    LineSegments,
    | ViewerSketchLineCandidate
    | ViewerSketchCurveCandidate
    | ViewerModelLineCandidate
    | ViewerModelCurveCandidate
  >()
  #sketchPointPreselection: ViewerSketchReferenceCandidate | null = null
  #interactionMode: ViewerInteractionMode = "select"
  #sketchProjection: Readonly<{ bounds: ViewerSketchProjectionBounds }> | null = null

  constructor(canvas: HTMLCanvasElement, options: GeometryViewportOptions) {
    this.#canvas = canvas
    this.#onOriginPlanePreselectionChange =
      options.onOriginPlanePreselectionChange ?? (() => undefined)
    this.#onOriginPlaneSelectionChange = options.onOriginPlaneSelectionChange ?? (() => undefined)
    this.#onSelectionChange = options.onSelectionChange ?? (() => undefined)
    this.#onSketchReferencePreselectionChange =
      options.onSketchReferencePreselectionChange ?? (() => undefined)
    this.#onSketchReferenceSelectionChange =
      options.onSketchReferenceSelectionChange ?? (() => undefined)
    const context = canvas.getContext("webgl2", {
      alpha: true,
      antialias: true,
      depth: true,
      powerPreference: "high-performance",
      preserveDrawingBuffer: false,
    })
    if (!context) throw new Error("WebGL2 is unavailable.")
    this.#renderer = new WebGLRenderer({ canvas, context, alpha: true, antialias: true })
    this.#renderer.setClearAlpha(0)
    this.#renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO))
    this.#scene.add(this.#modelGroup)
    this.#scene.add(this.#sketchGroup)
    this.#scene.add(this.#sketchPointCandidateGroup)
    this.#scene.add(this.#sketchPointPreselectionGroup)
    this.#createOriginPlanes()
    this.#scene.add(this.#originPlaneGroup)
    this.#scene.add(this.#featurePreselectionGroup)
    this.#scene.add(this.#featureSelectionGroup)
    this.#scene.add(this.#preselectionGroup)
    this.#scene.add(this.#selectionGroup)
    this.#orientationAxes.setColors(
      new Color("#e15b64"),
      new Color("#35a66f"),
      new Color("#4c8dff"),
    )
    this.#orientationScene.add(this.#orientationAxes)
    this.#scene.add(new AmbientLight(0xffffff, 1.6))
    const keyLight = new DirectionalLight(0xffffff, 2.8)
    keyLight.position.set(3, -4, 6)
    this.#scene.add(keyLight)
    const fillLight = new DirectionalLight(0x8eb8df, 1.2)
    fillLight.position.set(-4, 2, 3)
    this.#scene.add(fillLight)

    this.#camera.up.set(0, 0, 1)
    this.#camera.position.set(80, -80, 65)
    this.#controls = new OrbitControls(this.#camera, canvas)
    this.#controls.enableDamping = false
    this.#controls.zoomToCursor = true
    this.#controls.mouseButtons.LEFT = MOUSE.ROTATE
    this.#controls.mouseButtons.MIDDLE = MOUSE.ROTATE
    this.#controls.mouseButtons.RIGHT = MOUSE.PAN
    this.#controls.target.set(0, 0, 0)
    this.#controls.addEventListener("change", this.#render)
    this.#controls.update()
    this.#raycaster.params.Points.threshold = 2
    this.#raycaster.params.Line.threshold = 2
    canvas.addEventListener("pointerdown", this.#onPointerDown)
    canvas.addEventListener("pointermove", this.#onPointerMove)
    canvas.addEventListener("pointerup", this.#onPointerUp)
    canvas.addEventListener("pointerleave", this.#onPointerLeave)

    this.#resizeObserver = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (!entry) return
      this.#resize(entry.contentRect.width, entry.contentRect.height)
    })
    this.#resizeObserver.observe(canvas)
  }

  setMeshes(meshes: readonly ViewerMesh[]) {
    if (this.#disposed) return
    this.clearSelection()
    this.#setPreselection(null)
    disposeModelGroup(this.#modelGroup)
    disposeMaterials(this.#modelSurfaceMaterials)
    disposeMaterials(this.#modelEdgeMaterials)
    this.#modelSurfaceMaterials.length = 0
    this.#modelEdgeMaterials.length = 0
    this.#surfaceMeshes.length = 0
    this.#meshSources.clear()
    for (const source of meshes) {
      const preview = source.appearance === "preview"
      const datum = source.appearance === "datum"
      const geometry = createViewerGeometry(source)
      const surfaceMaterial = preview
        ? this.#previewSurfaceMaterial
        : datum
          ? this.#datumSurfaceMaterial
          : this.#createModelSurfaceMaterial(source.featureId)
      const edgeMaterial = preview
        ? this.#previewEdgeMaterial
        : datum
          ? this.#datumEdgeMaterial
          : this.#createModelEdgeMaterial()
      const surface = new Mesh(geometry, surfaceMaterial)
      surface.name = source.featureId
      if (!preview) {
        this.#meshSources.set(source.featureId, source)
        this.#surfaceMeshes.push(surface)
      }
      this.#modelGroup.add(surface)
      const edges = new LineSegments(new EdgesGeometry(geometry, 28), edgeMaterial)
      edges.name = `${source.featureId}:edges`
      this.#modelGroup.add(edges)
    }
    this.#render()
  }

  setFeaturePreselection(mesh: ViewerMesh | null) {
    if (this.#disposed) return
    const visibleMesh = mesh?.featureId === this.#featureSelection?.featureId ? null : mesh
    if (visibleMesh === this.#featurePreselection) return
    this.#featurePreselection = visibleMesh
    this.#replaceFeatureHighlight(
      this.#featurePreselectionGroup,
      this.#featurePreselectionMaterial,
      this.#featurePreselectionEdgeMaterial,
      visibleMesh,
      2,
    )
  }

  setFeatureSelection(mesh: ViewerMesh | null) {
    if (this.#disposed || mesh === this.#featureSelection) return
    this.#featureSelection = mesh
    this.#replaceFeatureHighlight(
      this.#featureSelectionGroup,
      this.#featureSelectionMaterial,
      this.#featureSelectionEdgeMaterial,
      mesh,
      3,
    )
    if (mesh?.featureId === this.#featurePreselection?.featureId) {
      this.setFeaturePreselection(null)
    }
  }

  setSketches(sketches: readonly ViewerSketch[]) {
    if (this.#disposed) return
    disposeModelGroup(this.#sketchGroup)
    for (const sketch of sketches) {
      this.#addSketchLines(
        sketch.sketchId,
        "curves",
        sketch.curvePositions,
        this.#sketchCurveMaterial,
      )
      this.#addSketchLines(
        sketch.sketchId,
        "construction-curves",
        sketch.constructionCurvePositions,
        this.#sketchConstructionCurveMaterial,
        true,
      )
      this.#addSketchPoints(
        sketch.sketchId,
        "points",
        sketch.pointPositions,
        this.#sketchPointMaterial,
      )
      this.#addSketchPoints(
        sketch.sketchId,
        "construction-points",
        sketch.constructionPointPositions,
        this.#sketchConstructionPointMaterial,
      )
    }
    this.#render()
  }

  setSketchReferenceCandidates(candidates: readonly ViewerSketchReferenceCandidate[]) {
    if (this.#disposed) return
    this.#setSketchPointPreselection(null)
    disposeModelGroup(this.#sketchPointCandidateGroup)
    this.#sketchPointCandidates = candidates.filter(isViewerSketchPointCandidate)
    this.#sketchLineObjects.clear()
    this.#sketchPointObject = null
    if (this.#sketchPointCandidates.length > 0) {
      const positions = new Float32Array(this.#sketchPointCandidates.length * 3)
      for (const [index, candidate] of this.#sketchPointCandidates.entries()) {
        positions.set(candidate.position, index * 3)
      }
      const points = new Points(
        createViewerSketchGeometry(positions),
        this.#sketchPointCandidateMaterial,
      )
      points.name = "sketch-reference-candidates"
      points.renderOrder = 8
      this.#sketchPointObject = points
      this.#sketchPointCandidateGroup.add(points)
    }
    for (const candidate of candidates) {
      if (!isViewerSketchLineCandidate(candidate)) continue
      const line = new LineSegments(
        createViewerSketchGeometry(sketchReferenceLinePositions(candidate)),
        this.#sketchLineCandidateMaterial,
      )
      line.name = `sketch-reference-${candidate.kind}:${sketchReferenceEntityId(candidate)}`
      line.renderOrder = 8
      this.#sketchLineObjects.set(line, candidate)
      this.#sketchPointCandidateGroup.add(line)
    }
    this.#render()
  }

  setOriginPlaneSelection(selectedPlane: ViewerOriginPlane | null) {
    if (this.#disposed || selectedPlane === this.#originPlaneSelection) return
    this.#originPlaneSelection = selectedPlane
    this.#setOriginPlanePreselection(null)
    if (selectedPlane !== null) {
      this.clearSelection()
      this.#setPreselection(null)
    }
    this.#updateOriginPlanes()
    this.#render()
  }

  setOriginPlaneVisibility(visibility: ViewerOriginPlaneVisibility) {
    if (this.#disposed) return
    this.#originPlaneVisibility = visibility
    this.#updateOriginPlanes()
    this.#render()
  }

  orientToFrame(frame: ViewerFrame) {
    if (this.#disposed) return false
    const distance = this.#camera.position.distanceTo(this.#controls.target)
    const pose = viewerCameraPoseForFrame(frame, distance)
    if (!pose) return false
    this.#controls.target.set(...pose.target)
    this.#camera.position.set(...pose.position)
    this.#camera.up.set(...pose.up)
    this.#expandViewToScene(frame.origin)
    this.#updateClippingToScene()
    this.#updateProjection()
    this.#controls.update()
    this.#render()
    return true
  }

  setSketchProjection(frame: ViewerFrame, bounds: ViewerSketchProjectionBounds) {
    if (this.#disposed) return false
    const target = viewerSketchProjectionTarget(frame, bounds)
    if (!target) return false
    const distance = this.#camera.position.distanceTo(this.#controls.target)
    const pose = viewerCameraPoseForFrame({ ...frame, origin: target }, distance)
    if (!pose) return false
    this.#sketchProjection = { bounds }
    this.#controls.target.set(...pose.target)
    this.#camera.position.set(...pose.position)
    this.#camera.up.set(...pose.up)
    const aspect = this.#canvas.clientWidth / Math.max(this.#canvas.clientHeight, 1)
    this.#viewHeight = viewerSketchProjectionViewHeight(bounds, aspect)
    this.#updateClippingToScene()
    this.#updateProjection()
    this.#controls.update()
    this.#render()
    return true
  }

  clearSketchProjection() {
    if (this.#disposed) return
    this.#sketchProjection = null
    this.#render()
  }

  setInteractionMode(mode: ViewerInteractionMode) {
    if (this.#disposed || mode === this.#interactionMode) return
    this.#interactionMode = mode
    if (mode !== "sketch-reference-select") this.#setSketchPointPreselection(null)
    if (mode === "camera-only" || mode === "sketch-reference-select") {
      this.#pointerDown = null
      this.#setOriginPlanePreselection(null)
      this.#setPreselection(null)
      if (this.#selection) {
        this.#selection = null
        disposeModelGroup(this.#selectionGroup)
      }
      this.#render()
    }
  }

  fit() {
    if (this.#disposed) return
    const bounds = new Box3().setFromObject(this.#modelGroup).expandByObject(this.#sketchGroup)
    if (bounds.isEmpty()) {
      this.#viewHeight = DEFAULT_VIEW_HEIGHT
      this.#controls.target.set(0, 0, 0)
      this.#camera.position.set(80, -80, 65)
      this.#camera.near = 0.01
      this.#camera.far = 10_000
      this.#updateProjection()
      this.#controls.update()
      this.#render()
      return
    }
    const sphere = bounds.getBoundingSphere(new Sphere())
    const radius = Math.max(sphere.radius, 0.001)
    const direction = new Vector3(1, -1, 0.8).normalize()
    const distance = Math.max(radius * 4, 10)
    this.#viewHeight = Math.max(radius * 2 * FIT_PADDING, 1)
    this.#controls.target.copy(sphere.center)
    this.#camera.position.copy(sphere.center).addScaledVector(direction, distance)
    this.#camera.near = Math.max(distance - radius * 2.5, 0.01)
    this.#camera.far = distance + radius * 2.5
    this.#updateProjection()
    this.#controls.update()
    this.#render()
  }

  clearSelection() {
    if (!this.#selection) return
    this.#selection = null
    disposeModelGroup(this.#selectionGroup)
    this.#onSelectionChange(null)
    this.#render()
  }

  dispose() {
    if (this.#disposed) return
    this.#disposed = true
    this.#resizeObserver.disconnect()
    this.#canvas.removeEventListener("pointerdown", this.#onPointerDown)
    this.#canvas.removeEventListener("pointermove", this.#onPointerMove)
    this.#canvas.removeEventListener("pointerup", this.#onPointerUp)
    this.#canvas.removeEventListener("pointerleave", this.#onPointerLeave)
    this.#controls.removeEventListener("change", this.#render)
    this.#controls.dispose()
    disposeModelGroup(this.#modelGroup)
    disposeModelGroup(this.#sketchGroup)
    disposeModelGroup(this.#sketchPointCandidateGroup)
    disposeModelGroup(this.#sketchPointPreselectionGroup)
    disposeMaterials(this.#modelSurfaceMaterials)
    disposeMaterials(this.#modelEdgeMaterials)
    disposeModelGroup(this.#originPlaneGroup)
    disposeModelGroup(this.#featurePreselectionGroup)
    disposeModelGroup(this.#featureSelectionGroup)
    disposeModelGroup(this.#preselectionGroup)
    disposeModelGroup(this.#selectionGroup)
    this.#previewSurfaceMaterial.dispose()
    this.#previewEdgeMaterial.dispose()
    this.#datumSurfaceMaterial.dispose()
    this.#datumEdgeMaterial.dispose()
    this.#sketchCurveMaterial.dispose()
    this.#sketchConstructionCurveMaterial.dispose()
    this.#sketchPointMaterial.dispose()
    this.#sketchConstructionPointMaterial.dispose()
    this.#sketchPointCandidateMaterial.dispose()
    this.#sketchPointPreselectionMaterial.dispose()
    this.#sketchLineCandidateMaterial.dispose()
    this.#sketchLinePreselectionMaterial.dispose()
    this.#preselectionMaterial.dispose()
    this.#selectionMaterial.dispose()
    this.#featurePreselectionMaterial.dispose()
    this.#featurePreselectionEdgeMaterial.dispose()
    this.#featureSelectionMaterial.dispose()
    this.#featureSelectionEdgeMaterial.dispose()
    for (const material of this.#originPlaneMaterials.values()) material.dispose()
    for (const material of this.#originPlaneEdgeMaterials) material.dispose()
    this.#orientationAxes.geometry.dispose()
    const orientationMaterials = Array.isArray(this.#orientationAxes.material)
      ? this.#orientationAxes.material
      : [this.#orientationAxes.material]
    for (const material of orientationMaterials) material.dispose()
    this.#originPlaneEdgeMaterials.length = 0
    this.#originPlaneMaterials.clear()
    this.#originPlaneMeshes.clear()
    this.#originPlaneMeshesByPlane.clear()
    this.#originPlaneEdges.clear()
    this.#originPlaneEdgesByPlane.clear()
    this.#renderer.dispose()
  }

  #resize(width: number, height: number) {
    if (this.#disposed || width <= 0 || height <= 0) return
    this.#renderer.setSize(width, height, false)
    this.#updateProjection(width / height)
    this.#render()
  }

  #updateProjection(aspect?: number) {
    const resolvedAspect =
      aspect ?? this.#canvas.clientWidth / Math.max(this.#canvas.clientHeight, 1)
    if (this.#sketchProjection) {
      this.#viewHeight = viewerSketchProjectionViewHeight(
        this.#sketchProjection.bounds,
        resolvedAspect,
      )
    }
    setCameraFrustum(this.#camera, this.#viewHeight, resolvedAspect)
  }

  #updateClippingToScene() {
    const bounds = new Box3()
      .setFromObject(this.#modelGroup)
      .expandByObject(this.#sketchGroup)
      .expandByObject(this.#sketchPointCandidateGroup)
    if (bounds.isEmpty()) {
      this.#camera.near = 0.01
      this.#camera.far = 10_000
      return
    }
    const sphere = bounds.getBoundingSphere(new Sphere())
    const clipping = viewerCameraClipping(
      this.#camera.position.toArray() as [number, number, number],
      sphere.center.toArray() as [number, number, number],
      sphere.radius,
    )
    this.#camera.near = clipping.near
    this.#camera.far = clipping.far
  }

  #expandViewToScene(target: ViewerVector3) {
    const bounds = new Box3()
      .setFromObject(this.#modelGroup)
      .expandByObject(this.#sketchGroup)
      .expandByObject(this.#sketchPointCandidateGroup)
    if (bounds.isEmpty()) return
    const sphere = bounds.getBoundingSphere(new Sphere())
    this.#viewHeight = viewerViewHeightForBounds(
      this.#viewHeight,
      target,
      sphere.center.toArray() as [number, number, number],
      sphere.radius,
    )
  }

  #pick(event: PointerEvent): ViewerSelection | null {
    if (!this.#prepareRaycaster(event)) return null
    const intersection = this.#raycaster.intersectObjects(this.#surfaceMeshes, false)[0]
    if (!intersection || intersection.faceIndex === undefined || intersection.faceIndex === null) {
      return null
    }
    const source = this.#meshSources.get(intersection.object.name)
    const faceId = source?.triangleFaceIds[intersection.faceIndex]
    if (!source || faceId === undefined) return null
    const faceOrdinal = viewerFaceOrdinal(source, faceId)
    return faceOrdinal === null ? null : { featureId: source.featureId, faceId, faceOrdinal }
  }

  #pickOriginPlane(event: PointerEvent): ViewerOriginPlane | null {
    if (!this.#prepareRaycaster(event)) return null
    const intersection = this.#raycaster.intersectObjects(
      [...this.#originPlaneMeshes.keys()],
      false,
    )[0]
    return intersection ? (this.#originPlaneMeshes.get(intersection.object as Mesh) ?? null) : null
  }

  #pickSketchPoint(event: PointerEvent): ViewerSketchReferenceCandidate | null {
    if (!this.#prepareRaycaster(event)) return null
    const pointHit = this.#pickSketchReferencePoint()
    const lineHit = this.#pickSketchReferenceLine()
    if (!pointHit) return lineHit?.candidate ?? null
    if (!lineHit) return pointHit.candidate
    return pointHit.distance <= lineHit.distance ? pointHit.candidate : lineHit.candidate
  }

  #pickSketchReferencePoint() {
    if (!this.#sketchPointObject) return null
    const hit = this.#raycaster.intersectObject(this.#sketchPointObject, false)[0]
    if (hit?.index === undefined) return null
    const candidate = this.#sketchPointCandidates[hit.index]
    return candidate ? { candidate, distance: hit.distance } : null
  }

  #pickSketchReferenceLine() {
    const hit = this.#raycaster.intersectObjects([...this.#sketchLineObjects.keys()], false)[0]
    if (!hit) return null
    const candidate = this.#sketchLineObjects.get(hit.object as LineSegments)
    return candidate ? { candidate, distance: hit.distance } : null
  }

  #prepareRaycaster(event: PointerEvent) {
    const bounds = this.#canvas.getBoundingClientRect()
    if (bounds.width <= 0 || bounds.height <= 0) return false
    this.#pointer.set(
      ((event.clientX - bounds.left) / bounds.width) * 2 - 1,
      -((event.clientY - bounds.top) / bounds.height) * 2 + 1,
    )
    this.#raycaster.setFromCamera(this.#pointer, this.#camera)
    const selectionThreshold = Math.max((this.#viewHeight / bounds.height) * 8, 0.25)
    this.#raycaster.params.Line.threshold = selectionThreshold
    this.#raycaster.params.Points.threshold = selectionThreshold
    return true
  }

  #setSketchPointPreselection(candidate: ViewerSketchReferenceCandidate | null) {
    if (sameSketchReferenceCandidate(candidate, this.#sketchPointPreselection)) return
    this.#sketchPointPreselection = candidate
    disposeModelGroup(this.#sketchPointPreselectionGroup)
    if (candidate && isViewerSketchLineCandidate(candidate)) {
      const line = new LineSegments(
        createViewerSketchGeometry(sketchReferenceLinePositions(candidate)),
        this.#sketchLinePreselectionMaterial,
      )
      line.renderOrder = 9
      this.#sketchPointPreselectionGroup.add(line)
    } else if (candidate) {
      const points = new Points(
        createViewerSketchGeometry(new Float32Array(candidate.position)),
        this.#sketchPointPreselectionMaterial,
      )
      points.renderOrder = 9
      this.#sketchPointPreselectionGroup.add(points)
    }
    this.#canvas.style.cursor = candidate ? "crosshair" : ""
    this.#onSketchReferencePreselectionChange(candidate)
    this.#render()
  }

  #createOriginPlanes() {
    for (const plane of viewerOriginPlanes) {
      const material = new MeshBasicMaterial({
        color: new Color(originPlaneColor(plane)),
        depthWrite: false,
        opacity: 0.16,
        side: DoubleSide,
        transparent: true,
      })
      const mesh = new Mesh(new PlaneGeometry(ORIGIN_PLANE_SIZE, ORIGIN_PLANE_SIZE), material)
      mesh.name = `origin-plane:${plane}`
      orientOriginPlane(mesh, plane)
      this.#originPlaneMaterials.set(plane, material)
      this.#originPlaneMeshes.set(mesh, plane)
      this.#originPlaneMeshesByPlane.set(plane, mesh)
      this.#originPlaneGroup.add(mesh)

      const edgeMaterial = new LineBasicMaterial({ color: new Color(originPlaneColor(plane)) })
      this.#originPlaneEdgeMaterials.push(edgeMaterial)
      const edges = new LineSegments(new EdgesGeometry(mesh.geometry), edgeMaterial)
      edges.name = `origin-plane:${plane}:edges`
      edges.rotation.copy(mesh.rotation)
      this.#originPlaneEdges.set(edges, plane)
      this.#originPlaneEdgesByPlane.set(plane, edges)
      this.#originPlaneGroup.add(edges)
    }
    this.#updateOriginPlanes()
  }

  #createModelSurfaceMaterial(featureId: string) {
    const material = new MeshStandardMaterial({
      color: new Color(viewerBodyColor(featureId)),
      roughness: 0.72,
      metalness: 0.04,
    })
    this.#modelSurfaceMaterials.push(material)
    return material
  }

  #createModelEdgeMaterial() {
    const material = new LineBasicMaterial({ color: new Color("#263746") })
    this.#modelEdgeMaterials.push(material)
    return material
  }

  #addSketchLines(
    sketchId: string,
    kind: string,
    positions: Float32Array,
    material: LineBasicMaterial | LineDashedMaterial,
    dashed = false,
  ) {
    if (positions.length === 0) return
    const lines = new LineSegments(createViewerSketchGeometry(positions), material)
    lines.name = `sketch:${sketchId}:${kind}`
    lines.renderOrder = 4
    if (dashed) lines.computeLineDistances()
    this.#sketchGroup.add(lines)
  }

  #addSketchPoints(
    sketchId: string,
    kind: string,
    positions: Float32Array,
    material: PointsMaterial,
  ) {
    if (positions.length === 0) return
    const points = new Points(createViewerSketchGeometry(positions), material)
    points.name = `sketch:${sketchId}:${kind}`
    points.renderOrder = 5
    this.#sketchGroup.add(points)
  }

  #setOriginPlanePreselection(plane: ViewerOriginPlane | null) {
    if (plane === this.#originPlanePreselection) return
    this.#originPlanePreselection = plane
    this.#canvas.style.cursor = plane ? "pointer" : ""
    this.#updateOriginPlanes()
    this.#onOriginPlanePreselectionChange(plane)
    this.#render()
  }

  #updateOriginPlanes() {
    for (const [plane, material] of this.#originPlaneMaterials) {
      const visible = this.#originPlaneSelection !== null || this.#originPlaneVisibility[plane]
      const mesh = this.#originPlaneMeshesByPlane.get(plane)
      if (mesh) mesh.visible = visible
      const edges = this.#originPlaneEdgesByPlane.get(plane)
      if (edges) edges.visible = visible
      material.opacity =
        plane === this.#originPlanePreselection
          ? 0.42
          : plane === this.#originPlaneSelection
            ? 0.26
            : 0.12
    }
    this.#originPlaneGroup.visible = [...this.#originPlaneMeshes].some(([mesh]) => mesh.visible)
  }

  #setPreselection(selection: ViewerSelection | null) {
    const visibleSelection = sameSelection(selection, this.#selection) ? null : selection
    if (sameSelection(visibleSelection, this.#preselection)) return
    this.#preselection = visibleSelection
    this.#replaceHighlight(this.#preselectionGroup, this.#preselectionMaterial, visibleSelection)
  }

  #setSelection(selection: ViewerSelection | null) {
    if (sameSelection(selection, this.#selection)) return
    this.#selection = selection
    this.#replaceHighlight(this.#selectionGroup, this.#selectionMaterial, selection)
    if (sameSelection(this.#preselection, selection)) this.#setPreselection(null)
    this.#onSelectionChange(selection)
  }

  #replaceHighlight(group: Group, material: MeshBasicMaterial, selection: ViewerSelection | null) {
    disposeModelGroup(group)
    if (selection) {
      const source = this.#meshSources.get(selection.featureId)
      const geometry = source ? createFaceHighlightGeometry(source, selection.faceId) : null
      if (geometry) group.add(new Mesh(geometry, material))
    }
    this.#render()
  }

  #replaceFeatureHighlight(
    group: Group,
    surfaceMaterial: MeshBasicMaterial,
    edgeMaterial: LineBasicMaterial,
    source: ViewerMesh | null,
    renderOrder: number,
  ) {
    disposeModelGroup(group)
    if (source) {
      const geometry = createViewerGeometry(source)
      const surface = new Mesh(geometry, surfaceMaterial)
      surface.name = `${source.featureId}:feature-highlight`
      surface.renderOrder = renderOrder
      group.add(surface)
      const edges = new LineSegments(new EdgesGeometry(geometry, 28), edgeMaterial)
      edges.name = `${source.featureId}:feature-highlight-edges`
      edges.renderOrder = renderOrder
      group.add(edges)
    }
    this.#render()
  }

  #onPointerDown = (event: PointerEvent) => {
    if (event.isPrimary && event.button === 0) {
      this.#pointerDown = { x: event.clientX, y: event.clientY }
    }
  }

  #onPointerMove = (event: PointerEvent) => {
    if (!event.isPrimary) return
    if (this.#interactionMode === "camera-only") return
    if (this.#interactionMode === "sketch-reference-select") {
      this.#setSketchPointPreselection(this.#pickSketchPoint(event))
      return
    }
    if (this.#originPlaneSelection) {
      const modelSelection = this.#pick(event)
      const plane = modelSelection ? null : this.#pickOriginPlane(event)
      this.#setOriginPlanePreselection(plane)
      this.#setPreselection(modelSelection)
      return
    }
    this.#setPreselection(this.#pick(event))
  }

  #onPointerUp = (event: PointerEvent) => {
    const start = this.#pointerDown
    this.#pointerDown = null
    if (!event.isPrimary || event.button !== 0 || !start) return
    if (this.#interactionMode === "camera-only") return
    const movement = Math.hypot(event.clientX - start.x, event.clientY - start.y)
    if (movement > 3) return
    if (this.#interactionMode === "sketch-reference-select") {
      this.#commitSketchPointSelection(event)
      return
    }
    if (this.#originPlaneSelection) {
      this.#commitOriginPlaneSelection(event)
      return
    }
    this.#setSelection(this.#pick(event))
  }

  #commitSketchPointSelection(event: PointerEvent) {
    const candidate = this.#pickSketchPoint(event)
    if (candidate) this.#onSketchReferenceSelectionChange(candidate)
  }

  #commitOriginPlaneSelection(event: PointerEvent) {
    const modelSelection = this.#pick(event)
    if (modelSelection) {
      this.#setSelection(modelSelection)
      return
    }
    const plane = this.#pickOriginPlane(event)
    if (plane) this.#onOriginPlaneSelectionChange(plane)
  }

  #onPointerLeave = () => {
    this.#pointerDown = null
    if (this.#interactionMode === "camera-only") return
    if (this.#interactionMode === "sketch-reference-select") {
      this.#setSketchPointPreselection(null)
      return
    }
    if (this.#originPlaneSelection) this.#setOriginPlanePreselection(null)
    this.#setPreselection(null)
  }

  #render = () => {
    if (this.#disposed) return
    const width = this.#canvas.clientWidth
    const height = this.#canvas.clientHeight
    if (width <= 0 || height <= 0) return
    this.#renderer.setScissorTest(false)
    this.#renderer.setViewport(0, 0, width, height)
    this.#renderer.render(this.#scene, this.#camera)

    const insetSize = Math.min(
      ORIENTATION_INSET_SIZE,
      width - ORIENTATION_INSET_MARGIN * 2,
      height - ORIENTATION_INSET_MARGIN * 2,
    )
    if (insetSize <= 0) return
    this.#orientationCamera.position
      .copy(this.#camera.position)
      .sub(this.#controls.target)
      .normalize()
      .multiplyScalar(3)
    this.#orientationCamera.up.copy(this.#camera.up)
    this.#orientationCamera.lookAt(0, 0, 0)
    this.#orientationCamera.updateMatrixWorld()
    this.#renderer.setScissorTest(true)
    this.#renderer.setScissor(
      ORIENTATION_INSET_MARGIN,
      ORIENTATION_INSET_MARGIN,
      insetSize,
      insetSize,
    )
    this.#renderer.setViewport(
      ORIENTATION_INSET_MARGIN,
      ORIENTATION_INSET_MARGIN,
      insetSize,
      insetSize,
    )
    this.#renderer.clearDepth()
    this.#renderer.render(this.#orientationScene, this.#orientationCamera)
    this.#renderer.setScissorTest(false)
    this.#renderer.setViewport(0, 0, width, height)
  }
}

export function createGeometryViewport(
  canvas: HTMLCanvasElement,
  options: GeometryViewportOptions = {},
): GeometryViewport {
  return new ThreeGeometryViewport(canvas, options)
}
