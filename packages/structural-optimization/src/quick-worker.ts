import type { loadPyodide as LoadPyodide } from "pyodide"
import { z } from "zod"
import {
  type QuickLightweightingProgress,
  quickLightweightingInputSchema,
  quickLightweightingProgressSchema,
  quickLightweightingResponseSchema,
} from "./quick-contract"
import { QuickLightweightingError } from "./quick-errors"
import { generateValidatedQuickLightweighting } from "./quick-generation"
import { quickGridSchema } from "./quick-isosurface"
import { createQuickSampling } from "./quick-sampling"
import solverSource from "./quick-solver.py?raw"
import { type NumericalRuntimeStage, numericalRuntimeMessage } from "./runtime-diagnostics"

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
  let stage: NumericalRuntimeStage = "request validation"
  try {
    const { input, runtimeBaseUrl } = requestSchema.parse(event.data)
    const base = new URL(runtimeBaseUrl)
    if (base.origin !== self.location.origin || !base.pathname.endsWith("/structural-runtime/"))
      throw new QuickLightweightingError(
        "runtime-unavailable",
        "The numerical runtime must be served by this application.",
      )
    self.postMessage({ type: "progress", stage: "loading" })
    stage = "module loading"
    const runtimeModule = runtimeModuleSchema.parse(
      await import(/* @vite-ignore */ new URL("pyodide.mjs", base).href),
    )
    stage = "runtime initialization"
    const pyodide = await runtimeModule.loadPyodide({
      indexURL: base.href,
      packages: ["numpy", "scipy"],
    })
    stage = "package loading"
    await pyodide.loadPackage(new URL("trimesh-4.12.2-py3-none-any.whl", base).href)
    stage = "solver loading"
    await pyodide.runPythonAsync(solverSource)
    stage = "source preparation"
    let lastProgress: QuickLightweightingProgress | undefined
    pyodide.globals.set("_QUICK_PROGRESS", (phase: unknown, completed: unknown, total: unknown) => {
      const progress = quickLightweightingProgressSchema.parse({ phase, completed, total })
      if (
        lastProgress?.phase === progress.phase &&
        lastProgress.total === progress.total &&
        progress.completed > 0 &&
        progress.completed < progress.total &&
        progress.completed - lastProgress.completed < Math.max(1, progress.total / 100)
      )
        return
      lastProgress = progress
      self.postMessage({ type: "progress", stage: "generating", progress })
    })
    pyodide.globals.set("_quick_request_json", JSON.stringify(input))
    self.postMessage({ type: "progress", stage: "generating" })
    let sampling: ReturnType<typeof createQuickSampling> | undefined
    pyodide.globals.set(
      "_QUICK_SAMPLE",
      (points: Parameters<ReturnType<typeof createQuickSampling>["sample"]>[0]) => {
        sampling ??= createQuickSampling(input)
        return sampling.sample(points)
      },
    )
    let raw: unknown
    try {
      raw = await pyodide.runPythonAsync("prepare_quick_json(_quick_request_json)")
    } finally {
      pyodide.runPython("_QUICK_SAMPLE = None")
      sampling?.dispose()
    }
    stage = "response validation"
    if (typeof raw !== "string") throw new Error("The prepared grid must be JSON.")
    const prepared = preparedSchema.parse(JSON.parse(raw))
    if (!prepared.ok) {
      self.postMessage({ type: "complete", response: prepared })
      return
    }
    stage = "geometry generation"
    const response = await generateValidatedQuickLightweighting(
      input,
      prepared.grid,
      async (candidate) => {
        stage = "geometry validation"
        pyodide.globals.set("_quick_candidate_json", JSON.stringify(candidate))
        const result: unknown = await pyodide.runPythonAsync(
          "finish_quick_json(_quick_candidate_json)",
        )
        stage = "response validation"
        if (typeof result !== "string") throw new Error("The generated mesh must be JSON.")
        const response = quickLightweightingResponseSchema.parse(JSON.parse(result))
        stage = "geometry generation"
        return response
      },
    )
    stage = "response validation"
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
                message: numericalRuntimeMessage(stage, error),
              },
      },
    })
  }
}
