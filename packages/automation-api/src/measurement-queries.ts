import { readDatumPlaneFeatureParameters, terminalFeatureIds } from "@vibeshape/domain"
import type { DocumentSnapshot } from "@vibeshape/domain/document"
import { documentIdSchema, featureIdSchema, revisionSchema } from "@vibeshape/domain/identifiers"
import {
  modelMeasurementEntrySchema,
  modelMeasurementEvidenceSchema,
} from "@vibeshape/domain/model-measurements"
import { z } from "zod"
import type { DerivedQueryContext, QueryDiagnosticCode, QueryResult } from "./queries"

const cursorSchema = z
  .string()
  .regex(/^(0|[1-9]\d{0,5})$/)
  .nullable()

export const modelMeasurementQuerySchema = z
  .object({
    kind: z.literal("org.vibeshape.model.measurements"),
    schemaVersion: z.literal(1),
    documentId: documentIdSchema,
    revision: revisionSchema,
    featureId: featureIdSchema.optional(),
    cursor: cursorSchema.default(null),
    limit: z.number().int().min(1).max(200).default(20),
  })
  .strict()

const label = { label: z.string().min(1).max(120).optional() }
const labeledEntrySchema = z.discriminatedUnion("status", [
  modelMeasurementEntrySchema.options[0].extend(label),
  modelMeasurementEntrySchema.options[1].extend(label),
  modelMeasurementEntrySchema.options[2].extend(label),
  modelMeasurementEntrySchema.options[3].extend(label),
])

export const modelMeasurementViewSchema = z
  .object({
    kind: z.literal("org.vibeshape.model.measurements"),
    schemaVersion: z.literal(1),
    documentId: documentIdSchema,
    revision: revisionSchema,
    generation: revisionSchema,
    classification: z.literal("derived"),
    nextCursor: cursorSchema,
    units: z
      .object({ length: z.literal("mm"), area: z.literal("mm2"), volume: z.literal("mm3") })
      .strict(),
    data: z
      .object({
        features: z.array(labeledEntrySchema).max(200),
        total: z.number().int().min(0).max(100_000),
      })
      .strict(),
  })
  .strict()

export type ModelMeasurementQuery = z.infer<typeof modelMeasurementQuerySchema>
export type ModelMeasurementView = z.infer<typeof modelMeasurementViewSchema>

function failure(
  code: QueryDiagnosticCode,
  message: string,
  retryable = false,
): Extract<QueryResult, { ok: false }> {
  return { ok: false, diagnostic: { code, message, retryable, issues: [] } }
}

function requestedFeatures(snapshot: DocumentSnapshot, query: ModelMeasurementQuery) {
  if (query.featureId) {
    const feature = snapshot.features.find((feature) => feature.id === query.featureId)
    if (!feature) return failure("feature-not-found", "The requested feature does not exist.")
    if (readDatumPlaneFeatureParameters(feature) !== null)
      return failure(
        "feature-not-measurable",
        "Construction plane display geometry cannot be measured as a model output.",
      )
    return { ok: true as const, features: [feature] }
  }
  const terminal = terminalFeatureIds(snapshot.features)
  return {
    ok: true as const,
    features: snapshot.features.filter((feature) => terminal.has(feature.id)),
  }
}

export function queryModelMeasurements(
  snapshot: DocumentSnapshot | null,
  input: unknown,
  context?: DerivedQueryContext,
): QueryResult {
  const query = modelMeasurementQuerySchema.safeParse(input)
  if (!query.success) return failure("invalid-query", "The model measurement query is invalid.")
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
  if (context?.measurements === undefined)
    return failure(
      "geometry-unavailable",
      "Exact measurements are not available for this document.",
      true,
    )
  const evidence = modelMeasurementEvidenceSchema.safeParse(context.measurements)
  if (!evidence.success)
    return failure("invalid-geometry-evidence", "The supplied measurement evidence is invalid.")
  if (evidence.data.documentId !== snapshot.id || evidence.data.revision !== snapshot.revision)
    return failure(
      "stale-geometry",
      "Exact measurements belong to another document or revision.",
      true,
    )
  return measurementPage(snapshot, query.data, evidence.data)
}

function measurementPage(
  snapshot: DocumentSnapshot,
  query: ModelMeasurementQuery,
  evidence: z.infer<typeof modelMeasurementEvidenceSchema>,
): QueryResult {
  const entries = new Map(evidence.features.map((entry) => [entry.featureId, entry]))
  if (
    entries.size !== snapshot.features.length ||
    snapshot.features.some((feature) => !entries.has(feature.id))
  )
    return failure(
      "invalid-geometry-evidence",
      "Measurement evidence must cover exactly the current features.",
    )
  const requested = requestedFeatures(snapshot, query)
  if (!requested.ok) return requested
  const { features } = requested
  const cursor = Number(query.cursor ?? 0)
  if (cursor > features.length)
    return failure("invalid-query", "The model measurement cursor is outside the current result.")
  const page = features.slice(cursor, cursor + query.limit).map((feature) => ({
    ...entries.get(feature.id),
    ...(feature.label ? { label: feature.label } : {}),
  }))
  const next = cursor + page.length
  const view = modelMeasurementViewSchema.safeParse({
    kind: query.kind,
    schemaVersion: 1,
    documentId: snapshot.id,
    revision: snapshot.revision,
    generation: evidence.generation,
    classification: "derived",
    nextCursor: next < features.length ? String(next) : null,
    units: { length: "mm", area: "mm2", volume: "mm3" },
    data: { features: page, total: features.length },
  })
  return view.success
    ? { ok: true, view: view.data }
    : failure("invalid-geometry-evidence", "The bounded measurement view is invalid.")
}
