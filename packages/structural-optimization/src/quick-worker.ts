import type { loadPyodide as LoadPyodide } from "pyodide"
import { z } from "zod"
import { quickLightweightingInputSchema, quickLightweightingResponseSchema } from "./quick-contract"
import { QuickLightweightingError } from "./quick-errors"
import { generateValidatedQuickLightweighting } from "./quick-generation"
import { quickGridSchema } from "./quick-isosurface"
import solverSource from "./quick-solver.py?raw"

const requestSchema = z
  .object({ input: quickLightweightingInputSchema, runtimeBaseUrl: z.url() })
  .strict()
const runtimeModuleSchema = z.object({
  loadPyodide: z.custom<typeof LoadPyodide>((value) => typeof value === "function"),
})
const preparedSchema = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), grid: quickGridSchema }).strict(),
  z
    .object({
      ok: z.literal(false),
      error: z.object({ code: z.string(), message: z.string() }).strict(),
    })
    .strict(),
])
let running = false
self.onmessage = async (event: MessageEvent<unknown>) => {
  if (running) return
  running = true
  try {
    const { input, runtimeBaseUrl } = requestSchema.parse(event.data)
    const base = new URL(runtimeBaseUrl)
    if (base.origin !== self.location.origin || !base.pathname.endsWith("/structural-runtime/"))
      throw new QuickLightweightingError(
        "runtime-unavailable",
        "The numerical runtime must be served by this application.",
      )
    self.postMessage({ type: "progress", stage: "loading" })
    const runtimeModule = runtimeModuleSchema.parse(
      await import(/* @vite-ignore */ new URL("pyodide.mjs", base).href),
    )
    const pyodide = await runtimeModule.loadPyodide({
      indexURL: base.href,
      packages: ["numpy", "scipy"],
    })
    await pyodide.loadPackage(new URL("trimesh-4.12.2-py3-none-any.whl", base).href)
    await pyodide.runPythonAsync(solverSource)
    pyodide.globals.set("_quick_request_json", JSON.stringify(input))
    self.postMessage({ type: "progress", stage: "generating" })
    const raw: unknown = await pyodide.runPythonAsync("prepare_quick_json(_quick_request_json)")
    if (typeof raw !== "string") throw new Error("The prepared grid must be JSON.")
    const prepared = preparedSchema.parse(JSON.parse(raw))
    if (!prepared.ok) {
      self.postMessage({ type: "complete", response: prepared })
      return
    }
    const response = await generateValidatedQuickLightweighting(
      input,
      prepared.grid,
      async (candidate) => {
        pyodide.globals.set("_quick_candidate_json", JSON.stringify(candidate))
        const result: unknown = await pyodide.runPythonAsync(
          "finish_quick_json(_quick_candidate_json)",
        )
        if (typeof result !== "string") throw new Error("The generated mesh must be JSON.")
        return quickLightweightingResponseSchema.parse(JSON.parse(result))
      },
    )
    self.postMessage({
      type: "complete",
      response,
    })
  } catch (error) {
    self.postMessage({
      type: "complete",
      response: {
        ok: false,
        error:
          error instanceof QuickLightweightingError
            ? { code: error.code, message: error.message }
            : {
                code: "runtime-unavailable",
                message: "The local numerical runtime could not generate lightweighting geometry.",
              },
      },
    })
  }
}
