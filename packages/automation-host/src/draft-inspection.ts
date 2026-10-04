import {
  type AutomationDraftInspectionRequest,
  automationDraftMeasurementEvidenceSchema,
} from "@vibeshape/automation-api/draft-inspection"
import type {
  AutomationQueryView,
  DerivedQueryContext,
  QueryDiagnosticCode,
  QueryDispatcher,
  QueryResult,
} from "@vibeshape/automation-api/queries"
import { serializedQueryBytes } from "@vibeshape/automation-api/query-byte-budget"
import { type DocumentSnapshot, documentSnapshotSchema } from "@vibeshape/domain/document"
import { modelBodyMeasurementEvidenceSchema } from "@vibeshape/domain/model-body-measurements"
import { modelBodyTopologyEvidenceResultSchema } from "@vibeshape/domain/model-body-topology"
import { modelEdgeEvidenceResultSchema } from "@vibeshape/domain/model-edges"
import { sketchSolutionEvidenceSchema } from "@vibeshape/domain/sketch-solution-evidence"
import { z } from "zod"
import type { DraftGeometryPort } from "./exact-draft-preview"

export type DraftInspectionCache = Readonly<{
  draftId: string
  revision: number
  target: string
  context: DerivedQueryContext
}>

type InspectionFailure = Extract<QueryResult, { ok: false }>
type GeometryQuery = Extract<
  AutomationDraftInspectionRequest["query"],
  {
    kind:
      | "org.vibeshape.model.edges"
      | "org.vibeshape.model.body-topology"
      | "org.vibeshape.model.body-measurements"
  }
>
const bodyMeasurementResultSchema = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), evidence: modelBodyMeasurementEvidenceSchema }).strict(),
  z
    .object({
      ok: z.literal(false),
      code: z.enum(["geometry-unavailable", "stale-geometry", "invalid-geometry-evidence"]),
    })
    .strict(),
])
function failure(code: QueryDiagnosticCode, message: string, retryable = false): InspectionFailure {
  return { ok: false, diagnostic: { code, message, retryable, issues: [] } }
}
function targetKey(
  query:
    | GeometryQuery
    | Extract<
        AutomationDraftInspectionRequest["query"],
        { kind: "org.vibeshape.model.measurements" }
      >,
) {
  return JSON.stringify([
    query.kind,
    query.featureId,
    "outputRole" in query ? query.outputRole : null,
    "topologyKind" in query ? query.topologyKind : null,
  ])
}
async function readGeometryEvidence(
  snapshot: DocumentSnapshot,
  query: GeometryQuery,
  geometry: DraftGeometryPort,
) {
  const detached = documentSnapshotSchema.parse(snapshot)
  switch (query.kind) {
    case "org.vibeshape.model.edges":
      return geometry.inspectEdges
        ? {
            parsed: modelEdgeEvidenceResultSchema.safeParse(
              await geometry.inspectEdges(detached, query.featureId),
            ),
            key: "edges" as const,
          }
        : null
    case "org.vibeshape.model.body-topology":
      return geometry.inspectBodyTopology
        ? {
            parsed: modelBodyTopologyEvidenceResultSchema.safeParse(
              await geometry.inspectBodyTopology(detached, {
                featureId: query.featureId,
                outputRole: query.outputRole,
                kind: query.topologyKind,
              }),
            ),
            key: "bodyTopology" as const,
          }
        : null
    case "org.vibeshape.model.body-measurements":
      return geometry.inspectBodyMeasurements
        ? {
            parsed: bodyMeasurementResultSchema.safeParse(
              await geometry.inspectBodyMeasurements(detached),
            ),
            key: "bodyMeasurements" as const,
          }
        : null
  }
}
function validatedContext(
  read: Awaited<ReturnType<typeof readGeometryEvidence>>,
  snapshot: DocumentSnapshot,
): { ok: true; context: DerivedQueryContext } | InspectionFailure {
  if (!read)
    return failure("geometry-unavailable", "Exact draft geometry evidence is unavailable.", true)
  if (!read.parsed.success)
    return failure(
      "invalid-geometry-evidence",
      "The draft geometry port returned invalid evidence.",
    )
  const result = read.parsed.data
  if (!result.ok)
    return failure(result.code, "Exact draft geometry evidence could not be prepared.", true)
  const evidence = result.evidence
  if (serializedQueryBytes(evidence, 4 * 1024 * 1024) > 4 * 1024 * 1024)
    return failure("query-result-too-large", "The draft geometry catalog exceeds the 4 MiB limit.")
  if (evidence.documentId !== snapshot.id || evidence.revision !== snapshot.revision)
    return failure(
      "stale-geometry",
      "The draft geometry evidence does not match the requested draft.",
      true,
    )
  return {
    ok: true,
    context: { [read.key]: read.key === "bodyMeasurements" ? evidence : { ok: true, evidence } },
  }
}

async function readCache(
  query: GeometryQuery,
  snapshot: DocumentSnapshot,
  draftId: string,
  geometry: DraftGeometryPort,
  cache: DraftInspectionCache | null,
): Promise<{ ok: true; cache: DraftInspectionCache } | InspectionFailure> {
  const target = targetKey(query)
  if (cache?.draftId === draftId && cache.revision === snapshot.revision && cache.target === target)
    return { ok: true, cache }
  if (query.cursor !== null)
    return failure(
      "stale-geometry",
      "The draft geometry cursor is no longer available; restart paging.",
      true,
    )
  const checked = validatedContext(await readGeometryEvidence(snapshot, query, geometry), snapshot)
  if (!checked.ok) return checked

  return {
    ok: true,
    cache: {
      draftId,
      revision: snapshot.revision,
      target,
      context: checked.context,
    },
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
  let nextCache = cache
  const query = request.query
  if (
    query.kind === "org.vibeshape.model.edges" ||
    query.kind === "org.vibeshape.model.body-topology" ||
    query.kind === "org.vibeshape.model.body-measurements"
  ) {
    const read = await readCache(query, snapshot, draftId, geometry, cache)
    if (!read.ok) return read
    nextCache = read.cache
  }
  if (query.kind === "org.vibeshape.model.measurements") {
    const read = await readMeasurementCache(query, snapshot, draftId, geometry, cache)
    if (!read.ok) return read
    nextCache = read.cache
  }
  if (query.kind === "org.vibeshape.sketch.solution") {
    const read = await readSketchCache(query, snapshot, draftId, geometry, cache)
    if (!read.ok) return read
    nextCache = read.cache
  }
  const result = queries.dispatch(snapshot, query, nextCache?.context)
  return result.ok ? { ok: true, view: result.view, cache: nextCache } : result
}

async function readMeasurementCache(
  query: Extract<
    AutomationDraftInspectionRequest["query"],
    { kind: "org.vibeshape.model.measurements" }
  >,
  snapshot: DocumentSnapshot,
  draftId: string,
  geometry: DraftGeometryPort,
  cache: DraftInspectionCache | null,
): Promise<{ ok: true; cache: DraftInspectionCache } | InspectionFailure> {
  const target = targetKey(query)
  if (cache?.draftId === draftId && cache.revision === snapshot.revision && cache.target === target)
    return { ok: true, cache }
  if (query.cursor !== null)
    return failure(
      "stale-geometry",
      "The draft measurement cursor is no longer available; restart paging.",
      true,
    )
  const raw = await geometry.evaluate(documentSnapshotSchema.parse(snapshot))
  const parsed = parseMeasurementEvidence(raw)
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
    cache: { draftId, revision: snapshot.revision, target, context: { measurements: parsed.data } },
  }
}

function parseMeasurementEvidence(raw: unknown) {
  const evidence = raw && typeof raw === "object" && "measurements" in raw ? raw.measurements : raw
  return automationDraftMeasurementEvidenceSchema.safeParse(evidence)
}

const sketchInspectionResultSchema = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), evidence: sketchSolutionEvidenceSchema }).strict(),
  z
    .object({
      ok: z.literal(false),
      code: z.enum([
        "sketch-not-found",
        "stale-geometry",
        "invalid-geometry-evidence",
        "geometry-unavailable",
      ]),
    })
    .strict(),
])
async function readSketchCache(
  query: Extract<
    AutomationDraftInspectionRequest["query"],
    { kind: "org.vibeshape.sketch.solution" }
  >,
  snapshot: DocumentSnapshot,
  draftId: string,
  geometry: DraftGeometryPort,
  cache: DraftInspectionCache | null,
): Promise<{ ok: true; cache: DraftInspectionCache } | InspectionFailure> {
  const target = JSON.stringify([query.kind, query.sketchId])
  if (cache?.draftId === draftId && cache.revision === snapshot.revision && cache.target === target)
    return { ok: true, cache }
  if (query.cursor !== null)
    return failure(
      "stale-geometry",
      "The draft sketch cursor is no longer available; restart paging.",
      true,
    )
  const checked = await readSketchEvidence(query, snapshot, geometry)
  if (!checked.ok) return checked
  const evidence = checked.evidence
  return {
    ok: true,
    cache: { draftId, revision: snapshot.revision, target, context: { sketchSolution: evidence } },
  }
}

async function readSketchEvidence(
  query: Extract<
    AutomationDraftInspectionRequest["query"],
    { kind: "org.vibeshape.sketch.solution" }
  >,
  snapshot: DocumentSnapshot,
  geometry: DraftGeometryPort,
) {
  if (!geometry.inspectSketchSolution)
    return failure("geometry-unavailable", "Draft sketch solving is unavailable.", true)
  const read = sketchInspectionResultSchema.safeParse(
    await geometry.inspectSketchSolution(documentSnapshotSchema.parse(snapshot), query.sketchId),
  )
  if (!read.success)
    return failure("invalid-geometry-evidence", "The sketch solver returned invalid evidence.")
  if (!read.data.ok)
    return failure(read.data.code, "The sketch solution could not be prepared.", true)
  const evidence = read.data.evidence
  if (
    evidence.documentId !== snapshot.id ||
    evidence.revision !== snapshot.revision ||
    evidence.sketchId !== query.sketchId
  )
    return failure(
      "stale-geometry",
      "The solved evidence belongs to another sketch or draft revision.",
      true,
    )
  if (serializedQueryBytes(evidence, 4 * 1024 * 1024) > 4 * 1024 * 1024)
    return failure("query-result-too-large", "The solved sketch catalog exceeds the 4 MiB limit.")
  return { ok: true as const, evidence }
}
