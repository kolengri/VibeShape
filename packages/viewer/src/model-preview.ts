import {
  AmbientLight,
  DirectionalLight,
  DoubleSide,
  Mesh,
  MeshStandardMaterial,
  OrthographicCamera,
  Scene,
  Vector3,
  WebGLRenderer,
} from "three"
import {
  createViewerGeometry,
  type ViewerMesh,
  type ViewerStandardView,
  type ViewerVector3,
  viewerCameraPoseForStandardView,
} from "./three-viewport"
import { viewerBodyColor } from "./viewer-appearance"

const DEFAULT_VIEWS = ["isometric", "front", "right", "top"] as const
const STANDARD_VIEWS = new Set<ViewerStandardView>([
  "isometric",
  "front",
  "back",
  "right",
  "left",
  "top",
  "bottom",
])
const OUTPUT_WIDTHS = [1_024, 768, 576, 432, 384] as const
const MAX_PNG_BYTES = 88 * 1_024
const PANEL_PADDING = 12
const PANEL_HEADER_HEIGHT = 52

export type ModelPreviewCamera = Readonly<{
  position: ViewerVector3
  target: ViewerVector3
  up?: ViewerVector3
  viewHeightMm?: number
}>

export type ModelPreviewOptions = Readonly<{
  quality?: "overview" | "detail"
  views?: readonly ViewerStandardView[]
  camera?: ModelPreviewCamera
}>

export type ModelPreviewView = ViewerStandardView | "custom"

export type ModelPreview = Readonly<{
  mimeType: "image/png"
  base64: string
  width: number
  height: number
  views: readonly ModelPreviewView[]
}>

export type ProjectThumbnail = Readonly<{
  mediaType: "image/png"
  bytes: Uint8Array
}>

type PreviewCamera = Readonly<{
  direction: Vector3
  target: Vector3
  up: Vector3
  viewHeight?: number
}>

type PreviewRequest = Readonly<{
  quality: "overview" | "detail"
  meshes: readonly ViewerMesh[]
  corners: readonly Vector3[]
  views: readonly ModelPreviewView[]
  camera?: PreviewCamera
}>

function previewError(message: string) {
  return new Error(`Cannot render model preview: ${message}`)
}

function validatedViews(options: ModelPreviewOptions, quality: PreviewRequest["quality"]) {
  if (options.views !== undefined && !Array.isArray(options.views)) {
    throw previewError("choose one to four unique standard views.")
  }
  const views: ViewerStandardView[] = [
    ...(options.views ?? (quality === "overview" ? ["isometric"] : DEFAULT_VIEWS)),
  ]
  if (
    views.length < 1 ||
    views.length > 4 ||
    new Set(views).size !== views.length ||
    views.some((view) => !STANDARD_VIEWS.has(view))
  ) {
    throw previewError("choose one to four unique standard views.")
  }
  return views
}

function validatedVector(value: ViewerVector3, label: string) {
  if (
    !Array.isArray(value) ||
    value.length !== 3 ||
    Array.from(value).some(
      (coordinate) => !Number.isFinite(coordinate) || Math.abs(coordinate) > 1_000_000,
    )
  ) {
    throw previewError(`camera ${label} must contain three finite coordinates within ±1,000,000.`)
  }
  return new Vector3(...value)
}

function cameraUp(direction: Vector3, input?: ViewerVector3) {
  const up = validatedVector(input ?? [0, 0, 1], "up")
  const upLength = Math.hypot(up.x, up.y, up.z)
  if (upLength === 0) throw previewError("camera up must be nonzero.")
  up.divideScalar(upLength)
  if (Math.abs(up.dot(direction)) >= 1 - 1e-10) {
    if (input !== undefined) throw previewError("camera up must not be parallel to its direction.")
    up.set(0, 1, 0)
  }
  return up
}

function validatedViewHeight(height?: number) {
  if (height === undefined) return undefined
  if (!Number.isFinite(height) || height <= 0 || height > 1_000_000) {
    throw previewError("camera viewHeightMm must be positive and at most 1,000,000 mm.")
  }
  return height
}

function validatedCamera(input: ModelPreviewCamera): PreviewCamera {
  if (!input || typeof input !== "object") throw previewError("the camera must be an object.")
  const position = validatedVector(input.position, "position")
  const target = validatedVector(input.target, "target")
  const direction = position.sub(target)
  const distance = Math.hypot(direction.x, direction.y, direction.z)
  if (distance === 0) throw previewError("camera position and target must differ.")
  direction.divideScalar(distance)
  const up = cameraUp(direction, input.up)
  const height = validatedViewHeight(input.viewHeightMm)
  return { direction, target, up, ...(height === undefined ? {} : { viewHeight: height }) }
}

function hasTriangleBuffers(mesh: ViewerMesh) {
  return [
    mesh.positions instanceof Float32Array,
    mesh.normals instanceof Float32Array,
    mesh.indices instanceof Uint32Array,
    mesh.triangleFaceIds instanceof Uint32Array,
  ].every(Boolean)
}

function hasTriangleBufferLengths(mesh: ViewerMesh) {
  return [
    mesh.positions.length >= 9,
    mesh.positions.length % 3 === 0,
    mesh.normals.length === mesh.positions.length,
    mesh.indices.length >= 3,
    mesh.indices.length % 3 === 0,
    mesh.triangleFaceIds.length === mesh.indices.length / 3,
  ].every(Boolean)
}

function validatedMesh(mesh: ViewerMesh) {
  if (!mesh || typeof mesh.featureId !== "string" || !mesh.featureId || !hasTriangleBuffers(mesh)) {
    throw previewError("a mesh has malformed triangle buffers.")
  }
  if (!hasTriangleBufferLengths(mesh)) throw previewError("a mesh has malformed triangle buffers.")
  if (!mesh.positions.every(Number.isFinite) || !mesh.normals.every(Number.isFinite)) {
    throw previewError("mesh positions and normals must be finite.")
  }
  const vertexCount = mesh.positions.length / 3
  if (mesh.indices.some((index) => index >= vertexCount)) {
    throw previewError("a triangle references a missing vertex.")
  }
  return {
    featureId: mesh.featureId,
    positions: mesh.positions.slice(),
    normals: mesh.normals.slice(),
    indices: mesh.indices.slice(),
    triangleFaceIds: mesh.triangleFaceIds.slice(),
  } satisfies ViewerMesh
}

function hasSurfaceTriangle(mesh: ViewerMesh) {
  const first = new Vector3()
  const second = new Vector3()
  const third = new Vector3()
  for (let index = 0; index < mesh.indices.length; index += 3) {
    first.fromArray(mesh.positions, (mesh.indices[index] ?? 0) * 3)
    second.fromArray(mesh.positions, (mesh.indices[index + 1] ?? 0) * 3).sub(first)
    third.fromArray(mesh.positions, (mesh.indices[index + 2] ?? 0) * 3).sub(first)
    if (second.cross(third).lengthSq() > 0) return true
  }
  return false
}

function meshBounds(meshes: readonly ViewerMesh[]) {
  const min = new Vector3(Infinity, Infinity, Infinity)
  const max = new Vector3(-Infinity, -Infinity, -Infinity)
  const point = new Vector3()
  for (const mesh of meshes) {
    for (const index of mesh.indices) {
      point.fromArray(mesh.positions, index * 3)
      min.min(point)
      max.max(point)
    }
  }
  return { min, max }
}

function normalizeMesh(mesh: ViewerMesh, center: Vector3, scale: number) {
  // Center and normalize copied buffers to preserve distant and very small model framing on the GPU.
  const point = new Vector3()
  for (let index = 0; index < mesh.positions.length; index += 3) {
    point
      .fromArray(mesh.positions, index)
      .sub(center)
      .divideScalar(scale)
      .toArray(mesh.positions, index)
    point.fromArray(mesh.normals, index).normalize().toArray(mesh.normals, index)
  }
  if (!mesh.positions.every(Number.isFinite)) {
    throw previewError("the mesh coordinate range cannot be represented for rendering.")
  }
}

function boundsCorners(min: Vector3, max: Vector3) {
  const corners: Vector3[] = []
  for (const x of [min.x, max.x]) {
    for (const y of [min.y, max.y]) {
      for (const z of [min.z, max.z]) corners.push(new Vector3(x, y, z))
    }
  }
  return corners
}

function normalizeCamera(custom: PreviewCamera, center: Vector3, scale: number): PreviewCamera {
  const target = custom.target.sub(center).divideScalar(scale)
  if (custom.viewHeight === undefined) return { ...custom, target }
  const height = custom.viewHeight / scale
  if (!Number.isFinite(height) || height <= 0) {
    throw previewError("the camera zoom range cannot be represented.")
  }
  return { ...custom, target, viewHeight: height }
}

function validatedQuality(value: ModelPreviewOptions["quality"]) {
  const quality = value === undefined ? "detail" : value
  if (quality !== "overview" && quality !== "detail") {
    throw previewError("quality must be overview or detail.")
  }
  return quality
}

function snapshotRequest(
  meshes: readonly ViewerMesh[],
  options: ModelPreviewOptions,
): PreviewRequest {
  const quality = validatedQuality(options.quality)
  if (options.camera !== undefined && options.views !== undefined) {
    throw previewError("camera and views are mutually exclusive.")
  }
  const custom = options.camera === undefined ? undefined : validatedCamera(options.camera)
  const views: ModelPreviewView[] = custom ? ["custom"] : validatedViews(options, quality)
  if (!meshes.length) throw previewError("the model has no meshes.")
  const snapshots = meshes.map(validatedMesh)
  if (!snapshots.some(hasSurfaceTriangle)) {
    throw previewError("the model has no non-degenerate surface triangles.")
  }
  const { min, max } = meshBounds(snapshots)
  const center = min.clone().add(max).multiplyScalar(0.5)
  const extent = max.clone().sub(min)
  const scale = Math.max(extent.x, extent.y, extent.z)
  for (const mesh of snapshots) normalizeMesh(mesh, center, scale)
  const corners = boundsCorners(
    min.sub(center).divideScalar(scale),
    max.sub(center).divideScalar(scale),
  )
  return {
    quality,
    meshes: snapshots,
    corners,
    views,
    ...(custom ? { camera: normalizeCamera(custom, center, scale) } : {}),
  }
}

function positionCamera(view: ModelPreviewView, custom?: PreviewCamera) {
  const camera = new OrthographicCamera(-1, 1, 1, -1, 0.01, 10)
  if (view === "custom") {
    if (!custom) throw previewError("the custom camera is unavailable.")
    // Orthographic distance does not change XY projection; use a stable distance in normalized space.
    camera.position.copy(custom.target).addScaledVector(custom.direction, 4)
    camera.up.copy(custom.up)
    camera.lookAt(custom.target)
  } else {
    const pose = viewerCameraPoseForStandardView(view, [0, 0, 0], 4)
    if (!pose) throw previewError("the standard view camera is unavailable.")
    camera.position.set(...pose.position)
    camera.up.set(...pose.up)
    camera.lookAt(...pose.target)
  }
  camera.updateMatrixWorld()
  return camera
}

function cameraBounds(camera: OrthographicCamera, corners: readonly Vector3[]) {
  let halfWidth = 0
  let halfHeight = 0
  let near = Infinity
  let far = -Infinity
  for (const corner of corners) {
    const projected = corner.clone().applyMatrix4(camera.matrixWorldInverse)
    halfWidth = Math.max(halfWidth, Math.abs(projected.x))
    halfHeight = Math.max(halfHeight, Math.abs(projected.y))
    near = Math.min(near, -projected.z)
    far = Math.max(far, -projected.z)
  }
  return { halfWidth, halfHeight, near, far }
}

function previewCamera(view: ModelPreviewView, request: PreviewRequest, aspect: number) {
  const camera = positionCamera(view, request.camera)
  const bounds = cameraBounds(camera, request.corners)
  const height =
    request.camera?.viewHeight ??
    Math.max(bounds.halfHeight * 2, (bounds.halfWidth * 2) / aspect, 0.025) * 1.2
  camera.left = (-height * aspect) / 2
  camera.right = (height * aspect) / 2
  camera.top = height / 2
  camera.bottom = -height / 2
  const padding = Math.max((bounds.far - bounds.near) * 0.05, 0.05)
  const retreat = Math.max(0.01 + padding - bounds.near, 0)
  // Retreat along the look axis only; the requested framing and projected XYZ orientation stay fixed.
  camera.position.addScaledVector(new Vector3().setFromMatrixColumn(camera.matrixWorld, 2), retreat)
  camera.updateMatrixWorld()
  camera.near = bounds.near + retreat - padding
  camera.far = bounds.far + retreat + padding
  camera.updateProjectionMatrix()
  if (!camera.projectionMatrix.elements.every(Number.isFinite)) {
    throw previewError("the camera framing range cannot be represented.")
  }
  return camera
}

function drawOrientation(
  context: CanvasRenderingContext2D,
  camera: OrthographicCamera,
  x: number,
  y: number,
) {
  const right = new Vector3().setFromMatrixColumn(camera.matrixWorld, 0)
  const up = new Vector3().setFromMatrixColumn(camera.matrixWorld, 1)
  const towardCamera = new Vector3().setFromMatrixColumn(camera.matrixWorld, 2)
  const axes = [
    { label: "X", direction: new Vector3(1, 0, 0), color: "#c33c4c" },
    { label: "Y", direction: new Vector3(0, 1, 0), color: "#208447" },
    { label: "Z", direction: new Vector3(0, 0, 1), color: "#2667d6" },
  ]
  context.font = "600 11px system-ui, sans-serif"
  context.lineWidth = 1.5
  for (const axis of axes) {
    const dx = axis.direction.dot(right) * 20
    const dy = -axis.direction.dot(up) * 20
    context.strokeStyle = axis.color
    context.fillStyle = axis.color
    if (Math.hypot(dx, dy) < 1) {
      const symbol = axis.direction.dot(towardCamera) > 0 ? "⊙" : "⊗"
      context.fillText(`${axis.label}${symbol}`, x - 8, y + 15)
      continue
    }
    const angle = Math.atan2(dy, dx)
    context.beginPath()
    context.moveTo(x, y)
    context.lineTo(x + dx, y + dy)
    context.moveTo(x + dx - Math.cos(angle - 0.5) * 5, y + dy - Math.sin(angle - 0.5) * 5)
    context.lineTo(x + dx, y + dy)
    context.lineTo(x + dx - Math.cos(angle + 0.5) * 5, y + dy - Math.sin(angle + 0.5) * 5)
    context.stroke()
    context.fillText(axis.label, x + dx * 1.2 - 3, y + dy * 1.2 + 4)
  }
}

function renderPanels(
  renderer: WebGLRenderer,
  scene: Scene,
  output: HTMLCanvasElement,
  context: CanvasRenderingContext2D,
  request: PreviewRequest,
  width: number,
) {
  const columns = request.views.length === 1 ? 1 : 2
  const rows = Math.ceil(request.views.length / columns)
  const cellWidth = width / columns
  const cellHeight = (width * 0.75) / columns
  output.width = width
  output.height = cellHeight * rows
  context.fillStyle = "#e4e9ef"
  context.fillRect(0, 0, output.width, output.height)
  const surfaceWidth = cellWidth - PANEL_PADDING * 2
  const surfaceHeight = cellHeight - PANEL_HEADER_HEIGHT - PANEL_PADDING * 2
  renderer.setSize(surfaceWidth, surfaceHeight, false)
  for (const [index, view] of request.views.entries()) {
    const x = (index % columns) * cellWidth
    const y = Math.floor(index / columns) * cellHeight
    context.fillStyle = "#f3f5f8"
    context.fillRect(x + 1, y + 1, cellWidth - 2, cellHeight - 2)
    context.fillStyle = "#263746"
    context.font = "600 16px system-ui, sans-serif"
    context.fillText(view.charAt(0).toUpperCase() + view.slice(1), x + PANEL_PADDING, y + 28)
    const camera = previewCamera(view, request, surfaceWidth / surfaceHeight)
    renderer.render(scene, camera)
    context.drawImage(
      renderer.domElement,
      x + PANEL_PADDING,
      y + PANEL_HEADER_HEIGHT + PANEL_PADDING,
    )
    drawOrientation(context, camera, x + cellWidth - 38, y + 27)
  }
}

function encodePng(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob?.type !== "image/png") reject(previewError("PNG encoding failed."))
      else resolve(blob)
    }, "image/png")
  })
}

async function pngBase64(blob: Blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  let binary = ""
  for (let index = 0; index < bytes.length; index += 8_192) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 8_192))
  }
  return btoa(binary)
}

type PreviewResources = {
  geometries: ReturnType<typeof createViewerGeometry>[]
  materials: MeshStandardMaterial[]
}

function hasMissingNormals(normals: Float32Array) {
  const normal = new Vector3()
  for (let index = 0; index < normals.length; index += 3) {
    if (normal.fromArray(normals, index).lengthSq() === 0) return true
  }
  return false
}

function populateScene(scene: Scene, meshes: readonly ViewerMesh[], resources: PreviewResources) {
  scene.add(new AmbientLight(0xffffff, 1.6))
  const keyLight = new DirectionalLight(0xffffff, 2.8)
  keyLight.position.set(3, -4, 6)
  scene.add(keyLight)
  const fillLight = new DirectionalLight(0x8eb8df, 1.2)
  fillLight.position.set(-4, 2, 3)
  scene.add(fillLight)
  for (const source of meshes) {
    const geometry = createViewerGeometry(source)
    resources.geometries.push(geometry)
    if (hasMissingNormals(source.normals)) geometry.computeVertexNormals()
    const material = new MeshStandardMaterial({
      color: viewerBodyColor(source.featureId) ?? "#9aaec1",
      roughness: 0.72,
      metalness: 0.04,
      side: DoubleSide,
    })
    resources.materials.push(material)
    const surface = new Mesh(geometry, material)
    surface.frustumCulled = false
    scene.add(surface)
  }
}

async function boundedImage(
  renderer: WebGLRenderer,
  scene: Scene,
  output: HTMLCanvasElement,
  context: CanvasRenderingContext2D,
  request: PreviewRequest,
  assertContext: () => void,
): Promise<ModelPreview> {
  for (const width of OUTPUT_WIDTHS) {
    if (request.quality === "overview" && width > 768) continue
    assertContext()
    renderPanels(renderer, scene, output, context, request, width)
    assertContext()
    const png = await encodePng(output)
    assertContext()
    if (png.size > MAX_PNG_BYTES) continue
    const base64 = await pngBase64(png)
    assertContext()
    return {
      mimeType: "image/png",
      base64,
      width: output.width,
      height: output.height,
      views: request.views,
    }
  }
  throw previewError("the PNG exceeds the 88 KiB image limit at the minimum resolution.")
}

async function withPreviewRenderer<T>(
  request: PreviewRequest,
  render: (
    renderer: WebGLRenderer,
    scene: Scene,
    output: HTMLCanvasElement,
    context: CanvasRenderingContext2D,
    assertContext: () => void,
  ) => Promise<T>,
): Promise<T> {
  if (typeof document === "undefined") throw previewError("a browser with WebGL2 is required.")
  const canvas = document.createElement("canvas")
  const output = document.createElement("canvas")
  const context = output.getContext("2d")
  if (!context) throw previewError("the image canvas is unavailable.")
  const gl = canvas.getContext("webgl2", {
    alpha: false,
    antialias: true,
    preserveDrawingBuffer: true,
  })
  if (!gl) throw previewError("WebGL2 is unavailable.")
  let contextLost = false
  const onContextLost = (event: Event) => {
    event.preventDefault()
    contextLost = true
  }
  canvas.addEventListener("webglcontextlost", onContextLost)
  const assertContext = () => {
    if (contextLost || gl.isContextLost()) throw previewError("the WebGL2 context was lost.")
  }
  let renderer: WebGLRenderer | undefined
  const resources: PreviewResources = { geometries: [], materials: [] }
  const scene = new Scene()
  try {
    renderer = new WebGLRenderer({ canvas, context: gl, alpha: false, antialias: true })
    renderer.setPixelRatio(1)
    renderer.setClearColor("#f3f5f8", 1)
    populateScene(scene, request.meshes, resources)
    return await render(renderer, scene, output, context, assertContext)
  } finally {
    for (const geometry of resources.geometries) geometry.dispose()
    for (const material of resources.materials) material.dispose()
    scene.clear()
    canvas.removeEventListener("webglcontextlost", onContextLost)
    renderer?.dispose()
    if (renderer) renderer.forceContextLoss()
    else gl.getExtension("WEBGL_lose_context")?.loseContext()
    canvas.width = 0
    canvas.height = 0
    output.width = 0
    output.height = 0
  }
}

let previewQueue: Promise<unknown> = Promise.resolve()

function enqueuePreview<T>(render: () => Promise<T>) {
  const result = previewQueue.then(render)
  // A failed render must release the queue for later requests.
  previewQueue = result.catch(() => undefined)
  return result
}

/** Renders all supplied triangles in an isolated, disposable WebGL2 context without a live viewport. */
export async function renderModelPreview(
  meshes: readonly ViewerMesh[],
  options: ModelPreviewOptions = {},
): Promise<ModelPreview> {
  const request = snapshotRequest(meshes, options)
  return enqueuePreview(() =>
    withPreviewRenderer(request, (renderer, scene, output, context, assertContext) =>
      boundedImage(renderer, scene, output, context, request, assertContext),
    ),
  )
}

/** Keeps every surface triangle; image size is bounded by resolution rather than missing geometry. */
export async function renderProjectThumbnail(
  meshes: readonly ViewerMesh[],
  options: Readonly<{ signal?: AbortSignal }> = {},
): Promise<ProjectThumbnail | null> {
  const { signal } = options
  if (meshes.length === 0 || signal?.aborted) return null
  // Cancellable background jobs borrow immutable display snapshots until the queue accepts them.
  // Explicit calls keep their eager snapshot semantics.
  const prepared = signal ? undefined : snapshotRequest(meshes, { views: ["isometric"] })
  return enqueuePreview(async () => {
    if (signal?.aborted) return null
    const request = prepared ?? snapshotRequest(meshes, { views: ["isometric"] })
    return withPreviewRenderer(request, async (renderer, scene, output, context, assertContext) => {
      output.width = 240
      output.height = 160
      renderer.setSize(output.width, output.height, false)
      assertContext()
      renderer.render(scene, previewCamera("isometric", request, output.width / output.height))
      assertContext()
      context.drawImage(renderer.domElement, 0, 0)
      const png = await encodePng(output)
      assertContext()
      if (signal?.aborted) return null
      if (png.size > 128 * 1_024) throw previewError("the project thumbnail exceeds 128 KiB.")
      const bytes = new Uint8Array(await png.arrayBuffer())
      assertContext()
      if (signal?.aborted) return null
      return { mediaType: "image/png", bytes }
    })
  })
}
