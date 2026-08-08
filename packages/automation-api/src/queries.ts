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

export type DocumentSummaryQuery = Readonly<z.infer<typeof documentSummaryQuerySchema>>
export type DocumentSummaryView = Readonly<z.infer<typeof documentSummaryViewSchema>>

export type QueryIssue = Readonly<{
  path: string
  message: string
}>

export type QueryDiagnosticCode =
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
  | { ok: true; view: DocumentSummaryView }
  | { ok: false; diagnostic: QueryDiagnostic }

export type TrustedQueryHandler = Readonly<{
  kind: QueryDescriptor["kind"]
  schemaVersion: QueryDescriptor["schemaVersion"]
  ownerModuleId: QueryDescriptor["ownerModuleId"]
  execute: (snapshot: DocumentSnapshot | null, input: unknown) => QueryResult
}>

export type QueryDispatcher = Readonly<{
  dispatch: (snapshot: DocumentSnapshot | null, input: unknown) => QueryResult
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

  return handler.execute(snapshot, input)
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
          dispatch: (snapshot, input) =>
            dispatchQuery(moduleRegistry, indexed.handlersByKind, snapshot, input),
        },
      }
    : indexed
}

export const documentCoreQueryHandlers: readonly TrustedQueryHandler[] = [
  {
    kind: "org.vibeshape.document.summary",
    schemaVersion: 1,
    ownerModuleId: documentCoreModule.id,
    execute: queryDocumentSummary,
  },
]
