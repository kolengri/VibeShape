import type { SurfaceTextureMesh, SurfaceTextureMeshLayer } from "@vibeshape/protocol"
import { describe, expect, it } from "vitest"
import {
  encodeSurfaceTextureStl,
  sampleSurfaceTexturePattern,
  textureSurfaceMesh,
} from "./surface-texture"

function boxMesh(size = 10): SurfaceTextureMesh {
  const corners = [
    [0, 0, 0],
    [size, 0, 0],
    [size, size, 0],
    [0, size, 0],
    [0, 0, size],
    [size, 0, size],
    [size, size, size],
    [0, size, size],
  ]
  const faces = [
    [0, 3, 2, 1],
    [4, 5, 6, 7],
    [0, 1, 5, 4],
    [1, 2, 6, 5],
    [2, 3, 7, 6],
    [3, 0, 4, 7],
  ]
  const directions = [
    [0, 0, -1],
    [0, 0, 1],
    [0, -1, 0],
    [1, 0, 0],
    [0, 1, 0],
    [-1, 0, 0],
  ]
  const positions: number[] = []
  const normals: number[] = []
  const indices: number[] = []
  const faceIds: number[] = []
  for (const [index, face] of faces.entries()) {
    for (const corner of face) {
      positions.push(...(corners[corner] ?? []))
      normals.push(...(directions[index] ?? []))
    }
    const start = index * 4
    indices.push(start, start + 1, start + 2, start, start + 2, start + 3)
    faceIds.push(index + 1, index + 1)
  }
  return {
    positions: Float32Array.from(positions),
    normals: Float32Array.from(normals),
    indices: Uint32Array.from(indices),
    triangleFaceIds: Uint32Array.from(faceIds),
  }
}

function layer(overrides: Partial<SurfaceTextureMeshLayer> = {}): SurfaceTextureMeshLayer {
  return {
    id: "texture-test",
    enabled: true,
    targetFaceIds: null,
    mask: { base: "all", strokes: [] },
    map: { kind: "custom", width: 1, height: 1, pixels: [255] },
    mapping: { kind: "triplanar", axis: "z" },
    heightMm: 0.3,
    sizeUMm: 5,
    sizeVMm: 5,
    rotationDeg: 0,
    offsetUMm: 0,
    offsetVMm: 0,
    direction: "outward",
    invert: false,
    boundaryFadeMm: 0,
    blend: "add",
    ...overrides,
  }
}

const quality = { maxEdgeLengthMm: 1, maxTriangles: 50_000 }

function coordinate(mesh: SurfaceTextureMesh, index: number, axis: number) {
  return mesh.positions[index * 3 + axis] ?? 0
}

function maximum(mesh: SurfaceTextureMesh, axis: number) {
  let value = -Infinity
  for (let index = 0; index < mesh.positions.length / 3; index += 1)
    value = Math.max(value, coordinate(mesh, index, axis))
  return value
}

function assertClosed(mesh: SurfaceTextureMesh) {
  const edges = new Map<string, number>()
  for (let triangle = 0; triangle < mesh.indices.length; triangle += 3) {
    const a = mesh.indices[triangle] ?? 0
    const b = mesh.indices[triangle + 1] ?? 0
    const c = mesh.indices[triangle + 2] ?? 0
    for (const [first, second] of [
      [a, b],
      [b, c],
      [c, a],
    ]) {
      const key = [first, second].sort((left, right) => (left ?? 0) - (right ?? 0)).join(":")
      edges.set(key, (edges.get(key) ?? 0) + 1)
    }
  }
  expect([...edges.values()].every((count) => count === 2)).toBe(true)
}

describe("physical surface texture meshes", () => {
  it("refines a coarse CAD cube into deterministic watertight relief without mutating source buffers", async () => {
    const source = boxMesh()
    const original = source.positions.slice()
    const first = await textureSurfaceMesh(
      source,
      [layer({ map: { kind: "builtin", pattern: "ridges" } })],
      quality,
    )
    const second = await textureSurfaceMesh(
      source,
      [layer({ map: { kind: "builtin", pattern: "ridges" } })],
      quality,
    )
    expect(first.statistics.triangleCount).toBeGreaterThan(1_000)
    expect(maximum(first.mesh, 2)).toBeCloseTo(10.3, 4)
    expect(first.mesh).toEqual(second.mesh)
    expect(source.positions).toEqual(original)
    expect([...new Set(first.mesh.triangleFaceIds)].sort()).toEqual([1, 2, 3, 4, 5, 6])
    assertClosed(first.mesh)
  })

  it("protects every unselected face and shared boundary while adding relief inside the selected face", async () => {
    const result = await textureSurfaceMesh(
      boxMesh(),
      [layer({ targetFaceIds: [2], boundaryFadeMm: 2 })],
      quality,
    )
    expect(maximum(result.mesh, 2)).toBeCloseTo(10.3, 4)
    const faceAxis = [2, 2, 1, 0, 1, 0]
    const faceCoordinate = [0, 10, 0, 10, 10, 0]
    for (let triangle = 0; triangle < result.mesh.indices.length / 3; triangle += 1) {
      const face = result.mesh.triangleFaceIds[triangle] ?? 0
      if (face === 2) continue
      for (let corner = 0; corner < 3; corner += 1)
        expect(
          coordinate(
            result.mesh,
            result.mesh.indices[triangle * 3 + corner] ?? 0,
            faceAxis[face - 1] ?? 0,
          ),
        ).toBe(faceCoordinate[face - 1])
    }
    assertClosed(result.mesh)
  })

  it("applies ordered additive and replacement layers with explicit physical directions", async () => {
    const base = layer()
    const inward = layer({ id: "second", direction: "inward", heightMm: 0.1 })
    const additive = await textureSurfaceMesh(boxMesh(), [base, inward], quality)
    const replaced = await textureSurfaceMesh(
      boxMesh(),
      [base, { ...inward, blend: "replace" }],
      quality,
    )
    const centered = await textureSurfaceMesh(
      boxMesh(),
      [layer({ direction: "centered" })],
      quality,
    )
    const inverted = await textureSurfaceMesh(boxMesh(), [layer({ invert: true })], quality)
    expect(maximum(additive.mesh, 2)).toBeCloseTo(10.2, 4)
    expect(maximum(replaced.mesh, 2)).toBe(10)
    expect(maximum(centered.mesh, 2)).toBeCloseTo(10.15, 4)
    expect(maximum(inverted.mesh, 2)).toBe(10)
  })

  it("bakes brush paint and erase in stroke order without painting the opposite side", async () => {
    const paint = {
      center: [5, 5, 10] as [number, number, number],
      normal: [0, 0, 1] as [number, number, number],
      radiusMm: 20,
      hardness: 1,
      mode: "paint" as const,
    }
    const painted = await textureSurfaceMesh(
      boxMesh(),
      [layer({ mask: { base: "empty", strokes: [paint] } })],
      quality,
    )
    expect(maximum(painted.mesh, 2)).toBeCloseTo(10.3, 4)
    for (let triangle = 0; triangle < painted.mesh.indices.length / 3; triangle += 1)
      if (painted.mesh.triangleFaceIds[triangle] === 1)
        for (let corner = 0; corner < 3; corner += 1)
          expect(
            coordinate(painted.mesh, painted.mesh.indices[triangle * 3 + corner] ?? 0, 2),
          ).toBe(0)
    const erased = await textureSurfaceMesh(
      boxMesh(),
      [layer({ mask: { base: "empty", strokes: [paint, { ...paint, mode: "erase" }] } })],
      quality,
    )
    expect(maximum(erased.mesh, 2)).toBe(10)
    assertClosed(painted.mesh)
  })

  it("exports the actual displaced triangles to binary STL", async () => {
    const result = await textureSurfaceMesh(boxMesh(), [layer()], quality)
    const file = encodeSurfaceTextureStl([result.mesh])
    const view = new DataView(file.buffer)
    const count = view.getUint32(80, true)
    expect(count).toBe(result.mesh.indices.length / 3)
    expect(file.length).toBe(84 + count * 50)
    let highest = -Infinity
    for (let triangle = 0; triangle < count; triangle += 1)
      for (let corner = 0; corner < 3; corner += 1)
        highest = Math.max(
          highest,
          view.getFloat32(84 + triangle * 50 + 12 + corner * 12 + 8, true),
        )
    expect(highest).toBeCloseTo(10.3, 4)
  })

  it("rejects missing faces, unreasonable refinement and malformed solid meshes with actionable failures", async () => {
    await expect(
      textureSurfaceMesh(boxMesh(), [layer({ targetFaceIds: [99] })], quality),
    ).rejects.toMatchObject({ code: "surface-texture-invalid-target" })
    await expect(
      textureSurfaceMesh(boxMesh(), [layer()], { maxEdgeLengthMm: 0.02, maxTriangles: 12 }),
    ).rejects.toMatchObject({ code: "surface-texture-resource-limit" })
    const open = boxMesh()
    await expect(
      textureSurfaceMesh(
        { ...open, indices: open.indices.slice(3), triangleFaceIds: open.triangleFaceIds.slice(1) },
        [layer()],
        quality,
      ),
    ).rejects.toMatchObject({ code: "surface-texture-invalid-mesh" })
    const invalid = boxMesh()
    invalid.positions[0] = Number.NaN
    await expect(textureSurfaceMesh(invalid, [layer()], quality)).rejects.toMatchObject({
      code: "surface-texture-invalid-mesh",
    })
    await expect(
      textureSurfaceMesh(boxMesh(), [layer({ direction: "inward", heightMm: 50 })], quality),
    ).rejects.toMatchObject({ code: "surface-texture-invalid-displacement" })
  })

  it("honours cancellation between refinement passes", async () => {
    let cancelled = false
    await expect(
      textureSurfaceMesh(boxMesh(), [layer()], quality, {
        isCancelled: () => cancelled,
        onProgress: () => {
          cancelled = true
        },
      }),
    ).rejects.toMatchObject({ code: "cancelled" })
  })

  it("generates repeatable original tileable grayscale maps", () => {
    for (const pattern of ["noise", "ridges", "dots", "knurling", "hexagons", "wood"] as const) {
      const values = Array.from({ length: 64 }, (_, index) =>
        sampleSurfaceTexturePattern(pattern, index / 63, 0.3),
      )
      expect(Math.min(...values)).toBeGreaterThanOrEqual(0)
      expect(Math.max(...values)).toBeLessThanOrEqual(1)
      expect(new Set(values).size).toBeGreaterThan(3)
      expect(sampleSurfaceTexturePattern(pattern, 0, 0.3)).toBeCloseTo(
        sampleSurfaceTexturePattern(pattern, 1, 0.3),
        10,
      )
    }
  })
})
