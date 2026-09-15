import type { DocumentSnapshot } from "@vibeshape/domain/document"
import { documentIdSchema, featureIdSchema, revisionSchema } from "@vibeshape/domain/identifiers"
import {
  createEdgeReferenceProjector,
  modelEdgeEvidenceResultSchema,
  modelEdgeEvidenceSchema,
} from "@vibeshape/domain/model-edges"
import { createTopologyReferenceResolver, edgeTopoRefSchema } from "@vibeshape/domain/topology"
import { z } from "zod"
import type { DerivedQueryContext, QueryDiagnosticCode, QueryResult } from "./queries"
import { serializedQueryBytes } from "./query-byte-budget"

const cursorSchema = z
  .object({
    rebuildId: modelEdgeEvidenceSchema.shape.rebuildId,
    featureId: featureIdSchema,
    offset: z.number().int().min(0).max(10_000),
  })
  .strict()
  .nullable()
export const modelEdgeQuerySchema = z
  .object({
    kind: z.literal("org.vibeshape.model.edges"),
    schemaVersion: z.literal(1),
    documentId: documentIdSchema,
    revision: revisionSchema,
    featureId: featureIdSchema,
    cursor: cursorSchema.default(null),
    limit: z.number().int().min(1).max(100).default(20),
  })
  .strict()
export const modelEdgeViewSchema = z
  .object({
    kind: z.literal("org.vibeshape.model.edges"),
    schemaVersion: z.literal(1),
    documentId: documentIdSchema,
    revision: revisionSchema,
    generation: revisionSchema,
    rebuildId: modelEdgeEvidenceSchema.shape.rebuildId,
    featureId: featureIdSchema,
    contentHash: modelEdgeEvidenceSchema.shape.contentHash,
    classification: z.literal("derived"),
    nextCursor: cursorSchema,
    data: z
      .object({
        edges: z
          .array(
            z
              .object({
                reference: edgeTopoRefSchema,
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
  .refine(
    (view) => view.data.edges.every((edge) => edge.reference.featureId === view.featureId),
    "Every edge must belong to the inspected feature.",
  )
  .refine(
    (view) =>
      view.nextCursor === null ||
      (view.nextCursor.rebuildId === view.rebuildId &&
        view.nextCursor.featureId === view.featureId &&
        view.nextCursor.offset < view.data.total),
    "The next cursor must belong to the same geometry result.",
  )
export type ModelEdgeQuery = z.infer<typeof modelEdgeQuerySchema>
export type ModelEdgeView = z.infer<typeof modelEdgeViewSchema>

function failure(
  code: QueryDiagnosticCode,
  message: string,
  retryable = false,
): Extract<QueryResult, { ok: false }> {
  return { ok: false, diagnostic: { code, message, retryable, issues: [] } }
}

export function queryModelEdges(
  snapshot: DocumentSnapshot | null,
  input: unknown,
  context?: DerivedQueryContext,
): QueryResult {
  const query = modelEdgeQuerySchema.safeParse(input)
  if (!query.success) return failure("invalid-query", "The model edge query is invalid.")
  if (!snapshot) return failure("document-not-found", "The requested document was not found.")
  if (snapshot.id !== query.data.documentId)
    return failure(
      "document-id-mismatch",
      "The query document does not match the supplied snapshot.",
    )
  if (snapshot.revision !== query.data.revision)
    return failure(
      "stale-query-revision",
      "The requested document revision is no longer current.",
      true,
    )
  if (!snapshot.features.some((feature) => feature.id === query.data.featureId))
    return failure("feature-not-found", "The requested feature does not exist.")
  return edgeEvidencePage(query.data, context)
}

function edgeEvidencePage(query: ModelEdgeQuery, context?: DerivedQueryContext): QueryResult {
  if (context?.edges === undefined)
    return failure("geometry-unavailable", "Exact edge evidence is unavailable.", true)
  const result = modelEdgeEvidenceResultSchema.safeParse(context.edges)
  if (!result.success)
    return failure("invalid-geometry-evidence", "The supplied edge evidence is invalid.")
  if (!result.data.ok)
    return failure(result.data.code, "Exact edge evidence could not be prepared.", true)
  const evidence = result.data.evidence
  if (evidence.documentId !== query.documentId || evidence.revision !== query.revision)
    return failure(
      "stale-geometry",
      "The edge evidence belongs to another document or revision.",
      true,
    )
  if (evidence.featureId !== query.featureId)
    return failure("invalid-geometry-evidence", "Edge evidence belongs to another feature.")
  return edgePage(query, evidence)
}

function edgePage(
  query: ModelEdgeQuery,
  evidence: z.infer<typeof modelEdgeEvidenceSchema>,
): QueryResult {
  if (
    query.cursor &&
    (query.cursor.rebuildId !== evidence.rebuildId || query.cursor.featureId !== query.featureId)
  )
    return failure(
      "stale-geometry",
      "The edge cursor belongs to another geometry result; restart from the first page.",
      true,
    )
  const cursor = query.cursor?.offset ?? 0
  if (cursor > evidence.candidates.length)
    return failure("invalid-query", "The edge cursor is outside the current result.")
  const project = createEdgeReferenceProjector(query.featureId, evidence.candidates)
  const resolve = createTopologyReferenceResolver(evidence.candidates)
  const edges = evidence.candidates.slice(cursor, cursor + query.limit).map((candidate) => {
    const reference = project(candidate)
    return { reference, resolution: resolve(reference).status }
  })
  const next = cursor + edges.length
  const view = {
    kind: query.kind,
    schemaVersion: 1,
    documentId: query.documentId,
    revision: query.revision,
    generation: evidence.generation,
    rebuildId: evidence.rebuildId,
    featureId: query.featureId,
    contentHash: evidence.contentHash,
    classification: "derived",
    nextCursor:
      next < evidence.candidates.length
        ? { rebuildId: evidence.rebuildId, featureId: query.featureId, offset: next }
        : null,
    data: { edges, total: evidence.candidates.length },
  }
  if (serializedQueryBytes(view) > 128 * 1024)
    return failure(
      "query-result-too-large",
      "The edge page exceeds 128 KiB; reduce the page limit.",
      true,
    )
  return { ok: true, view: modelEdgeViewSchema.parse(view) }
}
