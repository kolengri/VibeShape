import type { DocumentSnapshot } from "@vibeshape/domain/document"
import {
  documentIdSchema,
  featureIdSchema,
  revisionSchema,
  sketchConstraintIdSchema,
  sketchIdSchema,
  variableIdSchema,
} from "@vibeshape/domain/identifiers"
import {
  inspectVariableReferencesInExpression,
  parameterExpressionReferences,
  variableExpressionSchema,
  variableNameSchema,
} from "@vibeshape/domain/variables"
import { z } from "zod"
import type { QueryResult } from "./queries"
import { serializedQueryBytes } from "./query-byte-budget"
import { resolveQuerySnapshot } from "./query-snapshot"

const cursorSchema = z
  .string()
  .regex(/^(0|[1-9]\d{0,14})$/)
  .nullable()
export const modelVariableUsageArgumentsSchema = z
  .object({
    revision: revisionSchema,
    variableId: variableIdSchema,
    transitive: z.boolean().default(false),
    cursor: cursorSchema.default(null),
    limit: z.number().int().min(1).max(100).default(100),
  })
  .strict()

export const modelVariableUsageQuerySchema = modelVariableUsageArgumentsSchema
  .extend({
    kind: z.literal("org.vibeshape.cad.variable-usage"),
    schemaVersion: z.literal(1),
    documentId: documentIdSchema,
  })
  .strict()

function expressionLocationSchema<Fields extends z.ZodRawShape>(fields: Fields) {
  const pathSegment = z.union([z.string(), z.number().int().nonnegative().safe()])
  const common = {
    expression: variableExpressionSchema,
    ...fields,
  }
  return z.discriminatedUnion("kind", [
    z
      .object({
        kind: z.literal("variable"),
        variableId: variableIdSchema,
        name: variableNameSchema,
        parameterPath: z.tuple([z.literal("expression")]),
        ...common,
      })
      .strict(),
    z
      .object({
        kind: z.literal("feature"),
        entity: z.object({ kind: z.literal("feature"), id: featureIdSchema }).strict(),
        parameterPath: z.tuple([z.literal("parameters")]).rest(pathSegment),
        label: z.string().min(1).max(120).optional(),
        type: z.string().min(1).max(128),
        suppressed: z.boolean(),
        ...common,
      })
      .strict(),
    z
      .object({
        kind: z.literal("sketch-constraint"),
        entity: z.object({ kind: z.literal("sketch"), id: sketchIdSchema }).strict(),
        parameterPath: z
          .tuple([z.literal("constraints"), z.number().int().nonnegative().safe()])
          .rest(pathSegment),
        label: z.string().min(1).max(120).optional(),
        constraintId: sketchConstraintIdSchema,
        constraintType: z.string().min(1).max(128),
        ...common,
      })
      .strict(),
  ])
}
const locationSchema = expressionLocationSchema({})
const entrySchema = expressionLocationSchema({ distance: z.number().int().positive().max(4097) })
const diagnosticSchema = expressionLocationSchema({
  code: z.string().regex(/^[a-z][a-z0-9-]{0,95}$/),
  message: z.string().min(1).max(512),
})

export const modelVariableUsageViewSchema = modelVariableUsageQuerySchema
  .omit({ cursor: true, limit: true })
  .extend({
    variableName: variableNameSchema,
    classification: z.literal("semantic"),
    nextCursor: cursorSchema,
    data: z
      .object({
        coverage: z.enum(["complete", "partial"]),
        total: z.number().int().nonnegative().safe(),
        items: z.array(entrySchema).max(100),
        diagnosticTotal: z.number().int().nonnegative().safe(),
        diagnostics: z.array(diagnosticSchema).max(20),
      })
      .strict(),
  })
  .strict()

export type ModelVariableUsageQuery = z.infer<typeof modelVariableUsageQuerySchema>
export type ModelVariableUsageView = z.infer<typeof modelVariableUsageViewSchema>
type ExpressionLocation = z.infer<typeof locationSchema>
type ScannedLocation = ExpressionLocation & ReturnType<typeof inspectVariableReferencesInExpression>
type Failure = Extract<QueryResult, { ok: false }>

function failure(code: Failure["diagnostic"]["code"], message: string, retryable = false): Failure {
  return { ok: false, diagnostic: { code, message, retryable, issues: [] } }
}

function featureExpressionLocations(snapshot: DocumentSnapshot): ScannedLocation[] {
  return snapshot.features.flatMap((feature) =>
    parameterExpressionReferences(feature.parameters).map(
      ({ path, ...expression }): ScannedLocation => ({
        kind: "feature",
        entity: { kind: "feature", id: feature.id },
        ...(feature.label ? { label: feature.label } : {}),
        type: feature.type.typeId,
        suppressed: feature.suppressed,
        parameterPath: ["parameters", ...path],
        ...expression,
      }),
    ),
  )
}

function sketchExpressionLocations(snapshot: DocumentSnapshot): ScannedLocation[] {
  return snapshot.sketches.flatMap((sketch) =>
    sketch.constraints.flatMap((constraint, index) =>
      parameterExpressionReferences(constraint).map(
        ({ path, ...expression }): ScannedLocation => ({
          kind: "sketch-constraint",
          entity: { kind: "sketch", id: sketch.id },
          ...(sketch.label ? { label: sketch.label } : {}),
          constraintId: constraint.id,
          constraintType: constraint.type,
          parameterPath: ["constraints", index, ...path],
          ...expression,
        }),
      ),
    ),
  )
}

function expressionLocations(snapshot: DocumentSnapshot): ScannedLocation[] {
  const variables: ScannedLocation[] = snapshot.variables.map((variable) => ({
    kind: "variable",
    variableId: variable.id,
    name: variable.name,
    parameterPath: ["expression"],
    expression: variable.expression,
    ...inspectVariableReferencesInExpression(variable.expression),
  }))
  return [
    ...variables,
    ...featureExpressionLocations(snapshot),
    ...sketchExpressionLocations(snapshot),
  ]
}

function variableConsumers(locations: ScannedLocation[]) {
  const consumers = new Map<string, string[]>()
  for (const location of locations) {
    if (location.kind !== "variable") continue
    for (const reference of location.references) {
      const names = consumers.get(reference) ?? []
      names.push(location.name)
      consumers.set(reference, names)
    }
  }
  return consumers
}

function dependentVariableDistances(
  locations: ScannedLocation[],
  name: string,
  transitive: boolean,
) {
  const distances = new Map([[name, 0]])
  if (!transitive) return distances
  const consumers = variableConsumers(locations)
  const queue = [name]
  // Breadth-first traversal retains the shortest route through shared variable definitions.
  for (const current of queue) {
    for (const consumer of consumers.get(current) ?? []) {
      if (distances.has(consumer)) continue
      distances.set(consumer, (distances.get(current) ?? 0) + 1)
      queue.push(consumer)
    }
  }
  return distances
}

function usageItems(
  locations: ScannedLocation[],
  variableId: string,
  distances: ReadonlyMap<string, number>,
) {
  return locations.flatMap(({ references, diagnostic: _diagnostic, ...location }) => {
    if (location.kind === "variable" && location.variableId === variableId) return []
    const matches = references.flatMap((name) => {
      const distance = distances.get(name)
      return distance === undefined ? [] : [distance + 1]
    })
    return matches.length ? [{ ...location, distance: Math.min(...matches) }] : []
  })
}

function usageDiagnostics(locations: ScannedLocation[]) {
  const diagnostics: ModelVariableUsageView["data"]["diagnostics"] = []
  let diagnosticTotal = 0
  for (const { references: _references, diagnostic, ...location } of locations) {
    if (!diagnostic) continue
    diagnosticTotal += 1
    if (diagnostics.length < 20)
      diagnostics.push({ ...location, code: diagnostic.code, message: diagnostic.message })
  }
  return { diagnostics, diagnosticTotal }
}

function usagePage(
  query: ModelVariableUsageQuery,
  variableName: string,
  locations: ScannedLocation[],
) {
  const distances = dependentVariableDistances(locations, variableName, query.transitive)
  const entries = usageItems(locations, query.variableId, distances)
  const cursor = Number(query.cursor ?? 0)
  if (cursor > entries.length)
    return failure("invalid-query", "The variable usage cursor is outside the current result.")
  const items = entries.slice(cursor, cursor + query.limit)
  const nextIndex = cursor + items.length
  const diagnostics = usageDiagnostics(locations)
  const view = modelVariableUsageViewSchema.parse({
    kind: query.kind,
    schemaVersion: 1,
    documentId: query.documentId,
    revision: query.revision,
    variableId: query.variableId,
    variableName,
    transitive: query.transitive,
    classification: "semantic",
    nextCursor: nextIndex < entries.length ? String(nextIndex) : null,
    data: {
      coverage: diagnostics.diagnosticTotal ? "partial" : "complete",
      total: entries.length,
      items,
      ...diagnostics,
    },
  })
  if (serializedQueryBytes(view) > 128 * 1024)
    return failure(
      "query-result-too-large",
      "The variable usage page exceeds the response byte budget.",
      true,
    )
  return { ok: true as const, view }
}

/** Inspect saved typed expressions without geometry evaluation or arbitrary string matching. */
export function queryVariableUsage(
  snapshot: DocumentSnapshot | null,
  input: unknown,
): { ok: true; view: ModelVariableUsageView } | Failure {
  const parsed = modelVariableUsageQuerySchema.safeParse(input)
  if (!parsed.success) return failure("invalid-query", "The variable usage query is invalid.")
  const query = parsed.data
  const context = resolveQuerySnapshot(snapshot, query)
  if (!context.ok) return context
  const saved = context.snapshot
  const variable = saved.variables.find(({ id }) => id === query.variableId)
  if (!variable) return failure("variable-not-found", "The requested variable was not found.")
  return usagePage(query, variable.name, expressionLocations(saved))
}

const operationSchema = z
  .object({ tool: z.literal("model_variable_usage"), arguments: modelVariableUsageArgumentsSchema })
  .strict()
const locationKey = (item: ModelVariableUsageView["data"]["items"][number]) =>
  JSON.stringify([
    item.kind,
    item.kind === "variable" ? item.variableId : item.entity,
    item.parameterPath,
  ])

export function variableUsageResultContextMatches(
  input: unknown,
  result: { ok: boolean; value?: unknown },
  documentId?: string,
): boolean | null {
  const operation = operationSchema.safeParse(input)
  if (!operation.success) return null
  if (!result.ok) return true
  const parsed = modelVariableUsageViewSchema.safeParse(result.value)
  if (!parsed.success) return false
  const view = parsed.data
  const query = operation.data.arguments
  const start = Number(query.cursor ?? 0)
  const end = start + view.data.items.length
  const nextCursor = end < view.data.total ? String(end) : null
  return (
    (documentId === undefined || view.documentId === documentId) &&
    view.revision === query.revision &&
    view.variableId === query.variableId &&
    view.transitive === query.transitive &&
    start <= view.data.total &&
    view.data.items.length === Math.min(query.limit, view.data.total - start) &&
    view.nextCursor === nextCursor &&
    (nextCursor === null || end > start) &&
    new Set(view.data.items.map(locationKey)).size === view.data.items.length &&
    view.data.items.every(
      (item) =>
        (query.transitive || item.distance === 1) &&
        (item.kind !== "variable" || item.variableId !== query.variableId),
    )
  )
}
