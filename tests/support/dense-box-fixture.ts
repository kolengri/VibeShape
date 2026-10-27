type Point = readonly [number, number, number]

/** Increases only surface triangulation; enclosed volume and analysis resolution stay fixed. */
export function denseBoxMesh({
  subdivisions = 42,
  min = [-5, -1, -1],
  max = [5, 1, 1],
  faceLocal = false,
}: {
  subdivisions?: number
  min?: Point
  max?: Point
  faceLocal?: boolean
} = {}) {
  const n = subdivisions
  const faces: readonly [Point, Point, Point][] = [
    [
      [0, 0, 0],
      [0, 0, 1],
      [0, 1, 0],
    ],
    [
      [n, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
    ],
    [
      [0, 0, 0],
      [1, 0, 0],
      [0, 0, 1],
    ],
    [
      [0, n, 0],
      [0, 0, 1],
      [1, 0, 0],
    ],
    [
      [0, 0, 0],
      [0, 1, 0],
      [1, 0, 0],
    ],
    [
      [0, 0, n],
      [1, 0, 0],
      [0, 1, 0],
    ],
  ]
  const vertices: number[] = []
  const indices: number[] = []
  for (const [origin, u, v] of faces) {
    const base = vertices.length / 3
    for (let i = 0; i <= n; i++)
      for (let j = 0; j <= n; j++)
        for (const axis of [0, 1, 2] as const)
          vertices.push(
            min[axis] + ((origin[axis] + u[axis] * i + v[axis] * j) / n) * (max[axis] - min[axis]),
          )
    for (let cell = 0; cell < n * n; cell++) {
      const i = Math.floor(cell / n)
      const j = cell % n
      const a = base + i * (n + 1) + j
      const b = a + n + 1
      indices.push(a, b, a + 1, b, b + 1, a + 1)
    }
  }
  return faceLocal
    ? {
        vertices: indices.flatMap((index) => vertices.slice(index * 3, index * 3 + 3)),
        indices: Array.from({ length: indices.length }, (_, index) => index),
      }
    : { vertices, indices }
}
