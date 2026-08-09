import { OrbitControls } from "three/addons/controls/OrbitControls.js"
import {
  AmbientLight,
  Box3,
  BufferAttribute,
  BufferGeometry,
  Color,
  DirectionalLight,
  EdgesGeometry,
  Group,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshStandardMaterial,
  OrthographicCamera,
  Scene,
  Sphere,
  Vector3,
  WebGLRenderer,
} from "three"

const DEFAULT_VIEW_HEIGHT = 100
const FIT_PADDING = 1.35
const MAX_PIXEL_RATIO = 2

export type ViewerMesh = Readonly<{
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
  fit: () => void
  dispose: () => void
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

class ThreeGeometryViewport implements GeometryViewport {
  readonly #canvas: HTMLCanvasElement
  readonly #renderer: WebGLRenderer
  readonly #scene = new Scene()
  readonly #camera = new OrthographicCamera(-50, 50, 50, -50, 0.01, 10_000)
  readonly #controls: OrbitControls
  readonly #modelGroup = new Group()
  readonly #surfaceMaterial = new MeshStandardMaterial({
    color: new Color("#9aaec1"),
    roughness: 0.72,
    metalness: 0.04,
  })
  readonly #edgeMaterial = new LineBasicMaterial({ color: new Color("#263746") })
  readonly #resizeObserver: ResizeObserver
  #viewHeight = DEFAULT_VIEW_HEIGHT
  #disposed = false

  constructor(canvas: HTMLCanvasElement) {
    this.#canvas = canvas
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
    this.#controls.target.set(0, 0, 0)
    this.#controls.addEventListener("change", this.#render)
    this.#controls.update()

    this.#resizeObserver = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (!entry) return
      this.#resize(entry.contentRect.width, entry.contentRect.height)
    })
    this.#resizeObserver.observe(canvas)
  }

  setMeshes(meshes: readonly ViewerMesh[]) {
    if (this.#disposed) return
    disposeModelGroup(this.#modelGroup)
    for (const source of meshes) {
      const geometry = createViewerGeometry(source)
      const surface = new Mesh(geometry, this.#surfaceMaterial)
      surface.name = source.featureId
      this.#modelGroup.add(surface)
      const edges = new LineSegments(new EdgesGeometry(geometry, 28), this.#edgeMaterial)
      edges.name = `${source.featureId}:edges`
      this.#modelGroup.add(edges)
    }
    this.fit()
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

  dispose() {
    if (this.#disposed) return
    this.#disposed = true
    this.#resizeObserver.disconnect()
    this.#controls.removeEventListener("change", this.#render)
    this.#controls.dispose()
    disposeModelGroup(this.#modelGroup)
    this.#surfaceMaterial.dispose()
    this.#edgeMaterial.dispose()
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

  #render = () => {
    if (!this.#disposed) this.#renderer.render(this.#scene, this.#camera)
  }
}

export function createGeometryViewport(canvas: HTMLCanvasElement): GeometryViewport {
  return new ThreeGeometryViewport(canvas)
}
