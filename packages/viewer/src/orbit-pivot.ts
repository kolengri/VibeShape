import type { Camera, Quaternion, Vector3 } from "three"

/** Keeps a model pivot fixed on screen when controls rotate around the view target. */
export function preserveOrbitPivot(
  camera: Camera,
  target: Vector3,
  pivot: Vector3,
  previousOrientation: Quaternion,
) {
  if (camera.quaternion.equals(previousOrientation)) return
  const rotation = camera.quaternion.clone().multiply(previousOrientation.clone().invert())
  const offset = pivot.clone().sub(target)
  const translation = offset.clone().sub(offset.applyQuaternion(rotation))
  camera.position.add(translation)
  target.add(translation)
  camera.updateMatrixWorld()
}
