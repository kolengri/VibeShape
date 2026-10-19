import type { ResolvedReferencePlane } from "@vibeshape/application/reference-frame"
import type { FeatureId } from "@vibeshape/domain"
import type { ReferencePlane } from "@vibeshape/domain/reference-frame"
import type {
  ViewerAxialGizmo,
  ViewerToolPlane,
  ViewerVector3,
} from "@vibeshape/viewer/three-viewport"
import type { SplitBounds, SplitPlane } from "./split-form-model"

export type SplitPlaneResolver = (support: ReferencePlane) => ResolvedReferencePlane | null
export type SplitManipulator = Readonly<{
  axialGizmo: ViewerAxialGizmo &
    Readonly<{ featureId: FeatureId; onDistanceChange: (offset: number) => void }>
  toolPlane: ViewerToolPlane
}>

export function splitSupportPlane(
  reference: ReferencePlane | null | undefined,
  plane: SplitPlane,
  resolve?: SplitPlaneResolver,
) {
  if (reference === null) return null
  const support = reference ?? { kind: "origin-plane", plane }
  if (resolve) return resolve(support)
  if (support.kind === "explicit-plane") return { origin: support.origin, normal: support.normal }
  if (support.kind !== "origin-plane") return null
  const normals = { XY: [0, 0, 1], XZ: [0, 1, 0], YZ: [1, 0, 0] } as const
  return { origin: [0, 0, 0] as const, normal: normals[support.plane] }
}

/** The signed offset is measured from the support plane along its oriented unit normal. */
export function splitManipulatorFrame(
  plane: ResolvedReferencePlane,
  bounds: SplitBounds,
  offset: number,
) {
  if (
    ![...plane.origin, ...plane.normal, ...bounds.min, ...bounds.max, offset].every(
      Number.isFinite,
    ) ||
    Math.abs(Math.hypot(...plane.normal) - 1) > 1e-6 ||
    Math.abs(offset) > 100_000
  )
    return null
  const center: ViewerVector3 = [
    (bounds.min[0] + bounds.max[0]) / 2,
    (bounds.min[1] + bounds.max[1]) / 2,
    (bounds.min[2] + bounds.max[2]) / 2,
  ]
  const height = plane.normal.reduce(
    (sum, value, i) => sum + value * ((center[i] ?? 0) - (plane.origin[i] ?? 0)),
    0,
  )
  const origin: ViewerVector3 = [
    center[0] - plane.normal[0] * height,
    center[1] - plane.normal[1] * height,
    center[2] - plane.normal[2] * height,
  ]
  return {
    origin,
    direction: plane.normal,
    distance: offset,
    toolPlane: {
      origin: [
        origin[0] + plane.normal[0] * offset,
        origin[1] + plane.normal[1] * offset,
        origin[2] + plane.normal[2] * offset,
      ] as const,
      normal: plane.normal,
      size: Math.min(
        200_000,
        Math.max(10, Math.hypot(...bounds.max.map((v, i) => v - (bounds.min[i] ?? 0))) * 1.25),
      ),
    },
  }
}
