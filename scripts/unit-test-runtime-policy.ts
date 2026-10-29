import { realpathSync } from "node:fs"
import type { treeInputs } from "./unit-test-files"

type Input = Awaited<ReturnType<typeof treeInputs>>[number]
const engine = "packages/geometry-worker/src/engine.ts"
const engineHash = "1c928534b20212b3852c5fe984edafc4b975cfb3b6cd26b46c53b8fa37aec0ed"
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
    "packages/structural-optimization/tests/compound_relative_fixtures.py",
    "e60d2d6e0011da132327038f518c6bcaee4c4c0cdbbcc5282777d4ffc9cd08da",
  ],
  [
    "packages/structural-optimization/tests/boundary_reference_fixtures.py",
    "d75f0ff0f667346f79549dccebe2002c3ed907a6274b3e151288b9f7aff1cd45",
  ],
  [
    "packages/structural-optimization/tests/iterative_fixtures.py",
    "e2c4c62810251d3311e801b8d8bd8a10d91e418adcc61095dc3ad45815204253",
  ],
  [
    "packages/structural-optimization/tests/resource_fixtures.py",
    "7fbb2768e47a8a56668ae3180e91f96adc32a4d4dd1180ae98a4abba5218db54",
  ],
  [
    "packages/structural-optimization/src/solver.py",
    "4ff6da6550e4624a94bf4198b7a89768b480938546a4b0249cc9d9f4c51b8331",
  ],
  [
    "packages/structural-optimization/src/quick-solver.py",
    "97f1ae3a35da1a86cce7a8f0e4dcbf312ca6dcf53a2bca6a615554c02953d6a4",
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
    "9f5b940055415cc9aebd610244d392579b51a278c110f6fa3459bff0428db06f",
  ],
])
const callers = new Map([
  [
    "packages/structural-optimization/tests/wasm-large-elasticity.test.ts",
    "4be1d991fc98f10295b04c7928c5468683a1f88a2126c601a1bb7e59e53596a7",
  ],
  [
    "packages/structural-optimization/src/quick-preparation.ts",
    "ff5b84f3afd7f3c28e4fe72bae5443da55e08acf4109400e984cf03a47ea2480",
  ],
  [
    "packages/structural-optimization/tests/quick-bvh-sampling.test.ts",
    "5cf2a307cf108276dc5f4b1471c7bafc92bc451362cc6bfe2d9d80a1ed381e7e",
  ],
  [
    "packages/structural-optimization/src/worker.ts",
    "583eac7626a630e52f9d8e302e8b3206f01111ebf135a523715cbcd12b6ed207",
  ],
  [
    "packages/structural-optimization/src/quick-worker.ts",
    "53a54997a5a6ed3c358713ee20f2c6f95dd3787763a1b62a65e9ac23694b57a6",
  ],
  [
    "packages/structural-optimization/tests/quick-wasm.test.ts",
    "1c4930fe4a0d5c12c2c775a036c0f18998fe35053e06baba00e637a83c0bef18",
  ],
  [
    "packages/structural-optimization/tests/quick-wasm-curved.test.ts",
    "a7b53e854fd3d9d1a7050004507ebd2fb74a4c2549c2db617dbe83aac9ccc0a9",
  ],
  [
    "packages/structural-optimization/tests/quick-wasm-sampling.test.ts",
    "2853f46d54bc61108fa12a131bf6ae67e4dd45ef69a8a1ad31a11b2fb95b1d33",
  ],
  [
    "packages/structural-optimization/tests/quick-wasm-helpers.ts",
    "a1934bee50fa089a975da8788e8014b5076bfb98d7984e9374e04a9fd296ce80",
  ],
  [
    "packages/structural-optimization/tests/wasm-solver.test.ts",
    "6aabed32f4e767669d4d442761524b5e0c8e9693e83508e04578f0fee4d84c12",
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
