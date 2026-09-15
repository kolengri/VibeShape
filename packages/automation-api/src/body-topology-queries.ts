import { bodyOutputRoleSchema } from "@vibeshape/domain/body-reference"
import type { DocumentSnapshot } from "@vibeshape/domain/document"
import { documentIdSchema, featureIdSchema, revisionSchema } from "@vibeshape/domain/identifiers"
import {
  bodyTopoRefSchema,
  createBodyTopologyReferenceProjector,
  createBodyTopologyReferenceResolver,
  type ModelBodyTopologyEvidence,
  modelBodyTopologyEvidenceResultSchema,
} from "@vibeshape/domain/model-body-topology"
import { z } from "zod"
import type { DerivedQueryContext, QueryDiagnosticCode, QueryResult } from "./queries"
import { serializedQueryBytes } from "./query-byte-budget"

const topologyKindSchema = z.enum(["edge", "face"])
const provenanceShape = {
  documentId: documentIdSchema,
  revision: revisionSchema,
  generation: revisionSchema,
  rebuildId: z.string().min(1).max(128),
  featureId: featureIdSchema,
  contentHash: z.string().regex(/^[a-f0-9]{64}$/),
  outputRole: bodyOutputRoleSchema,
  topologyKind: topologyKindSchema,
}
const cursorSchema = z
  .object({ ...provenanceShape, offset: z.number().int().min(0).max(10_000) })
  .strict()

export const modelBodyTopologyArgumentsSchema = z
  .object({
    revision: revisionSchema,
    featureId: featureIdSchema,
    outputRole: bodyOutputRoleSchema,
    topologyKind: topologyKindSchema,
    cursor: cursorSchema.nullable().default(null),
    limit: z.number().int().min(1).max(100).default(20),
  })
  .strict()

export const modelBodyTopologyQuerySchema = modelBodyTopologyArgumentsSchema.extend({
  kind: z.literal("org.vibeshape.model.body-topology"),
  schemaVersion: z.literal(1),
  documentId: documentIdSchema,
})
export type ModelBodyTopologyQuery = z.infer<typeof modelBodyTopologyQuerySchema>

const bodyTopologyViewBaseSchema = z
  .object({
    ...provenanceShape,
    kind: z.literal("org.vibeshape.model.body-topology"),
    schemaVersion: z.literal(1),
    classification: z.literal("derived"),
    nextCursor: cursorSchema.nullable(),
    data: z
      .object({
        topology: z
          .array(
            z
              .object({
                reference: bodyTopoRefSchema,
                resolution: z.enum(["resolved", "ambiguous", "missing"]),
              })
              .strict(),
          )
          .max(100),
        total: z.number().int().min(0).max(10_000),
      })
      .strict(),
  })
  .strict()

type Provenance = Pick<z.infer<typeof cursorSchema>, keyof typeof provenanceShape>
function sameProvenance(left: Provenance, right: Provenance) {
  return (Object.keys(provenanceShape) as (keyof Provenance)[]).every(
    (key) => left[key] === right[key],
  )
}

export const modelBodyTopologyViewSchema = bodyTopologyViewBaseSchema
  .refine(
    (view) =>
      view.data.topology.every(
        ({ reference }) =>
          reference.featureId === view.featureId &&
          reference.outputRole === view.outputRole &&
          reference.kind === view.topologyKind,
      ),
    "Every topology reference must belong to the inspected body and kind.",
  )
  .refine(
    (view) =>
      view.nextCursor === null ||
      (sameProvenance(view.nextCursor, view) && view.nextCursor.offset < view.data.total),
    "The next cursor must belong to the same body topology result.",
  )
export type ModelBodyTopologyView = z.infer<typeof modelBodyTopologyViewSchema>

function failure(
  code: QueryDiagnosticCode,
  message: string,
  retryable = false,
): Extract<QueryResult, { ok: false }> {
  return { ok: false, diagnostic: { code, message, retryable, issues: [] } }
}

export function queryModelBodyTopology(
  snapshot: DocumentSnapshot | null,
  input: unknown,
  context?: DerivedQueryContext,
): QueryResult {
  const parsed = modelBodyTopologyQuerySchema.safeParse(input)
  if (!parsed.success) return failure("invalid-query", "The body topology query is invalid.")
  const query = parsed.data
  const documentFailure = validateDocument(snapshot, query)
  if (documentFailure) return documentFailure
  if (context?.bodyTopology === undefined)
    return failure("geometry-unavailable", "Exact body topology evidence is unavailable.", true)
  const result = modelBodyTopologyEvidenceResultSchema.safeParse(context.bodyTopology)
  if (!result.success)
    return failure("invalid-geometry-evidence", "The supplied body topology evidence is invalid.")
  if (!result.data.ok)
    return failure(result.data.code, "Exact body topology could not be prepared.", true)
  return evidencePage(query, result.data.evidence)
}

function validateDocument(snapshot: DocumentSnapshot | null, query: ModelBodyTopologyQuery) {
  if (!snapshot) return failure("document-not-found", "The requested document was not found.")
  if (snapshot.id !== query.documentId)
    return failure(
      "document-id-mismatch",
      "The query document does not match the supplied snapshot.",
    )
  if (snapshot.revision !== query.revision)
    return failure("stale-query-revision", "The requested revision is no longer current.", true)
  const feature = snapshot.features.find(({ id }) => id === query.featureId)
  if (!feature) return failure("feature-not-found", "The requested feature does not exist.")
  if (feature.suppressed)
    return failure("geometry-unavailable", "The requested feature is suppressed.")
  return null
}

function evidenceProvenance(evidence: ModelBodyTopologyEvidence): Provenance {
  return {
    documentId: evidence.documentId,
    revision: evidence.revision,
    generation: evidence.generation,
    rebuildId: evidence.rebuildId,
    featureId: evidence.featureId,
    contentHash: evidence.contentHash,
    outputRole: evidence.outputRole,
    topologyKind: evidence.kind,
  }
}

function matchesTarget(query: ModelBodyTopologyQuery, evidence: ModelBodyTopologyEvidence) {
  return (
    evidence.featureId === query.featureId &&
    evidence.outputRole === query.outputRole &&
    evidence.kind === query.topologyKind
  )
}

function evidencePage(
  query: ModelBodyTopologyQuery,
  evidence: ModelBodyTopologyEvidence,
): QueryResult {
  if (evidence.documentId !== query.documentId || evidence.revision !== query.revision)
    return failure(
      "stale-geometry",
      "The body topology evidence belongs to another document or revision.",
      true,
    )
  if (!matchesTarget(query, evidence))
    return failure("invalid-geometry-evidence", "Body topology evidence belongs to another target.")
  const provenance = evidenceProvenance(evidence)
  if (query.cursor && !sameProvenance(query.cursor, provenance))
    return failure(
      "stale-geometry",
      "The topology cursor belongs to another body or rebuild; restart from the first page.",
      true,
    )
  const offset = query.cursor?.offset ?? 0
  if (offset > evidence.candidates.length)
    return failure("invalid-query", "The cursor is outside the current body topology result.")
  return topologyPage(query, evidence, provenance, offset)
}

function topologyPage(
  query: ModelBodyTopologyQuery,
  evidence: ModelBodyTopologyEvidence,
  provenance: Provenance,
  offset: number,
): QueryResult {
  const project = createBodyTopologyReferenceProjector(evidence)
  const resolve = createBodyTopologyReferenceResolver(evidence)
  const topology = evidence.candidates.slice(offset, offset + query.limit).map((candidate) => {
    const reference = project(candidate)
    return { reference, resolution: resolve(reference).status }
  })
  const next = offset + topology.length
  const view = modelBodyTopologyViewSchema.parse({
    ...provenance,
    kind: query.kind,
    schemaVersion: 1,
    classification: "derived",
    nextCursor: next < evidence.candidates.length ? { ...provenance, offset: next } : null,
    data: { topology, total: evidence.candidates.length },
  })
  if (serializedQueryBytes(view) > 128 * 1024)
    return failure(
      "query-result-too-large",
      "The body topology page is too large; reduce the page limit.",
      true,
    )
  return { ok: true, view }
}
