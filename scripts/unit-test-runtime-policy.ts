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
    "39ee755a963585565d1b16529b79595c91f03542d639de33618801732a0c140e",
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
    "packages/structural-optimization/tests/resource_fixtures.py",
    "cdb7b73c9dad1c073117c0ee1e685da7f6352f4692afbb33bd149f1c0d2e98be",
  ],
  [
    "packages/structural-optimization/src/solver.py",
    "1898b03023370e26df80114bebec47b7bb388656f690f0c861c32a9f5d75d67e",
  ],
  [
    "packages/structural-optimization/src/quick-solver.py",
    "a960c2db2f8d7aab3eb21cf681273069cb9058c20bb4e01f19e6989f506eeee3",
  ],
  [
    "packages/structural-optimization/tests/surface_target_fixtures.py",
    "5522f2158cead5973bb314b353e6471c41b43df33279106a5025918ffcb6cf27",
  ],
  [
    "packages/structural-optimization/tests/obstacle_fixtures.py",
    "dd14ca19ebb7f85faa05ac468a1eee5d6276e54276f6a9bad5bfce608875c375",
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
    "583eac7626a630e52f9d8e302e8b3206f01111ebf135a523715cbcd12b6ed207",
  ],
  [
    "packages/structural-optimization/src/quick-worker.ts",
    "e7796468ee117e353e5f0819a7160de7cfe2a294d5c4c3e435b5c862ad054339",
  ],
  [
    "packages/structural-optimization/tests/quick-wasm.test.ts",
    "1c4930fe4a0d5c12c2c775a036c0f18998fe35053e06baba00e637a83c0bef18",
  ],
  [
    "packages/structural-optimization/tests/quick-wasm-curved.test.ts",
    "cfe0b0d97192b59dfac5a5a4ad2daf69c534ec8808eb5bf94e6f5ab787ff4c57",
  ],
  [
    "packages/structural-optimization/tests/quick-wasm-helpers.ts",
    "c01831cf9da8e9abd61f20311e73b84956d21818709df765b954c16a6947df5d",
  ],
  [
    "packages/structural-optimization/tests/wasm-solver.test.ts",
    "41b8b17c31e5c8e3c1d630def846723a66bbb2c14cac49884279f16ace2bb11f",
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
