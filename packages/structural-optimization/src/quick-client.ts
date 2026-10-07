import { z } from "zod"
import {
  type QuickLightweightingInput,
  type QuickLightweightingProgress,
  type QuickLightweightingResult,
  quickLightweightingInputSchema,
  quickLightweightingProgressSchema,
  quickLightweightingResponseSchema,
} from "./quick-contract"
import { QuickLightweightingError } from "./quick-errors"
import { encodeQuickLightweightingStl, signedQuickMeshVolume } from "./quick-mesh"

export { QuickLightweightingError } from "./quick-errors"
export { encodeQuickLightweightingStl } from "./quick-mesh"

const progressSchema = z
  .object({
    type: z.literal("progress"),
    stage: z.enum(["loading", "generating"]),
    progress: quickLightweightingProgressSchema.optional(),
  })
  .strict()
const responseSchema = z
  .object({ type: z.literal("complete"), response: quickLightweightingResponseSchema })
  .strict()

function validateResult(input: QuickLightweightingInput, result: QuickLightweightingResult) {
  const effective = resolveQuickLightweightingSettings(input)
  const parameters = [
    [input.mode, result.mode],
    [input.cellSizeMm, result.cellSizeMm],
    [input.skinThicknessMm, result.skinThicknessMm],
    [input.removalPercent, result.requestedRemovalPercent],
    [effective.cellType, result.cellType],
    [effective.latticeCellSizeMm, result.latticeCellSizeMm],
  ]
  if (
    !parameters.every(([expected, actual]) => expected === actual) ||
    Math.abs(signedQuickMeshVolume(input.mesh) - result.sourceVolumeMm3) >
      result.sourceVolumeMm3 * 1e-6 ||
    Math.abs(signedQuickMeshVolume(result.mesh) - result.resultVolumeMm3) >
      result.sourceVolumeMm3 * 1e-6
  )
    throw new QuickLightweightingError(
      "invalid-result",
      "The generated volume metrics are inconsistent.",
    )
  if (
    input.mode === "preserve-exterior" &&
    (!input.mesh.vertices.every((value, index) => result.mesh.vertices[index] === value) ||
      !input.mesh.indices.every((value, index) => result.mesh.indices[index] === value))
  )
    throw new QuickLightweightingError(
      "invalid-result",
      "The generated mesh changed the captured exterior.",
    )
  encodeQuickLightweightingStl(result.mesh, input.cellSizeMm)
}

export function generateQuickLightweighting(
  input: QuickLightweightingInput,
  options: {
    signal?: AbortSignal
    runtimeBaseUrl?: string
    onProgress?: (stage: "loading" | "generating", progress?: QuickLightweightingProgress) => void
  } = {},
): Promise<QuickLightweightingResult> {
  const parsed = quickLightweightingInputSchema.safeParse(input)
  if (!parsed.success)
    return Promise.reject(
      new QuickLightweightingError("invalid-input", "Lightweighting settings are invalid."),
    )
  if (options.signal?.aborted)
    return Promise.reject(new DOMException("Lightweighting canceled.", "AbortError"))
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./quick-worker.ts", import.meta.url), { type: "module" })
    let settled = false
    const finish = (operation: () => void) => {
      if (settled) return
      settled = true
      options.signal?.removeEventListener("abort", abort)
      worker.terminate()
      operation()
    }
    const abort = () =>
      finish(() => reject(new DOMException("Lightweighting canceled.", "AbortError")))
    options.signal?.addEventListener("abort", abort, { once: true })
    worker.onerror = () =>
      finish(() =>
        reject(
          new QuickLightweightingError("runtime-unavailable", "The lightweighting worker failed."),
        ),
      )
    worker.onmessageerror = () =>
      finish(() =>
        reject(
          new QuickLightweightingError(
            "invalid-result",
            "The generated response could not be decoded.",
          ),
        ),
      )
    worker.onmessage = (event: MessageEvent<unknown>) => {
      if (settled) return
      const progress = progressSchema.safeParse(event.data)
      if (progress.success) {
        try {
          options.onProgress?.(progress.data.stage, progress.data.progress)
        } catch (error) {
          finish(() => reject(error))
        }
        return
      }
      finish(() => {
        try {
          const { response } = responseSchema.parse(event.data)
          if (!response.ok) {
            reject(new QuickLightweightingError(response.error.code, response.error.message))
            return
          }
          validateResult(parsed.data, response.result)
          resolve(response.result)
        } catch (error) {
          reject(
            error instanceof QuickLightweightingError
              ? error
              : new QuickLightweightingError(
                  "invalid-result",
                  "The generated mesh or response is invalid.",
                ),
          )
        }
      })
    }
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

import { resolveQuickLightweightingSettings } from "@vibeshape/domain/quick-lightweighting"
