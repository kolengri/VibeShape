import {
  type PictureRenderSettings,
  pictureRenderCameraSchema,
} from "@vibeshape/domain/picture-render"
import { Box3, OrthographicCamera, Vector3 } from "three"
import { viewerBodyKey } from "./mesh-geometry"
import type { ModelPreviewCamera } from "./model-preview"
import type { ViewerMesh } from "./three-viewport"

export {
  type PictureRenderSettings,
  pictureFinishes,
  pictureRenderSettingsSchema,
  pictureScenes,
  pictureSizes,
} from "@vibeshape/domain/picture-render"
export const pictureRenderLimits = Object.freeze({
  maxBodies: 128,
  maxTriangles: 200_000,
  maxMeshBytes: 32 * 1024 * 1024,
  maxPngBytes: 12 * 1024 * 1024,
  maxDurationMs: 120_000,
})
export type PictureRenderErrorCode =
  | "invalid-input"
  | "limit"
  | "unavailable"
  | "context-lost"
  | "encoding"
  | "stale"
  | "busy"
  | "timeout"
export class PictureRenderError extends Error {
  constructor(
    public readonly code: PictureRenderErrorCode,
    message: string,
  ) {
    super(message)
    this.name = "PictureRenderError"
  }
}
export type PictureRenderSnapshot = Readonly<{
  meshes: readonly ViewerMesh[]
  bounds: Box3
}>

function validIdentity(value: unknown) {
  return typeof value === "string" && value.length > 0 && value.length <= 128
}
function validMeshIdentity(mesh: ViewerMesh) {
  return (
    validIdentity(mesh.featureId) &&
    (mesh.outputRole === undefined ||
      (typeof mesh.outputRole === "string" && mesh.outputRole.length <= 128))
  )
}
function validTriangleBuffers(mesh: ViewerMesh) {
  return (
    mesh.positions instanceof Float32Array &&
    mesh.normals instanceof Float32Array &&
    mesh.indices instanceof Uint32Array &&
    mesh.triangleFaceIds instanceof Uint32Array
  )
}
function validateMeshHeader(mesh: ViewerMesh) {
  if (!mesh || !validMeshIdentity(mesh) || !validTriangleBuffers(mesh)) {
    throw new PictureRenderError(
      "invalid-input",
      "A body has invalid triangle buffers or identity.",
    )
  }
  if (mesh.appearance && mesh.appearance !== "model") {
    throw new PictureRenderError(
      "invalid-input",
      "Only committed terminal body meshes can be rendered.",
    )
  }
}

function validTriangleCounts(mesh: ViewerMesh) {
  return (
    mesh.positions.length >= 9 &&
    mesh.positions.length % 3 === 0 &&
    mesh.normals.length === mesh.positions.length &&
    mesh.indices.length >= 3 &&
    mesh.indices.length % 3 === 0 &&
    mesh.triangleFaceIds.length === mesh.indices.length / 3
  )
}
function validateTriangleData(mesh: ViewerMesh) {
  if (
    !validTriangleCounts(mesh) ||
    mesh.indices.some((index) => index >= mesh.positions.length / 3) ||
    mesh.positions.some((value) => !Number.isFinite(value) || Math.abs(value) > 1_000_000) ||
    !mesh.normals.every(Number.isFinite)
  ) {
    throw new PictureRenderError(
      "invalid-input",
      "A body has malformed or non-finite triangle data.",
    )
  }
}

function validateAppearance(mesh: ViewerMesh) {
  if (
    (mesh.color && !/^#[\da-f]{6}$/i.test(mesh.color)) ||
    (mesh.material &&
      (!/^#[\da-f]{6}$/i.test(mesh.material.color) ||
        [mesh.material.roughness, mesh.material.metalness, mesh.material.opacity].some(
          (value) => !Number.isFinite(value) || value < 0 || value > 1,
        )))
  ) {
    throw new PictureRenderError("invalid-input", "A body has invalid appearance data.")
  }
}

/** Validates budgets before allocating copies. No live viewport resources cross this boundary. */
export function copyPictureRenderInput(meshes: readonly ViewerMesh[]): PictureRenderSnapshot {
  if (
    !Array.isArray(meshes) ||
    meshes.length < 1 ||
    meshes.length > pictureRenderLimits.maxBodies
  ) {
    throw new PictureRenderError("limit", "Choose between 1 and 128 visible terminal bodies.")
  }
  let bytes = 0
  let triangles = 0
  const keys = new Set<string>()
  for (const mesh of meshes as readonly ViewerMesh[]) {
    validateMeshHeader(mesh)
    const key = viewerBodyKey(mesh)
    if (keys.has(key))
      throw new PictureRenderError("invalid-input", "Body identities must be unique.")
    keys.add(key)
    bytes +=
      mesh.positions.byteLength +
      mesh.normals.byteLength +
      mesh.indices.byteLength +
      mesh.triangleFaceIds.byteLength
    triangles += mesh.indices.length / 3
    if (bytes > pictureRenderLimits.maxMeshBytes || triangles > pictureRenderLimits.maxTriangles) {
      throw new PictureRenderError(
        "limit",
        "Picture exceeds the 200,000 triangle or 32 MiB mesh budget.",
      )
    }
    validateTriangleData(mesh)
    validateAppearance(mesh)
  }
  const bounds = new Box3()
  const point = new Vector3()
  const copies = meshes.map((mesh) => {
    for (let index = 0; index < mesh.positions.length; index += 3)
      bounds.expandByPoint(point.fromArray(mesh.positions, index))
    return {
      featureId: mesh.featureId,
      ...(mesh.outputRole === undefined ? {} : { outputRole: mesh.outputRole }),
      ...(mesh.color ? { color: mesh.color } : {}),
      ...(mesh.material ? { material: { ...mesh.material } } : {}),
      positions: mesh.positions.slice(),
      normals: mesh.normals.slice(),
      indices: mesh.indices.slice(),
      triangleFaceIds: mesh.triangleFaceIds.slice(),
    }
  })
  if (bounds.getSize(point).length() < 1e-8)
    throw new PictureRenderError("invalid-input", "The visible bodies have no extent.")
  return { meshes: copies, bounds }
}

function projectedHalfExtents(
  bounds: Box3,
  center: Vector3,
  scale: number,
  camera: OrthographicCamera,
) {
  let halfWidth = 0
  let halfHeight = 0
  for (const x of [bounds.min.x, bounds.max.x])
    for (const y of [bounds.min.y, bounds.max.y])
      for (const z of [bounds.min.z, bounds.max.z]) {
        const corner = new Vector3(x, y, z)
          .sub(center)
          .multiplyScalar(scale)
          .applyMatrix4(camera.matrixWorldInverse)
        halfWidth = Math.max(halfWidth, Math.abs(corner.x))
        halfHeight = Math.max(halfHeight, Math.abs(corner.y))
      }
  return { halfWidth, halfHeight }
}

/** Frames all projected corners, including tall and wide bodies at non-square aspect ratios. */
export function createPictureCamera(
  bounds: Box3,
  settings: PictureRenderSettings,
  input?: ModelPreviewCamera,
) {
  const center = bounds.getCenter(new Vector3())
  const scale = 1 / bounds.getSize(new Vector3()).length()
  const camera = new OrthographicCamera(-1, 1, 1, -1, 0.01, 100)
  const parsed = input ? pictureRenderCameraSchema.safeParse(input) : null
  if (settings.camera === "current" && !parsed?.success)
    throw new PictureRenderError(
      "invalid-input",
      "The current camera is unavailable or invalid; direction and up must be independent.",
    )
  const pose = settings.camera === "current" && parsed?.success ? parsed.data : null
  const direction = pose
    ? new Vector3(...pose.position).sub(new Vector3(...pose.target))
    : new Vector3(1, -1, 0.8)
  const up = new Vector3(...(pose?.up ?? [0, 0, 1]))
  const target = pose
    ? new Vector3(...pose.target).sub(center).multiplyScalar(scale)
    : new Vector3()
  camera.up.copy(up).normalize()
  camera.position.copy(target).addScaledVector(direction.normalize(), 5)
  camera.lookAt(target)
  camera.updateMatrixWorld(true)
  const { halfWidth, halfHeight } = projectedHalfExtents(bounds, center, scale, camera)
  const aspect = settings.width / settings.height
  const half = pose?.viewHeightMm
    ? (pose.viewHeightMm * scale) / 2
    : Math.max(halfHeight, halfWidth / aspect, 0.01) * 1.15
  camera.left = -half * aspect
  camera.right = half * aspect
  camera.top = half
  camera.bottom = -half
  camera.updateProjectionMatrix()
  return camera
}
