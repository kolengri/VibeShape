import { z } from "zod"
import type { DocumentSnapshot } from "./document"
import type { DocumentDependencyModelIssue, DocumentGraphDiagnostic } from "./document-graph"

export const domainDiagnosticCodeSchema = z.enum([
  "invalid-command",
  "invalid-event",
  "document-already-exists",
  "document-not-found",
  "document-id-mismatch",
  "stale-revision",
  "revision-exhausted",
  "command-no-op",
  "variable-already-exists",
  "variable-name-conflict",
  "variable-name-immutable",
  "variable-not-found",
  "variable-in-use",
  "invalid-variable-expression",
  "invalid-feature-expression",
  "feature-already-exists",
  "feature-not-found",
  "feature-in-use",
  "invalid-feature-graph",
  "feature-type-unavailable",
  "unavailable-dependency-model",
  "invalid-feature-parameters",
  "invalid-feature-content-parameters",
  "invalid-feature-dependency-count",
  "invalid-feature-reference-count",
  "sketch-already-exists",
  "sketch-not-found",
  "sketch-in-use",
  "invalid-sketch",
])

const domainDiagnosticSchema = z
  .object({
    code: domainDiagnosticCodeSchema,
    message: z.string().min(1),
    retryable: z.boolean(),
    issues: z.array(z.object({ path: z.string(), message: z.string().min(1) }).strict()).max(8),
  })
  .strict()

export type DomainDiagnostic = Readonly<z.infer<typeof domainDiagnosticSchema>>

export function domainDiagnostic(
  code: z.infer<typeof domainDiagnosticCodeSchema>,
  message: string,
  retryable = false,
): DomainDiagnostic {
  return { code, message, retryable, issues: [] }
}

export function zodDiagnosticIssues(error: z.ZodError): DomainDiagnostic["issues"] {
  return error.issues.slice(0, 8).map((issue) => ({
    path: issue.path.map(String).join("."),
    message: issue.message,
  }))
}

function requireNextRevision(baseRevision: number, revision: number) {
  return revision === baseRevision + 1
}

export function requireExistingDocumentRevision(
  snapshot: DocumentSnapshot | null,
  documentId: DocumentSnapshot["id"],
  baseRevision: number,
  revision?: number,
): { ok: true; snapshot: DocumentSnapshot } | { ok: false; diagnostic: DomainDiagnostic } {
  if (!snapshot) {
    return {
      ok: false,
      diagnostic: domainDiagnostic("document-not-found", "The document does not exist."),
    }
  }

  if (snapshot.id !== documentId) {
    return {
      ok: false,
      diagnostic: domainDiagnostic(
        "document-id-mismatch",
        "The operation targets a different document.",
      ),
    }
  }

  if (baseRevision === Number.MAX_SAFE_INTEGER) {
    return {
      ok: false,
      diagnostic: domainDiagnostic(
        "revision-exhausted",
        "The document revision cannot advance safely.",
      ),
    }
  }

  if (
    snapshot.revision !== baseRevision ||
    (revision !== undefined && !requireNextRevision(baseRevision, revision))
  ) {
    return {
      ok: false,
      diagnostic: domainDiagnostic(
        "stale-revision",
        "The operation does not extend the current document revision.",
        true,
      ),
    }
  }

  return { ok: true, snapshot }
}

export function featureMutationDiagnostic(
  input: Readonly<{
    code:
      | "feature-already-exists"
      | "feature-not-found"
      | "feature-in-use"
      | "invalid-feature-graph"
    message: string
    issues: readonly { path: string; message: string }[]
  }>,
  invalidEvent = false,
): DomainDiagnostic {
  return {
    code: invalidEvent ? "invalid-event" : input.code,
    message: invalidEvent
      ? "The feature event does not match the current document."
      : input.message,
    retryable: false,
    issues: input.issues.slice(0, 8),
  }
}

export function documentGraphDiagnostic(
  input: DocumentGraphDiagnostic,
  invalidEvent = false,
): DomainDiagnostic {
  return {
    code: invalidEvent ? "invalid-event" : "invalid-command",
    message: invalidEvent
      ? "The document event produces an invalid dependency graph."
      : "The document command produces an invalid dependency graph.",
    retryable: false,
    issues: [{ path: input.code, message: input.message }, ...input.issues].slice(0, 8),
  }
}

export function unavailableDependencyModelDiagnostic(
  issues: readonly DocumentDependencyModelIssue[],
  invalidEvent = false,
): DomainDiagnostic {
  return {
    code: invalidEvent ? "invalid-event" : "unavailable-dependency-model",
    message: invalidEvent
      ? "The document event requires an unavailable feature dependency model."
      : "A feature dependency model is unavailable for this destructive operation.",
    retryable: false,
    issues: issues.slice(0, 8).map((issue) => ({
      path: issue.ownerPath,
      message: `Feature type ${issue.typeKey} must declare its semantic inputs before deletion is safe.`,
    })),
  }
}
