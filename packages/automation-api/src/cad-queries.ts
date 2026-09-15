import type { DocumentSnapshot } from "@vibeshape/domain/document"
import { featureRecordSchema } from "@vibeshape/domain/feature-graph"
import {
  documentIdSchema,
  featureIdSchema,
  revisionSchema,
  sketchIdSchema,
} from "@vibeshape/domain/identifiers"
import {
  readExtrusionFeatureParameters,
  readRevolveFeatureParameters,
} from "@vibeshape/domain/part-design"
import { sketchRecordSchema } from "@vibeshape/domain/sketch"
import { z } from "zod"
import type { QueryDiagnosticCode, QueryResult } from "./queries"
import { serializedQueryBytes } from "./query-byte-budget"

const MAX_SERIALIZED_DETAIL_BYTES = 128 * 1024
const MAX_SERIALIZED_LIST_BYTES = 128 * 1024
const MAX_SUMMARY_DEPENDENCIES = 256
const cursorSchema = z
  .string()
  .regex(/^(0|[1-9]\d{0,5})$/)
  .nullable()

export const cadInspectionListQuerySchema = z
  .object({
    kind: z.literal("org.vibeshape.cad.inspection.list"),
    schemaVersion: z.literal(1),
    documentId: documentIdSchema,
    revision: revisionSchema,
    cursor: cursorSchema.default(null),
    limit: z.number().int().min(1).max(100).default(100),
  })
  .strict()

const summarySchema = z
  .object({
    kind: z.enum(["feature", "sketch"]),
    id: z.union([featureIdSchema, sketchIdSchema]),
    type: z.string().min(1).max(128),
    label: z.string().min(1).max(120).optional(),
    version: z.number().int().nonnegative().safe(),
    dependencies: z.array(z.union([featureIdSchema, sketchIdSchema])).max(MAX_SUMMARY_DEPENDENCIES),
  })
  .strict()

export const cadInspectionListViewSchema = z
  .object({
    kind: z.literal("org.vibeshape.cad.inspection.list"),
    schemaVersion: z.literal(1),
    documentId: documentIdSchema,
    revision: revisionSchema,
    classification: z.literal("semantic"),
    nextCursor: cursorSchema,
    data: z
      .object({ items: z.array(summarySchema).max(100), total: z.number().int().nonnegative() })
      .strict(),
  })
  .strict()

export const cadInspectionDetailQuerySchema = z
  .object({
    kind: z.literal("org.vibeshape.cad.inspection.detail"),
    schemaVersion: z.literal(1),
    documentId: documentIdSchema,
    revision: revisionSchema,
    entity: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("feature"), id: featureIdSchema }).strict(),
      z.object({ kind: z.literal("sketch"), id: sketchIdSchema }).strict(),
    ]),
  })
  .strict()

export const cadInspectionDetailViewSchema = z
  .object({
    kind: z.literal("org.vibeshape.cad.inspection.detail"),
    schemaVersion: z.literal(1),
    documentId: documentIdSchema,
    revision: revisionSchema,
    classification: z.literal("semantic"),
    data: z.discriminatedUnion("entityKind", [
      z.object({ entityKind: z.literal("feature"), record: featureRecordSchema }).strict(),
      z.object({ entityKind: z.literal("sketch"), record: sketchRecordSchema }).strict(),
    ]),
  })
  .strict()

export type CadInspectionListQuery = z.infer<typeof cadInspectionListQuerySchema>
export type CadInspectionListView = z.infer<typeof cadInspectionListViewSchema>
export type CadInspectionDetailQuery = z.infer<typeof cadInspectionDetailQuerySchema>
export type CadInspectionDetailView = z.infer<typeof cadInspectionDetailViewSchema>

function failure(
  code: QueryDiagnosticCode,
  message: string,
  retryable = false,
): Extract<QueryResult, { ok: false }> {
  return { ok: false, diagnostic: { code, message, retryable, issues: [] } }
}

function documentGuard(snapshot: DocumentSnapshot | null, documentId: string, revision: number) {
  if (!snapshot) return failure("document-not-found", "The requested document was not found.")
  if (snapshot.id !== documentId)
    return failure(
      "document-id-mismatch",
      "The query document does not match the supplied snapshot.",
    )
  if (snapshot.revision !== revision)
    return failure(
      "stale-query-revision",
      "The requested document revision is no longer current.",
      true,
    )
  return { ok: true as const, snapshot }
}

function sketchDependencies(sketch: DocumentSnapshot["sketches"][number]) {
  const dependencies = new Set<string>()
  if (sketch.support) dependencies.add(sketch.support.reference.featureId)
  for (const reference of sketch.externalReferences ?? []) {
    if ("sourceSketchId" in reference) dependencies.add(reference.sourceSketchId)
    if ("reference" in reference && "featureId" in reference.reference)
      dependencies.add(reference.reference.featureId)
  }
  return [...dependencies]
}

function featureDependencies(feature: DocumentSnapshot["features"][number]) {
  const dependencies = new Set<string>(feature.dependencies)
  const extrusion = readExtrusionFeatureParameters(feature)
  const revolve = readRevolveFeatureParameters(feature)
  if (extrusion) dependencies.add(extrusion.profile.sketchId)
  if (revolve) {
    dependencies.add(revolve.profile.sketchId)
    if (revolve.axis.kind === "model-edge") dependencies.add(revolve.axis.reference.featureId)
    if (revolve.axis.kind === "sketch-line") dependencies.add(revolve.axis.sketchId)
  }
  return [...dependencies]
}

export function queryCadInspectionList(
  snapshot: DocumentSnapshot | null,
  input: unknown,
): QueryResult {
  const query = cadInspectionListQuerySchema.safeParse(input)
  if (!query.success) return failure("invalid-query", "The CAD inspection list query is invalid.")
  const guarded = documentGuard(snapshot, query.data.documentId, query.data.revision)
  if (!guarded.ok) return guarded
  const featureCount = guarded.snapshot.features.length
  const sketchCount = guarded.snapshot.sketches.length
  const total = featureCount + sketchCount
  const cursor = Number(query.data.cursor ?? 0)
  if (!Number.isSafeInteger(cursor) || cursor < 0 || cursor > total)
    return failure("invalid-query", "The CAD inspection cursor is outside the current result.")
  const end = cursor + query.data.limit
  const features = guarded.snapshot.features
    .slice(cursor, Math.min(end, featureCount))
    .map((feature) => ({
      kind: "feature" as const,
      id: feature.id,
      type: feature.type.typeId,
      ...(feature.label ? { label: feature.label } : {}),
      version: feature.type.schemaVersion,
      dependencies: featureDependencies(feature),
    }))
  const sketchStart = Math.max(0, cursor - featureCount)
  const sketches = guarded.snapshot.sketches
    .slice(sketchStart, Math.max(sketchStart, end - featureCount))
    .map((sketch) => ({
      kind: "sketch" as const,
      id: sketch.id,
      type: "sketch",
      label: sketch.label,
      version: sketch.schemaVersion,
      dependencies: sketchDependencies(sketch),
    }))
  const page = [...features, ...sketches]
  const candidate = {
    kind: query.data.kind,
    schemaVersion: 1,
    documentId: guarded.snapshot.id,
    revision: guarded.snapshot.revision,
    classification: "semantic",
    nextCursor: cursor + page.length < total ? String(cursor + page.length) : null,
    data: { items: page, total },
  }
  if (
    page.some((item) => item.dependencies.length > MAX_SUMMARY_DEPENDENCIES) ||
    serializedQueryBytes(candidate) > MAX_SERIALIZED_LIST_BYTES
  )
    return failure(
      "query-result-too-large",
      "The CAD inspection list exceeds the serialized size limit.",
    )
  return { ok: true as const, view: cadInspectionListViewSchema.parse(candidate) }
}

export function queryCadInspectionDetail(
  snapshot: DocumentSnapshot | null,
  input: unknown,
): QueryResult {
  const query = cadInspectionDetailQuerySchema.safeParse(input)
  if (!query.success) return failure("invalid-query", "The CAD inspection detail query is invalid.")
  const guarded = documentGuard(snapshot, query.data.documentId, query.data.revision)
  if (!guarded.ok) return guarded
  const record =
    query.data.entity.kind === "feature"
      ? guarded.snapshot.features.find((feature) => feature.id === query.data.entity.id)
      : guarded.snapshot.sketches.find((sketch) => sketch.id === query.data.entity.id)
  if (!record)
    return failure(
      query.data.entity.kind === "feature" ? "feature-not-found" : "sketch-not-found",
      `The requested ${query.data.entity.kind} does not exist.`,
    )
  const view = cadInspectionDetailViewSchema.safeParse({
    kind: query.data.kind,
    schemaVersion: 1,
    documentId: guarded.snapshot.id,
    revision: guarded.snapshot.revision,
    classification: "semantic",
    data: { entityKind: query.data.entity.kind, record },
  })
  if (!view.success) return failure("invalid-query", "The requested CAD record is invalid.")
  const bytes = serializedQueryBytes(view)
  return bytes <= MAX_SERIALIZED_DETAIL_BYTES
    ? { ok: true, view: view.data }
    : failure(
        "query-result-too-large",
        "The CAD inspection detail exceeds the serialized size limit.",
      )
}
