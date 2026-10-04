import {
  automationDraftBodyMeasurementEvidenceSchema,
  automationDraftBodyTopologyEvidenceSchema,
} from "@vibeshape/automation-api/draft-inspection"
import type {
  ModelBodyMeasurementQuery,
  ModelBodyTopologyQuery,
  QueryResult,
} from "@vibeshape/automation-api/queries"
import { type DocumentSnapshot, documentSnapshotSchema } from "@vibeshape/domain/document"
import type { ModelBodyMeasurementEvidence } from "@vibeshape/domain/model-body-measurements"
import {
  type ModelBodyTopologyEvidence,
  modelBodyTopologyEvidenceResultSchema,
} from "@vibeshape/domain/model-body-topology"
import { z } from "zod"
import type { DraftGeometryPort } from "./exact-draft-preview"

export type DraftBodyCache =
  | Readonly<{
      kind: "body-measurements"
      draftId: string
      revision: number
      evidence: ModelBodyMeasurementEvidence
    }>
  | Readonly<{
      kind: "body-topology"
      draftId: string
      revision: number
      evidence: ModelBodyTopologyEvidence
    }>
type Failure = Extract<QueryResult, { ok: false }>
const failure = (
  code: Failure["diagnostic"]["code"],
  message: string,
  retryable = false,
): Failure => ({
  ok: false,
  diagnostic: { code, message, retryable, issues: [] },
})
const bodyMeasurementResultSchema = z.discriminatedUnion("ok", [
  z
    .object({ ok: z.literal(true), evidence: automationDraftBodyMeasurementEvidenceSchema })
    .strict(),
  z
    .object({
      ok: z.literal(false),
      code: z.enum(["geometry-unavailable", "stale-geometry", "invalid-geometry-evidence"]),
    })
    .strict(),
])

export async function readDraftBodyCache(
  query: ModelBodyMeasurementQuery | ModelBodyTopologyQuery,
  snapshot: DocumentSnapshot,
  draftId: string,
  geometry: DraftGeometryPort,
  cache: DraftBodyCache | null,
): Promise<{ ok: true; cache: DraftBodyCache } | Failure> {
  const current = cache?.draftId === draftId && cache.revision === snapshot.revision ? cache : null
  if (query.kind === "org.vibeshape.model.body-measurements")
    return readMeasurementCache(query, snapshot, draftId, geometry, current)
  return readTopologyCache(query, snapshot, draftId, geometry, current)
}

async function readMeasurementCache(
  query: ModelBodyMeasurementQuery,
  snapshot: DocumentSnapshot,
  draftId: string,
  geometry: DraftGeometryPort,
  cache: DraftBodyCache | null,
): Promise<{ ok: true; cache: DraftBodyCache } | Failure> {
  if (cache?.kind === "body-measurements") return { ok: true, cache }
  if (query.cursor !== null)
    return failure("stale-geometry", "The draft body cursor is unavailable; restart paging.", true)
  if (!geometry.inspectBodyMeasurements)
    return failure("geometry-unavailable", "Exact draft body measurements are unavailable.", true)
  const result = bodyMeasurementResultSchema.safeParse(
    await geometry.inspectBodyMeasurements(documentSnapshotSchema.parse(snapshot)),
  )
  if (!result.success)
    return failure("invalid-geometry-evidence", "Invalid or oversized draft body measurements.")
  if (!result.data.ok)
    return failure(result.data.code, "Draft body measurements could not be prepared.", true)
  const evidence = result.data.evidence
  if (evidence.documentId !== snapshot.id || evidence.revision !== snapshot.revision)
    return failure("stale-geometry", "Draft body measurements belong to another revision.", true)
  return {
    ok: true,
    cache: { kind: "body-measurements", draftId, revision: snapshot.revision, evidence },
  }
}

async function readTopologyCache(
  query: ModelBodyTopologyQuery,
  snapshot: DocumentSnapshot,
  draftId: string,
  geometry: DraftGeometryPort,
  cache: DraftBodyCache | null,
): Promise<{ ok: true; cache: DraftBodyCache } | Failure> {
  if (cache?.kind === "body-topology" && sameTopologyTarget(cache.evidence, query))
    return { ok: true, cache }
  if (query.cursor !== null)
    return failure(
      "stale-geometry",
      "The draft topology cursor is unavailable; restart paging.",
      true,
    )
  if (!geometry.inspectBodyTopology)
    return failure("geometry-unavailable", "Exact draft body topology is unavailable.", true)
  const result = await readTopologyEvidence(snapshot, query, geometry.inspectBodyTopology)
  if (!result.ok) return result
  const evidence = result.evidence
  return {
    ok: true,
    cache: { kind: "body-topology", draftId, revision: snapshot.revision, evidence },
  }
}

function sameSnapshot(
  evidence: { documentId: string; revision: number },
  snapshot: DocumentSnapshot,
) {
  return evidence.documentId === snapshot.id && evidence.revision === snapshot.revision
}
function sameTopologyTarget(evidence: ModelBodyTopologyEvidence, query: ModelBodyTopologyQuery) {
  return (
    evidence.featureId === query.featureId &&
    evidence.outputRole === query.outputRole &&
    evidence.kind === query.topologyKind
  )
}

async function readTopologyEvidence(
  snapshot: DocumentSnapshot,
  query: ModelBodyTopologyQuery,
  inspect: NonNullable<DraftGeometryPort["inspectBodyTopology"]>,
): Promise<{ ok: true; evidence: ModelBodyTopologyEvidence } | Failure> {
  const result = modelBodyTopologyEvidenceResultSchema.safeParse(
    await inspect(documentSnapshotSchema.parse(snapshot), query),
  )
  if (!result.success)
    return failure("invalid-geometry-evidence", "Invalid draft topology evidence.")
  if (!result.data.ok)
    return failure(result.data.code, "Draft topology could not be prepared.", true)
  const bounded = automationDraftBodyTopologyEvidenceSchema.safeParse(result.data.evidence)
  if (!bounded.success)
    return failure("query-result-too-large", "Draft topology exceeds the 4 MiB catalog limit.")
  const evidence = bounded.data
  if (!sameSnapshot(evidence, snapshot) || !sameTopologyTarget(evidence, query))
    return failure(
      "stale-geometry",
      "Draft topology does not match the requested body and revision.",
      true,
    )
  return { ok: true, evidence }
}
