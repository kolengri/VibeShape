import type { QuickLightweightingInput, QuickLightweightingResponse } from "./quick-contract"
import { QuickLightweightingError } from "./quick-errors"
import {
  generateQuickIsosurface,
  type QuickIsosurfaceCandidate,
  quickGridSchema,
} from "./quick-isosurface"
import { signedQuickMeshVolume, validateQuickLightweightingSnapshot } from "./quick-mesh"

function validateSnapshotResponse(
  response: QuickLightweightingResponse,
  cellSizeMm: number,
): QuickLightweightingResponse {
  if (!response.ok) return response
  try {
    validateQuickLightweightingSnapshot(response.result.mesh, cellSizeMm)
    return response
  } catch (error) {
    if (!(error instanceof QuickLightweightingError)) throw error
    return { ok: false, error: { code: error.code, message: error.message } }
  }
}

/** Reuse the captured distance grid for at most three connected-material candidates. */
export async function generateValidatedQuickLightweighting(
  input: QuickLightweightingInput,
  grid: unknown,
  finish: (candidate: QuickIsosurfaceCandidate) => Promise<QuickLightweightingResponse>,
): Promise<QuickLightweightingResponse> {
  const parsedGrid = quickGridSchema.parse(grid)
  const targets = [input.removalPercent]
  let response: QuickLightweightingResponse | undefined
  for (let attempt = 0; attempt < 3; attempt++) {
    const removalPercent = targets[attempt]
    if (removalPercent === undefined) break
    const candidate = generateQuickIsosurface({ ...input, removalPercent }, parsedGrid)
    // Python retains the original request and reports its requested percentage;
    // only the candidate search target changes during feasibility backtracking.
    response = validateSnapshotResponse(await finish(candidate), input.cellSizeMm)
    if (response.ok || response.error.code !== "disconnected-mesh") return response
    if (attempt === 0) {
      const fraction = Math.abs(signedQuickMeshVolume(candidate)) / parsedGrid.sourceVolumeCells
      const actualRemoval = 100 * (input.mode === "preserve-exterior" ? fraction : 1 - fraction)
      // Skin-capped targets must backtrack from achieved geometry; otherwise all
      // three searches can repeat the same disconnected maximum-removal mesh.
      const base =
        input.mode === "preserve-exterior"
          ? Math.min(input.removalPercent, actualRemoval)
          : input.removalPercent
      targets.push(base * (65 / 80), base * (50 / 80))
    }
  }
  return (
    response ?? {
      ok: false,
      error: {
        code: "no-removable-material",
        message: "No connected candidate was found. Reduce removal or use finer detail cells.",
      },
    }
  )
}
