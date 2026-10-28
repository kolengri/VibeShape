import { beforeAll, describe, expect, it } from "bun:test"
import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { loadPyodide, type PyodideInterface } from "pyodide"
import { vi } from "../../../tests/unit/support/bun-test"
import { optimizeStructuralModel } from "../src/client"
import {
  type StructuralMesh,
  type StructuralOptimizationInput,
  structuralOptimizationInputSchema,
  structuralOptimizationResultSchema,
  structuralSolverResponseSchema,
} from "../src/contract"
import { generateStructuralDesigns } from "../src/generative-design"
import { encodeStructuralSnapshot, encodeStructuralStl } from "../src/mesh"
import { denseBoxMesh } from "./dense-box-fixture"

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
  await runtime.runPythonAsync(
    readFileSync(
      resolve(root, "packages/structural-optimization/tests/implicit_fixtures.py"),
      "utf8",
    ),
  )
  await runtime.runPythonAsync(
    readFileSync(
      resolve(root, "packages/structural-optimization/tests/resource_fixtures.py"),
      "utf8",
    ),
  )
  await runtime.runPythonAsync(
    readFileSync(
      resolve(root, "packages/structural-optimization/tests/iterative_fixtures.py"),
      "utf8",
    ),
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
    [132.8, 0.8],
    [10_000, 0.01],
  ])(
    "completes decimal-grid analysis and exact snapshot encoding at offset %s and cell size %s",
    async (offset, scale) => {
      const input = axialBar(0)
      const translated = ([x, y, z]: readonly [number, number, number]): [
        number,
        number,
        number,
      ] => [x * scale + offset, y * scale, z * scale]
      input.mesh.vertices = input.mesh.vertices.map(
        (value, axis) => value * scale + (axis % 3 === 0 ? offset : 0),
      )
      input.cellSizeMm = scale
      input.supports = [{ min: translated([-5, -1, -1]), max: translated([-5, 1, 1]) }]
      input.loadCases = [
        {
          name: "axial",
          region: { min: translated([5, -1, -1]), max: translated([5, 1, 1]) },
          forceN: [10 * scale ** 2, 0, 0],
        },
      ]
      const response = await run(input)
      if (!response.ok) throw new Error(`${response.error.code}: ${response.error.message}`)
      expect(response.result.initialCellCount).toBe(40)
      expect(response.result.baseline.maxVonMisesMpa).toBeCloseTo(2.5, 6)
      expect(response.result.baseline.maxDisplacementMm).toBeCloseTo(0.025 * scale, 8)
      expect(response.result.optimized).toEqual(response.result.baseline)
      expect(encodeStructuralSnapshot(response.result.mesh, scale).format).toBe("3mf")
    },
    timeout,
  )

  it.each([
    [0.35, false],
    [0.45, false],
    [0.35, true],
    [0.45, true],
  ])(
    "matches direct-reference 3D bending and torsion at Poisson ratio %s with varied modulus %s",
    async (poisson, varied) => {
      await runtime.runPythonAsync(
        `verify_iterative_direct_reference(_surface_test_solver, ${poisson}, ${varied ? "True" : "False"})`,
      )
    },
    timeout,
  )

  it.each(["iteration-limit", "breakdown", "nonfinite", "false-convergence"])(
    "rejects iterative %s without publishing a numerical result",
    async (failure) => {
      await runtime.runPythonAsync(
        `verify_iterative_failure(_surface_test_solver, ${JSON.stringify(failure)})`,
      )
    },
    timeout,
  )

  it(
    "rejects non-finite and nonpositive assembled stiffness",
    async () => {
      await runtime.runPythonAsync("verify_iterative_invalid_stiffness(_surface_test_solver)")
    },
    timeout,
  )

  it(
    "solves a compact 3D analytical solid without direct sparse factorization",
    async () => {
      const raw = await runtime.runPythonAsync(
        "json.dumps(verify_iterative_compact_analytical_solve(_surface_test_solver))",
      )
      const result = structuralOptimizationResultSchema.parse(JSON.parse(String(raw)))
      expect(result.initialCellCount).toBe(1536)
      expect(signedSurfaceVolume(result.mesh)).toBeCloseTo(1536, 6)
    },
    timeout,
  )

  it(
    "preserves inclusive ray bounds and strict boundary-cell contact",
    async () => {
      await runtime.runPythonAsync("verify_triangle_query_bounds(_surface_test_solver)")
    },
    timeout,
  )

  it(
    "retains the exact reference voxels for curved, rotated and cavity sources",
    async () => {
      const counts = await runtime.runPythonAsync(
        "json.dumps(verify_voxel_filter_equivalence(_surface_test_solver))",
      )
      expect(JSON.parse(String(counts))).toHaveLength(5)
    },
    timeout,
  )

  it(
    "solves more than three thousand cells and five thousand nodes with analytical elasticity",
    async () => {
      const raw = await runtime.runPythonAsync(
        "json.dumps(verify_large_analytical_beam(_surface_test_solver))",
      )
      const result = structuralOptimizationResultSchema.parse(JSON.parse(String(raw)))
      expect(result.initialCellCount).toBe(3012)
      expect(result.finalCellCount).toBe(3012)
      expect(result.baseline.maxVonMisesMpa).toBeCloseTo(10 / 12, 6)
      expect(result.baseline.maxDisplacementMm).toBeCloseTo((10 * 251) / (1000 * 12), 6)
      expect(signedSurfaceVolume(result.mesh)).toBeCloseTo(3012, 6)
    },
    timeout,
  )

  it.each([
    "verify_sparse_candidate_grid",
    "verify_large_filter_and_morphology",
    "verify_many_cavity_shells",
    "verify_many_settings_and_user_iterations",
  ])(
    "executes %s without an automatic resource rejection",
    async (verification) => {
      await runtime.runPythonAsync(`${verification}(_surface_test_solver)`)
    },
    timeout,
  )

  it(
    "accepts dense captured surfaces for SIMP without changing the analytical FEM problem",
    async () => {
      const input = structuralOptimizationInputSchema.parse({
        ...axialBar(1),
        mesh: denseBoxMesh(),
        algorithm: { kind: "simp", volumeFraction: 0.8, filterRadiusMm: 1.5, penalty: 3 },
      })
      expect(input.mesh.vertices.length / 3).toBe(11_094)
      expect(input.mesh.indices.length / 3).toBe(21_168)
      const response = await run(input)
      if (!response.ok) throw new Error(`${response.error.code}: ${response.error.message}`)
      expect(response.result.initialCellCount).toBe(40)
      expect(response.result.baseline.maxVonMisesMpa).toBeCloseTo(2.5, 8)
      expect(response.result.baseline.maxDisplacementMm).toBeCloseTo(0.025, 8)
      expect(response.result.algorithm).toMatchObject({
        kind: "simp",
        settings: input.algorithm,
        densityIterations: 1,
      })
      expect(signedSurfaceVolume(response.result.mesh)).toBeCloseTo(
        response.result.optimized.volumeMm3,
        8,
      )
    },
    timeout,
  )

  it(
    "validates large captured surface selections against the actual Python source triangle count",
    async () => {
      const mesh = denseBoxMesh()
      runtime.globals.set("_dense_source_json", JSON.stringify(mesh))
      const raw = await runtime.runPythonAsync(`
_dense_source, _, _ = _source({"mesh": json.loads(_dense_source_json)}, 1, time.monotonic() + 180)
_dense_region = _region({"kind": "surface", "triangleIndices": list(range(21168)), "depthMm": 1}, len(_dense_source.faces))
try:
    _region({"kind": "surface", "triangleIndices": [21168], "depthMm": 1}, len(_dense_source.faces))
    _dense_rejected = False
except SolverError as error:
    _dense_rejected = error.code == "invalid-input"
json.dumps({"selectionCount": len(_dense_region["triangles"]), "outOfSourceRejected": _dense_rejected})
`)
      expect(JSON.parse(String(raw))).toEqual({
        selectionCount: 21_168,
        outOfSourceRejected: true,
      })
    },
    timeout,
  )

  it(
    "executes penalized SIMP FEM, independent sensitivities, filtering, projection and protected target failure",
    async () => {
      await runtime.runPythonAsync(
        "verify_penalized_fem_and_sensitivity(_surface_test_solver); verify_simp_search(_surface_test_solver)",
      )
      const raw = await runtime.runPythonAsync("json.dumps(implicit_request(_surface_test_solver))")
      const input = structuralOptimizationInputSchema.parse(JSON.parse(String(raw)))
      const response = await run(input)
      expect(response.ok).toBe(true)
      if (!response.ok) return
      expect(response.result.algorithm?.kind).toBe("simp")
      expect(signedSurfaceVolume(response.result.mesh)).toBeCloseTo(
        response.result.optimized.volumeMm3,
        8,
      )
      expect(
        encodeStructuralStl(response.result.mesh, input.cellSizeMm).byteLength,
      ).toBeGreaterThan(84)
    },
    timeout,
  )

  it.each([1, 3])(
    "accepts the actual full-solid lattice fallback through client validation at budget %s",
    async (budget) => {
      const raw = await runtime.runPythonAsync(
        `json.dumps(verify_lattice_baseline_fallback(_surface_test_solver, ${budget})[0])`,
      )
      const input = structuralOptimizationInputSchema.parse(JSON.parse(String(raw)))
      vi.stubGlobal("Worker", NumericalWorker)
      try {
        const output = await optimizeStructuralModel(input, {
          runtimeBaseUrl: "http://localhost/structural-runtime/",
        })
        expect(output.status).toBe("no-improvement")
        expect(output.finalCellCount).toBe(output.initialCellCount)
        expect(output.algorithm?.kind).toBe("adaptive-lattice")
        if (output.algorithm?.kind !== "adaptive-lattice")
          throw new Error("Expected lattice evidence.")
        expect(output.algorithm.thresholdPasses).toBe(output.iterations)
        expect(output.iterations).toBeLessThanOrEqual(budget)
        expect(output.algorithm.projectionEvaluations).toBeLessThanOrEqual(budget)
      } finally {
        vi.unstubAllGlobals()
      }
    },
    timeout,
  )
  it(
    "rejects both directions of cavity intersections and coplanar contacts",
    async () => {
      await runtime.runPythonAsync("verify_shell_intersections(_surface_test_solver)")
    },
    timeout,
  )

  it(
    "accepts disjoint skinny cavities and rejects unresolved shell arithmetic explicitly",
    async () => {
      await runtime.runPythonAsync("verify_skinny_cavity_separation(_surface_test_solver)")
    },
    timeout,
  )

  it.each(["gyroid", "schwarz-p", "schwarz-d"] as const)(
    "verifies FEM-graded %s cells and captured solid volume",
    async (lattice) => {
      await runtime.runPythonAsync(
        `_implicit_pair = verify_lattice_search(_surface_test_solver, ${JSON.stringify(lattice)}, "von-mises", 0)`,
      )
      const raw = await runtime.runPythonAsync("json.dumps(_implicit_pair[1])")
      const response = structuralSolverResponseSchema.parse({
        ok: true,
        result: JSON.parse(String(raw)),
      })
      expect(response.ok).toBe(true)
      if (!response.ok) return
      expect(response.result.algorithm?.kind).toBe("adaptive-lattice")
      expect(response.result.finalCellCount).toBeLessThan(response.result.initialCellCount)
      expect(signedSurfaceVolume(response.result.mesh)).toBeCloseTo(
        response.result.optimized.volumeMm3,
        8,
      )
      expect(
        encodeStructuralStl(response.result.mesh, response.result.cellSizeMm).byteLength,
      ).toBeGreaterThan(84)
    },
    timeout,
  )

  it(
    "rejects underresolution, conflicting targets, invalid geometry and infeasibility for both algorithms",
    async () => {
      await runtime.runPythonAsync(
        "verify_implicit_failures(_surface_test_solver); verify_implicit_constraints(_surface_test_solver, 'simp'); verify_implicit_constraints(_surface_test_solver, 'adaptive-lattice')",
      )
    },
    timeout,
  )

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
    "reports measured displacement and its limit for an infeasible SIMP baseline without geometry",
    async () => {
      const input = axialBar(1)
      input.maxDisplacementMm = 0.001
      input.algorithm = { kind: "simp", volumeFraction: 0.8, filterRadiusMm: 1.5, penalty: 3 }
      const response = await run(structuralOptimizationInputSchema.parse(input))
      expect(response.ok).toBe(false)
      if (response.ok) throw new Error("An infeasible baseline must not return a mesh.")
      expect(response.error.code).toBe("infeasible-baseline")
      const displacement = response.error.message.match(
        /load case 1 "axial": maximum displacement ([\d.e+-]+) mm exceeds limit ([\d.e+-]+) mm/,
      )
      expect(displacement).not.toBeNull()
      expect(Number(displacement?.[1])).toBeCloseTo(0.025, 8)
      expect(Number(displacement?.[2])).toBe(0.001)
      expect(response.error.message).not.toContain("von Mises stress")
      expect(response).not.toHaveProperty("result")
    },
    timeout,
  )

  it.each([
    ["named", "axial", "bending"],
    ["escaped", "\u0000".repeat(80), "\u0001".repeat(80)],
    ["unicode", "😀".repeat(40), "🚀".repeat(40)],
  ])(
    "reports separate controlling cases and physical limits within the automation error envelope for %s names",
    async (_kind, axialName, bendingName) => {
      const input = axialBar(1)
      input.material.yieldStrengthMpa = 4
      input.maxDisplacementMm = 0.04
      const axial = input.loadCases[0]
      if (!axial) throw new Error("The fixture must supply an axial load case.")
      input.loadCases = [
        { ...axial, name: axialName },
        { ...axial, name: bendingName, forceN: [0, 0, -0.2] },
      ]
      const response = await run(structuralOptimizationInputSchema.parse(input))
      expect(response.ok).toBe(false)
      if (response.ok) throw new Error("An infeasible baseline must not return a mesh.")
      expect(response.error.code).toBe("infeasible-baseline")
      const stress = response.error.message.match(
        /load case 1 .*: von Mises stress ([\d.e+-]+) MPa exceeds allowable ([\d.e+-]+) MPa; safety factor ([\d.e+-]+) is below required ([\d.e+-]+)\. /,
      )
      if (!stress)
        throw new Error("The diagnostic must include controlling stress and safety limits.")
      expect(Number(stress[1])).toBeCloseTo(2.5, 8)
      expect(Number(stress[2])).toBe(2)
      expect(Number(stress[3])).toBeCloseTo(1.6, 8)
      expect(Number(stress[4])).toBe(2)
      const displacement = response.error.message.match(
        /load case 2 .*: maximum displacement ([\d.e+-]+) mm exceeds limit ([\d.e+-]+) mm/,
      )
      if (!displacement)
        throw new Error("The diagnostic must include controlling displacement limits.")
      expect(Number(displacement[1])).toBeCloseTo(0.05, 2)
      expect(Number(displacement[2])).toBe(0.04)
      expect(response.error.message.length).toBeLessThanOrEqual(512)
      if (_kind === "named") {
        expect(response.error.message).toContain('load case 1 "axial"')
        expect(response.error.message).toContain('load case 2 "bending"')
      }
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
