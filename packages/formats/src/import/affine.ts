import { type ImportedCurve, requireImport } from "./contracts"
import { transformDeterminant } from "./matrix"

export const identityTransform = () => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
export function multiplyTransforms(left: readonly number[], right: readonly number[]) {
  const result = Array<number>(16).fill(0)
  for (let column = 0; column < 4; column++)
    for (let row = 0; row < 4; row++)
      for (let axis = 0; axis < 4; axis++)
        result[column * 4 + row] =
          (result[column * 4 + row] ?? 0) +
          (left[axis * 4 + row] ?? 0) * (right[column * 4 + axis] ?? 0)
  requireImport(
    result.every(Number.isFinite),
    "invalid-geometry",
    "Transform composition is non-finite.",
  )
  return result
}
export function validateTransform(matrix: readonly number[]) {
  const determinant = transformDeterminant(matrix)
  requireImport(
    matrix.length === 16 &&
      matrix.every(Number.isFinite) &&
      Number.isFinite(determinant) &&
      determinant !== 0,
    "invalid-geometry",
    "Import transforms must be finite and nonsingular.",
  )
  return determinant < 0
}
export function transformPoint(
  matrix: readonly number[],
  point: readonly number[],
): [number, number, number] {
  return [0, 1, 2].map(
    (axis) =>
      (matrix[axis] ?? 0) * (point[0] ?? 0) +
      (matrix[axis + 4] ?? 0) * (point[1] ?? 0) +
      (matrix[axis + 8] ?? 0) * (point[2] ?? 0) +
      (matrix[axis + 12] ?? 0),
  ) as [number, number, number]
}
export function validateWorldPoint(point: readonly number[]) {
  requireImport(
    point.every((value) => Number.isFinite(value) && Math.abs(value) <= 100_000),
    "invalid-geometry",
    "World coordinates exceed the finite millimeter bounds.",
  )
}
export function scaledPoint2(x: number, y: number, scale: number): [number, number] {
  return [x * scale, y * scale]
}
export function scaledPoint3(
  x: number,
  y: number,
  z: number,
  scale: number,
): [number, number, number] {
  return [x * scale, y * scale, z * scale]
}
function angleInSweep(angle: number, start: number, sweep: number) {
  const turn = Math.PI * 2
  const delta = sweep > 0 ? angle - start : start - angle
  return ((delta % turn) + turn) % turn <= Math.abs(sweep) + 1e-10
}
function projectedConicAngle(
  matrix: readonly number[],
  axis: number,
  x: readonly [number, number],
  y: readonly [number, number],
) {
  const a = (matrix[axis] ?? 0) * x[0] + (matrix[axis + 4] ?? 0) * x[1]
  const b = (matrix[axis] ?? 0) * y[0] + (matrix[axis + 4] ?? 0) * y[1]
  return Math.atan2(b, a)
}
function conicPoints(
  curve: Extract<ImportedCurve, { center: unknown }>,
  matrix: readonly number[],
) {
  const axes: readonly [readonly [number, number], readonly [number, number]] =
    "radius" in curve
      ? [
          [curve.radius, 0],
          [0, curve.radius],
        ]
      : [curve.xAxis, curve.yAxis]
  const [x, y] = axes
  const start = "startAngle" in curve ? curve.startAngle : 0
  const sweep = "sweep" in curve ? curve.sweep : Math.PI * 2
  const angles = [start, start + sweep]
  for (let axis = 0; axis < 3; axis++) {
    const projected = projectedConicAngle(matrix, axis, x, y)
    for (const angle of [projected, projected + Math.PI])
      if (angleInSweep(angle, start, sweep)) angles.push(angle)
  }
  return angles.map((angle) => [
    curve.center[0] + x[0] * Math.cos(angle) + y[0] * Math.sin(angle),
    curve.center[1] + x[1] * Math.cos(angle) + y[1] * Math.sin(angle),
  ])
}
export function validateWorldCurve(curve: ImportedCurve, matrix: readonly number[]) {
  if ("xAxis" in curve)
    requireImport(
      curve.xAxis[0] * curve.yAxis[1] - curve.xAxis[1] * curve.yAxis[0] !== 0,
      "invalid-geometry",
      "An ellipse requires independent nonzero axes.",
    )
  if (curve.type === "line")
    requireImport(
      curve.start[0] !== curve.end[0] || curve.start[1] !== curve.end[1],
      "invalid-geometry",
      "A line requires distinct endpoints.",
    )
  const points =
    "center" in curve
      ? conicPoints(curve, matrix)
      : [
          curve.start,
          curve.end,
          ...("control" in curve ? [curve.control] : []),
          ...("control1" in curve ? [curve.control1, curve.control2] : []),
        ]
  for (const point of points) validateWorldPoint(transformPoint(matrix, point))
}
