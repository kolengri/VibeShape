import { BoxGeometry } from "three"
import { describe, expect, it } from "vitest"
import { parseGeometryImport } from "./import"
import { threeMfModelMeshSchema } from "./three-mf"
import { writeThreeMfMeshes } from "./three-mf-meshes"

type Point = [number, number, number]
type Mesh = { vertices: Point[]; triangles: Point[] }

const cubeTriangles: Point[] = [
  [0, 2, 1],
  [0, 3, 2],
  [4, 5, 6],
  [4, 6, 7],
  [0, 1, 5],
  [0, 5, 4],
  [3, 7, 6],
  [3, 6, 2],
  [0, 4, 7],
  [0, 7, 3],
  [1, 2, 6],
  [1, 6, 5],
]

function box(minimum: Point, maximum: Point, inward = false): Mesh {
  const [x, y, z] = minimum
  const [right, back, top] = maximum
  return {
    vertices: [
      [x, y, z],
      [right, y, z],
      [right, back, z],
      [x, back, z],
      [x, y, top],
      [right, y, top],
      [right, back, top],
      [x, back, top],
    ],
    triangles: cubeTriangles.map(([a, b, c]) => (inward ? [a, c, b] : [a, b, c])),
  }
}

function combine(...shells: Mesh[]): Mesh {
  const mesh: Mesh = { vertices: [], triangles: [] }
  for (const shell of shells) {
    const offset = mesh.vertices.length
    mesh.vertices.push(...shell.vertices)
    mesh.triangles.push(
      ...shell.triangles.map(([a, b, c]): Point => [a + offset, b + offset, c + offset]),
    )
  }
  return mesh
}

function concavePrism(): Mesh {
  const polygon = [
    [0, 0],
    [4, 0],
    [4, 1],
    [1, 1],
    [1, 4],
    [0, 4],
  ] as const
  const base: Point[] = [
    [0, 1, 2],
    [0, 2, 3],
    [0, 3, 5],
    [3, 4, 5],
  ]
  const triangles: Point[] = base.flatMap(([a, b, c]): Point[] => [
    [a, c, b],
    [a + 6, b + 6, c + 6],
  ])
  for (let a = 0; a < 6; a++) {
    const b = (a + 1) % 6
    triangles.push([a, b, b + 6], [a, b + 6, a + 6])
  }
  return { vertices: [0, 4].flatMap((z) => polygon.map(([x, y]): Point => [x, y, z])), triangles }
}

describe("3MF nested material shells", () => {
  it("round trips a generated hollow mesh beyond the generic XML-node budget", async () => {
    const geometry = new BoxGeometry(10, 10, 10, 96, 96, 96)
    try {
      const position = geometry.getAttribute("position")
      const index = geometry.index
      if (!index) throw new Error("Expected indexed box geometry")
      const outer: Mesh = { vertices: [], triangles: [] }
      for (let vertex = 0; vertex < position.count; vertex++) {
        outer.vertices.push([position.getX(vertex), position.getY(vertex), position.getZ(vertex)])
      }
      for (let triangle = 0; triangle < index.count; triangle += 3) {
        outer.triangles.push([
          index.getX(triangle),
          index.getX(triangle + 1),
          index.getX(triangle + 2),
        ])
      }
      const source = combine(outer, box([-1, -1, -1], [1, 1, 1], true))
      const exported = writeThreeMfMeshes({
        title: "Detailed hollow mesh",
        meshes: [{ vertices: source.vertices.flat(), triangles: source.triangles.flat() }],
      })
      const imported = await parseGeometryImport({ format: "3mf", bytes: exported.bytes })
      expect(imported.ok).toBe(true)
      if (!imported.ok || imported.geometry.kind !== "triangle-mesh")
        throw new Error("Expected imported mesh")
      expect(imported.geometry.meshes[0]?.vertices).toHaveLength(55_306)
      expect(imported.geometry.meshes[0]?.triangles).toHaveLength(110_604)
    } finally {
      geometry.dispose()
    }
  }, 10_000)

  it.each([0.01, 1, 100])(
    "exports and imports two enclosed cavities at scale %s without changing winding",
    async (scale) => {
      const source = combine(
        box([0, 0, 0], [10, 10, 10]),
        box([1, 1, 1], [3, 3, 3], true),
        box([6, 6, 6], [9, 9, 9], true),
      )
      const vertices = source.vertices.map(
        ([x, y, z]): Point => [x * scale + 1000, y * scale - 2000, z * scale + 3000],
      )
      const exported = writeThreeMfMeshes({
        title: "Hollow fixture",
        meshes: [{ vertices: vertices.flat(), triangles: source.triangles.flat() }],
      })
      expect(exported.report).toMatchObject({ vertexCount: 24, triangleCount: 36 })
      const imported = await parseGeometryImport({ format: "3mf", bytes: exported.bytes })
      expect(imported.ok).toBe(true)
      if (!imported.ok || imported.geometry.kind !== "triangle-mesh")
        throw new Error("Expected imported mesh")
      expect(imported.geometry.meshes[0]?.vertices).toEqual(vertices)
      expect(imported.geometry.meshes[0]?.triangles).toEqual(source.triangles)
    },
  )

  it("accepts a solid island inside a cavity and a separate outward solid", () => {
    const mesh = combine(
      box([0, 0, 0], [10, 10, 10]),
      box([1, 1, 1], [9, 9, 9], true),
      box([2, 2, 2], [3, 3, 3]),
      box([20, 20, 20], [21, 21, 21]),
    )
    expect(threeMfModelMeshSchema.safeParse(mesh).success).toBe(true)
  })

  it("rejects a negative shell inside the outer bounds but outside the actual concave solid", () => {
    expect(
      threeMfModelMeshSchema.safeParse(combine(concavePrism(), box([2, 2, 1], [3, 3, 2], true)))
        .success,
    ).toBe(false)
  })

  it("rejects a cavity crossing a concave boundary even when all its vertices are inside", () => {
    const polygon = [
      [0.2, 2.5],
      [2.5, 0.2],
      [2.5, 0.4],
      [0.4, 2.5],
    ] as const
    const cavity = box([0, 0, 1], [1, 1, 2], true)
    cavity.vertices = [1, 2].flatMap((z) => polygon.map(([x, y]): Point => [x, y, z]))
    expect(threeMfModelMeshSchema.safeParse(combine(concavePrism(), cavity)).success).toBe(false)
  })

  it.each([
    ["isolated inward shell", box([11, 1, 1], [12, 2, 2], true)],
    ["cavity touching the exterior", box([0, 1, 1], [2, 2, 2], true)],
    ["cavity crossing the exterior", box([-1, 1, 1], [2, 2, 2], true)],
    ["contradictory outward cavity", box([1, 1, 1], [2, 2, 2])],
    ["overlapping outward solid", box([9, 1, 1], [11, 2, 2])],
  ] as const)("rejects %s", (_name, shell) => {
    expect(
      threeMfModelMeshSchema.safeParse(combine(box([0, 0, 0], [10, 10, 10]), shell)).success,
    ).toBe(false)
  })

  it.each([
    ["touching cavities", box([3, 1, 1], [5, 3, 3], true)],
    ["crossing cavities", box([2, 2, 2], [4, 4, 4], true)],
    ["nested inward cavities", box([1.5, 1.5, 1.5], [2.5, 2.5, 2.5], true)],
  ] as const)("rejects %s", (_name, shell) => {
    const mesh = combine(box([0, 0, 0], [10, 10, 10]), box([1, 1, 1], [3, 3, 3], true), shell)
    expect(threeMfModelMeshSchema.safeParse(mesh).success).toBe(false)
  })

  it("rejects a globally reversed hollow solid and a zero-volume closed shell", () => {
    const hollow = combine(box([0, 0, 0], [10, 10, 10]), box([1, 1, 1], [9, 9, 9], true))
    expect(
      threeMfModelMeshSchema.safeParse({
        ...hollow,
        triangles: hollow.triangles.map(([a, b, c]) => [a, c, b]),
      }).success,
    ).toBe(false)
    const flat: Mesh = {
      vertices: [
        [0, 0, 0],
        [1, 0, 0],
        [1, 1, 0],
        [0, 1, 0],
      ],
      triangles: [
        [0, 2, 1],
        [0, 1, 3],
        [0, 3, 2],
        [1, 2, 3],
      ],
    }
    expect(threeMfModelMeshSchema.safeParse(flat).success).toBe(false)
  })
})
