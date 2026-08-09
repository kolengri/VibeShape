import createNativeSketchSolver from "../runtime/vibeshape_slvs.mjs"
import nativeSketchSolverWasmUrl from "../runtime/vibeshape_slvs.wasm?url"
import { type SketchCompilationInput, solveSketchRecord } from "./production"

export type BrowserSketchSolvePort = (
  input: SketchCompilationInput,
) => ReturnType<typeof solveSketchRecord>

let nativeModulePromise: ReturnType<typeof createNativeSketchSolver> | null = null

function loadNativeModule() {
  nativeModulePromise ??= createNativeSketchSolver({
    locateFile(path) {
      return path.endsWith(".wasm") ? nativeSketchSolverWasmUrl : path
    },
  })
  return nativeModulePromise
}

export async function createBrowserSketchSolvePort(): Promise<BrowserSketchSolvePort> {
  const module = await loadNativeModule()
  return (input) => solveSketchRecord(module, input)
}
