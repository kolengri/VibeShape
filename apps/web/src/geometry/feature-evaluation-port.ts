import type {
  FeatureGeometryEvaluationPort,
  FeatureGeometryEvaluationPortResult,
} from "@vibeshape/application/feature-rebuild"
import {
  createGeometryRequestEnvelope,
  type GeometryWorkerClient,
  GeometryWorkerRequestError,
} from "@vibeshape/geometry-worker/client"

type EvaluationRequest = Parameters<FeatureGeometryEvaluationPort>[0]
type TerminalResponse = Awaited<ReturnType<GeometryWorkerClient["request"]>>

function terminalFailureCode(response: TerminalResponse | undefined) {
  if (!response) return "worker-request-failed" as const
  if (response.type === "failure") return response.diagnostic.code
  if (response.type === "requestCancelled") return response.reason
  return "worker-request-failed" as const
}

function requestFailureCode(error: unknown) {
  return error instanceof GeometryWorkerRequestError
    ? terminalFailureCode(error.response)
    : ("worker-request-failed" as const)
}

function geometryResult(
  response: TerminalResponse,
  input: EvaluationRequest,
): FeatureGeometryEvaluationPortResult {
  if (response.type !== "featureEvaluated") {
    return { ok: false, diagnosticCode: "unexpected-worker-response" }
  }
  if (response.featureId !== input.featureId || response.contentHash !== input.contentHash) {
    return { ok: false, diagnosticCode: "unexpected-worker-response" }
  }

  const { engine, shape, topologyCandidates, mesh, cache, timings } = response
  return {
    ok: true,
    geometry: { engine, shape, topologyCandidates, mesh, cache, timings },
  }
}

async function evaluateGeometry(
  client: GeometryWorkerClient,
  input: EvaluationRequest,
): Promise<FeatureGeometryEvaluationPortResult> {
  try {
    const response = await client.request(
      {
        ...createGeometryRequestEnvelope(input.documentId, input.generation, input.revision),
        type: "evaluateFeature",
        featureId: input.featureId,
        content: input.content,
        contentHash: input.contentHash,
        dependencies: [...input.dependencies],
        mesh: input.mesh,
      },
      input.onProgress ? { onProgress: input.onProgress } : {},
    )
    return geometryResult(response, input)
  } catch (error) {
    return { ok: false, diagnosticCode: requestFailureCode(error) }
  }
}

export function createGeometryFeatureEvaluationPort(
  client: GeometryWorkerClient,
): FeatureGeometryEvaluationPort {
  return (input) => evaluateGeometry(client, input)
}
