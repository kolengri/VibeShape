import { readDatumPlaneFeatureParameters } from "@vibeshape/domain"
import { bodyOutputRoleSchema } from "@vibeshape/domain/body-reference"
import type { DocumentSnapshot } from "@vibeshape/domain/document"
import { documentIdSchema, featureIdSchema, revisionSchema } from "@vibeshape/domain/identifiers"
import { terminalBodyOutputs } from "@vibeshape/domain/model-bodies"
import type { ModelBodyMeasurementEntry } from "@vibeshape/domain/model-body-measurements"
import {
  bodyMeasurementOutputs,
  modelBodyMeasurementEntrySchema,
  modelBodyMeasurementEvidenceSchema,
} from "@vibeshape/domain/model-body-measurements"
import { z } from "zod"
import type { DerivedQueryContext, QueryDiagnosticCode, QueryResult } from "./queries"
import { serializedQueryBytes } from "./query-byte-budget"

const cursorSchema = z
  .string()
  .regex(/^(0|[1-9]\d{0,5})$/)
  .nullable()

const modelBodyMeasurementArgumentsBaseSchema = z
  .object({
    revision: revisionSchema,
    featureId: featureIdSchema.optional(),
    outputRole: bodyOutputRoleSchema.optional(),
    cursor: cursorSchema.default(null),
    limit: z.number().int().min(1).max(200).default(20),
  })
  .strict()

function refineBodyMeasurementArguments(
  query: { outputRole?: string | undefined; featureId?: string | undefined },
  context: z.RefinementCtx,
) {
  if (query.outputRole !== undefined && query.featureId === undefined) {
    context.addIssue({
      code: "custom",
      path: ["featureId"],
      message: "outputRole requires featureId.",
    })
  }
}

export const modelBodyMeasurementArgumentsSchema =
  modelBodyMeasurementArgumentsBaseSchema.superRefine(refineBodyMeasurementArguments)

export const modelBodyMeasurementQuerySchema = modelBodyMeasurementArgumentsBaseSchema
  .safeExtend({
    kind: z.literal("org.vibeshape.model.body-measurements"),
    schemaVersion: z.literal(1),
    documentId: documentIdSchema,
  })
  .superRefine(refineBodyMeasurementArguments)

const labeledBodySchema = modelBodyMeasurementEntrySchema.safeExtend({
  label: z.string().min(1).max(120).optional(),
})

export const modelBodyMeasurementViewSchema = z
  .object({
    kind: z.literal("org.vibeshape.model.body-measurements"),
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
        bodies: z.array(labeledBodySchema).max(200),
        total: z.number().int().min(0).max(100_000),
      })
      .strict(),
  })
  .strict()

export type ModelBodyMeasurementQuery = z.infer<typeof modelBodyMeasurementQuerySchema>
export type ModelBodyMeasurementView = z.infer<typeof modelBodyMeasurementViewSchema>

const MAX_SERIALIZED_BYTES = 128 * 1024

function failure(
  code: QueryDiagnosticCode,
  message: string,
  retryable = false,
): Extract<QueryResult, { ok: false }> {
  return { ok: false, diagnostic: { code, message, retryable, issues: [] } }
}

export function queryModelBodyMeasurements(
  snapshot: DocumentSnapshot | null,
  input: unknown,
  context?: DerivedQueryContext,
): QueryResult {
  const validated = validateBodyMeasurementRequest(snapshot, input, context)
  if (!validated.ok) return validated.result
  if (!snapshot) return failure("document-not-found", "The requested document was not found.")
  const selected = selectBodyMeasurementOutputs(snapshot, validated.query, validated.evidence)
  if (!selected.ok) return selected.result
  return bodyMeasurementPage(
    snapshot,
    validated.query,
    validated.evidence.generation,
    selected.bodies,
  )
}

function validateBodyMeasurementRequest(
  snapshot: DocumentSnapshot | null,
  input: unknown,
  context?: DerivedQueryContext,
) {
  const query = parseBodyMeasurementQuery(input)
  if (!query.ok) return query
  const document = validateBodyMeasurementDocument(snapshot, query.query)
  if (!document.ok) return document
  const evidence = validateBodyMeasurementEvidence(context, document.snapshot)
  if (!evidence.ok) return evidence
  return { ok: true as const, query: query.query, evidence: evidence.evidence }
}

function parseBodyMeasurementQuery(input: unknown) {
  const parsed = modelBodyMeasurementQuerySchema.safeParse(input)
  return parsed.success
    ? { ok: true as const, query: parsed.data }
    : {
        ok: false as const,
        result: failure("invalid-query", "The body measurement query is invalid."),
      }
}

function validateBodyMeasurementDocument(
  snapshot: DocumentSnapshot | null,
  query: ModelBodyMeasurementQuery,
) {
  if (!snapshot)
    return {
      ok: false as const,
      result: failure("document-not-found", "The requested document was not found."),
    }
  if (snapshot.id !== query.documentId)
    return {
      ok: false as const,
      result: failure(
        "document-id-mismatch",
        "The query document does not match the supplied snapshot.",
      ),
    }
  if (snapshot.revision !== query.revision)
    return {
      ok: false as const,
      result: failure(
        "stale-query-revision",
        "The requested document revision is no longer current.",
        true,
      ),
    }
  return { ok: true as const, snapshot }
}

function validateBodyMeasurementEvidence(
  context: DerivedQueryContext | undefined,
  snapshot: DocumentSnapshot,
) {
  if (context?.bodyMeasurements === undefined)
    return {
      ok: false as const,
      result: failure(
        "geometry-unavailable",
        "Exact body measurements are not available for this document.",
        true,
      ),
    }
  const evidence = modelBodyMeasurementEvidenceSchema.safeParse(context.bodyMeasurements)
  if (!evidence.success)
    return {
      ok: false as const,
      result: failure(
        "invalid-geometry-evidence",
        "The supplied body measurement evidence is invalid.",
      ),
    }
  if (evidence.data.documentId !== snapshot.id || evidence.data.revision !== snapshot.revision)
    return {
      ok: false as const,
      result: failure(
        "stale-geometry",
        "Exact body measurements belong to another document or revision.",
        true,
      ),
    }
  return { ok: true as const, evidence: evidence.data }
}

function selectBodyMeasurementOutputs(
  snapshot: DocumentSnapshot,
  query: ModelBodyMeasurementQuery,
  evidence: z.infer<typeof modelBodyMeasurementEvidenceSchema>,
) {
  const feature = requestedBodyFeature(snapshot, query)
  if (!feature.ok) return feature
  const byFeature = bodyMeasurementOutputs(snapshot.features, evidence)
  if (!byFeature)
    return {
      ok: false as const,
      result: failure("invalid-geometry-evidence", "Body measurement evidence is incomplete."),
    }
  const terminal = terminalBodyOutputs(snapshot.features, byFeature)
  if (!terminal)
    return {
      ok: false as const,
      result: failure("invalid-geometry-evidence", "Body measurement evidence is incomplete."),
    }
  const selected = query.featureId ? (byFeature.get(query.featureId) ?? []) : terminal
  return pickBodyMeasurementRole(query, selected)
}

function requestedBodyFeature(snapshot: DocumentSnapshot, query: ModelBodyMeasurementQuery) {
  const feature = query.featureId
    ? snapshot.features.find(({ id }) => id === query.featureId)
    : undefined
  if (query.featureId && !feature)
    return {
      ok: false as const,
      result: failure("feature-not-found", "The requested feature does not exist."),
    }
  if (feature && readDatumPlaneFeatureParameters(feature) !== null)
    return {
      ok: false as const,
      result: failure(
        "feature-not-measurable",
        "Construction plane display geometry cannot be measured as a model body.",
      ),
    }
  return { ok: true as const, feature }
}

function pickBodyMeasurementRole(
  query: ModelBodyMeasurementQuery,
  selected: readonly ModelBodyMeasurementEntry[],
) {
  if (query.featureId && selected.length === 0)
    return {
      ok: false as const,
      result: failure(
        "geometry-unavailable",
        "Exact body measurements are not available for the requested feature.",
        true,
      ),
    }
  const bodies =
    query.outputRole === undefined
      ? selected
      : selected.filter((entry) => entry.outputRole === query.outputRole)
  return query.outputRole !== undefined && bodies.length === 0
    ? {
        ok: false as const,
        result: failure("body-not-found", "The requested body output role does not exist."),
      }
    : { ok: true as const, bodies }
}

function bodyMeasurementPage(
  snapshot: DocumentSnapshot,
  query: ModelBodyMeasurementQuery,
  generation: number,
  bodies: readonly ModelBodyMeasurementEntry[],
): QueryResult {
  const cursor = Number(query.cursor ?? 0)
  if (!Number.isSafeInteger(cursor) || cursor < 0 || cursor > bodies.length)
    return failure("invalid-query", "The body measurement cursor is outside the current result.")

  const page = bodies.slice(cursor, cursor + query.limit).map((entry) => {
    const feature = snapshot.features.find(({ id }) => id === entry.featureId)
    return feature?.label ? { ...entry, label: feature.label } : entry
  })
  const nextIndex = cursor + page.length
  const view = {
    kind: query.kind,
    schemaVersion: query.schemaVersion,
    documentId: snapshot.id,
    revision: snapshot.revision,
    generation,
    classification: "derived" as const,
    nextCursor: nextIndex < bodies.length ? String(nextIndex) : null,
    units: { length: "mm" as const, area: "mm2" as const, volume: "mm3" as const },
    data: { bodies: page, total: bodies.length },
  }
  if (serializedQueryBytes(view, MAX_SERIALIZED_BYTES) > MAX_SERIALIZED_BYTES)
    return failure(
      "query-result-too-large",
      "The body measurement query result is too large; reduce the page limit.",
      true,
    )
  const parsed = modelBodyMeasurementViewSchema.safeParse(view)
  return parsed.success
    ? { ok: true, view: parsed.data }
    : failure("invalid-geometry-evidence", "The bounded body measurement view is invalid.")
}
