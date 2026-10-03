import type { PrintPreparationMesh } from "@vibeshape/protocol"
import { describe, expect, it } from "vitest"
import { preparePrintMeshes } from "./index"
import { layPrintFacetOnBed } from "./lay-flat"
import type { Point } from "./mesh-geometry"

const tetrahedron: PrintPreparationMesh = {
  name: "Asymmetric tetrahedron",
  vertices: [0, 0, 0, 23, 1, 2, 3, 17, 1, 2, 4, 29],
  triangles: [0, 2, 1, 0, 1, 3, 0, 3, 2, 1, 2, 3],
}
const cuboid: PrintPreparationMesh = {
  name: "Asymmetric cuboid",
  vertices: [0, 0, 0, 27, 0, 0, 27, 15, 0, 0, 15, 0, 0, 0, 43, 27, 0, 43, 27, 15, 43, 0, 15, 43],
  triangles: [
    0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 1, 2, 6, 1, 6, 5, 2, 3, 7, 2, 7, 6, 3, 0,
    4, 3, 4, 7,
  ],
}
const zeroRotation = { rotationX: 0, rotationY: 0, rotationZ: 0 }

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("Incomplete test mesh")
  return value
}

function trianglePoints(mesh: PrintPreparationMesh, index: number): [Point, Point, Point] {
  const point = (offset: number): Point => {
    const i = required(mesh.triangles[index * 3 + offset]) * 3
    return [
      required(mesh.vertices[i]),
      required(mesh.vertices[i + 1]),
      required(mesh.vertices[i + 2]),
    ]
  }
  return [point(0), point(1), point(2)]
}

function facetNormal([a, b, c]: [Point, Point, Point]): Point {
  const u: Point = [b[0] - a[0], b[1] - a[1], b[2] - a[2]]
  const v: Point = [c[0] - a[0], c[1] - a[1], c[2] - a[2]]
  const n: Point = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]]
  const length = Math.hypot(...n)
  return [n[0] / length, n[1] / length, n[2] / length]
}

function cloneMesh(mesh: PrintPreparationMesh): PrintPreparationMesh {
  return { ...mesh, vertices: [...mesh.vertices], triangles: [...mesh.triangles] }
}

describe("lay a selected disposable print facet on the bed", () => {
  it.each([
    zeroRotation,
    { rotationX: 47, rotationY: -31, rotationZ: 73 },
    { rotationX: -112, rotationY: 69, rotationZ: 90 },
    { rotationX: 180, rotationY: -90, rotationZ: -180 },
    { rotationX: -180, rotationY: 180, rotationZ: 180 },
  ])(
    "seats every asymmetric tetrahedron face after arbitrary current XYZ rotation %j",
    (current) => {
      const prepared = required(
        preparePrintMeshes({ meshes: [tetrahedron], settings: { ...current, supports: false } })
          .meshes[0],
      )
      for (let index = 0; index < 4; index++) {
        const rotation = layPrintFacetOnBed(prepared, index, current)
        const seated = required(
          preparePrintMeshes({ meshes: [tetrahedron], settings: { ...rotation, supports: false } })
            .meshes[0],
        )
        const points = trianglePoints(seated, index)
        const normal = facetNormal(points)
        for (const point of points) expect(point[2]).toBeCloseTo(0, 8)
        expect(normal[0]).toBeCloseTo(0, 8)
        expect(normal[1]).toBeCloseTo(0, 8)
        expect(normal[2]).toBeCloseTo(-1, 8)
        expect(rotation.rotationZ).toBe(0)
        expect(rotation.rotationX).toBeGreaterThanOrEqual(-180)
        expect(rotation.rotationX).toBeLessThanOrEqual(180)
        expect(rotation.rotationY).toBeGreaterThanOrEqual(-180)
        expect(rotation.rotationY).toBeLessThanOrEqual(180)
      }
    },
  )

  it.each([0, 2, 4, 6, 8, 10])(
    "seats axis-aligned cuboid facet %s after 90-degree yaw and pitch",
    (index) => {
      const current = { rotationX: 35, rotationY: 90, rotationZ: 90 }
      const prepared = required(
        preparePrintMeshes({ meshes: [cuboid], settings: { ...current, supports: false } })
          .meshes[0],
      )
      const rotation = layPrintFacetOnBed(prepared, index, current)
      const seated = required(
        preparePrintMeshes({ meshes: [cuboid], settings: { ...rotation, supports: false } })
          .meshes[0],
      )
      const points = trianglePoints(seated, index)
      for (const point of points) expect(point[2]).toBeCloseTo(0, 8)
      expect(facetNormal(points)[2]).toBeCloseTo(-1, 8)
    },
  )

  it("returns canonical zero angles for an already downward source facet", () => {
    expect(layPrintFacetOnBed(cuboid, 0, zeroRotation)).toEqual(zeroRotation)
    const current = { rotationX: 61, rotationY: -28, rotationZ: 90 }
    const prepared = required(
      preparePrintMeshes({ meshes: [cuboid], settings: { ...current, supports: false } }).meshes[0],
    )
    const rotation = layPrintFacetOnBed(prepared, 0, current)
    expect(rotation).toEqual(zeroRotation)
    expect(Object.is(rotation.rotationX, -0)).toBe(false)
    expect(Object.is(rotation.rotationY, -0)).toBe(false)
  })

  it("preserves both source and prepared meshes and derives repeatable settings", () => {
    const sourceBefore = cloneMesh(tetrahedron)
    const current = { rotationX: 32, rotationY: 41, rotationZ: -90 }
    const prepared = required(
      preparePrintMeshes({ meshes: [tetrahedron], settings: { ...current, supports: false } })
        .meshes[0],
    )
    const preparedBefore = cloneMesh(prepared)
    const rotation = layPrintFacetOnBed(prepared, 3, current)
    expect(layPrintFacetOnBed(prepared, 3, current)).toEqual(rotation)
    expect(prepared).toEqual(preparedBefore)
    expect(tetrahedron).toEqual(sourceBefore)
  })

  it.each([-1, 0.5, 4, Number.NaN, Infinity, -Infinity])(
    "rejects invalid selected triangle index %s",
    (index) => {
      expect(() => layPrintFacetOnBed(tetrahedron, index, zeroRotation)).toThrow()
    },
  )

  it("rejects repeated and collinear selected vertices", () => {
    const repeated = { ...tetrahedron, triangles: [0, 0, 0, ...tetrahedron.triangles.slice(3)] }
    const collinear = {
      ...tetrahedron,
      vertices: [0, 0, 0, 1, 0, 0, 2, 0, 0, ...tetrahedron.vertices.slice(9)],
    }
    for (const mesh of [repeated, collinear]) {
      expect(() => layPrintFacetOnBed(mesh, 0, zeroRotation)).toThrow(
        "print-analysis.degenerate-facet",
      )
    }
  })

  it.each(["rotationX", "rotationY", "rotationZ"])(
    "rejects non-finite or out-of-range current %s",
    (axis) => {
      for (const value of [Number.NaN, Infinity, -Infinity, -180.001, 180.001]) {
        expect(() =>
          layPrintFacetOnBed(tetrahedron, 0, { ...zeroRotation, [axis]: value }),
        ).toThrow()
      }
    },
  )

  it("requires all current rotation axes rather than applying preparation defaults", () => {
    for (const rotation of [
      {},
      { rotationX: 0 },
      { rotationX: 0, rotationY: 0 },
      { ...zeroRotation, rotationZ: "90" },
    ]) {
      // @ts-expect-error Deliberately exercise an untrusted incomplete or malformed rotation.
      expect(() => layPrintFacetOnBed(tetrahedron, 0, rotation)).toThrow()
    }
  })

  it("validates the current mesh before deriving its selected normal", () => {
    for (const mesh of [
      { ...tetrahedron, vertices: [] },
      { ...tetrahedron, vertices: [Number.NaN, ...tetrahedron.vertices.slice(1)] },
      { ...tetrahedron, vertices: [Infinity, ...tetrahedron.vertices.slice(1)] },
      { ...tetrahedron, triangles: [4, ...tetrahedron.triangles.slice(1)] },
      { ...tetrahedron, triangles: [...tetrahedron.triangles, 0] },
      { ...tetrahedron, unexpected: true },
    ]) {
      expect(() => layPrintFacetOnBed(mesh, 0, zeroRotation)).toThrow()
    }
  })
})
