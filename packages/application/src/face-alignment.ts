import type { BodyReference } from "@vibeshape/domain/body-reference"

type Vector3 = readonly [number, number, number]
export type FaceAlignmentOrientation = "opposed" | "same"
export type FaceAlignmentFace = Readonly<{
  context: string
  reference: Pick<BodyReference, "featureId" | "outputRole">
  center: Vector3
  normal: Vector3
}>

function dot(a: Vector3, b: Vector3) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}
function finiteUnitVector(vector: Vector3) {
  return vector.every(Number.isFinite) && Math.abs(Math.hypot(...vector) - 1) <= 1e-6
}

function alignmentMatrix(from: Vector3, to: Vector3) {
  const [fromX, fromY, fromZ] = from
  const [toX, toY, toZ] = to
  // The quaternion's vector part is from × to, in the same right-handed world frame.
  let x = fromY * toZ - fromZ * toY
  let y = fromZ * toX - fromX * toZ
  let z = fromX * toY - fromY * toX
  let w = 1 + Math.min(1, Math.max(-1, dot(from, to)))
  if (w < Number.EPSILON) {
    // A half turn has no unique shortest axis. Choose a deterministic perpendicular axis.
    const axis =
      Math.abs(from[0]) > Math.abs(from[2])
        ? ([-from[1], from[0], 0] as const)
        : ([0, -from[2], from[1]] as const)
    ;[x, y, z] = axis
    w = 0
  }
  const magnitude = Math.hypot(x, y, z, w)
  ;[x, y, z, w] = [x / magnitude, y / magnitude, z / magnitude, w / magnitude]
  return [
    [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
    [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
    [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)],
  ] as const
}

/** Frozen world-origin Rx, Ry, Rz then translation, matching Placement schema version 1. */
export function calculateFaceAlignment(
  source: FaceAlignmentFace,
  target: FaceAlignmentFace,
  orientation: FaceAlignmentOrientation,
  offset: number,
): { translation: Vector3; rotation: Vector3 } | null {
  if (
    source.context !== target.context ||
    (source.reference.featureId === target.reference.featureId &&
      source.reference.outputRole === target.reference.outputRole) ||
    !finiteUnitVector(source.normal) ||
    !finiteUnitVector(target.normal) ||
    !source.center.every(Number.isFinite) ||
    !target.center.every(Number.isFinite) ||
    !Number.isFinite(offset)
  )
    return null
  const direction: Vector3 = target.normal.map((v) => (orientation === "opposed" ? -v : v)) as [
    number,
    number,
    number,
  ]
  const matrix = alignmentMatrix(source.normal, direction)
  const horizontal = Math.hypot(matrix[0][0], matrix[1][0])
  const y = Math.atan2(-matrix[2][0], horizontal)
  const locked = horizontal < 1e-12
  const rotation: Vector3 = [
    locked ? 0 : Math.atan2(matrix[2][1], matrix[2][2]),
    y,
    locked ? Math.atan2(-matrix[0][1], matrix[1][1]) : Math.atan2(matrix[1][0], matrix[0][0]),
  ]
  const translation: Vector3 = matrix.map(
    (row, axis) =>
      (target.center[axis] as number) +
      offset * (target.normal[axis] as number) -
      dot(row, source.center),
  ) as [number, number, number]
  return translation.every((value) => Number.isFinite(value) && Math.abs(value) <= 100_000)
    ? { translation, rotation }
    : null
}
