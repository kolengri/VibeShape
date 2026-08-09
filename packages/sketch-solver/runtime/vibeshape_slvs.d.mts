import type { NativeSketchSolverModule } from "../src/abi"

type SketchSolverModuleOptions = Readonly<{
  locateFile?: (path: string, prefix: string) => string
  print?: (message: string) => void
  printErr?: (message: string) => void
}>

export default function createVibeShapeSketchSolver(
  options?: SketchSolverModuleOptions,
): Promise<NativeSketchSolverModule>
