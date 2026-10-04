import type { DocumentSnapshot } from "@vibeshape/domain/document"
import {
  documentIdSchema,
  revisionSchema,
  sketchConstraintIdSchema,
  sketchIdSchema,
} from "@vibeshape/domain/identifiers"
import {
  sketchSolutionCircleSchema,
  sketchSolutionDiagnosticSchema,
  sketchSolutionEvidenceMatchesDocument,
  sketchSolutionEvidenceSchema,
  sketchSolutionPointSchema,
  sketchSolutionProfileSchema,
  sketchSolutionSummarySchema,
} from "@vibeshape/domain/sketch-solution-evidence"
import { z } from "zod"
import type { DerivedQueryContext, QueryDiagnosticCode, QueryResult } from "./queries"
import { serializedQueryBytes } from "./query-byte-budget"

const sketchSolutionCursorSchema = z
  .object({
    inspectionId: z.uuid(),
    section: z.enum(["points", "circles", "failed-constraints", "profiles", "diagnostics"]),
    offset: z.number().int().min(0).max(10000),
  })
  .strict()
  .nullable()
export const sketchSolutionArgumentsSchema = z
  .object({
    revision: revisionSchema,
    sketchId: sketchIdSchema,
    section: z
      .enum(["points", "circles", "failed-constraints", "profiles", "diagnostics"])
      .default("profiles"),
    cursor: sketchSolutionCursorSchema.default(null),
    limit: z.number().int().min(1).max(200).default(20),
  })
  .strict()
export const sketchSolutionQuerySchema = sketchSolutionArgumentsSchema.extend({
  kind: z.literal("org.vibeshape.sketch.solution"),
  schemaVersion: z.literal(1),
  documentId: documentIdSchema,
})
const count = z.number().int().min(0).max(10000)
const sectionDataSchema = z.discriminatedUnion("section", [
  z
    .object({
      section: z.literal("points"),
      items: z.array(sketchSolutionPointSchema).max(200),
      total: count,
    })
    .strict(),
  z
    .object({
      section: z.literal("circles"),
      items: z.array(sketchSolutionCircleSchema).max(200),
      total: count,
    })
    .strict(),
  z
    .object({
      section: z.literal("failed-constraints"),
      items: z.array(sketchConstraintIdSchema).max(200),
      total: count,
    })
    .strict(),
  z
    .object({
      section: z.literal("profiles"),
      items: z.array(sketchSolutionProfileSchema).max(200),
      total: count,
    })
    .strict(),
  z
    .object({
      section: z.literal("diagnostics"),
      items: z.array(sketchSolutionDiagnosticSchema).max(200),
      total: count,
    })
    .strict(),
])
export const sketchSolutionViewSchema = z
  .object({
    kind: z.literal("org.vibeshape.sketch.solution"),
    schemaVersion: z.literal(1),
    documentId: documentIdSchema,
    revision: revisionSchema,
    generation: revisionSchema,
    classification: z.literal("derived"),
    inspectionId: z.uuid(),
    sketchId: sketchIdSchema,
    summary: sketchSolutionSummarySchema,
    counts: z
      .object({
        points: count,
        circles: count,
        failedConstraints: count,
        profiles: count,
        diagnostics: count,
      })
      .strict(),
    units: z.object({ length: z.literal("mm"), area: z.literal("mm2") }).strict(),
    nextCursor: sketchSolutionCursorSchema,
    data: sectionDataSchema,
  })
  .strict()
  .refine(
    (view) =>
      view.data.section !== "profiles" ||
      view.data.items.every(({ selector }) => selector.sketchId === view.sketchId),
    "Profile selectors must belong to the inspected sketch.",
  )
export type SketchSolutionQuery = z.infer<typeof sketchSolutionQuerySchema>
export type SketchSolutionView = z.infer<typeof sketchSolutionViewSchema>
export function sketchSolutionPageMatches(
  view: SketchSolutionView,
  argumentsInput: z.infer<typeof sketchSolutionArgumentsSchema>,
) {
  return (
    view.revision === argumentsInput.revision &&
    view.sketchId === argumentsInput.sketchId &&
    view.data.section === argumentsInput.section &&
    cursorMatches(argumentsInput, view.inspectionId) &&
    pageCardinalityMatches(view, argumentsInput)
  )
}
function pageCardinalityMatches(
  view: SketchSolutionView,
  argumentsInput: z.infer<typeof sketchSolutionArgumentsSchema>,
) {
  const counts = {
    points: view.counts.points,
    circles: view.counts.circles,
    "failed-constraints": view.counts.failedConstraints,
    profiles: view.counts.profiles,
    diagnostics: view.counts.diagnostics,
  }
  const offset = argumentsInput.cursor?.offset ?? 0
  const next = offset + view.data.items.length
  return (
    view.data.total === counts[view.data.section] &&
    offset <= view.data.total &&
    view.data.items.length === Math.min(argumentsInput.limit, view.data.total - offset) &&
    nextCursorMatches(view, next)
  )
}
function nextCursorMatches(view: SketchSolutionView, next: number) {
  if (view.nextCursor === null) return next === view.data.total
  return (
    next < view.data.total &&
    view.nextCursor.inspectionId === view.inspectionId &&
    view.nextCursor.section === view.data.section &&
    view.nextCursor.offset === next
  )
}
function failure(
  code: QueryDiagnosticCode,
  message: string,
  retryable = false,
): Extract<QueryResult, { ok: false }> {
  return { ok: false, diagnostic: { code, message, retryable, issues: [] } }
}
export function querySketchSolution(
  snapshot: DocumentSnapshot | null,
  input: unknown,
  context?: DerivedQueryContext,
): QueryResult {
  const query = sketchSolutionQuerySchema.safeParse(input)
  if (!query.success) return failure("invalid-query", "The sketch solution query is invalid.")
  if (!snapshot) return failure("document-not-found", "The requested document was not found.")
  if (snapshot.id !== query.data.documentId)
    return failure(
      "document-id-mismatch",
      "The requested document does not match the supplied snapshot.",
    )
  if (snapshot.revision !== query.data.revision)
    return failure(
      "stale-query-revision",
      "The requested document revision is no longer current.",
      true,
    )
  if (!snapshot.sketches.some(({ id }) => id === query.data.sketchId))
    return failure("sketch-not-found", "The requested sketch does not exist.")
  return solutionPage(snapshot, query.data, context?.sketchSolution)
}
function solutionPage(
  snapshot: DocumentSnapshot,
  query: SketchSolutionQuery,
  input: unknown,
): QueryResult {
  const checked = validatedSolution(snapshot, query, input)
  if (!checked.ok) return checked
  const value = checked.value
  return buildSolutionPage(snapshot, query, value)
}
function validatedSolution(snapshot: DocumentSnapshot, query: SketchSolutionQuery, input: unknown) {
  if (input === undefined)
    return failure("geometry-unavailable", "Solved sketch evidence is unavailable.", true)
  const evidence = sketchSolutionEvidenceSchema.safeParse(input)
  if (!evidence.success)
    return failure("invalid-geometry-evidence", "The supplied solved sketch evidence is invalid.")
  const value = evidence.data
  if (
    value.documentId !== snapshot.id ||
    value.revision !== snapshot.revision ||
    value.sketchId !== query.sketchId
  )
    return failure(
      "stale-geometry",
      "The solved sketch evidence belongs to another sketch or revision.",
      true,
    )
  if (!cursorMatches(query, value.inspectionId))
    return failure(
      "stale-geometry",
      "The sketch solution cursor belongs to an expired inspection.",
      true,
    )
  if (!sketchSolutionEvidenceMatchesDocument(snapshot, value))
    return failure(
      "invalid-geometry-evidence",
      "The solved evidence does not cover the authored sketch entities and constraints.",
    )
  return { ok: true as const, value }
}
function cursorMatches(query: z.infer<typeof sketchSolutionArgumentsSchema>, inspectionId: string) {
  return (
    query.cursor === null ||
    (query.cursor.inspectionId === inspectionId && query.cursor.section === query.section)
  )
}
function buildSolutionPage(
  snapshot: DocumentSnapshot,
  query: SketchSolutionQuery,
  value: import("@vibeshape/domain/sketch-solution-evidence").SketchSolutionEvidence,
): QueryResult {
  const sections = {
    points: value.points,
    circles: value.circles,
    "failed-constraints": value.failedConstraintIds,
    profiles: value.profiles,
    diagnostics: value.diagnostics,
  }
  const items = sections[query.section]
  const offset = query.cursor?.offset ?? 0
  if (offset > items.length)
    return failure("invalid-query", "The sketch solution cursor is outside the current section.")
  const page = items.slice(offset, offset + query.limit)
  const next = offset + page.length
  const result = {
    kind: query.kind,
    schemaVersion: 1,
    documentId: snapshot.id,
    revision: snapshot.revision,
    generation: value.generation,
    classification: "derived",
    inspectionId: value.inspectionId,
    sketchId: value.sketchId,
    summary: value.summary,
    counts: {
      points: value.points.length,
      circles: value.circles.length,
      failedConstraints: value.failedConstraintIds.length,
      profiles: value.profiles.length,
      diagnostics: value.diagnostics.length,
    },
    units: { length: "mm", area: "mm2" },
    nextCursor:
      next < items.length
        ? { inspectionId: value.inspectionId, section: query.section, offset: next }
        : null,
    data: { section: query.section, items: page, total: items.length },
  }
  if (serializedQueryBytes(result, 128 * 1024) > 128 * 1024)
    return failure(
      "query-result-too-large",
      "The solved sketch page exceeds the response budget; reduce the limit.",
      true,
    )
  const parsed = sketchSolutionViewSchema.safeParse(result)
  return parsed.success
    ? { ok: true, view: parsed.data }
    : failure("invalid-geometry-evidence", "The bounded solved sketch view is invalid.")
}
