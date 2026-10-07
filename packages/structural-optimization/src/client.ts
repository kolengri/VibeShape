import { z } from "zod"
import {
  type StructuralOptimizationInput,
  type StructuralOptimizationResult,
  structuralOptimizationInputSchema,
  structuralSolverResponseSchema,
} from "./contract"
import { StructuralOptimizationError } from "./errors"
import { encodeStructuralStl } from "./mesh"

export { StructuralOptimizationError } from "./errors"

const progressSchema = z
  .object({ type: z.literal("progress"), stage: z.enum(["loading", "solving"]) })
  .strict()
const responseSchema = z
  .object({ type: z.literal("complete"), response: structuralSolverResponseSchema })
  .strict()

function metricsFeasible(
  input: StructuralOptimizationInput,
  metrics: StructuralOptimizationResult["baseline"],
) {
  const stressLimit = input.material.yieldStrengthMpa / input.safetyFactor
  return (
    metrics.cases.length === input.loadCases.length &&
    metrics.cases.every((item, index) => item.name === input.loadCases[index]?.name) &&
    [metrics, ...metrics.cases].every(
      (item) =>
        item.maxVonMisesMpa <= stressLimit * (1 + 1e-8) &&
        item.maxDisplacementMm <= input.maxDisplacementMm * (1 + 1e-8) &&
        item.safetyFactor >= input.safetyFactor * (1 - 1e-8),
    )
  )
}
function validateFeasibility(
  input: StructuralOptimizationInput,
  result: StructuralOptimizationResult,
) {
  for (const metrics of [result.baseline, result.optimized]) {
    if (!metricsFeasible(input, metrics))
      throw new StructuralOptimizationError(
        "invalid-result",
        "The solver returned an infeasible result.",
      )
  }
  const improved = result.finalCellCount < result.initialCellCount
  if (
    result.cellSizeMm !== input.cellSizeMm ||
    result.iterations > input.maxIterations ||
    result.finalCellCount > result.initialCellCount ||
    result.optimized.volumeMm3 > result.baseline.volumeMm3 * (1 + 1e-8) ||
    (result.status === "improved") !== improved
  )
    throw new StructuralOptimizationError(
      "invalid-result",
      "The solver returned inconsistent model metrics.",
    )
  encodeStructuralStl(result.mesh, input.cellSizeMm)
}

export function optimizeStructuralModel(
  input: StructuralOptimizationInput,
  options: {
    signal?: AbortSignal
    runtimeBaseUrl?: string
    onProgress?: (stage: "loading" | "solving") => void
  } = {},
): Promise<StructuralOptimizationResult> {
  const parsed = structuralOptimizationInputSchema.safeParse(input)
  if (!parsed.success)
    return Promise.reject(
      new StructuralOptimizationError("invalid-input", "Analysis inputs are invalid."),
    )
  if (options.signal?.aborted)
    return Promise.reject(new DOMException("Analysis canceled.", "AbortError"))
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" })
    let settled = false
    const finish = (operation: () => void) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      options.signal?.removeEventListener("abort", abort)
      worker.terminate()
      operation()
    }
    const abort = () => finish(() => reject(new DOMException("Analysis canceled.", "AbortError")))
    const timeout = setTimeout(
      () =>
        finish(() =>
          reject(new StructuralOptimizationError("timeout", "Analysis exceeded its time budget.")),
        ),
      180_000,
    )
    options.signal?.addEventListener("abort", abort, { once: true })
    worker.onerror = () =>
      finish(() =>
        reject(
          new StructuralOptimizationError("runtime-unavailable", "The analysis worker failed."),
        ),
      )
    worker.onmessage = (event: MessageEvent<unknown>) => {
      if (settled) return
      const progress = progressSchema.safeParse(event.data)
      if (progress.success) {
        try {
          options.onProgress?.(progress.data.stage)
        } catch (error) {
          finish(() => reject(error))
        }
        return
      }
      finish(() => {
        try {
          const { response } = responseSchema.parse(event.data)
          if (!response.ok) {
            reject(new StructuralOptimizationError(response.error.code, response.error.message))
            return
          }
          validateFeasibility(parsed.data, response.result)
          resolve(response.result)
        } catch (error) {
          reject(
            error instanceof StructuralOptimizationError
              ? error
              : new StructuralOptimizationError(
                  "invalid-result",
                  "The solver returned an invalid mesh or response.",
                ),
          )
        }
      })
    }
    worker.onmessageerror = () =>
      finish(() =>
        reject(
          new StructuralOptimizationError(
            "invalid-result",
            "The analysis response could not be decoded.",
          ),
        ),
      )
    try {
      worker.postMessage({
        input: parsed.data,
        runtimeBaseUrl:
          options.runtimeBaseUrl ?? new URL("structural-runtime/", document.baseURI).href,
      })
    } catch (error) {
      finish(() => reject(error))
    }
  })
}
