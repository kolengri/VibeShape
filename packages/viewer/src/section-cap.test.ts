import { describe, expect, it } from "bun:test"
import {
  BoxGeometry,
  type BufferGeometry,
  CylinderGeometry,
  ExtrudeGeometry,
  Path,
  Shape,
  TorusGeometry,
} from "three"
import { sectionCapPositions } from "./section-cap"
import type { ViewerMesh } from "./three-viewport"

function source(geometry: BufferGeometry): ViewerMesh {
  const positions = new Float32Array(geometry.getAttribute("position").array)
  const indices = geometry.index
    ? new Uint32Array(geometry.index.array)
    : Uint32Array.from({ length: positions.length / 3 }, (_, index) => index)
  return {
    featureId: "fixture",
    positions,
    indices,
    normals: new Float32Array(positions.length),
    triangleFaceIds: new Uint32Array(indices.length / 3),
  }
}

function area(positions: Float32Array | null) {
  if (!positions) return 0
  let result = 0
  for (let index = 0; index < positions.length; index += 9) {
    const [ax = 0, ay = 0, az = 0, bx = 0, by = 0, bz = 0, cx = 0, cy = 0, cz = 0] =
      positions.slice(index, index + 9)
    result +=
      Math.hypot(
        (by - ay) * (cz - az) - (bz - az) * (cy - ay),
        (bz - az) * (cx - ax) - (bx - ax) * (cz - az),
        (bx - ax) * (cy - ay) - (by - ay) * (cx - ax),
      ) / 2
  }
  return result
}

function combine(...meshes: ViewerMesh[]): ViewerMesh {
  const positions = Float32Array.from(meshes.flatMap((mesh) => [...mesh.positions]))
  const indices: number[] = []
  let offset = 0
  for (const mesh of meshes) {
    indices.push(...mesh.indices.map((index) => index + offset))
    offset += mesh.positions.length / 3
  }
  return {
    featureId: "combined",
    positions,
    indices: new Uint32Array(indices),
    normals: new Float32Array(positions.length),
    triangleFaceIds: new Uint32Array(indices.length / 3),
  }
}

function triangleCoordinateCenter(positions: Float32Array, index: number, coordinate: number) {
  return (
    ((positions[index + coordinate] ?? 0) +
      (positions[index + coordinate + 3] ?? 0) +
      (positions[index + coordinate + 6] ?? 0)) /
    3
  )
}

function triangleCenters(positions: Float32Array | null) {
  const centers: [number, number][] = []
  if (!positions) return centers
  for (let index = 0; index < positions.length; index += 9)
    centers.push([
      triangleCoordinateCenter(positions, index, 0),
      triangleCoordinateCenter(positions, index, 1),
    ])
  return centers
}

describe("disposable closed-mesh section caps", () => {
  it.each(["x", "y", "z"] as const)(
    "fills a solid on %s with the same cap for both halfspaces",
    (axis) => {
      const mesh = source(new BoxGeometry(10, 10, 10))
      const before = [...mesh.positions]
      for (const flipped of [false, true]) {
        const positions = sectionCapPositions(mesh, { axis, offset: 1, flipped })
        expect(area(positions)).toBeCloseTo(100, 5)
        const coordinate = { x: 0, y: 1, z: 2 }[axis]
        expect(
          positions?.filter((_, index) => index % 3 === coordinate).every((value) => value === 1),
        ).toBe(true)
      }
      expect([...mesh.positions]).toEqual(before)
    },
  )

  it("keeps a through hole empty while triangulating its surrounding material", () => {
    const shape = new Shape().moveTo(0, 0).lineTo(10, 0).lineTo(10, 10).lineTo(0, 10).closePath()
    const hole = new Path().moveTo(3, 3).lineTo(3, 7).lineTo(7, 7).lineTo(7, 3).closePath()
    shape.holes.push(hole)
    const mesh = source(new ExtrudeGeometry(shape, { depth: 10, bevelEnabled: false }))
    const positions = sectionCapPositions(mesh, { axis: "z", offset: 5, flipped: false })
    expect(area(positions)).toBeCloseTo(84, 5)
    for (const [x, y] of triangleCenters(positions)) {
      expect(x > 3 && x < 7 && y > 3 && y < 7).toBe(false)
    }
  })

  it("retains disconnected solids and multiple loops of a curved solid", () => {
    const left = source(new BoxGeometry(10, 10, 10).translate(-20, 0, 0))
    const right = source(new BoxGeometry(10, 10, 10).translate(20, 0, 0))
    expect(
      area(sectionCapPositions(combine(left, right), { axis: "z", offset: 0, flipped: false })),
    ).toBeCloseTo(200, 5)
    const torus = source(new TorusGeometry(10, 2, 24, 48))
    expect(area(sectionCapPositions(torus, { axis: "z", offset: 0, flipped: false }))).toBeCloseTo(
      Math.PI * 80,
      -1,
    )
  })

  it("handles cuts through existing mesh edges and cylinder tessellation seams", () => {
    const rotated = source(new BoxGeometry(10, 10, 10).rotateY(Math.PI / 4))
    expect(
      area(sectionCapPositions(rotated, { axis: "z", offset: 0, flipped: false })),
    ).toBeCloseTo(100 * Math.SQRT2, 4)
    const cylinder = source(new CylinderGeometry(5, 5, 10, 64).rotateX(Math.PI / 2))
    expect(
      area(sectionCapPositions(cylinder, { axis: "z", offset: 0, flipped: false })),
    ).toBeCloseTo(78.414, 2)
  })

  it("does not invent a cap at a tangent boundary, outside the model, or for open meshes", () => {
    const mesh = source(new BoxGeometry(10, 10, 10))
    for (const offset of [-20, -5, 5, 20, NaN, Infinity])
      expect(sectionCapPositions(mesh, { axis: "z", offset, flipped: false })).toBeNull()
    expect(
      sectionCapPositions(
        { ...mesh, indices: mesh.indices.slice(3) },
        { axis: "z", offset: 0, flipped: false },
      ),
    ).toBeNull()
    expect(
      sectionCapPositions(
        { ...mesh, indices: new Uint32Array([...mesh.indices, 0, 1, 2]) },
        { axis: "z", offset: 0, flipped: false },
      ),
    ).toBeNull()
    expect(
      sectionCapPositions(
        { ...mesh, positions: new Float32Array([NaN, 0, 0]) },
        { axis: "z", offset: 0, flipped: false },
      ),
    ).toBeNull()
  })

  it.each(["x", "y", "z"] as const)(
    "preserves cap area and tolerance at translated %s bounds",
    (axis) => {
      const mesh = source(new BoxGeometry(10, 10, 10).translate(100_000, 100_000, 100_000))
      const coordinate = { x: 0, y: 1, z: 2 }[axis]
      for (const flipped of [false, true]) {
        for (const offset of [99_995.002, 100_000, 100_004.998]) {
          const cap = sectionCapPositions(mesh, { axis, offset, flipped })
          expect(area(cap)).toBeCloseTo(100, 4)
          expect(cap).not.toBeNull()
          if (!cap) throw new Error("Expected an interior cap.")
          for (let index = coordinate; index < cap.length; index += 3)
            expect(cap[index]).toBe(Math.fround(offset))
        }
        // At this translation the welding tolerance is 0.00100005 mm.
        for (const offset of [
          99_990, 99_994.9995, 99_995, 99_995.0005, 100_004.9995, 100_005, 100_005.0005, 100_010,
        ])
          expect(sectionCapPositions(mesh, { axis, offset, flipped })).toBeNull()
      }
    },
  )

  it("refreshes cached bounds when a body snapshot is replaced", () => {
    const mesh = source(new BoxGeometry(10, 10, 10).translate(100_000, 100_000, 100_000))
    expect(area(sectionCapPositions(mesh, { axis: "x", offset: 100_000, flipped: false }))).toBe(
      100,
    )
    const replacement = source(new BoxGeometry(10, 10, 10))
    expect(replacement.featureId).toBe(mesh.featureId)
    expect(area(sectionCapPositions(replacement, { axis: "x", offset: 0, flipped: false }))).toBe(
      100,
    )
    expect(sectionCapPositions(mesh, { axis: "x", offset: 0, flipped: false })).toBeNull()
  })

  it("rejects a single self-intersecting contour even with a closed manifold edge graph", () => {
    const polygon = [
      [0, 0],
      [6, 5],
      [0, 6],
      [4, 0],
    ]
    const positions = new Float32Array(
      [-1, 1].flatMap((z) => polygon.flatMap(([x = 0, y = 0]) => [x, y, z])),
    )
    const indices = [0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7]
    for (let index = 0; index < 4; index += 1) {
      const next = (index + 1) % 4
      indices.push(index, next, next + 4, index, next + 4, index + 4)
    }
    const mesh: ViewerMesh = {
      featureId: "self-intersection",
      positions,
      indices: new Uint32Array(indices),
      normals: new Float32Array(positions.length),
      triangleFaceIds: new Uint32Array(indices.length / 3),
    }
    expect(sectionCapPositions(mesh, { axis: "z", offset: 0, flipped: false })).toBeNull()
  })

  it("falls back without a fill when contour intersection work exceeds its bounded budget", () => {
    const dense = source(new BoxGeometry(10, 10, 10, 1, 512, 1))
    expect(sectionCapPositions(dense, { axis: "z", offset: 0, flipped: false })).toBeNull()
  })

  it("rejects intersecting contours instead of interpreting overlapping shells as holes", () => {
    const a = source(new BoxGeometry(10, 10, 10))
    const b = source(new BoxGeometry(10, 10, 10).translate(4, 4, 0))
    expect(sectionCapPositions(combine(a, b), { axis: "z", offset: 0, flipped: false })).toBeNull()
  })
})
