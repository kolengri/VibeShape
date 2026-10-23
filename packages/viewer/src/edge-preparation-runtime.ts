import { prepareCreaseEdges } from "./edge-preparation-kernel"
import {
  type EdgePreparationResponse,
  edgePreparationRequestSchema,
} from "./edge-preparation-schema"

export function processEdgePreparation(value: unknown): EdgePreparationResponse {
  const parsed = edgePreparationRequestSchema.safeParse(value)
  if (!parsed.success) {
    return { version: 1, type: "edgePreparationFailed", jobId: 0, code: "invalid-mesh" }
  }
  const request = parsed.data
  // Linear semantic validation belongs off the UI thread too.
  const vertexCount = request.positions.length / 3
  if (
    !request.positions.every(Number.isFinite) ||
    !request.indices.every((index) => index < vertexCount)
  ) {
    return {
      version: 1,
      type: "edgePreparationFailed",
      jobId: request.jobId,
      code: "invalid-mesh",
    }
  }
  try {
    return {
      version: 1,
      type: "edgesPrepared",
      jobId: request.jobId,
      ...prepareCreaseEdges(request),
    }
  } catch {
    return {
      version: 1,
      type: "edgePreparationFailed",
      jobId: request.jobId,
      code: "preparation-failed",
    }
  }
}
