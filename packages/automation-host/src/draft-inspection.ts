import {
  type AutomationDraftInspectionRequest,
  automationDraftEdgeEvidenceSchema,
} from "@vibeshape/automation-api/draft-inspection"
import type {
  AutomationQueryView,
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
import type { DraftGeometryPort } from "./exact-draft-preview"

type ModelEdgeEvidence = Extract<ModelEdgeEvidenceResult, { ok: true }>["evidence"]

export type DraftEdgeCache = Readonly<{
  draftId: string
  revision: number
  featureId: FeatureId
  evidence: ModelEdgeEvidence
}>

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
  cache: DraftEdgeCache | null,
): Promise<{ ok: true; cache: DraftEdgeCache } | InspectionFailure> {
  if (
    cache?.draftId === draftId &&
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
          draftId,
          revision: snapshot.revision,
          featureId: query.featureId,
          evidence: read.evidence,
        },
      }
    : read
}

export async function inspectDraftQuery(
  request: AutomationDraftInspectionRequest,
  snapshot: DocumentSnapshot,
  draftId: string,
  geometry: DraftGeometryPort,
  queries: QueryDispatcher,
  cache: DraftEdgeCache | null,
): Promise<
  { ok: true; view: AutomationQueryView; cache: DraftEdgeCache | null } | InspectionFailure
> {
  let nextCache = cache
  if (request.query.kind === "org.vibeshape.model.edges") {
    const read = await readEdgeCache(request.query, snapshot, draftId, geometry, cache)
    if (!read.ok) return read
    nextCache = read.cache
  }
  const result = queries.dispatch(snapshot, request.query, {
    edges: nextCache ? { ok: true, evidence: nextCache.evidence } : undefined,
  })
  return result.ok ? { ok: true, view: result.view, cache: nextCache } : result
}
