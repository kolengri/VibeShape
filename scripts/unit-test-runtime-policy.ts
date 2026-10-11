import { realpathSync } from "node:fs"
import type { treeInputs } from "./unit-test-files"

type Input = Awaited<ReturnType<typeof treeInputs>>[number]
const engine = "packages/geometry-worker/src/engine.ts"
const engineHash = "a60979802ad8818f4b60087ba83f657cd28d02f63c67b8f4c1b78c44d4dfa6f3"
const reflectedGlobals = new Map([
  ["tests/unit/support/dom.ts", "6ea7655949bb970b91af80fa86b8961f920bffe3e21c6fc848327223aecd26f7"],
  [
    "tests/unit/support/bun-test.ts",
    "ad9db09b77d77544021df0688dd4ef318b8c5bf048a99d126654295c7067d252",
  ],
  [
    "packages/formats/src/vshape.ts",
    "60dbb7749777609246a3a788523111f73d41b896d3e20e5cd8ce887eb5955c49",
  ],
  [
    "packages/formats/src/vshape.test.ts",
    "e67620166ca398b79223ee899103b235d1a4f95a4bdc2c003c572cc444c8f8cd",
  ],
  [
    "packages/formats/src/text-outline/font.ts",
    "f41184b6377b705145c073c37ae0286333a7c974872a0d137be6b914dc96ed8b",
  ],
])
const preparation = new Map([
  [
    "scripts/prepare-structural-runtime.ts",
    "e0acfba773d02b17a66cd773c11b4b7b8921559d82f6cde377e5cba91e6cfe7c",
  ],
  [
    "scripts/structural-runtime-inputs.ts",
    "e07279d19577cd93beddf607cbf1ca14bd8e18ffaf353b35dd08d8d794073748",
  ],
])
const python = new Map([
  [
    "packages/structural-optimization/src/solver.py",
    "bdbec4e84c11998247ba6fb964a38ea416e0d67e12fd748903929ec3c2d72f37",
  ],
  [
    "packages/structural-optimization/src/quick-solver.py",
    "e2ddf0024783f7a000c66cce7a0544c326894fdd917c41ce7d34397f3fb449e8",
  ],
  [
    "packages/structural-optimization/tests/surface_target_fixtures.py",
    "5522f2158cead5973bb314b353e6471c41b43df33279106a5025918ffcb6cf27",
  ],
  [
    "packages/structural-optimization/tests/obstacle_fixtures.py",
    "40b6cc3823a0943de007724c9d427ee88daff01da1f80ba90e3d4dc218a49365",
  ],
  [
    "packages/structural-optimization/tests/fdm_fixtures.py",
    "6ccc9458e67a6dcfbcdfe9b0da02ecdc86e2f06adbd4d5c1b0ae1c7722bbaece",
  ],
])
const callers = new Map([
  [
    "packages/structural-optimization/src/worker.ts",
    "ddba07df02a1d3f4dfb051930bf5ea87c80597a01abd480339b10a5a56b0977b",
  ],
  [
    "packages/structural-optimization/src/quick-worker.ts",
    "a04578ee9f8b163beff0fff1342f87d09fb7ea103c97faf0256cd29bd587e0c7",
  ],
  [
    "packages/structural-optimization/tests/quick-wasm.test.ts",
    "b9dee0174264cd04eea6fd73ef780bb0b9958db0e1f5a6983936b7245347edbd",
  ],
  [
    "packages/structural-optimization/tests/wasm-solver.test.ts",
    "99debd0b78baf56962ab6d940b794f77a4a6cc9be72bc56622b060bd1c8adcfb",
  ],
])

function sameBun(root: string, environment: NodeJS.ProcessEnv) {
  if (!environment.PATH) return false
  const executable = Bun.which("bun", { PATH: environment.PATH, cwd: root })
  if (!executable) return false
  try {
    return realpathSync(executable) === realpathSync(process.execPath)
  } catch {
    return false
  }
}

/** Only inspected immutable producers may cross an interpreter, subprocess or fetch boundary. */
export function runtimePolicy(
  input: Input,
  hashes: Map<string, string>,
  root: string,
  environment: NodeJS.ProcessEnv,
) {
  const structural =
    callers.get(input.path) === input.hash &&
    [...preparation, ...python].every(([path, hash]) => hashes.get(path) === hash)
  return {
    reflectedGlobals: reflectedGlobals.get(input.path) === input.hash,
    workerFactory:
      input.path === "tests/unit/support/vite-imports.ts" &&
      input.hash === "50e3af4758c9781f5e32fed28265318f4b60be258e554bd89d4f20b922ef4c11",
    fetch: input.path === engine && input.hash === engineHash,
    python: structural,
    memoryReport:
      structural && input.path === "packages/structural-optimization/tests/quick-wasm.test.ts",
    preparation: structural && input.path.includes("/tests/") && sameBun(root, environment),
  }
}
