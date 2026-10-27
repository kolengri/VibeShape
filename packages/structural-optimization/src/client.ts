import {
  structuralAlgorithmSummaryMatches,
  structuralFdmSummaryMatches,
} from "@vibeshape/domain/lightweighting"
import { z } from "zod"
import {
  type StructuralOptimizationInput,
  type StructuralOptimizationResult,
  structuralOptimizationInputSchema,
  structuralSolverResponseSchema,
} from "./contract"
import { StructuralOptimizationError } from "./errors"
import { invalidInputMessage } from "./input-diagnostics"
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
function massTargetMatches(
  input: StructuralOptimizationInput,
  result: StructuralOptimizationResult,
) {
  const requested = input.objective
  const objective = result.objective
  if (requested?.kind !== "maximize-stiffness" || objective?.kind !== "maximize-stiffness")
    return false
  const targetCount = Math.ceil(result.initialCellCount * requested.retainedMassFraction)
  return (
    objective.retainedMassFraction === requested.retainedMassFraction &&
    objective.targetCellCount === targetCount &&
    result.finalCellCount >= targetCount &&
    Math.abs(objective.targetMassKg / result.baseline.massKg - objective.retainedMassFraction) <=
      1e-8 &&
    Math.abs(
      objective.achievedRetainedMassFraction - result.optimized.massKg / result.baseline.massKg,
    ) <= 1e-8
  )
}
function objectiveMatches(
  input: StructuralOptimizationInput,
  result: StructuralOptimizationResult,
) {
  if (input.objective?.kind !== "maximize-stiffness")
    return (
      result.objective?.kind !== "maximize-stiffness" &&
      result.termination !== "target-mass-reached"
    )
  return (
    massTargetMatches(input, result) &&
    targetStatusMatches(result) &&
    [result.baseline, result.optimized].every((metrics) =>
      metrics.cases.every(({ complianceNmm }) => complianceNmm > 0),
    )
  )
}
function targetStatusMatches(result: StructuralOptimizationResult) {
  const objective = result.objective
  if (objective?.kind !== "maximize-stiffness") return false
  const reached = result.finalCellCount === objective.targetCellCount
  return (
    (objective.targetStatus === "reached") === reached &&
    (result.termination === "target-mass-reached") === reached
  )
}
function cellMetricsMatch(
  input: StructuralOptimizationInput,
  result: StructuralOptimizationResult,
) {
  const cellVolume = input.cellSizeMm ** 3
  const cellMass = cellVolume * input.material.densityKgM3 * 1e-9
  return [
    { metrics: result.baseline, count: result.initialCellCount },
    { metrics: result.optimized, count: result.finalCellCount },
  ].every(
    ({ metrics, count }) =>
      Math.abs(metrics.volumeMm3 / cellVolume - count) <= 1e-8 &&
      Math.abs(metrics.massKg / cellMass - count) <= 1e-8,
  )
}
function modelMetricsMatch(
  input: StructuralOptimizationInput,
  result: StructuralOptimizationResult,
) {
  return (
    result.cellSizeMm === input.cellSizeMm &&
    result.iterations <= input.maxIterations &&
    result.finalCellCount <= result.initialCellCount &&
    (result.status === "improved") === result.finalCellCount < result.initialCellCount
  )
}
function resultMatchesRequest(
  input: StructuralOptimizationInput,
  result: StructuralOptimizationResult,
) {
  return [
    modelMetricsMatch(input, result),
    cellMetricsMatch(input, result),
    objectiveMatches(input, result),
    structuralFdmSummaryMatches(result.fdm, input.fdm, input.cellSizeMm),
    structuralAlgorithmSummaryMatches(
      result.algorithm,
      input.algorithm,
      input.cellSizeMm,
      result.initialCellCount,
      result.finalCellCount,
      {
        iterations: result.iterations,
        evaluations: result.evaluations,
        maxIterations: input.maxIterations,
      },
    ),
  ].every(Boolean)
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
  if (!resultMatchesRequest(input, result))
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
      new StructuralOptimizationError(
        "invalid-input",
        invalidInputMessage("Analysis inputs are invalid.", parsed.error),
      ),
    )
  if (options.signal?.aborted)
    return Promise.reject(new DOMException("Analysis canceled.", "AbortError"))
  return new Promise((resolve, reject) => {
    let worker: Worker
    try {
      worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" })
    } catch {
      reject(
        new StructuralOptimizationError(
          "runtime-unavailable",
          "The analysis worker could not start.",
        ),
      )
      return
    }
    let settled = false
    const finish = (operation: () => void) => {
      if (settled) return
      settled = true
      options.signal?.removeEventListener("abort", abort)
      worker.terminate()
      operation()
    }
    const abort = () => finish(() => reject(new DOMException("Analysis canceled.", "AbortError")))
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
