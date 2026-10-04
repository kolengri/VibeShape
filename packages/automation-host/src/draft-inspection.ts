import {
  type AutomationDraftInspectionRequest,
  automationDraftEdgeEvidenceSchema,
  automationDraftMeasurementEvidenceSchema,
} from "@vibeshape/automation-api/draft-inspection"
import type {
  AutomationQueryView,
  DerivedQueryContext,
  ModelEdgeQuery,
  QueryDiagnosticCode,
  QueryDispatcher,
  QueryResult,
} from "@vibeshape/automation-api/queries"
import { type DocumentSnapshot, documentSnapshotSchema } from "@vibeshape/domain/document"
import type { FeatureId } from "@vibeshape/domain/identifiers"
import {
  type ModelEdgeEvidenceResult,
  modelEdgeEvidenceResultSchema,
} from "@vibeshape/domain/model-edges"
import type { ModelMeasurementEvidence } from "@vibeshape/domain/model-measurements"
import { type DraftBodyCache, readDraftBodyCache } from "./draft-body-inspection"
import type { DraftGeometryPort } from "./exact-draft-preview"

type ModelEdgeEvidence = Extract<ModelEdgeEvidenceResult, { ok: true }>["evidence"]

export type DraftEdgeCache = Readonly<{
  kind: "edges"
  draftId: string
  revision: number
  featureId: FeatureId
  evidence: ModelEdgeEvidence
}>

type DraftMeasurementCache = Readonly<{
  kind: "measurements"
  draftId: string
  revision: number
  evidence: ModelMeasurementEvidence
}>
export type DraftInspectionCache = DraftEdgeCache | DraftMeasurementCache | DraftBodyCache

type InspectionFailure = Extract<QueryResult, { ok: false }>
function failure(code: QueryDiagnosticCode, message: string, retryable = false): InspectionFailure {
  return { ok: false, diagnostic: { code, message, retryable, issues: [] } }
}

async function readEdgeEvidence(
  snapshot: DocumentSnapshot,
  featureId: FeatureId,
  geometry: DraftGeometryPort,
): Promise<{ ok: true; evidence: ModelEdgeEvidence } | InspectionFailure> {
  if (!geometry.inspectEdges)
    return failure("geometry-unavailable", "Exact draft edge evidence is unavailable.", true)
  const raw = await geometry.inspectEdges(documentSnapshotSchema.parse(snapshot), featureId)
  const parsed = modelEdgeEvidenceResultSchema.safeParse(raw)
  if (!parsed.success)
    return failure(
      "invalid-geometry-evidence",
      "The draft geometry port returned invalid edge evidence.",
    )
  if (!parsed.data.ok)
    return failure(parsed.data.code, "Exact draft edge evidence could not be prepared.", true)
  const evidence = automationDraftEdgeEvidenceSchema.safeParse(parsed.data.evidence)
  if (!evidence.success)
    return failure("query-result-too-large", "The draft edge catalog exceeds the 4 MiB limit.")
  if (
    evidence.data.documentId !== snapshot.id ||
    evidence.data.revision !== snapshot.revision ||
    evidence.data.featureId !== featureId
  )
    return failure(
      "stale-geometry",
      "The draft edge evidence does not match the requested draft.",
      true,
    )
  return { ok: true, evidence: evidence.data }
}

async function readEdgeCache(
  query: ModelEdgeQuery,
  snapshot: DocumentSnapshot,
  draftId: string,
  geometry: DraftGeometryPort,
  cache: DraftInspectionCache | null,
): Promise<{ ok: true; cache: DraftEdgeCache } | InspectionFailure> {
  if (
    cache?.kind === "edges" &&
    cache.draftId === draftId &&
    cache.revision === snapshot.revision &&
    cache.featureId === query.featureId
  )
    return { ok: true, cache }
  if (query.cursor !== null)
    return failure(
      "stale-geometry",
      "The draft edge cursor is no longer available; restart paging.",
      true,
    )
  const read = await readEdgeEvidence(snapshot, query.featureId, geometry)
  return read.ok
    ? {
        ok: true,
        cache: {
          kind: "edges",
          draftId,
          revision: snapshot.revision,
          featureId: query.featureId,
          evidence: read.evidence,
        },
      }
    : read
}

async function readMeasurementCache(
  snapshot: DocumentSnapshot,
  draftId: string,
  geometry: DraftGeometryPort,
  cache: DraftInspectionCache | null,
  cursor: string | null,
): Promise<{ ok: true; cache: DraftMeasurementCache } | InspectionFailure> {
  if (
    cache?.kind === "measurements" &&
    cache.draftId === draftId &&
    cache.revision === snapshot.revision
  )
    return { ok: true, cache }
  if (cursor !== null)
    return failure(
      "stale-geometry",
      "The draft measurement cursor is no longer available; restart paging.",
      true,
    )
  const raw = await geometry.evaluate(documentSnapshotSchema.parse(snapshot))
  const parsed = automationDraftMeasurementEvidenceSchema.safeParse(raw)
  if (!parsed.success)
    return failure(
      "invalid-geometry-evidence",
      "The draft geometry port returned invalid or oversized measurement evidence.",
    )
  if (parsed.data.documentId !== snapshot.id || parsed.data.revision !== snapshot.revision)
    return failure(
      "stale-geometry",
      "The draft measurements do not match the requested draft.",
      true,
    )
  return {
    ok: true,
    cache: { kind: "measurements", draftId, revision: snapshot.revision, evidence: parsed.data },
  }
}

export async function inspectDraftQuery(
  request: AutomationDraftInspectionRequest,
  snapshot: DocumentSnapshot,
  draftId: string,
  geometry: DraftGeometryPort,
  queries: QueryDispatcher,
  cache: DraftInspectionCache | null,
): Promise<
  { ok: true; view: AutomationQueryView; cache: DraftInspectionCache | null } | InspectionFailure
> {
  const read = await readInspectionCache(request.query, snapshot, draftId, geometry, cache)
  if (!read.ok) return read
  const nextCache = read.cache
  const result = queries.dispatch(snapshot, request.query, inspectionContext(nextCache))
  return result.ok ? { ok: true, view: result.view, cache: nextCache } : result
}

async function readInspectionCache(
  query: AutomationDraftInspectionRequest["query"],
  snapshot: DocumentSnapshot,
  draftId: string,
  geometry: DraftGeometryPort,
  cache: DraftInspectionCache | null,
): Promise<{ ok: true; cache: DraftInspectionCache | null } | InspectionFailure> {
  if (query.kind === "org.vibeshape.model.edges") {
    const read = await readEdgeCache(query, snapshot, draftId, geometry, cache)
    return read
  }
  if (query.kind === "org.vibeshape.model.measurements") {
    const read = await readMeasurementCache(snapshot, draftId, geometry, cache, query.cursor)
    return read
  }
  if (
    query.kind === "org.vibeshape.model.body-measurements" ||
    query.kind === "org.vibeshape.model.body-topology"
  ) {
    const bodyCache =
      cache?.kind === "body-measurements" || cache?.kind === "body-topology" ? cache : null
    const read = await readDraftBodyCache(query, snapshot, draftId, geometry, bodyCache)
    return read
  }
  return { ok: true, cache }
}
function inspectionContext(cache: DraftInspectionCache | null): DerivedQueryContext {
  if (!cache) return {}
  switch (cache.kind) {
    case "edges":
      return { edges: { ok: true, evidence: cache.evidence } }
    case "measurements":
      return { measurements: cache.evidence }
    case "body-measurements":
      return { bodyMeasurements: cache.evidence }
    case "body-topology":
      return { bodyTopology: { ok: true, evidence: cache.evidence } }
  }
}
