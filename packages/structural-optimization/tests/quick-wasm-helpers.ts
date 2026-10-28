import { beforeAll } from "bun:test"
import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { loadPyodide, type PyodideInterface } from "pyodide"
import type { StructuralMesh } from "../src/contract"
import {
  type QuickLightweightingInput,
  quickLightweightingResponseSchema,
} from "../src/quick-contract"
import { generateValidatedQuickLightweighting } from "../src/quick-generation"
import { createQuickSampling } from "../src/quick-sampling"

export const timeout = 120_000
export const root = fileURLToPath(new URL("../../../", import.meta.url))

export function createQuickWasmHarness(accelerated = true) {
  let runtime: PyodideInterface
  beforeAll(async () => {
    execFileSync("bun", ["run", "scripts/prepare-structural-runtime.ts"], {
      cwd: root,
      timeout,
      stdio: "pipe",
    })
    const directory = resolve(root, ".artifacts/structural-runtime")
    runtime = await loadPyodide({ indexURL: `${directory}/`, packages: ["numpy", "scipy"] })
    await runtime.loadPackage(resolve(directory, "trimesh-4.12.2-py3-none-any.whl"))
    await runtime.runPythonAsync(
      readFileSync(resolve(root, "packages/structural-optimization/src/quick-solver.py"), "utf8"),
    )
  }, timeout)

  async function prepare(request: QuickLightweightingInput) {
    runtime.globals.set("_quick_request_json", JSON.stringify(request))
    let sampling: ReturnType<typeof createQuickSampling> | undefined
    if (accelerated)
      runtime.globals.set(
        "_QUICK_SAMPLE",
        (points: Parameters<ReturnType<typeof createQuickSampling>["sample"]>[0]) => {
          sampling ??= createQuickSampling(request)
          return sampling.sample(points)
        },
      )
    let raw: unknown
    try {
      raw = await runtime.runPythonAsync("prepare_quick_json(_quick_request_json)")
    } finally {
      runtime.runPython("_QUICK_SAMPLE = None")
      sampling?.dispose()
    }
    if (typeof raw !== "string") throw new Error("Preparation must return JSON.")
    const prepared: { ok: boolean; grid?: unknown; error?: { code: string; message: string } } =
      JSON.parse(raw)
    return prepared
  }

  async function run(request: QuickLightweightingInput, inspectGrid?: (grid: unknown) => void) {
    const prepared = await prepare(request)
    if (!prepared.ok) return quickLightweightingResponseSchema.parse(prepared)
    inspectGrid?.(prepared.grid)
    return generateValidatedQuickLightweighting(request, prepared.grid, async (candidate) => {
      runtime.globals.set("_quick_candidate_json", JSON.stringify(candidate))
      const result: unknown = await runtime.runPythonAsync(
        "finish_quick_json(_quick_candidate_json)",
      )
      if (typeof result !== "string") throw new Error("Generation must return JSON.")
      return quickLightweightingResponseSchema.parse(JSON.parse(result))
    })
  }

  return {
    get runtime() {
      return runtime
    },
    prepare,
    run,
  }
}

function source(): StructuralMesh {
  return {
    vertices: [0, 0, 0, 0, 0, 10, 0, 10, 0, 0, 10, 10, 10, 0, 0, 10, 0, 10, 10, 10, 0, 10, 10, 10],
    indices: [
      0, 1, 3, 0, 3, 2, 4, 6, 7, 4, 7, 5, 0, 4, 5, 0, 5, 1, 2, 3, 7, 2, 7, 6, 0, 2, 6, 0, 6, 4, 1,
      5, 7, 1, 7, 3,
    ],
  }
}

export function input(
  mode: QuickLightweightingInput["mode"] = "preserve-exterior",
): QuickLightweightingInput {
  return {
    schemaVersion: 1,
    mesh: source(),
    mode,
    removalPercent: 50,
    cellSizeMm: 0.25,
    skinThicknessMm: mode === "preserve-exterior" ? 0.5 : 0,
  }
}

export function volume(mesh: StructuralMesh) {
  let result = 0
  for (let face = 0; face < mesh.indices.length; face += 3) {
    const points = mesh.indices
      .slice(face, face + 3)
      .map((index) => mesh.vertices.slice(index * 3, index * 3 + 3))
    const [a, b, c] = points
    if (!a || !b || !c) throw new Error("Missing triangle.")
    const [ax = 0, ay = 0, az = 0] = a
    const [bx = 0, by = 0, bz = 0] = b
    const [cx = 0, cy = 0, cz = 0] = c
    result += (ax * (by * cz - bz * cy) + ay * (bz * cx - bx * cz) + az * (bx * cy - by * cx)) / 6
  }
  return result
}
