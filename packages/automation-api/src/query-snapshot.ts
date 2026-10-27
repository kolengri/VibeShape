import type { DocumentSnapshot } from "@vibeshape/domain/document"
import type { QueryResult } from "./queries"

/** Resolve the saved document once before query-specific inspection. */
export function resolveQuerySnapshot(
  snapshot: DocumentSnapshot | null,
  query: { documentId: string; revision: number },
): { ok: true; snapshot: DocumentSnapshot } | Extract<QueryResult, { ok: false }> {
  if (!snapshot)
    return {
      ok: false,
      diagnostic: {
        code: "document-not-found",
        message: "The requested document was not found.",
        retryable: false,
        issues: [],
      },
    }
  if (snapshot.id !== query.documentId)
    return {
      ok: false,
      diagnostic: {
        code: "document-id-mismatch",
        message: "The query document does not match the supplied snapshot.",
        retryable: false,
        issues: [],
      },
    }
  if (snapshot.revision !== query.revision)
    return {
      ok: false,
      diagnostic: {
        code: "stale-query-revision",
        message: "The requested revision is no longer current.",
        retryable: true,
        issues: [],
      },
    }
  return { ok: true, snapshot }
}
