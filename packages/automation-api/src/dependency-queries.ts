import type { DocumentSnapshot } from "@vibeshape/domain/document"
import {
  createDocumentDependencyGraphFromSnapshot,
  type DocumentDependencyGraph,
} from "@vibeshape/domain/document-graph"
import { type DocumentNodeRef, documentNodeRefSchema } from "@vibeshape/domain/document-node"
import { documentIdSchema, revisionSchema } from "@vibeshape/domain/identifiers"
import { z } from "zod"
import type { QueryResult } from "./queries"
import { serializedQueryBytes } from "./query-byte-budget"

const cursorSchema = z
  .string()
  .regex(/^(0|[1-9]\d{0,5})$/)
  .nullable()
export const modelDependenciesArgumentsSchema = z
  .object({
    revision: revisionSchema,
    entity: documentNodeRefSchema,
    direction: z.enum(["dependencies", "dependents"]).default("dependents"),
    transitive: z.boolean().default(false),
    cursor: cursorSchema.default(null),
    limit: z.number().int().min(1).max(100).default(100),
  })
  .strict()

export const modelDependenciesQuerySchema = modelDependenciesArgumentsSchema
  .extend({
    kind: z.literal("org.vibeshape.cad.dependencies"),
    schemaVersion: z.literal(1),
    documentId: documentIdSchema,
  })
  .strict()

const entrySchema = z
  .object({
    entity: documentNodeRefSchema,
    label: z.string().min(1).max(120).optional(),
    type: z.string().min(1).max(128),
    suppressed: z.boolean(),
    distance: z.number().int().positive().max(100_256),
  })
  .strict()

export const modelDependenciesViewSchema = modelDependenciesQuerySchema
  .omit({ cursor: true, limit: true })
  .extend({
    classification: z.literal("semantic"),
    nextCursor: cursorSchema,
    data: z
      .object({
        coverage: z.enum(["complete", "partial"]),
        total: z.number().int().nonnegative().max(100_256),
        items: z.array(entrySchema).max(100),
      })
      .strict(),
  })
  .strict()

export type ModelDependenciesQuery = z.infer<typeof modelDependenciesQuerySchema>
export type ModelDependenciesView = z.infer<typeof modelDependenciesViewSchema>

const operationSchema = z
  .object({
    tool: z.literal("model_dependencies"),
    arguments: modelDependenciesArgumentsSchema,
  })
  .strict()

function pageMatches(
  query: z.infer<typeof modelDependenciesArgumentsSchema>,
  view: ModelDependenciesView,
) {
  const start = Number(query.cursor ?? 0)
  const end = start + view.data.items.length
  const nextCursor = end < view.data.total ? String(end) : null
  return (
    view.data.items.length <= query.limit &&
    end <= view.data.total &&
    view.nextCursor === nextCursor &&
    (nextCursor === null || end > start) &&
    new Set(view.data.items.map((item) => key(item.entity))).size === view.data.items.length &&
    view.data.items.every(
      (item) => key(item.entity) !== key(query.entity) && (query.transitive || item.distance === 1),
    )
  )
}

export function dependenciesResultContextMatches(
  input: unknown,
  result: { ok: boolean; value?: unknown },
  documentId?: string,
): boolean | null {
  const operation = operationSchema.safeParse(input)
  if (!operation.success) return null
  if (!result.ok) return true
  const value = modelDependenciesViewSchema.safeParse(result.value)
  if (!value.success) return false
  const query = operation.data.arguments
  const view = value.data
  return (
    (documentId === undefined || view.documentId === documentId) &&
    (["revision", "direction", "transitive"] as const).every(
      (field) => view[field] === query[field],
    ) &&
    key(view.entity) === key(query.entity) &&
    pageMatches(query, view)
  )
}

type Failure = Extract<QueryResult, { ok: false }>
function failure(code: Failure["diagnostic"]["code"], message: string, retryable = false): Failure {
  return { ok: false, diagnostic: { code, message, retryable, issues: [] } }
}

const key = (ref: DocumentNodeRef) => `${ref.kind}:${ref.id}`

function relatedNodes(graph: DocumentDependencyGraph, query: ModelDependenciesQuery) {
  const neighbours = query.direction === "dependencies" ? graph.dependenciesOf : graph.dependentsOf
  const visited = new Set([key(query.entity)])
  const queue = [{ entity: query.entity, distance: 0 }]
  // Breadth-first traversal gives each shared dependency its shortest distance once.
  for (const current of queue) {
    for (const entity of neighbours(current.entity)) {
      if (visited.has(key(entity))) continue
      visited.add(key(entity))
      queue.push({ entity, distance: current.distance + 1 })
    }
    if (!query.transitive) break
  }
  return queue.slice(1).flatMap(({ entity, distance }) => {
    const node = graph.getNode(entity)
    if (!node) return []
    return [
      {
        entity,
        ...(node.record.label ? { label: node.record.label } : {}),
        type: "type" in node.record ? node.record.type.typeId : "sketch",
        suppressed: "suppressed" in node.record && node.record.suppressed,
        distance,
      },
    ]
  })
}

/** Read authored History relations, independently of geometry or evaluation success. */
export function queryModelDependencies(
  snapshot: DocumentSnapshot | null,
  input: unknown,
): { ok: true; view: ModelDependenciesView } | Failure {
  const parsed = modelDependenciesQuerySchema.safeParse(input)
  if (!parsed.success) return failure("invalid-query", "The dependency query is invalid.")
  const query = parsed.data
  if (!snapshot) return failure("document-not-found", "The requested document was not found.")
  if (snapshot.id !== query.documentId)
    return failure(
      "document-id-mismatch",
      "The query document does not match the supplied snapshot.",
    )
  if (snapshot.revision !== query.revision)
    return failure("stale-query-revision", "The requested revision is no longer current.", true)
  const result = createDocumentDependencyGraphFromSnapshot(snapshot)
  if (!result.ok)
    return {
      ok: false,
      diagnostic: {
        code: "invalid-query",
        message: result.diagnostic.message,
        retryable: false,
        issues: result.diagnostic.issues,
      },
    }
  const graph = result.graph
  if (!graph.getNode(query.entity))
    return failure(
      query.entity.kind === "feature" ? "feature-not-found" : "sketch-not-found",
      "The requested History item was not found.",
    )
  const entries = relatedNodes(graph, query)
  const cursor = Number(query.cursor ?? 0)
  if (cursor > entries.length)
    return failure("invalid-query", "The dependency cursor is outside the current result.")
  const items = entries.slice(cursor, cursor + query.limit)
  const nextIndex = cursor + items.length
  const view = modelDependenciesViewSchema.parse({
    kind: query.kind,
    schemaVersion: 1,
    documentId: snapshot.id,
    revision: snapshot.revision,
    entity: query.entity,
    direction: query.direction,
    transitive: query.transitive,
    classification: "semantic",
    nextCursor: nextIndex < entries.length ? String(nextIndex) : null,
    data: {
      coverage: graph.dependencyModelIssues.length ? "partial" : "complete",
      total: entries.length,
      items,
    },
  })
  if (serializedQueryBytes(view) > 128 * 1024)
    return failure("query-result-too-large", "Reduce the dependency page limit.", true)
  return { ok: true, view }
}
