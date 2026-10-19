import type { FeatureId } from "@vibeshape/domain"
import type { ViewerAngularGizmo, ViewerVector3 } from "@vibeshape/viewer/three-viewport"
import type { parsePlacementForm } from "./placement-form-model"

type ParsedPlacement = Extract<ReturnType<typeof parsePlacementForm>, { ok: true }>
export type PlacementManipulationAxis = "translation" | "x" | "y" | "z"
export type PlacementSourceBounds = Readonly<{ min: ViewerVector3; max: ViewerVector3 }>
export type PlacementManipulator = Readonly<{
  translationGizmo?: Readonly<{
    featureId: FeatureId
    position: ViewerVector3
    onPositionChange: (position: ViewerVector3) => void
  }>
  angularGizmo?: ViewerAngularGizmo &
    Readonly<{
      featureId: FeatureId
      onAngleChange: (angle: number) => void
    }>
}>

function rotate(point: ViewerVector3, x: number, y: number, z: number): ViewerVector3 {
  const rxY = Math.cos(x) * point[1] - Math.sin(x) * point[2]
  const rxZ = Math.sin(x) * point[1] + Math.cos(x) * point[2]
  const ryX = Math.cos(y) * point[0] + Math.sin(y) * rxZ
  const ryZ = -Math.sin(y) * point[0] + Math.cos(y) * rxZ
  return [Math.cos(z) * ryX - Math.sin(z) * rxY, Math.sin(z) * ryX + Math.cos(z) * rxY, ryZ]
}

/** UI geometry follows frozen Placement v1: Rz * Ry * Rx about world origin, then translation. */
export function placementManipulatorFrame(parsed: ParsedPlacement, bounds: PlacementSourceBounds) {
  const center: ViewerVector3 = [
    (bounds.min[0] + bounds.max[0]) / 2,
    (bounds.min[1] + bounds.max[1]) / 2,
    (bounds.min[2] + bounds.max[2]) / 2,
  ]
  if (![...bounds.min, ...bounds.max].every(Number.isFinite)) return null
  const { rotation: r, translation: t } = parsed
  const rotatedCenter = rotate(center, r.x.value, r.y.value, r.z.value)
  const translation: ViewerVector3 = [t.x.value, t.y.value, t.z.value]
  const position: ViewerVector3 = [
    rotatedCenter[0] + translation[0],
    rotatedCenter[1] + translation[1],
    rotatedCenter[2] + translation[2],
  ]
  const radius = Math.max(5, Math.hypot(...bounds.max.map((v, i) => v - (bounds.min[i] ?? 0))) / 2)
  return {
    position,
    translationForPosition: (next: ViewerVector3): ViewerVector3 | null => {
      const result: ViewerVector3 = [
        next[0] - rotatedCenter[0],
        next[1] - rotatedCenter[1],
        next[2] - rotatedCenter[2],
      ]
      return result.every((value) => Number.isFinite(value) && Math.abs(value) <= 100_000)
        ? result
        : null
    },
    rotation(axis: Exclude<PlacementManipulationAxis, "translation">): ViewerAngularGizmo {
      // Each Euler field has a different effective world axis and zero-angle radial direction.
      const direction =
        axis === "x"
          ? rotate([1, 0, 0], 0, r.y.value, r.z.value)
          : axis === "y"
            ? rotate([0, 1, 0], 0, 0, r.z.value)
            : ([0, 0, 1] as const)
      const radial =
        axis === "x"
          ? rotate([0, radius, 0], 0, r.y.value, r.z.value)
          : axis === "y"
            ? rotate([radius, 0, 0], 0, 0, r.z.value)
            : ([radius, 0, 0] as const)
      return {
        angle: r[axis].value,
        axisDirection: direction,
        axisOrigin: translation,
        rotationOrigin: [
          translation[0] + radial[0],
          translation[1] + radial[1],
          translation[2] + radial[2],
        ],
        minAngle: -2 * Math.PI,
        maxAngle: 2 * Math.PI,
      }
    },
  }
}
