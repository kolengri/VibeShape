import type { loadPyodide as LoadPyodide } from "pyodide"
import { z } from "zod"
import { structuralOptimizationInputSchema, structuralSolverResponseSchema } from "./contract"
import solverSource from "./solver.py?raw"

const requestSchema = z
  .object({ input: structuralOptimizationInputSchema, runtimeBaseUrl: z.url() })
  .strict()
const runtimeModuleSchema = z.object({
  loadPyodide: z.custom<typeof LoadPyodide>((value) => typeof value === "function"),
})
let running = false
self.onmessage = async (event: MessageEvent<unknown>) => {
  if (running) return
  running = true
  try {
    const { input, runtimeBaseUrl } = requestSchema.parse(event.data)
    const base = new URL(runtimeBaseUrl)
    if (base.origin !== self.location.origin || !base.pathname.endsWith("/structural-runtime/"))
      throw new Error("The numerical runtime must be served by this application.")
    self.postMessage({ type: "progress", stage: "loading" })
    const runtimeModule = runtimeModuleSchema.parse(
      await import(/* @vite-ignore */ new URL("pyodide.mjs", base).href),
    )
    const pyodide = await runtimeModule.loadPyodide({
      indexURL: base.href,
      packages: ["numpy", "scipy"],
    })
    await pyodide.loadPackage([
      new URL("scikit_fem-12.0.2-py3-none-any.whl", base).href,
      new URL("trimesh-4.12.2-py3-none-any.whl", base).href,
    ])
    await pyodide.runPythonAsync(solverSource)
    pyodide.globals.set("_structural_request_json", JSON.stringify(input))
    self.postMessage({ type: "progress", stage: "solving" })
    const response: unknown = await pyodide.runPythonAsync("solve_json(_structural_request_json)")
    if (typeof response !== "string") throw new Error("The solver response must be JSON.")
    self.postMessage({
      type: "complete",
      response: structuralSolverResponseSchema.parse(JSON.parse(response)),
    })
  } catch {
    self.postMessage({
      type: "complete",
      response: {
        ok: false,
        error: {
          code: "runtime-unavailable",
          message: "The local numerical runtime could not complete analysis.",
        },
      },
    })
  }
}
