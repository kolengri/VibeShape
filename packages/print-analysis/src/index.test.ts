import { printPreparationSettingsSchema } from "@vibeshape/protocol"
import { describe, expect, it } from "vitest"
import { preparePrintMeshes } from "./index"

function required<T>(value: T | undefined, label: string): T {
  if (value === undefined) throw new Error(`test fixture missing ${label}`)
  return value
}

const vertices = [
  0, 0, 0, 20, 0, 0, 20, 20, 0, 0, 20, 0, 0, 0, 20, 20, 0, 20, 20, 20, 20, 0, 20, 20,
]
const triangles = [
  0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 1, 2, 6, 1, 6, 5, 2, 3, 7, 2, 7, 6, 3, 0, 4,
  3, 4, 7,
]
const cube = { name: "Cube", vertices, triangles }
function signedVolume(mesh: typeof cube) {
  let volume = 0
  for (let i = 0; i < mesh.triangles.length; i += 3) {
    const indices = mesh.triangles.slice(i, i + 3)
    if (indices.length !== 3) throw new Error("test fixture has incomplete triangle")
    const coordinates = indices.map((index) => mesh.vertices.slice(index * 3, index * 3 + 3))
    if (coordinates.some((point) => point.length !== 3))
      throw new Error("test fixture has incomplete vertex")
    const a = required(coordinates[0], "triangle vertex")
    const b = required(coordinates[1], "triangle vertex")
    const c = required(coordinates[2], "triangle vertex")
    volume +=
      (required(a[0], "x") *
        (required(b[1], "y") * required(c[2], "z") - required(b[2], "z") * required(c[1], "y")) +
        required(a[1], "y") *
          (required(b[2], "z") * required(c[0], "x") - required(b[0], "x") * required(c[2], "z")) +
        required(a[2], "z") *
          (required(b[0], "x") * required(c[1], "y") - required(b[1], "y") * required(c[0], "x"))) /
      6
  }
  return volume
}
function assertClosed(mesh: typeof cube) {
  const edges = new Map<string, number[]>()
  for (let i = 0; i < mesh.triangles.length; i += 3)
    for (let j = 0; j < 3; j++) {
      const a = required(mesh.triangles[i + j], "edge start"),
        b = required(mesh.triangles[i + ((j + 1) % 3)], "edge end")
      const key = a < b ? `${a}:${b}` : `${b}:${a}`
      edges.set(key, [...(edges.get(key) ?? []), a < b ? 1 : -1])
    }
  for (const incidence of edges.values()) {
    expect(incidence).toHaveLength(2)
    expect(
      required(incidence[0], "edge incidence") + required(incidence[1], "edge incidence"),
    ).toBe(0)
  }
  expect(signedVolume(mesh)).toBeGreaterThan(0)
}
describe("bounded print preparation", () => {
  it("seats a print copy and creates manifold positive-volume comb fins without editing inputs", () => {
    const before = { ...cube, vertices: [...vertices], triangles: [...triangles] }
    const result = preparePrintMeshes({ meshes: [cube], settings: {} })
    expect(result.report.finCount).toBe(2)
    expect(result.report.contactCount).toBeGreaterThan(0)
    for (const mesh of result.meshes) assertClosed(mesh)
    expect(signedVolume(required(result.meshes[0], "body mesh"))).toBeCloseTo(8000, 6)
    expect(
      Math.min(...result.meshes.flatMap((m) => m.vertices.filter((_, i) => i % 3 === 2))),
    ).toBeCloseTo(0, 7)
    expect(result.report.warnings).toEqual(["partial-coverage"])
    expect(cube).toEqual(before)
    expect(preparePrintMeshes({ meshes: [cube], settings: {} })).toEqual(result)
  })
  it.each([15, 30, 60, 75])("keeps fins closed at %s degrees", (rotationX) => {
    const result = preparePrintMeshes({ meshes: [cube], settings: { rotationX, spacing: 3 } })
    expect(result.report.finCount).toBeGreaterThan(0)
    for (const mesh of result.meshes.slice(1)) assertClosed(mesh)
  })
  it("puts every horizontal contact boundary on the layer grid", () => {
    const result = preparePrintMeshes({
      meshes: [cube],
      settings: { layerHeight: 0.3, spacing: 2 },
    })
    const fin = required(result.meshes[1], "fin mesh")
    for (const z of fin.vertices.filter((_, i) => i % 3 === 2))
      expect(z / 0.3).toBeCloseTo(Math.round(z / 0.3), 6)
    expect(result.report.contactCount).toBeGreaterThan(1)
  })
  it("accepts face-local duplicate vertices from export tessellation", () => {
    const soup = {
      name: "Soup",
      vertices: triangles.flatMap((i) => vertices.slice(i * 3, i * 3 + 3)),
      triangles: triangles.map((_, i) => i),
    }
    expect(preparePrintMeshes({ meshes: [soup], settings: {} }).report.finCount).toBe(2)
  })
  it("preserves every body when multibody fins are unavailable", () => {
    const result = preparePrintMeshes({
      meshes: [
        cube,
        { ...cube, name: "Other", vertices: vertices.map((v, i) => (i % 3 === 0 ? v + 40 : v)) },
      ],
      settings: {},
    })
    expect(result.report).toMatchObject({
      bodyCount: 2,
      finCount: 0,
      warnings: ["multiple-bodies"],
    })
    expect(result.meshes.map((m) => m.name)).toEqual(["Cube", "Other"])
  })
  it("refuses inverted, open, and concave bodies instead of guessing a contact", () => {
    const inverted = {
      ...cube,
      triangles: triangles.flatMap((_, i) =>
        i % 3 === 0
          ? [
              required(triangles[i], "triangle"),
              required(triangles[i + 2], "triangle"),
              required(triangles[i + 1], "triangle"),
            ]
          : [],
      ),
    }
    const open = { ...cube, triangles: triangles.slice(3) }
    const dented = { ...cube, vertices: vertices.map((v, i) => (i >= 18 && i < 21 ? 10 : v)) }
    for (const mesh of [inverted, open, dented])
      expect(preparePrintMeshes({ meshes: [mesh], settings: {} }).report).toMatchObject({
        finCount: 0,
        warnings: ["nonconvex-or-open"],
      })
  })
  it("does not add fins for a flat cube", () => {
    expect(preparePrintMeshes({ meshes: [cube], settings: { rotationX: 0 } }).report).toMatchObject(
      { finCount: 0, warnings: ["no-suitable-facet"] },
    )
  })
  it("rejects empty, invalid, excessive, and non-finite inputs", () => {
    expect(() => preparePrintMeshes({ meshes: [], settings: {} })).toThrow()
    expect(() =>
      preparePrintMeshes({
        meshes: [{ ...cube, triangles: [99, ...triangles.slice(1)] }],
        settings: {},
      }),
    ).toThrow()
    expect(() => preparePrintMeshes({ meshes: [cube], settings: { spacing: 1e-10 } })).toThrow()
    expect(() =>
      preparePrintMeshes({ meshes: [cube], settings: { rotationX: Infinity } }),
    ).toThrow()
    expect(printPreparationSettingsSchema.safeParse({ unknown: 1 }).success).toBe(false)
  })
})
