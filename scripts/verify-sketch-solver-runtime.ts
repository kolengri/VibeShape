import { join } from "node:path"
import {
  SKETCH_SOLVER_BUILD,
  SKETCH_SOLVER_CORRESPONDING_SOURCE_SHA256,
} from "../packages/sketch-solver/src/build-info"

const runtimeDirectory = join(import.meta.dirname, "../packages/sketch-solver/runtime")
const correspondingSourcePath = join(
  import.meta.dirname,
  "../third_party/solvespace/solvespace-corresponding-source.tar.gz",
)

async function sha256(path: string) {
  const bytes = await Bun.file(path).bytes()
  const digest = await crypto.subtle.digest("SHA-256", bytes)
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("")
}

const modulePath = join(runtimeDirectory, "vibeshape_slvs.mjs")
const wasmPath = join(runtimeDirectory, "vibeshape_slvs.wasm")
const [moduleHash, wasmHash, correspondingSourceHash, wasmBytes] = await Promise.all([
  sha256(modulePath),
  sha256(wasmPath),
  sha256(correspondingSourcePath),
  Bun.file(wasmPath).bytes(),
])

if (moduleHash !== SKETCH_SOLVER_BUILD.moduleSha256) {
  throw new Error(`Sketch solver module hash mismatch: ${moduleHash}.`)
}
if (wasmHash !== SKETCH_SOLVER_BUILD.wasmSha256) {
  throw new Error(`Sketch solver WASM hash mismatch: ${wasmHash}.`)
}
if (correspondingSourceHash !== SKETCH_SOLVER_CORRESPONDING_SOURCE_SHA256) {
  throw new Error(
    `Sketch solver corresponding-source bundle hash mismatch: ${correspondingSourceHash}.`,
  )
}
if (
  wasmBytes.length < 8 ||
  wasmBytes[0] !== 0x00 ||
  wasmBytes[1] !== 0x61 ||
  wasmBytes[2] !== 0x73 ||
  wasmBytes[3] !== 0x6d
) {
  throw new Error("Sketch solver runtime is not a valid WebAssembly binary.")
}

console.log(
  `Verified SolveSpace ${SKETCH_SOLVER_BUILD.solverVersion} runtime, WASM, and corresponding source (${wasmBytes.length} WASM bytes).`,
)
