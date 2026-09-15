import { readDatumPlaneFeatureParameters } from "@vibeshape/domain"
import type { DocumentSnapshot } from "@vibeshape/domain/document"
import type { FeatureId } from "@vibeshape/domain/identifiers"
import {
  type ModelBodyTopologyEvidenceResult,
  modelBodyTopologyEvidenceSchema,
} from "@vibeshape/domain/model-body-topology"
import { documentWorkerResponseSchema } from "@vibeshape/protocol"

type TopologyKind = "edge" | "face"

function completeFeatureCoverage(snapshot: DocumentSnapshot, response: RebuiltResponse) {
  const expected = snapshot.features.map((feature) => feature.id)
  const recordIds = response.evaluation.records.map((record) => record.featureId)
  if (recordIds.length !== expected.length) return false
  const ids = new Set(recordIds)
  return ids.size === expected.length && expected.every((id) => ids.has(id))
}

function completeGeometryCoverage(response: RebuiltResponse) {
  const successfulIds = response.evaluation.records
    .filter((record) => record.status === "succeeded")
    .map((record) => record.featureId)
  const geometryIds = response.geometry.map((record) => record.featureId)
  const successful = new Set(successfulIds)
  const geometries = new Set(geometryIds)
  return (
    successfulIds.length === successful.size &&
    geometryIds.length === geometries.size &&
    successful.size === geometries.size &&
    geometryIds.every((featureId) => successful.has(featureId))
  )
}

type RebuiltResponse = Extract<
  ReturnType<typeof documentWorkerResponseSchema.parse>,
  { type: "documentRebuilt" }
>

type RebuiltGeometry = RebuiltResponse["geometry"][number]
type RebuiltBody = NonNullable<RebuiltGeometry["geometry"]["bodies"]>[number]
type SourceEvidence =
  | { ok: false; result: ModelBodyTopologyEvidenceResult }
  | {
      ok: true
      response: RebuiltResponse
      geometry: RebuiltGeometry
    }

const invalidEvidence = (): SourceEvidence => ({
  ok: false,
  result: { ok: false, code: "invalid-geometry-evidence" },
})

const invalidResult = (): ModelBodyTopologyEvidenceResult => ({
  ok: false,
  code: "invalid-geometry-evidence",
})

function validateResponse(
  snapshot: DocumentSnapshot,
  response: RebuiltResponse,
): ModelBodyTopologyEvidenceResult | null {
  if (response.documentId !== snapshot.id || response.revision !== snapshot.revision) {
    return { ok: false, code: "stale-geometry" }
  }
  if (!completeFeatureCoverage(snapshot, response) || !completeGeometryCoverage(response)) {
    return invalidResult()
  }
  return null
}

function validateFeatureSource(
  snapshot: DocumentSnapshot,
  response: RebuiltResponse,
  target: { featureId: FeatureId },
): SourceEvidence {
  const feature = snapshot.features.find((candidate) => candidate.id === target.featureId)
  if (!feature) return { ok: false, result: { ok: false, code: "body-not-found" } }
  if (feature.suppressed || readDatumPlaneFeatureParameters(feature) !== null) {
    return { ok: false, result: { ok: false, code: "geometry-unavailable" } }
  }
  const evaluation = response.evaluation.records.find(
    (record) => record.featureId === target.featureId,
  )
  if (evaluation?.status !== "succeeded") {
    return { ok: false, result: { ok: false, code: "geometry-unavailable" } }
  }
  const geometry = response.geometry.find((record) => record.featureId === target.featureId)
  if (!geometry || geometry.contentHash !== evaluation.contentHash) return invalidEvidence()
  return { ok: true, response, geometry }
}

function validateSource(
  snapshot: DocumentSnapshot,
  response: RebuiltResponse,
  target: { featureId: FeatureId },
): SourceEvidence {
  const responseError = validateResponse(snapshot, response)
  return responseError
    ? { ok: false, result: responseError }
    : validateFeatureSource(snapshot, response, target)
}

type BodySelection =
  | { ok: false; result: ModelBodyTopologyEvidenceResult }
  | { ok: true; body: RebuiltBody }

function selectBody(geometry: RebuiltGeometry, outputRole: string): BodySelection {
  const root = geometry.geometry.shape
  if (!root.valid || root.volume <= 0 || root.solidCount < 1) {
    return { ok: false, result: { ok: false, code: "geometry-unavailable" } }
  }
  const bodies = geometry.geometry.bodies
  if (!bodies || bodies.length === 0) {
    return { ok: false, result: { ok: false, code: "body-not-found" } }
  }
  if (bodies.length !== geometry.geometry.shape.solidCount) {
    return { ok: false, result: invalidResult() }
  }
  const body = bodies.find((candidate) => candidate.outputRole === outputRole)
  return body ? { ok: true, body } : { ok: false, result: { ok: false, code: "body-not-found" } }
}

function projectEvidence(
  snapshot: DocumentSnapshot,
  source: Extract<SourceEvidence, { ok: true }>,
  target: { featureId: FeatureId; outputRole: string; kind: TopologyKind },
  body: RebuiltBody,
): ModelBodyTopologyEvidenceResult {
  const candidates = body.topologyCandidates
    .filter((candidate) => candidate.kind === target.kind)
    .map(({ candidateId, kind, semanticRole, lineageTokens, signature }) => ({
      candidateId,
      kind,
      ...(semanticRole ? { semanticRole } : {}),
      lineageTokens,
      signature,
    }))
  if (candidates.length !== body.shape[`${target.kind}Count`]) return invalidResult()
  const evidence = modelBodyTopologyEvidenceSchema.safeParse({
    schemaVersion: 1,
    documentId: snapshot.id,
    revision: snapshot.revision,
    generation: source.response.generation,
    rebuildId: source.response.requestId,
    featureId: target.featureId,
    contentHash: source.geometry.contentHash,
    outputRole: target.outputRole,
    kind: target.kind,
    candidates,
  })
  return evidence.success
    ? { ok: true, evidence: evidence.data }
    : { ok: false, code: "invalid-geometry-evidence" }
}

export function createModelBodyTopologyEvidence(
  snapshot: DocumentSnapshot,
  rebuild: { ok: false } | { ok: true; response: unknown },
  target: { featureId: FeatureId; outputRole: string; kind: TopologyKind },
): ModelBodyTopologyEvidenceResult {
  if (!rebuild.ok) return { ok: false, code: "geometry-unavailable" }

  const parsed = documentWorkerResponseSchema.safeParse(rebuild.response)
  if (!parsed.success || parsed.data.type !== "documentRebuilt") {
    return { ok: false, code: "invalid-geometry-evidence" }
  }
  const source = validateSource(snapshot, parsed.data, target)
  if (!source.ok) return source.result
  const body = selectBody(source.geometry, target.outputRole)
  return body.ok ? projectEvidence(snapshot, source, target, body.body) : body.result
}
