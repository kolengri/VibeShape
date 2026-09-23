import type { PrintPreparationMesh } from "@vibeshape/protocol"
import { cross2, EPS, type Point, type Point2 } from "./mesh-geometry"

function at<T>(values: readonly T[], index: number, label: string): T {
  const value = values[index]
  if (value === undefined) throw new Error(`print-analysis.${label}`)
  return value
}

function inTriangle(p: Point2, a: Point2, b: Point2, c: Point2) {
  return cross2(a, b, p) >= -EPS && cross2(b, c, p) >= -EPS && cross2(c, a, p) >= -EPS
}
function triangulate(points: Point2[]) {
  const remaining = points.map((_, i) => i)
  const triangles: [number, number, number][] = []
  while (remaining.length > 3) {
    let clipped = false
    for (let i = 0; i < remaining.length; i++) {
      const a = at(remaining, (i + remaining.length - 1) % remaining.length, "profile-index"),
        b = at(remaining, i, "profile-index"),
        c = at(remaining, (i + 1) % remaining.length, "profile-index")
      if (
        cross2(
          at(points, a, "profile-point"),
          at(points, b, "profile-point"),
          at(points, c, "profile-point"),
        ) <= EPS
      )
        continue
      if (
        remaining.some(
          (p) =>
            p !== a &&
            p !== b &&
            p !== c &&
            inTriangle(
              at(points, p, "profile-point"),
              at(points, a, "profile-point"),
              at(points, b, "profile-point"),
              at(points, c, "profile-point"),
            ),
        )
      )
        continue
      triangles.push([a, b, c])
      remaining.splice(i, 1)
      clipped = true
      break
    }
    if (!clipped) throw new Error("A support profile could not be triangulated without overlap.")
  }
  const a = at(remaining, 0, "profile-index"),
    b = at(remaining, 1, "profile-index"),
    c = at(remaining, 2, "profile-index")
  if (
    cross2(
      at(points, a, "profile-point"),
      at(points, b, "profile-point"),
      at(points, c, "profile-point"),
    ) <= EPS
  )
    throw new Error("Degenerate support profile.")
  triangles.push([a, b, c])
  return triangles
}
export function extrudeProfile(
  name: string,
  input: Point2[],
  u: Point,
  vCenter: number,
  thickness: number,
): PrintPreparationMesh {
  const area = input.reduce((sum, p, i) => {
    const next = at(input, (i + 1) % input.length, "profile-point")
    return sum + p[0] * next[1] - next[0] * p[1]
  }, 0)
  const polygon = area > 0 ? input : [...input].reverse()
  const vertices: number[] = []
  for (const [x, z] of polygon)
    for (const v of [vCenter - thickness / 2, vCenter + thickness / 2])
      vertices.push(u[0] * x - u[1] * v, u[1] * x + u[0] * v, z)
  const triangles: number[] = []
  for (const [a, b, c] of triangulate(polygon))
    triangles.push(2 * a, 2 * b, 2 * c, 2 * a + 1, 2 * c + 1, 2 * b + 1)
  for (let a = 0; a < polygon.length; a++) {
    const b = (a + 1) % polygon.length
    triangles.push(2 * a, 2 * b + 1, 2 * b, 2 * a, 2 * a + 1, 2 * b + 1)
  }
  return { name, vertices, triangles }
}
