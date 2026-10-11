import { beforeAll, describe, expect, it } from "bun:test"
import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { loadPyodide, type PyodideInterface } from "pyodide"
import { vi } from "../../../tests/unit/support/bun-test"
import {
  type StructuralMesh,
  type StructuralOptimizationInput,
  structuralOptimizationInputSchema,
  structuralSolverResponseSchema,
} from "../src/contract"
import { generateStructuralDesigns } from "../src/generative-design"
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

function stlCoordinatePlanes(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const planes = [new Set<number>(), new Set<number>(), new Set<number>()]
  for (let offset = 84; offset < bytes.length; offset += 50) {
    for (let vertex = 0; vertex < 3; vertex++) {
      for (const [axis, values] of planes.entries())
        values.add(view.getFloat32(offset + 12 + vertex * 12 + axis * 4, true))
    }
  }
  return planes
}

function minimumPlaneSpacing(planes: Set<number>[]) {
  let minimum = Infinity
  for (const values of planes) {
    const sorted = [...values].sort((a, b) => a - b)
    for (let i = 1; i < sorted.length; i++)
      minimum = Math.min(minimum, (sorted[i] ?? NaN) - (sorted[i - 1] ?? NaN))
  }
  return minimum
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
  await runtime.runPythonAsync(
    "from types import SimpleNamespace; _surface_test_solver = SimpleNamespace(**globals())",
  )
  await runtime.runPythonAsync(
    readFileSync(
      resolve(root, "packages/structural-optimization/tests/surface_target_fixtures.py"),
      "utf8",
    ),
  )
  await runtime.runPythonAsync(
    readFileSync(
      resolve(root, "packages/structural-optimization/tests/obstacle_fixtures.py"),
      "utf8",
    ),
  )
  await runtime.runPythonAsync(
    readFileSync(resolve(root, "packages/structural-optimization/tests/fdm_fixtures.py"), "utf8"),
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
  it.each([
    [
      "FDM axes, full cube coverage, thin features, and impossible sizes",
      "verify_fdm_axes_and_cubes",
    ],
    ["FDM conservative footprints and support modes", "verify_fdm_footprints_and_support_modes"],
    [
      "FDM hard constraints influence removal and keep the baseline bed",
      "verify_fdm_constraints_change_removal",
    ],
    ["FDM exact nominal minimum versus float32 shrink", "verify_fdm_float32_bound"],
    ["FDM printed layers cannot skip rounded build-axis slices", "verify_fdm_rounded_slice_height"],
    ["strict finite FDM settings", "verify_invalid_fdm_settings"],
  ])(
    "verifies %s against the browser runtime",
    async (_, verification) => {
      await runtime.runPythonAsync(`${verification}(_surface_test_solver)`)
    },
    timeout,
  )
  it.each([false, true])(
    "runs a real multi-material study with measured candidates and unreachable-baseline failures, FDM=%s",
    async (fdmEnabled) => {
      // Only transport is replaced: every scenario executes the pinned WASM solver
      // and passes through the production structural client's final validation.
      class NumericalWorker {
        onmessage: ((event: MessageEvent<unknown>) => void) | null = null
        onerror: (() => void) | null = null
        onmessageerror: (() => void) | null = null
        stopped = false
        terminate() {
          this.stopped = true
        }
        postMessage(request: { input: StructuralOptimizationInput }) {
          this.onmessage?.({
            data: { type: "progress", stage: "solving" },
          } as MessageEvent<unknown>)
          void run(request.input).then(
            (response) => {
              if (!this.stopped)
                this.onmessage?.({ data: { type: "complete", response } } as MessageEvent<unknown>)
            },
            () => {
              if (!this.stopped) this.onerror?.()
            },
          )
        }
      }
      vi.stubGlobal("Worker", NumericalWorker)
      const analysis = axialBar(4)
      if (fdmEnabled)
        analysis.fdm = {
          buildDirection: "+x",
          supportMode: "allowed",
          minFeatureSizeMm: 1,
          layerHeightMm: 0.2,
          maxOverhangAngleDeg: 45,
        }
      const source = structuredClone(analysis)
      try {
        const output = await generateStructuralDesigns(
          {
            schemaVersion: 1,
            analysis,
            materials: [
              { id: "reference", name: "Reference", material: analysis.material },
              {
                id: "stiffer-light",
                name: "Stiffer and lighter",
                material: { ...analysis.material, youngModulusMpa: 2000, densityKgM3: 500 },
              },
              { id: "weak", name: "Weak", material: { ...analysis.material, yieldStrengthMpa: 1 } },
            ],
            retainedMassFractions: [0.96, 1],
          },
          { runtimeBaseUrl: "http://localhost/structural-runtime/" },
        )
        expect(output.failures).toEqual([
          expect.objectContaining({ code: "infeasible-baseline", materialId: "weak" }),
          expect.objectContaining({ code: "infeasible-baseline", materialId: "weak" }),
        ])
        expect(output.candidates).toHaveLength(4)
        expect(output.failures.map(({ code }) => code)).toEqual([
          "infeasible-baseline",
          "infeasible-baseline",
        ])
        expect(output.candidates.map(({ result }) => result.finalCellCount)).toEqual([
          39, 40, 39, 40,
        ])
        expect(output.candidates.map(({ result }) => result.objective)).toEqual([
          expect.objectContaining({ targetStatus: "reached", targetCellCount: 39 }),
          expect.objectContaining({ targetStatus: "reached", targetCellCount: 40 }),
          expect.objectContaining({ targetStatus: "reached", targetCellCount: 39 }),
          expect.objectContaining({ targetStatus: "reached", targetCellCount: 40 }),
        ])
        expect(output.candidates.slice(0, 2).every(({ pareto }) => !pareto)).toBe(true)
        for (const candidate of output.candidates) {
          if (fdmEnabled) {
            expect(candidate.input.fdm).toEqual(analysis.fdm)
            expect(candidate.result.fdm?.settings).toEqual(analysis.fdm)
            expect(candidate.result.fdm?.optimized.minFeatureSizeBoundMm).toBeGreaterThanOrEqual(1)
          } else expect(candidate.result.fdm).toBeUndefined()
          expect(signedSurfaceVolume(candidate.result.mesh)).toBeCloseTo(
            candidate.result.optimized.volumeMm3,
            8,
          )
          expect(encodeStructuralStl(candidate.result.mesh, 1).byteLength).toBeGreaterThan(84)
        }
        expect(analysis).toEqual(source)
      } finally {
        vi.unstubAllGlobals()
      }
    },
    timeout,
  )
  it(
    "keeps the captured float32 STL outside boxes within the serialization displacement margin",
    async () => {
      const raw: unknown = await runtime.runPythonAsync(
        "json.dumps(serialization_clearance_request())",
      )
      if (typeof raw !== "string") throw new Error("Expected a serialized clearance fixture.")
      const input = structuralOptimizationInputSchema.parse(JSON.parse(raw))
      const response = await run(input)
      if (!response.ok) throw new Error(response.error.message)
      expect(response.result.initialCellCount).toBe(158)
      const bytes = encodeStructuralStl(response.result.mesh, input.cellSizeMm)
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
      const box = input.obstacleRegions?.[0]
      if (!box) throw new Error("Expected a keep-out box.")
      for (let offset = 84; offset < bytes.byteLength; offset += 50) {
        const points = Array.from({ length: 3 }, (_, vertex) =>
          Array.from({ length: 3 }, (_, axis) =>
            view.getFloat32(offset + 12 + vertex * 12 + axis * 4, true),
          ),
        )
        // These axis-aligned voxel triangles must have a separating axis from the box.
        expect(
          box.min.some(
            (minimum, axis) =>
              Math.max(...points.map((point) => point[axis] ?? Number.NaN)) < minimum ||
              Math.min(...points.map((point) => point[axis] ?? Number.NaN)) >
                (box.max[axis] ?? Number.NaN),
          ),
        ).toBe(true)
      }
    },
    timeout,
  )
  it(
    "keeps the actual float32 STL minimum-feature span above the accepted request",
    async () => {
      const raw: unknown = await runtime.runPythonAsync(
        "json.dumps(verify_fdm_float32_bound(_surface_test_solver))",
      )
      if (typeof raw !== "string") throw new Error("Expected a serialized FDM fixture.")
      const input = structuralOptimizationInputSchema.parse(JSON.parse(raw))
      const response = await run(input)
      if (!response.ok) throw new Error(response.error.message)
      const fdm = response.result.fdm
      if (!fdm) throw new Error("Expected measured FDM metadata.")
      const bytes = encodeStructuralStl(response.result.mesh, input.cellSizeMm)
      const minimumSpan = minimumPlaneSpacing(stlCoordinatePlanes(bytes))
      expect(minimumSpan).toBeGreaterThanOrEqual(0.999999)
      expect(minimumSpan).toBeLessThan(1)
      expect(fdm.optimized.minFeatureSizeBoundMm).toBeLessThanOrEqual(minimumSpan)
    },
    timeout,
  )
  it.each([
    ["keep-out baseline and target accounting", "verify_obstacle_baseline_accounting"],
    ["closed face, edge, corner, and exterior obstacle contact", "verify_closed_obstacle_contact"],
    ["keep-out conflicts and original baseline mapping", "verify_obstacle_conflicts_and_mapping"],
    ["keep-out topology and feasibility failures", "verify_obstacle_baseline_failures"],
    ["strict bounded positive keep-out boxes", "verify_invalid_obstacle_boxes"],
  ])(
    "verifies %s against the browser runtime",
    async (_, verification) => {
      await runtime.runPythonAsync(`${verification}(_surface_test_solver)`)
    },
    timeout,
  )
  it.each([
    ["rotated-face membership", "verify_rotated_surface_membership"],
    [
      "curved-face membership and preservation depth",
      "verify_curved_surface_membership_and_preservation",
    ],
    [
      "trimmed-face ties and empty-target diagnostics",
      "verify_trimmed_surface_ties_and_missing_facets",
    ],
    [
      "cube surface boundary retention, force, volume, and determinism",
      "verify_surface_boundary_freeze",
    ],
  ])(
    "verifies %s against the browser runtime",
    async (_, verification) => {
      await runtime.runPythonAsync(`${verification}(_surface_test_solver)`)
    },
    timeout,
  )

  it.each([
    { triangleIndices: [12], depthMm: 1 },
    { triangleIndices: [0, 0], depthMm: 1 },
    { triangleIndices: [-1], depthMm: 1 },
    { triangleIndices: [0.5], depthMm: 1 },
    { triangleIndices: [], depthMm: 1 },
    { triangleIndices: [0], depthMm: 0 },
    { triangleIndices: [0], depthMm: Number.POSITIVE_INFINITY },
  ])(
    "rejects malformed surface input %j at the Python boundary",
    async (region) => {
      const input = axialBar()
      input.supports = [
        { kind: "surface", ...region, triangleIndices: [...region.triangleIndices] },
      ]
      const response = await run(input)
      expect(response.ok).toBe(false)
      if (response.ok) throw new Error("Malformed surface input must not return geometry.")
      expect(response.error.code).toBe("invalid-input")
      expect(response).not.toHaveProperty("result")
    },
    timeout,
  )

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

  it.each([
    [0.96, 39],
    [0.9, 36],
    [1, 40],
  ])(
    "stops stiffness-guided removal at fraction %s with %s conservative cells",
    async (retainedMassFraction, targetCellCount) => {
      const input = axialBar(retainedMassFraction === 1 ? 0 : 4)
      input.objective = { kind: "maximize-stiffness", retainedMassFraction }
      const response = await run(structuralOptimizationInputSchema.parse(input))
      if (!response.ok) throw new Error(response.error.message)
      const result = response.result
      expect(result.initialCellCount).toBe(40)
      expect(result.finalCellCount).toBe(targetCellCount)
      expect(result.termination).toBe("target-mass-reached")
      expect(result.objective).toMatchObject({
        kind: "maximize-stiffness",
        retainedMassFraction,
        targetCellCount,
        targetStatus: "reached",
      })
      if (result.objective?.kind !== "maximize-stiffness")
        throw new Error("The stiffness result requires measured mass-target metadata.")
      expect(result.objective.targetMassKg).toBeCloseTo(0.00004 * retainedMassFraction, 12)
      expect(result.objective.achievedRetainedMassFraction).toBeCloseTo(targetCellCount / 40, 12)
      expect(result.optimized.massKg).toBeGreaterThanOrEqual(result.objective.targetMassKg)
      expect(result.optimized.safetyFactor).toBeGreaterThanOrEqual(2)
      expect(result.optimized.maxDisplacementMm).toBeLessThanOrEqual(1)
      expect(result.optimized.cases[0]?.complianceNmm).toBeGreaterThan(0)
      expect(signedSurfaceVolume(result.mesh)).toBeCloseTo(targetCellCount, 9)
      expect(result.sourceVolumeMm3).toBeCloseTo(40, 9)
      expect(result.sourceVolumeLossFraction).toBe(0)
      expect(() => encodeStructuralStl(result.mesh, result.cellSizeMm)).not.toThrow()
    },
    timeout,
  )

  it.each([
    ["iterations", "iteration-limit"],
    ["preserved", "no-removable-cells"],
    ["constraints", "constraints-or-topology"],
  ])(
    "reports an unreachable stiffness target blocked by %s",
    async (blocker, termination) => {
      const input = axialBar(blocker === "iterations" ? 1 : 4)
      input.objective = { kind: "maximize-stiffness", retainedMassFraction: 0.1 }
      if (blocker === "preserved") input.preserveRegions = [{ min: [-5, -1, -1], max: [5, 1, 1] }]
      if (blocker === "constraints") input.maxDisplacementMm = 0.0250000001
      const response = await run(structuralOptimizationInputSchema.parse(input))
      if (!response.ok) throw new Error(response.error.message)
      const result = response.result
      expect(result.termination).toBe<unknown>(termination)
      expect(result.finalCellCount).toBeGreaterThan(4)
      expect(result.objective).toMatchObject({
        kind: "maximize-stiffness",
        targetCellCount: 4,
        targetStatus: "not-reached",
      })
      expect(result.warnings.some((warning) => warning.includes("target not reached"))).toBe(true)
      expect(result.optimized.safetyFactor).toBeGreaterThanOrEqual(input.safetyFactor)
      expect(result.optimized.maxDisplacementMm).toBeLessThanOrEqual(input.maxDisplacementMm)
      expect(result.optimized.cases[0]?.complianceNmm).toBeGreaterThan(0)
      expect(signedSurfaceVolume(result.mesh)).toBeCloseTo(result.optimized.volumeMm3, 9)
    },
    timeout,
  )

  it(
    "preserves default minimum-mass behavior for an explicit objective",
    async () => {
      const input = axialBar(1)
      const legacy = await run(input)
      input.objective = { kind: "minimize-mass" }
      const explicit = await run(input)
      if (!legacy.ok || !explicit.ok) throw new Error("Both minimum-mass requests must succeed.")
      expect(legacy.result).not.toHaveProperty("objective")
      const { objective, ...result } = explicit.result
      expect(objective).toEqual({ kind: "minimize-mass" })
      expect(result).toEqual(legacy.result)
    },
    timeout,
  )

  it.each([
    null,
    { kind: "minimize-mass", retainedMassFraction: 0.5 },
    { kind: "maximize-stiffness" },
    { kind: "maximize-stiffness", retainedMassFraction: 0.099 },
    { kind: "maximize-stiffness", retainedMassFraction: 1.001 },
    { kind: "maximize-stiffness", retainedMassFraction: Number.POSITIVE_INFINITY },
    { kind: "maximize-stiffness", retainedMassFraction: true },
  ])(
    "rejects invalid objective %j at the WASM Python boundary",
    async (objective) => {
      // Deliberately bypass the TypeScript input schema to exercise Python's trust boundary.
      runtime.globals.set("_structural_request_json", JSON.stringify({ ...axialBar(), objective }))
      const raw: unknown = await runtime.runPythonAsync("solve_json(_structural_request_json)")
      if (typeof raw !== "string") throw new Error("The WASM solver must return a JSON string.")
      const response = structuralSolverResponseSchema.parse(JSON.parse(raw))
      expect(response.ok).toBe(false)
      if (response.ok) throw new Error("Malformed objectives must not return geometry.")
      expect(response.error.code).toBe("invalid-input")
      expect(response).not.toHaveProperty("result")
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
      expect(response.result.optimized.safetyFactor).toBe<unknown>(doubled?.safetyFactor)
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
