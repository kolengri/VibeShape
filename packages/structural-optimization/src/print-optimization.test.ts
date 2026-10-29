import { expect, it } from "bun:test"
import { Quaternion, Vector3 } from "three"
import type { StructuralMesh } from "./contract"
import {
  type PrintOptimizationOptions,
  PrintOptimizationSetupError,
  preparePrintOptimization,
} from "./print-optimization"

function box(width = 32, depth = 12, height = 8): StructuralMesh {
  return {
    vertices: [
      0,
      0,
      0,
      width,
      0,
      0,
      width,
      depth,
      0,
      0,
      depth,
      0,
      0,
      0,
      height,
      width,
      0,
      height,
      width,
      depth,
      height,
      0,
      depth,
      height,
    ],
    indices: [
      0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 1, 2, 6, 1, 6, 5, 2, 3, 7, 2, 7, 6, 3,
      0, 4, 3, 4, 7,
    ],
  }
}

function options(mesh = box()): PrintOptimizationOptions {
  return {
    mesh,
    bedTriangleIndices: [0, 1],
    preserveTriangleIndices: [2, 3],
    material: {
      youngModulusMpa: 2000,
      poissonRatio: 0.35,
      yieldStrengthMpa: 40,
      densityKgM3: 1250,
    },
    cellSizeMm: 1,
    minFeatureSizeMm: 1,
    layerHeightMm: 0.2,
    maxIterations: 10,
    minStiffnessFraction: 0.8,
    minStrengthFraction: 0.9,
    supportMode: "allowed",
  }
}

function point(mesh: StructuralMesh, index: number) {
  return new Vector3().fromArray(mesh.vertices, index * 3)
}

function placed(mesh: StructuralMesh, rotation: Quaternion, offset: Vector3): StructuralMesh {
  const vertices: number[] = []
  for (let index = 0; index < mesh.vertices.length / 3; index++)
    vertices.push(...point(mesh, index).applyQuaternion(rotation).add(offset).toArray())
  return { vertices, indices: [...mesh.indices] }
}

it.each([{ bed: [0, 1] }, { bed: [4, 5] }, { bed: [10, 11] }])(
  "restores arbitrary selected print face %j in its original placement",
  ({ bed }) => {
    const rotation = new Quaternion().setFromAxisAngle(new Vector3(1, 2, 3).normalize(), 1.234)
    const source = placed(box(), rotation, new Vector3(1234.5, -2000.25, 99.125))
    const setup = preparePrintOptimization({ ...options(source), bedTriangleIndices: bed })
    const restored = setup.restoreMesh(setup.input.mesh)
    const print = setup.toPrintMesh(source)
    expect(print).toEqual(setup.input.mesh)
    expect(print).not.toBe(setup.input.mesh)
    expect(restored.indices).toEqual(source.indices)
    for (const [index, coordinate] of source.vertices.entries())
      expect(restored.vertices[index]).toBeCloseTo(coordinate, 10)
    const [a, b, c] = setup.input.mesh.indices.slice((bed[0] ?? 0) * 3, (bed[0] ?? 0) * 3 + 3)
    const origin = point(setup.input.mesh, a ?? -1)
    const normal = point(setup.input.mesh, b ?? -1)
      .sub(origin)
      .cross(point(setup.input.mesh, c ?? -1).sub(origin))
      .normalize()
    expect(normal.z).toBeCloseTo(-1, 12)
    expect(origin.z).toBeCloseTo(0, 10)
    expect(
      Math.min(...setup.input.mesh.vertices.filter((_, index) => index % 3 === 2)),
    ).toBeGreaterThan(-1e-9)
  },
)

it("keeps preserved triangle identities and leaves the captured source and settings unchanged", () => {
  const settings = options()
  const original = structuredClone(settings)
  const { input } = preparePrintOptimization(settings)
  expect(settings).toEqual(original)
  expect(input.mesh.indices).toEqual(original.mesh.indices)
  expect(input.preserveRegions).toEqual([{ kind: "surface", triangleIndices: [2, 3], depthMm: 2 }])
  expect(input.relativePerformance).toEqual({ minStiffnessFraction: 0.8, minStrengthFraction: 0.9 })
  expect(input.algorithm).toEqual({
    kind: "simp",
    volumeFraction: 0.1,
    filterRadiusMm: 1.5,
    penalty: 3,
  })
  expect(input.fdm?.buildDirection).toBe("+z")
  expect(input.objective).toEqual({ kind: "minimize-mass" })
  input.mesh.vertices[0] = 123
  input.mesh.indices[0] = 123
  input.material.youngModulusMpa = 123
  settings.preserveTriangleIndices = [4]
  expect(settings.mesh).toEqual(original.mesh)
  expect(settings.material).toEqual(original.material)
  expect(input.preserveRegions).toEqual([{ kind: "surface", triangleIndices: [2, 3], depthMm: 2 }])
})

it("binds restoration to each captured setup and restores new solver vertices without rounding", () => {
  const rotation = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), 0.732)
  const offset = new Vector3(-59.125, 14.75, 27.4)
  const first = preparePrintOptimization(options(placed(box(), rotation, offset)))
  preparePrintOptimization(options(placed(box(), new Quaternion(), new Vector3(500, 600, 700))))
  const originalPoint = new Vector3(10.25, 2.5, 0.125).applyQuaternion(rotation).add(offset)
  // The printed frame for this rotation has the same axes as the unplaced fixture.
  const result = first.restoreMesh({ vertices: [10.25, 2.5, 0.125], indices: [] })
  expect(point(result, 0).distanceTo(originalPoint)).toBeLessThan(1e-12)
  const verification = first.toPrintMesh({ vertices: originalPoint.toArray(), indices: [] })
  expect(point(verification, 0).distanceTo(new Vector3(10.25, 2.5, 0.125))).toBeLessThan(1e-12)
})

it("uses independent structural end slabs and a true zero-resultant torsion load case", () => {
  const { input } = preparePrintOptimization(options())
  expect(input.loadCases).toHaveLength(4)
  expect(input.supports).toEqual([{ min: [0, 0, 0], max: [2, 12, 8] }])
  for (const load of input.loadCases.slice(0, 3)) {
    expect(new Vector3(...load.forceN).length()).toBe(1)
    expect(load.region).toEqual({ min: [30, 0, 0], max: [32, 12, 8] })
    expect(load.additionalLoads).toBeUndefined()
  }
  const torsion = input.loadCases[3]
  if (!torsion) throw new Error("Missing torsion case.")
  const terms = [torsion, ...(torsion.additionalLoads ?? [])]
  expect(terms).toHaveLength(2)
  const resultant = new Vector3()
  const moment = new Vector3()
  for (const { region, forceN } of terms) {
    if ("kind" in region) throw new Error("Expected geometric load patches.")
    const center = new Vector3(...region.min).add(new Vector3(...region.max)).multiplyScalar(0.5)
    const force = new Vector3(...forceN)
    expect(force.length()).toBe(0.5)
    resultant.add(force)
    moment.add(center.cross(force))
  }
  expect(resultant.length()).toBe(0)
  expect(Math.abs(moment.x)).toBeGreaterThan(4)
  expect(moment.y).toBeCloseTo(0)
  expect(moment.z).toBeCloseTo(0)
})

it.each([
  { bedTriangleIndices: [], code: "invalid-bed" },
  { bedTriangleIndices: [0, 99], code: "invalid-bed" },
  { bedTriangleIndices: [0, 0], code: "invalid-bed" },
  { bedTriangleIndices: [0, 4], code: "nonplanar-bed" },
  { preserveTriangleIndices: [12], code: "invalid-settings" },
  { layerHeightMm: 2, code: "invalid-settings" },
  { minStiffnessFraction: 0, code: "invalid-settings" },
  { cellSizeMm: Number.NaN, code: "invalid-settings" },
])("returns a localized-error code for invalid setup %j", ({ code, ...change }) => {
  try {
    preparePrintOptimization({ ...options(), ...change })
    throw new Error("Expected setup rejection.")
  } catch (error) {
    expect(error).toBeInstanceOf(PrintOptimizationSetupError)
    expect((error as PrintOptimizationSetupError).code).toBe(code)
  }
})

it.each([0, 1])("rejects a flat or unresolved %s mm plate before analysis", (height) => {
  expect(() => preparePrintOptimization(options(box(32, 12, height)))).toThrow("too thin")
})

it("rejects interior and inward-facing bed planes instead of flipping them silently", () => {
  const mesh = box()
  mesh.indices[1] = 1
  mesh.indices[2] = 2
  expect(() => preparePrintOptimization({ ...options(mesh), bedTriangleIndices: [0] })).toThrow(
    "internal or crosses",
  )
  const interior = box()
  interior.vertices.push(2, 2, 4, 8, 2, 4, 2, 8, 4)
  interior.indices.push(8, 9, 10)
  expect(() =>
    preparePrintOptimization({ ...options(interior), bedTriangleIndices: [12] }),
  ).toThrow("internal or crosses")
})

it("rejects a tapered far end without separated resolved torsion patches", () => {
  const mesh = box()
  for (const index of [1, 2, 5, 6]) {
    mesh.vertices[index * 3 + 1] = (mesh.vertices[index * 3 + 1] ?? 0) * 0.05 + 5.7
    mesh.vertices[index * 3 + 2] = (mesh.vertices[index * 3 + 2] ?? 0) * 0.05 + 3.8
  }
  // Use the unchanged left face as the bed; the far end is the narrow right face.
  expect(() =>
    preparePrintOptimization({ ...options(mesh), bedTriangleIndices: [10, 11] }),
  ).toThrow("torsion patches")
})
