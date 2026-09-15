import { type ModelBodyTopologyView, queryModelBodyTopology } from "./body-topology-queries"

export type { ModelBodyTopologyQuery, ModelBodyTopologyView } from "./body-topology-queries"
export {
  modelBodyTopologyArgumentsSchema,
  modelBodyTopologyQuerySchema,
  modelBodyTopologyViewSchema,
} from "./body-topology-queries"

import { type ModelEdgeView, queryModelEdges } from "./edge-queries"
import { serializedQueryBytes } from "./query-byte-budget"

export type { ModelEdgeQuery, ModelEdgeView } from "./edge-queries"
export { modelEdgeQuerySchema, modelEdgeViewSchema } from "./edge-queries"

import {
  type ModelBodyMeasurementView,
  queryModelBodyMeasurements,
} from "./body-measurement-queries"
import {
  type CadInspectionDetailView,
  type CadInspectionListView,
  queryCadInspectionDetail,
  queryCadInspectionList,
} from "./cad-queries"
import { type ModelMeasurementView, queryModelMeasurements } from "./measurement-queries"

export type {
  ModelBodyMeasurementQuery,
  ModelBodyMeasurementView,
} from "./body-measurement-queries"
export {
  modelBodyMeasurementArgumentsSchema,
  modelBodyMeasurementQuerySchema,
  modelBodyMeasurementViewSchema,
} from "./body-measurement-queries"
export type {
  CadInspectionDetailQuery,
  CadInspectionDetailView,
  CadInspectionListQuery,
  CadInspectionListView,
} from "./cad-queries"
export {
  cadInspectionDetailQuerySchema,
  cadInspectionDetailViewSchema,
  cadInspectionListQuerySchema,
  cadInspectionListViewSchema,
} from "./cad-queries"
export type { ModelMeasurementQuery, ModelMeasurementView } from "./measurement-queries"
export { modelMeasurementQuerySchema, modelMeasurementViewSchema } from "./measurement-queries"

import { type DocumentSnapshot, documentNameSchema } from "@vibeshape/domain/document"
import {
  documentIdSchema,
  revisionSchema,
  technicalIdentifierSchema,
  timestampSchema,
} from "@vibeshape/domain/identifiers"
import {
  documentCoreModule,
  type ModuleRegistry,
  type QueryDescriptor,
} from "@vibeshape/domain/modules"
import {
  evaluateVariableDefinitions,
  type VariableEvaluationResult,
  variableDefinitionSchema,
} from "@vibeshape/domain/variables"
import { z } from "zod"

const queryRouteSchema = z
  .object({
    kind: technicalIdentifierSchema,
    schemaVersion: z.number().int().positive().safe(),
  })
  .passthrough()

export const documentSummaryQuerySchema = z
  .object({
    kind: z.literal("org.vibeshape.document.summary"),
    schemaVersion: z.literal(1),
    documentId: documentIdSchema,
    revision: revisionSchema,
  })
  .strict()

export const documentSummaryViewSchema = z
  .object({
    kind: z.literal("org.vibeshape.document.summary"),
    schemaVersion: z.literal(1),
    documentId: documentIdSchema,
    revision: revisionSchema,
    classification: z.literal("semantic"),
    truncated: z.literal(false),
    data: z
      .object({
        name: documentNameSchema,
        createdAt: timestampSchema,
        updatedAt: timestampSchema,
      })
      .strict(),
  })
  .strict()

const variableCursorSchema = z.string().regex(/^(?:0|[1-9]\d{0,3})$/)

export const variableListQuerySchema = z
  .object({
    kind: z.literal("org.vibeshape.variable.list"),
    schemaVersion: z.literal(1),
    documentId: documentIdSchema,
    revision: revisionSchema,
    cursor: variableCursorSchema.nullable().default(null),
    limit: z.number().int().min(1).max(200).default(100),
  })
  .strict()

const variableValueSchema = z
  .object({
    dimension: z.enum(["length", "angle", "scalar"]),
    value: z.number().finite(),
    unit: z.enum(["mm", "rad", "1"]),
  })
  .strict()

export const variableListViewSchema = z
  .object({
    kind: z.literal("org.vibeshape.variable.list"),
    schemaVersion: z.literal(1),
    documentId: documentIdSchema,
    revision: revisionSchema,
    classification: z.literal("semantic"),
    nextCursor: variableCursorSchema.nullable(),
    data: z
      .object({
        variables: z
          .array(
            z
              .object({
                definition: variableDefinitionSchema,
                result: variableValueSchema,
                dependencies: z.array(z.string().min(1).max(64)).max(4_096),
              })
              .strict(),
          )
          .max(200),
      })
      .strict(),
  })
  .strict()

export type DocumentSummaryQuery = Readonly<z.infer<typeof documentSummaryQuerySchema>>
export type DocumentSummaryView = Readonly<z.infer<typeof documentSummaryViewSchema>>
export type VariableListQuery = Readonly<z.infer<typeof variableListQuerySchema>>
export type VariableListView = Readonly<z.infer<typeof variableListViewSchema>>
const VARIABLE_LIST_MAX_SERIALIZED_BYTES = 128 * 1024
export type AutomationQueryView =
  | ModelBodyTopologyView
  | ModelEdgeView
  | DocumentSummaryView
  | VariableListView
  | ModelMeasurementView
  | ModelBodyMeasurementView
  | CadInspectionListView
  | CadInspectionDetailView

export type QueryIssue = Readonly<{
  path: string
  message: string
}>

export type QueryDiagnosticCode =
  | "geometry-unavailable"
  | "stale-geometry"
  | "invalid-geometry-evidence"
  | "feature-not-found"
  | "sketch-not-found"
  | "feature-not-measurable"
  | "body-not-found"
  | "query-result-too-large"
  | "invalid-query-route"
  | "invalid-query"
  | "unregistered-query"
  | "unsupported-query-version"
  | "document-not-found"
  | "document-id-mismatch"
  | "stale-query-revision"
  | "duplicate-query-handler"
  | "missing-query-handler"
  | "orphan-query-handler"
  | "query-handler-owner-mismatch"
  | "query-handler-version-mismatch"

export type QueryDiagnostic = Readonly<{
  code: QueryDiagnosticCode
  message: string
  retryable: boolean
  issues: readonly QueryIssue[]
}>

export type QueryResult =
  | { ok: true; view: AutomationQueryView }
  | { ok: false; diagnostic: QueryDiagnostic }

export type DerivedQueryContext = Readonly<{
  measurements?: unknown
  bodyMeasurements?: unknown
  bodyTopology?: unknown
  edges?: unknown
}>

export type TrustedQueryHandler = Readonly<{
  kind: QueryDescriptor["kind"]
  schemaVersion: QueryDescriptor["schemaVersion"]
  ownerModuleId: QueryDescriptor["ownerModuleId"]
  execute: (
    snapshot: DocumentSnapshot | null,
    input: unknown,
    context?: DerivedQueryContext,
  ) => QueryResult
}>

export type QueryDispatcher = Readonly<{
  dispatch: (
    snapshot: DocumentSnapshot | null,
    input: unknown,
    context?: DerivedQueryContext,
  ) => QueryResult
}>

export type QueryDispatcherResult =
  | { ok: true; dispatcher: QueryDispatcher }
  | { ok: false; diagnostic: QueryDiagnostic }

function queryDiagnostic(
  code: QueryDiagnosticCode,
  message: string,
  retryable = false,
  issues: readonly QueryIssue[] = [],
): QueryDiagnostic {
  return { code, message, retryable, issues }
}

function zodIssues(error: z.ZodError): readonly QueryIssue[] {
  return error.issues.slice(0, 8).map((issue) => ({
    path: issue.path.map(String).join("."),
    message: issue.message,
  }))
}

export function queryDocumentSummary(
  snapshot: DocumentSnapshot | null,
  input: unknown,
): QueryResult {
  const parsed = documentSummaryQuerySchema.safeParse(input)

  if (!parsed.success) {
    return {
      ok: false,
      diagnostic: queryDiagnostic(
        "invalid-query",
        "The document summary query is invalid.",
        false,
        zodIssues(parsed.error),
      ),
    }
  }

  if (!snapshot) {
    return {
      ok: false,
      diagnostic: queryDiagnostic("document-not-found", "The requested document was not found."),
    }
  }

  if (snapshot.id !== parsed.data.documentId) {
    return {
      ok: false,
      diagnostic: queryDiagnostic(
        "document-id-mismatch",
        "The query document does not match the supplied snapshot.",
      ),
    }
  }

  if (snapshot.revision !== parsed.data.revision) {
    return {
      ok: false,
      diagnostic: queryDiagnostic(
        "stale-query-revision",
        `Document revision ${parsed.data.revision} is no longer current.`,
        true,
      ),
    }
  }

  return {
    ok: true,
    view: documentSummaryViewSchema.parse({
      kind: parsed.data.kind,
      schemaVersion: parsed.data.schemaVersion,
      documentId: snapshot.id,
      revision: snapshot.revision,
      classification: "semantic",
      truncated: false,
      data: {
        name: snapshot.name,
        createdAt: snapshot.createdAt,
        updatedAt: snapshot.updatedAt,
      },
    }),
  }
}

function canonicalUnit(dimension: "length" | "angle" | "scalar") {
  switch (dimension) {
    case "length":
      return "mm" as const
    case "angle":
      return "rad" as const
    case "scalar":
      return "1" as const
  }
}

export function queryDocumentVariables(
  snapshot: DocumentSnapshot | null,
  input: unknown,
): QueryResult {
  const parsed = variableListQuerySchema.safeParse(input)
  if (!parsed.success) {
    return {
      ok: false,
      diagnostic: queryDiagnostic(
        "invalid-query",
        "The document variable query is invalid.",
        false,
        zodIssues(parsed.error),
      ),
    }
  }
  if (!snapshot) {
    return {
      ok: false,
      diagnostic: queryDiagnostic("document-not-found", "The requested document was not found."),
    }
  }
  if (snapshot.id !== parsed.data.documentId) {
    return {
      ok: false,
      diagnostic: queryDiagnostic(
        "document-id-mismatch",
        "The query document does not match the supplied snapshot.",
      ),
    }
  }
  if (snapshot.revision !== parsed.data.revision) {
    return {
      ok: false,
      diagnostic: queryDiagnostic(
        "stale-query-revision",
        `Document revision ${parsed.data.revision} is no longer current.`,
        true,
      ),
    }
  }
  const evaluated = evaluateVariableDefinitions(snapshot.variables)
  if (!evaluated.ok) {
    return {
      ok: false,
      diagnostic: queryDiagnostic("invalid-query", "The committed variable table is invalid."),
    }
  }
  const cursor = parsed.data.cursor === null ? 0 : Number(parsed.data.cursor)
  if (!Number.isSafeInteger(cursor) || cursor < 0 || cursor > snapshot.variables.length) {
    return {
      ok: false,
      diagnostic: queryDiagnostic("invalid-query", "The document variable cursor is invalid."),
    }
  }
  return createVariablePage(snapshot, parsed.data, cursor, evaluated)
}

function createVariablePage(
  snapshot: DocumentSnapshot,
  query: VariableListQuery,
  cursor: number,
  evaluated: Extract<VariableEvaluationResult, { ok: true }>,
): QueryResult {
  const definitions = snapshot.variables.slice(cursor, cursor + query.limit)
  const nextIndex = cursor + definitions.length
  const variables = []
  const emptyPage = {
    kind: query.kind,
    schemaVersion: query.schemaVersion,
    documentId: snapshot.id,
    revision: snapshot.revision,
    classification: "semantic",
    nextCursor: nextIndex < snapshot.variables.length ? String(nextIndex) : null,
    data: { variables: [] },
  }
  let serializedBytes = serializedQueryBytes(emptyPage)
  for (const definition of definitions) {
    const variable = evaluated.valuesById.get(definition.id)
    if (!variable) {
      return {
        ok: false,
        diagnostic: queryDiagnostic("invalid-query", "The committed variable table is invalid."),
      }
    }
    const entry = {
      definition,
      result: {
        ...variable.value,
        unit: canonicalUnit(variable.value.dimension),
      },
      dependencies: variable.dependencies,
    }
    const entryBytes = serializedQueryBytes(entry)
    serializedBytes += entryBytes + (variables.length > 0 ? 1 : 0)
    if (serializedBytes > VARIABLE_LIST_MAX_SERIALIZED_BYTES) {
      return {
        ok: false,
        diagnostic: queryDiagnostic(
          "query-result-too-large",
          "The variable query result is too large; reduce the page limit.",
          true,
        ),
      }
    }
    variables.push(entry)
  }
  return {
    ok: true,
    view: variableListViewSchema.parse({
      kind: query.kind,
      schemaVersion: query.schemaVersion,
      documentId: snapshot.id,
      revision: snapshot.revision,
      classification: "semantic",
      nextCursor: nextIndex < snapshot.variables.length ? String(nextIndex) : null,
      data: { variables },
    }),
  }
}

function validateHandlerDescriptor(
  descriptor: QueryDescriptor,
  handler: TrustedQueryHandler,
): QueryDiagnostic | null {
  if (handler.ownerModuleId !== descriptor.ownerModuleId) {
    return queryDiagnostic(
      "query-handler-owner-mismatch",
      `Query handler ${handler.kind} does not belong to module ${descriptor.ownerModuleId}.`,
    )
  }

  return handler.schemaVersion === descriptor.schemaVersion
    ? null
    : queryDiagnostic(
        "query-handler-version-mismatch",
        `Query handler ${handler.kind} does not implement schema version ${descriptor.schemaVersion}.`,
      )
}

function indexQueryHandlers(
  moduleRegistry: ModuleRegistry,
  handlers: readonly TrustedQueryHandler[],
) {
  const handlersByKind = new Map<string, TrustedQueryHandler>()

  for (const handler of handlers) {
    if (handlersByKind.has(handler.kind)) {
      return {
        ok: false,
        diagnostic: queryDiagnostic(
          "duplicate-query-handler",
          `Query handler ${handler.kind} is registered twice.`,
        ),
      } as const
    }

    const descriptor = moduleRegistry.getQuery(handler.kind)

    if (!descriptor) {
      return {
        ok: false,
        diagnostic: queryDiagnostic(
          "orphan-query-handler",
          `Query handler ${handler.kind} has no registered descriptor.`,
        ),
      } as const
    }

    const diagnostic = validateHandlerDescriptor(descriptor, handler)

    if (diagnostic) {
      return { ok: false, diagnostic } as const
    }

    handlersByKind.set(handler.kind, handler)
  }

  const missingDescriptor = moduleRegistry.queries.find(
    (descriptor) => !handlersByKind.has(descriptor.kind),
  )

  return missingDescriptor
    ? ({
        ok: false,
        diagnostic: queryDiagnostic(
          "missing-query-handler",
          `Query ${missingDescriptor.kind} has no trusted handler.`,
        ),
      } as const)
    : ({ ok: true, handlersByKind } as const)
}

function dispatchQuery(
  moduleRegistry: ModuleRegistry,
  handlersByKind: ReadonlyMap<string, TrustedQueryHandler>,
  snapshot: DocumentSnapshot | null,
  input: unknown,
  context?: DerivedQueryContext,
): QueryResult {
  const route = queryRouteSchema.safeParse(input)

  if (!route.success) {
    return {
      ok: false,
      diagnostic: queryDiagnostic(
        "invalid-query-route",
        "The query route is invalid.",
        false,
        zodIssues(route.error),
      ),
    }
  }

  const descriptor = moduleRegistry.getQuery(route.data.kind)
  const handler = handlersByKind.get(route.data.kind)

  if (!descriptor || !handler) {
    return {
      ok: false,
      diagnostic: queryDiagnostic(
        "unregistered-query",
        `Query ${route.data.kind} is not registered.`,
      ),
    }
  }

  if (route.data.schemaVersion !== descriptor.schemaVersion) {
    return {
      ok: false,
      diagnostic: queryDiagnostic(
        "unsupported-query-version",
        `Query ${route.data.kind} schema version ${route.data.schemaVersion} is not supported.`,
      ),
    }
  }

  return handler.execute(snapshot, input, context)
}

export function createQueryDispatcher(
  moduleRegistry: ModuleRegistry,
  handlers: readonly TrustedQueryHandler[],
): QueryDispatcherResult {
  const indexed = indexQueryHandlers(moduleRegistry, handlers)

  return indexed.ok
    ? {
        ok: true,
        dispatcher: {
          dispatch: (snapshot, input, context) =>
            dispatchQuery(moduleRegistry, indexed.handlersByKind, snapshot, input, context),
        },
      }
    : indexed
}

export const documentCoreQueryHandlers: readonly TrustedQueryHandler[] = [
  {
    kind: "org.vibeshape.model.body-topology",
    schemaVersion: 1,
    ownerModuleId: documentCoreModule.id,
    execute: queryModelBodyTopology,
  },
  {
    kind: "org.vibeshape.model.edges",
    schemaVersion: 1,
    ownerModuleId: documentCoreModule.id,
    execute: queryModelEdges,
  },
  {
    kind: "org.vibeshape.document.summary",
    schemaVersion: 1,
    ownerModuleId: documentCoreModule.id,
    execute: queryDocumentSummary,
  },
  {
    kind: "org.vibeshape.variable.list",
    schemaVersion: 1,
    ownerModuleId: documentCoreModule.id,
    execute: queryDocumentVariables,
  },
  {
    kind: "org.vibeshape.model.measurements",
    schemaVersion: 1,
    ownerModuleId: documentCoreModule.id,
    execute: queryModelMeasurements,
  },
  {
    kind: "org.vibeshape.model.body-measurements",
    schemaVersion: 1,
    ownerModuleId: documentCoreModule.id,
    execute: queryModelBodyMeasurements,
  },
  {
    kind: "org.vibeshape.cad.inspection.list",
    schemaVersion: 1,
    ownerModuleId: documentCoreModule.id,
    execute: queryCadInspectionList,
  },
  {
    kind: "org.vibeshape.cad.inspection.detail",
    schemaVersion: 1,
    ownerModuleId: documentCoreModule.id,
    execute: queryCadInspectionDetail,
  },
]
