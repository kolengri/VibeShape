import { expect, it } from "bun:test"
import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { loadPyodide } from "pyodide"

it("solves 44,100 full-solid cells in a fresh pinned runtime with analytical elasticity", async () => {
  const root = resolve(import.meta.dir, "../../..")
  execFileSync("bun", ["run", "scripts/prepare-structural-runtime.ts"], {
    cwd: root,
    timeout: 120_000,
    stdio: "pipe",
  })
  const directory = resolve(root, ".artifacts/structural-runtime")
  const runtime = await loadPyodide({ indexURL: `${directory}/`, packages: ["numpy", "scipy"] })
  await runtime.loadPackage([
    resolve(directory, "scikit_fem-12.0.2-py3-none-any.whl"),
    resolve(directory, "trimesh-4.12.2-py3-none-any.whl"),
  ])
  await runtime.runPythonAsync(
    readFileSync(resolve(root, "packages/structural-optimization/src/solver.py"), "utf8"),
  )
  await runtime.runPythonAsync(
    readFileSync(
      resolve(root, "packages/structural-optimization/tests/iterative_fixtures.py"),
      "utf8",
    ),
  )
  const raw: unknown = await runtime.runPythonAsync(
    "from types import SimpleNamespace; json.dumps(verify_iterative_large_analytical_solve(SimpleNamespace(**globals())))",
  )
  expect(typeof raw).toBe("string")
  expect(JSON.parse(String(raw))).toMatchObject({ volumeMm3: 44_100, massKg: 0.0441 })
}, 120_000)
