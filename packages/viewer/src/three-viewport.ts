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
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  MOUSE,
  OrthographicCamera,
  PerspectiveCamera,
  PlaneGeometry,
  Raycaster,
  Scene,
  Sphere,
  Vector2,
  Vector3,
  WebGLRenderer,
} from "three"
import { OrbitControls } from "three/addons/controls/OrbitControls.js"

const DEFAULT_VIEW_HEIGHT = 100
const FIT_PADDING = 1.35
const MAX_PIXEL_RATIO = 2
const ORIGIN_PLANE_SIZE = 64
const ORIENTATION_INSET_MARGIN = 8
const ORIENTATION_INSET_SIZE = 80

export const viewerOriginPlanes = ["xy", "xz", "yz"] as const
export type ViewerOriginPlane = (typeof viewerOriginPlanes)[number]

export type ViewerMesh = Readonly<{
  appearance?: "model" | "preview"
  featureId: string
  positions: Float32Array
  normals: Float32Array
  indices: Uint32Array
  triangleFaceIds: Uint32Array
}>

export type OrthographicFrustum = Readonly<{
  left: number
  right: number
  top: number
  bottom: number
}>

export type GeometryViewport = Readonly<{
  setMeshes: (meshes: readonly ViewerMesh[]) => void
  setOriginPlaneSelection: (selectedPlane: ViewerOriginPlane | null) => void
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
}>

export function orthographicFrustum(viewHeight: number, aspect: number): OrthographicFrustum {
  const safeHeight =
    Number.isFinite(viewHeight) && viewHeight > 0 ? viewHeight : DEFAULT_VIEW_HEIGHT
  const safeAspect = Number.isFinite(aspect) && aspect > 0 ? aspect : 1
  const halfHeight = safeHeight / 2
  const halfWidth = halfHeight * safeAspect
  return { left: -halfWidth, right: halfWidth, top: halfHeight, bottom: -halfHeight }
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
    if (child instanceof Mesh || child instanceof LineSegments) child.geometry.dispose()
  }
}

function sameSelection(left: ViewerSelection | null, right: ViewerSelection | null) {
  return left?.featureId === right?.featureId && left?.faceId === right?.faceId
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
  readonly #originPlaneGroup = new Group()
  readonly #preselectionGroup = new Group()
  readonly #selectionGroup = new Group()
  readonly #raycaster = new Raycaster()
  readonly #pointer = new Vector2()
  readonly #meshSources = new Map<string, ViewerMesh>()
  readonly #surfaceMeshes: Mesh[] = []
  readonly #originPlaneMeshes = new Map<Mesh, ViewerOriginPlane>()
  readonly #originPlaneMaterials = new Map<ViewerOriginPlane, MeshBasicMaterial>()
  readonly #originPlaneEdgeMaterials: LineBasicMaterial[] = []
  readonly #surfaceMaterial = new MeshStandardMaterial({
    color: new Color("#9aaec1"),
    roughness: 0.72,
    metalness: 0.04,
  })
  readonly #edgeMaterial = new LineBasicMaterial({ color: new Color("#263746") })
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
  readonly #resizeObserver: ResizeObserver
  readonly #onOriginPlanePreselectionChange: (plane: ViewerOriginPlane | null) => void
  readonly #onOriginPlaneSelectionChange: (plane: ViewerOriginPlane) => void
  readonly #onSelectionChange: (selection: ViewerSelection | null) => void
  #viewHeight = DEFAULT_VIEW_HEIGHT
  #disposed = false
  #pointerDown: Readonly<{ x: number; y: number }> | null = null
  #originPlaneSelection: ViewerOriginPlane | null = null
  #originPlanePreselection: ViewerOriginPlane | null = null
  #preselection: ViewerSelection | null = null
  #selection: ViewerSelection | null = null

  constructor(canvas: HTMLCanvasElement, options: GeometryViewportOptions) {
    this.#canvas = canvas
    this.#onOriginPlanePreselectionChange =
      options.onOriginPlanePreselectionChange ?? (() => undefined)
    this.#onOriginPlaneSelectionChange = options.onOriginPlaneSelectionChange ?? (() => undefined)
    this.#onSelectionChange = options.onSelectionChange ?? (() => undefined)
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
    this.#createOriginPlanes()
    this.#scene.add(this.#originPlaneGroup)
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
    this.#controls.mouseButtons.LEFT = MOUSE.ROTATE
    this.#controls.mouseButtons.MIDDLE = MOUSE.ROTATE
    this.#controls.mouseButtons.RIGHT = MOUSE.PAN
    this.#controls.target.set(0, 0, 0)
    this.#controls.addEventListener("change", this.#render)
    this.#controls.update()
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
    this.#surfaceMeshes.length = 0
    this.#meshSources.clear()
    for (const source of meshes) {
      const preview = source.appearance === "preview"
      const geometry = createViewerGeometry(source)
      const surface = new Mesh(
        geometry,
        preview ? this.#previewSurfaceMaterial : this.#surfaceMaterial,
      )
      surface.name = source.featureId
      if (!preview) {
        this.#meshSources.set(source.featureId, source)
        this.#surfaceMeshes.push(surface)
      }
      this.#modelGroup.add(surface)
      const edges = new LineSegments(
        new EdgesGeometry(geometry, 28),
        preview ? this.#previewEdgeMaterial : this.#edgeMaterial,
      )
      edges.name = `${source.featureId}:edges`
      this.#modelGroup.add(edges)
    }
    this.#render()
  }

  setOriginPlaneSelection(selectedPlane: ViewerOriginPlane | null) {
    if (this.#disposed || selectedPlane === this.#originPlaneSelection) return
    this.#originPlaneSelection = selectedPlane
    this.#originPlaneGroup.visible = selectedPlane !== null
    this.#setOriginPlanePreselection(null)
    if (selectedPlane !== null) {
      this.clearSelection()
      this.#setPreselection(null)
    }
    this.#updateOriginPlaneMaterials()
    this.#render()
  }

  fit() {
    if (this.#disposed) return
    const bounds = new Box3().setFromObject(this.#modelGroup)
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
    disposeModelGroup(this.#originPlaneGroup)
    disposeModelGroup(this.#preselectionGroup)
    disposeModelGroup(this.#selectionGroup)
    this.#surfaceMaterial.dispose()
    this.#edgeMaterial.dispose()
    this.#previewSurfaceMaterial.dispose()
    this.#previewEdgeMaterial.dispose()
    this.#preselectionMaterial.dispose()
    this.#selectionMaterial.dispose()
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
    setCameraFrustum(this.#camera, this.#viewHeight, resolvedAspect)
  }

  #pick(event: PointerEvent): ViewerSelection | null {
    const bounds = this.#canvas.getBoundingClientRect()
    if (bounds.width <= 0 || bounds.height <= 0) return null
    this.#pointer.set(
      ((event.clientX - bounds.left) / bounds.width) * 2 - 1,
      -((event.clientY - bounds.top) / bounds.height) * 2 + 1,
    )
    this.#raycaster.setFromCamera(this.#pointer, this.#camera)
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
    const bounds = this.#canvas.getBoundingClientRect()
    if (bounds.width <= 0 || bounds.height <= 0) return null
    this.#pointer.set(
      ((event.clientX - bounds.left) / bounds.width) * 2 - 1,
      -((event.clientY - bounds.top) / bounds.height) * 2 + 1,
    )
    this.#raycaster.setFromCamera(this.#pointer, this.#camera)
    const intersection = this.#raycaster.intersectObjects(
      [...this.#originPlaneMeshes.keys()],
      false,
    )[0]
    return intersection ? (this.#originPlaneMeshes.get(intersection.object as Mesh) ?? null) : null
  }

  #createOriginPlanes() {
    this.#originPlaneGroup.visible = false
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
      this.#originPlaneGroup.add(mesh)

      const edgeMaterial = new LineBasicMaterial({ color: new Color(originPlaneColor(plane)) })
      this.#originPlaneEdgeMaterials.push(edgeMaterial)
      const edges = new LineSegments(new EdgesGeometry(mesh.geometry), edgeMaterial)
      edges.name = `origin-plane:${plane}:edges`
      edges.rotation.copy(mesh.rotation)
      this.#originPlaneGroup.add(edges)
    }
  }

  #setOriginPlanePreselection(plane: ViewerOriginPlane | null) {
    if (plane === this.#originPlanePreselection) return
    this.#originPlanePreselection = plane
    this.#canvas.style.cursor = plane ? "pointer" : ""
    this.#updateOriginPlaneMaterials()
    this.#onOriginPlanePreselectionChange(plane)
    this.#render()
  }

  #updateOriginPlaneMaterials() {
    for (const [plane, material] of this.#originPlaneMaterials) {
      material.opacity =
        plane === this.#originPlanePreselection
          ? 0.42
          : plane === this.#originPlaneSelection
            ? 0.26
            : 0.12
    }
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

  #onPointerDown = (event: PointerEvent) => {
    if (event.isPrimary && event.button === 0) {
      this.#pointerDown = { x: event.clientX, y: event.clientY }
    }
  }

  #onPointerMove = (event: PointerEvent) => {
    if (!event.isPrimary) return
    if (this.#originPlaneSelection) {
      this.#setOriginPlanePreselection(this.#pickOriginPlane(event))
      return
    }
    this.#setPreselection(this.#pick(event))
  }

  #onPointerUp = (event: PointerEvent) => {
    const start = this.#pointerDown
    this.#pointerDown = null
    if (!event.isPrimary || event.button !== 0 || !start) return
    const movement = Math.hypot(event.clientX - start.x, event.clientY - start.y)
    if (movement > 3) return
    if (this.#originPlaneSelection) {
      const plane = this.#pickOriginPlane(event)
      if (plane) this.#onOriginPlaneSelectionChange(plane)
      return
    }
    this.#setSelection(this.#pick(event))
  }

  #onPointerLeave = () => {
    this.#pointerDown = null
    if (this.#originPlaneSelection) this.#setOriginPlanePreselection(null)
    else this.#setPreselection(null)
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
