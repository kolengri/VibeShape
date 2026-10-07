import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { loadPyodide, type PyodideInterface } from "pyodide"
import { beforeAll, describe, expect, it } from "vitest"
import {
  type StructuralMesh,
  type StructuralOptimizationInput,
  structuralOptimizationInputSchema,
  structuralSolverResponseSchema,
} from "../src/contract"
import { encodeStructuralStl } from "../src/mesh"

const timeout = 120_000
const root = fileURLToPath(new URL("../../../", import.meta.url))
let runtime: PyodideInterface

function axialBar(maxIterations = 4): StructuralOptimizationInput {
  return {
    schemaVersion: 1,
    mesh: {
      vertices: [
        -5, -1, -1, -5, -1, 1, -5, 1, -1, -5, 1, 1, 5, -1, -1, 5, -1, 1, 5, 1, -1, 5, 1, 1,
      ],
      indices: [
        0, 1, 3, 0, 3, 2, 4, 6, 7, 4, 7, 5, 0, 4, 5, 0, 5, 1, 2, 3, 7, 2, 7, 6, 0, 2, 6, 0, 6, 4, 1,
        5, 7, 1, 7, 3,
      ],
    },
    material: {
      youngModulusMpa: 1000,
      poissonRatio: 0,
      yieldStrengthMpa: 100,
      densityKgM3: 1000,
    },
    safetyFactor: 2,
    maxDisplacementMm: 1,
    cellSizeMm: 1,
    supports: [{ min: [-5, -1, -1], max: [-5, 1, 1] }],
    loadCases: [
      { name: "axial", region: { min: [5, -1, -1], max: [5, 1, 1] }, forceN: [10, 0, 0] },
    ],
    preserveRegions: [],
    maxIterations,
  }
}

async function run(input: StructuralOptimizationInput) {
  runtime.globals.set("_structural_request_json", JSON.stringify(input))
  const raw: unknown = await runtime.runPythonAsync("solve_json(_structural_request_json)")
  if (typeof raw !== "string") throw new Error("The WASM solver must return a JSON string.")
  return structuralSolverResponseSchema.parse(JSON.parse(raw))
}

function signedSurfaceVolume(mesh: StructuralMesh) {
  const point = (index: number) =>
    [
      mesh.vertices[index * 3] ?? Number.NaN,
      mesh.vertices[index * 3 + 1] ?? Number.NaN,
      mesh.vertices[index * 3 + 2] ?? Number.NaN,
    ] as const
  let volume = 0
  for (let i = 0; i < mesh.indices.length; i += 3) {
    const [ax, ay, az] = point(mesh.indices[i] ?? -1)
    const [bx, by, bz] = point(mesh.indices[i + 1] ?? -1)
    const [cx, cy, cz] = point(mesh.indices[i + 2] ?? -1)
    volume += (ax * (by * cz - bz * cy) + ay * (bz * cx - bx * cz) + az * (bx * cy - by * cx)) / 6
  }
  return volume
}

beforeAll(async () => {
  // Root tests run before build in CI; prepare and verify this same local asset
  // closure rather than depending on a previous build or a Python installation.
  execFileSync("bun", ["run", "scripts/prepare-structural-runtime.ts"], {
    cwd: root,
    timeout,
    stdio: "pipe",
  })
  const runtimeDirectory = resolve(root, ".artifacts/structural-runtime")
  runtime = await loadPyodide({ indexURL: `${runtimeDirectory}/`, packages: ["numpy", "scipy"] })
  await runtime.loadPackage([
    resolve(runtimeDirectory, "scikit_fem-12.0.2-py3-none-any.whl"),
    resolve(runtimeDirectory, "trimesh-4.12.2-py3-none-any.whl"),
  ])
  await runtime.runPythonAsync(
    readFileSync(resolve(root, "packages/structural-optimization/src/solver.py"), "utf8"),
  )
  expect(runtime.version).toBe("314.0.7")
  const versions: unknown = await runtime.runPythonAsync(
    'import json, numpy, scipy, skfem, trimesh; json.dumps({"numpy": numpy.__version__, "scipy": scipy.__version__, "skfem": skfem.__version__, "trimesh": trimesh.__version__})',
  )
  expect(typeof versions).toBe("string")
  expect(JSON.parse(String(versions))).toEqual({
    numpy: "2.4.6",
    scipy: "1.18.0",
    skfem: "12.0.2",
    trimesh: "4.12.2",
  })
}, timeout)

describe("pinned Pyodide full-solid structural solver", () => {
  it(
    "matches independent axial elasticity and mass calculations",
    async () => {
      const input = axialBar(1)
      input.preserveRegions = [{ min: [-5, -1, -1], max: [5, 1, 1] }]
      const response = await run(structuralOptimizationInputSchema.parse(input))
      if (!response.ok) throw new Error(response.error.message)
      // nu=0: uniform end traction and a clamped end admit sigma=F/A,
      // displacement=FL/(EA), and compliance=F*displacement exactly.
      expect(response.result.baseline.volumeMm3).toBeCloseTo(40, 9)
      expect(response.result.baseline.maxVonMisesMpa).toBeCloseTo(2.5, 9)
      expect(response.result.baseline.maxDisplacementMm).toBeCloseTo(0.025, 9)
      expect(response.result.baseline.safetyFactor).toBeCloseTo(40, 9)
      expect(response.result.baseline.massKg).toBeCloseTo(0.00004, 12)
      expect(response.result.baseline.cases[0]?.complianceNmm).toBeCloseTo(0.25, 9)
      expect(response.result.optimized).toEqual(response.result.baseline)
      expect(response.result.evaluations).toBe(2)
    },
    timeout,
  )

  it(
    "returns feasible removed material with the exact analyzed closed surface",
    async () => {
      const input = structuralOptimizationInputSchema.parse(axialBar())
      const before = structuredClone(input)
      const response = await run(input)
      if (!response.ok) throw new Error(response.error.message)
      const result = response.result
      expect(input).toEqual(before)
      expect(result.status).toBe("improved")
      expect(result.finalCellCount).toBeLessThan(result.initialCellCount)
      expect(result.optimized.safetyFactor).toBeGreaterThanOrEqual(input.safetyFactor)
      expect(result.optimized.maxDisplacementMm).toBeLessThanOrEqual(input.maxDisplacementMm)
      expect(result.optimized.volumeMm3).toBe(result.finalCellCount)
      expect(signedSurfaceVolume(result.mesh)).toBeCloseTo(result.optimized.volumeMm3, 9)
      expect(() => encodeStructuralStl(result.mesh, result.cellSizeMm)).not.toThrow()
      expect(result.evaluations).toBeGreaterThan(2)
    },
    timeout,
  )

  it(
    "constrains every load case using its own unaveraged peak stress",
    async () => {
      const input = axialBar(1)
      input.loadCases.push({
        name: "double",
        region: { min: [5, -1, -1], max: [5, 1, 1] },
        forceN: [20, 0, 0],
      })
      const response = await run(structuralOptimizationInputSchema.parse(input))
      if (!response.ok) throw new Error(response.error.message)
      const [axial, doubled] = response.result.optimized.cases
      expect(doubled?.maxVonMisesMpa).toBeCloseTo((axial?.maxVonMisesMpa ?? Number.NaN) * 2, 9)
      expect(doubled?.maxDisplacementMm).toBeCloseTo(
        (axial?.maxDisplacementMm ?? Number.NaN) * 2,
        9,
      )
      expect(response.result.optimized.safetyFactor).toBe(doubled?.safetyFactor)
    },
    timeout,
  )

  it(
    "rejects an infeasible displacement baseline without returning geometry",
    async () => {
      const input = axialBar(1)
      input.maxDisplacementMm = 0.001
      const response = await run(structuralOptimizationInputSchema.parse(input))
      expect(response.ok).toBe(false)
      if (response.ok) throw new Error("An infeasible baseline must not return a mesh.")
      expect(response.error.code).toBe("infeasible-baseline")
      expect(response).not.toHaveProperty("result")
    },
    timeout,
  )

  it(
    "rejects missing supports at the Python trust boundary without returning geometry",
    async () => {
      const input = axialBar(1)
      input.supports = []
      const response = await run(input)
      expect(response.ok).toBe(false)
      if (response.ok) throw new Error("Missing supports must not return a mesh.")
      expect(response.error.code).toBe("no-support-nodes")
      expect(response).not.toHaveProperty("result")
    },
    timeout,
  )
})
