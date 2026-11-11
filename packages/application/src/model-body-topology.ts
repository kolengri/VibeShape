import { isReferenceGeometryFeature } from "@vibeshape/domain"
import type { DocumentSnapshot } from "@vibeshape/domain/document"
import type { FeatureId } from "@vibeshape/domain/identifiers"
import {
  type ModelBodyTopologyEvidenceResult,
  modelBodyTopologyEvidenceSchema,
} from "@vibeshape/domain/model-body-topology"
import { documentWorkerResponseSchema } from "@vibeshape/protocol"
import { projectTopologyCandidate } from "./topology-candidate-projection"

type TopologyKind = "edge" | "face"
type TopologyTarget = { featureId: FeatureId; outputRole: string; kind: TopologyKind }

export type ModelBodyTopologyEvidenceResolver = (
  target: TopologyTarget,
) => ModelBodyTopologyEvidenceResult

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
      bodies: ReadonlyMap<string, RebuiltBody>
    }

const invalidEvidence = (): Extract<SourceEvidence, { ok: false }> => ({
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
  feature: DocumentSnapshot["features"][number],
  response: RebuiltResponse,
  evaluation: RebuiltResponse["evaluation"]["records"][number] | undefined,
  geometry: RebuiltGeometry | undefined,
): SourceEvidence {
  if (feature.suppressed || isReferenceGeometryFeature(feature)) {
    return { ok: false, result: { ok: false, code: "geometry-unavailable" } }
  }
  if (evaluation?.status !== "succeeded") {
    return { ok: false, result: { ok: false, code: "geometry-unavailable" } }
  }
  if (!geometry || geometry.contentHash !== evaluation.contentHash) return invalidEvidence()
  return {
    ok: true,
    response,
    geometry,
    bodies: new Map(geometry.geometry.bodies?.map((body) => [body.outputRole, body])),
  }
}

type BodySelection =
  | { ok: false; result: ModelBodyTopologyEvidenceResult }
  | { ok: true; body: RebuiltBody }

type BodyEvidenceSelection =
  | { ok: false; result: ModelBodyTopologyEvidenceResult }
  | { ok: true; source: Extract<SourceEvidence, { ok: true }>; body: RebuiltBody }

function selectBody(
  source: Extract<SourceEvidence, { ok: true }>,
  outputRole: string,
): BodySelection {
  const { geometry } = source
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
  const body = source.bodies.get(outputRole)
  return body ? { ok: true, body } : { ok: false, result: { ok: false, code: "body-not-found" } }
}

function projectEvidence(
  snapshot: DocumentSnapshot,
  source: Extract<SourceEvidence, { ok: true }>,
  target: TopologyTarget,
  body: RebuiltBody,
): ModelBodyTopologyEvidenceResult {
  const candidates = body.topologyCandidates
    .filter((candidate) => candidate.kind === target.kind)
    .map(projectTopologyCandidate)
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

function createBodyEvidenceResolver(
  snapshot: DocumentSnapshot,
  rebuild: { ok: false } | { ok: true; response: unknown },
): (target: Pick<TopologyTarget, "featureId" | "outputRole">) => BodyEvidenceSelection {
  if (!rebuild.ok) return () => ({ ok: false, result: { ok: false, code: "geometry-unavailable" } })

  const parsed = documentWorkerResponseSchema.safeParse(rebuild.response)
  if (!parsed.success || parsed.data.type !== "documentRebuilt") {
    return invalidEvidence
  }
  const response = parsed.data
  const responseError = validateResponse(snapshot, response)
  if (responseError) return () => ({ ok: false, result: responseError })
  const evaluations = new Map(
    response.evaluation.records.map((record) => [record.featureId, record]),
  )
  const geometries = new Map(response.geometry.map((geometry) => [geometry.featureId, geometry]))
  const sources = new Map<FeatureId, SourceEvidence>()
  for (const feature of snapshot.features) {
    if (!sources.has(feature.id))
      sources.set(
        feature.id,
        validateFeatureSource(
          feature,
          response,
          evaluations.get(feature.id),
          geometries.get(feature.id),
        ),
      )
  }
  return (target) => {
    const source = sources.get(target.featureId)
    if (!source) return { ok: false, result: { ok: false, code: "body-not-found" } }
    if (!source.ok) return source
    const body = selectBody(source, target.outputRole)
    return body.ok ? { ok: true, source, body: body.body } : body
  }
}

/** Own one resolver per synchronous catalogue invocation; retain no cross-rebuild cache. */
export function createModelBodyTopologyEvidenceResolver(
  snapshot: DocumentSnapshot,
  rebuild: { ok: false } | { ok: true; response: unknown },
): ModelBodyTopologyEvidenceResolver {
  const resolveBody = createBodyEvidenceResolver(snapshot, rebuild)
  return (target) => {
    const selection = resolveBody(target)
    return selection.ok
      ? projectEvidence(snapshot, selection.source, target, selection.body)
      : selection.result
  }
}

/** Read analytical recipes only after validating both complete body topology sets. */
export function inspectModelBodyTopologyCandidates(
  snapshot: DocumentSnapshot,
  rebuild: { ok: false } | { ok: true; response: unknown },
  target: Pick<TopologyTarget, "featureId" | "outputRole">,
): RebuiltBody["topologyCandidates"] | null {
  const selection = createBodyEvidenceResolver(snapshot, rebuild)(target)
  if (!selection.ok) return null
  for (const kind of ["edge", "face"] as const) {
    if (!projectEvidence(snapshot, selection.source, { ...target, kind }, selection.body).ok)
      return null
  }
  return selection.body.topologyCandidates
}

export function createModelBodyTopologyEvidence(
  snapshot: DocumentSnapshot,
  rebuild: { ok: false } | { ok: true; response: unknown },
  target: TopologyTarget,
): ModelBodyTopologyEvidenceResult {
  return createModelBodyTopologyEvidenceResolver(snapshot, rebuild)(target)
}
