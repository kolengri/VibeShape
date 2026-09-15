import { readDatumPlaneFeatureParameters } from "@vibeshape/domain"
import type { DocumentSnapshot } from "@vibeshape/domain/document"
import type { FeatureId } from "@vibeshape/domain/identifiers"
import {
  type ModelEdgeEvidenceResult,
  modelEdgeEvidenceSchema,
} from "@vibeshape/domain/model-edges"
import { documentWorkerResponseSchema } from "@vibeshape/protocol"

export function createModelEdgeEvidence(
  snapshot: DocumentSnapshot,
  rebuild: { ok: false } | { ok: true; response: unknown },
  featureId: FeatureId,
): ModelEdgeEvidenceResult {
  if (!rebuild.ok) return { ok: false, code: "geometry-unavailable" }
  const parsed = documentWorkerResponseSchema.safeParse(rebuild.response)
  if (!parsed.success || parsed.data.type !== "documentRebuilt")
    return { ok: false, code: "invalid-geometry-evidence" }
  const response = parsed.data
  if (response.documentId !== snapshot.id || response.revision !== snapshot.revision)
    return { ok: false, code: "stale-geometry" }
  const ids = new Set(response.evaluation.records.map((record) => record.featureId))
  if (
    response.evaluation.records.length !== snapshot.features.length ||
    ids.size !== snapshot.features.length ||
    snapshot.features.some((feature) => !ids.has(feature.id))
  )
    return { ok: false, code: "invalid-geometry-evidence" }
  return projectEdgeEvidence(snapshot, response, featureId)
}

function projectEdgeEvidence(
  snapshot: DocumentSnapshot,
  response: Extract<
    ReturnType<typeof documentWorkerResponseSchema.parse>,
    { type: "documentRebuilt" }
  >,
  featureId: FeatureId,
): ModelEdgeEvidenceResult {
  const feature = snapshot.features.find((record) => record.id === featureId)
  if (!feature || readDatumPlaneFeatureParameters(feature) !== null)
    return { ok: false, code: "geometry-unavailable" }
  const record = response.evaluation.records.find((record) => record.featureId === featureId)
  if (record?.status !== "succeeded") return { ok: false, code: "geometry-unavailable" }
  const geometry = response.geometry.find((record) => record.featureId === featureId)
  if (!geometry || geometry.contentHash !== record.contentHash)
    return { ok: false, code: "invalid-geometry-evidence" }
  if (!geometry.geometry.shape.valid || geometry.geometry.shape.solidCount < 1)
    return { ok: false, code: "geometry-unavailable" }
  return projectCandidates(snapshot, response, geometry)
}

function projectCandidates(
  snapshot: DocumentSnapshot,
  response: Extract<
    ReturnType<typeof documentWorkerResponseSchema.parse>,
    { type: "documentRebuilt" }
  >,
  geometry: Extract<
    ReturnType<typeof documentWorkerResponseSchema.parse>,
    { type: "documentRebuilt" }
  >["geometry"][number],
): ModelEdgeEvidenceResult {
  const candidates = geometry.geometry.topologyCandidates
    .filter((candidate) => candidate.kind === "edge")
    .map((candidate) => ({
      candidateId: candidate.candidateId,
      kind: candidate.kind,
      ...(candidate.semanticRole ? { semanticRole: candidate.semanticRole } : {}),
      lineageTokens: candidate.lineageTokens,
      signature: candidate.signature,
    }))
  if (candidates.length !== geometry.geometry.shape.edgeCount)
    return { ok: false, code: "invalid-geometry-evidence" }
  const evidence = modelEdgeEvidenceSchema.safeParse({
    schemaVersion: 1,
    documentId: snapshot.id,
    revision: snapshot.revision,
    generation: response.generation,
    rebuildId: response.requestId,
    featureId: geometry.featureId,
    contentHash: geometry.contentHash,
    candidates,
  })
  return evidence.success
    ? { ok: true, evidence: evidence.data }
    : { ok: false, code: "invalid-geometry-evidence" }
}
