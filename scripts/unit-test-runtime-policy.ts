import { realpathSync } from "node:fs"
import type { treeInputs } from "./unit-test-files"

type Input = Awaited<ReturnType<typeof treeInputs>>[number]
const engine = "packages/geometry-worker/src/engine.ts"
const engineHash = "4e99a633ebd79740f0598195fa9b3fa900cf3893e1bce9a1b43954901ef7be19"
const reflectedGlobals = new Map([
  ["tests/unit/support/dom.ts", "6ea7655949bb970b91af80fa86b8961f920bffe3e21c6fc848327223aecd26f7"],
  [
    "tests/unit/support/bun-test.ts",
    "ad9db09b77d77544021df0688dd4ef318b8c5bf048a99d126654295c7067d252",
  ],
  [
    "packages/formats/src/vshape.ts",
    "c3bad5a4a7e328585d3f5031071583361e5565757f91af7f8fe1ebd0e7b945d9",
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
    "dfbb952f4c108315890e92eb882ada59998766bf18ce943b740a8d32c582bc77",
  ],
  [
    "scripts/structural-runtime-inputs.ts",
    "e07279d19577cd93beddf607cbf1ca14bd8e18ffaf353b35dd08d8d794073748",
  ],
])
const python = new Map([
  [
    "packages/structural-optimization/src/solver.py",
    "2fe47ab1eac6e51e0236d2a62e5c98155f49183f7f3e7ef89f8db2e40ab9a124",
  ],
  [
    "packages/structural-optimization/src/quick-solver.py",
    "b784af9f14d3504734d9b694ba09c6ba82b4c3df004cd345fe274ff2fc6ef296",
  ],
  [
    "packages/structural-optimization/tests/surface_target_fixtures.py",
    "5522f2158cead5973bb314b353e6471c41b43df33279106a5025918ffcb6cf27",
  ],
  [
    "packages/structural-optimization/tests/obstacle_fixtures.py",
    "43c7689e26184fe7be8628ed515bc8fa64677343e3895e543ec6970794f173ac",
  ],
  [
    "packages/structural-optimization/tests/implicit_fixtures.py",
    "135bc02aa7fd16bca80ee8af4d041850fc6211beb62db5d1970b96cee2e3ce93",
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
    "52891ebb5f85cc248947364ff58e2feebbc1161cbfe67b3da033e20c67d4a588",
  ],
  [
    "packages/structural-optimization/tests/quick-wasm-curved.test.ts",
    "cfe0b0d97192b59dfac5a5a4ad2daf69c534ec8808eb5bf94e6f5ab787ff4c57",
  ],
  [
    "packages/structural-optimization/tests/quick-wasm-helpers.ts",
    "8291201866097696e88d6aee156fcbe9bc300de9c62aade25e0ce49d24c1b8fc",
  ],
  [
    "packages/structural-optimization/tests/wasm-solver.test.ts",
    "79a06f2d8f5f1a15aaa7e4a7d7143f77d2f21d00b25ee24b93b761980ed59e0c",
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
