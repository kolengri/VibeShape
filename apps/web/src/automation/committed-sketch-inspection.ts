import type { createDisposableSketchInspection } from "@vibeshape/application/disposable-sketch-inspection"
import {
  type QueryDiagnosticCode,
  type QueryDispatcher,
  type QueryResult,
  type SketchSolutionQuery,
  sketchSolutionQuerySchema,
} from "@vibeshape/automation-api/queries"
import { serializedQueryBytes } from "@vibeshape/automation-api/query-byte-budget"
import type { AutomationDocumentPort } from "@vibeshape/automation-host/host"
import { documentSnapshotSchema } from "@vibeshape/domain/document"
import type { SketchSolutionEvidence } from "@vibeshape/domain/sketch-solution-evidence"

function failure(
  code: QueryDiagnosticCode,
  message: string,
  retryable = false,
): Extract<QueryResult, { ok: false }> {
  return { ok: false, diagnostic: { code, message, retryable, issues: [] } }
}
export function createCommittedSketchInspection(
  options: Readonly<{
    documents: AutomationDocumentPort
    queries: QueryDispatcher
    inspection: ReturnType<typeof createDisposableSketchInspection>
  }>,
) {
  let closed = false
  let cache: SketchSolutionEvidence | null = null
  let epoch = 0
  async function read(input: SketchSolutionQuery): Promise<QueryResult> {
    const operationEpoch = epoch
    const query = sketchSolutionQuerySchema.safeParse(input)
    if (!query.success) return failure("invalid-query", "The sketch solution query is invalid.")
    if (closed) return failure("geometry-unavailable", "The automation session is closed.")
    const before = documentSnapshotSchema.safeParse(
      await options.documents.readSnapshot(query.data.documentId),
    )
    if (operationEpoch !== epoch)
      return failure("geometry-unavailable", "The sketch inspection was cancelled.", true)
    if (!before.success)
      return failure("document-not-found", "The requested document is unavailable.")
    if (!sameRequestedDocument(before.data, query.data))
      return failure("stale-query-revision", "The active document revision changed.", true)
    let evidence = cache
    if (!sameTarget(evidence, query.data)) {
      if (query.data.cursor !== null)
        return failure(
          "stale-geometry",
          "The solved sketch cursor is no longer available; restart paging.",
          true,
        )
      const checked = await evaluate(query.data, before.data, operationEpoch)
      if (!checked.ok) return checked
      evidence = checked.evidence
    }
    return publish(before.data, query.data, evidence)
  }
  function publish(
    snapshot: import("@vibeshape/domain/document").DocumentSnapshot,
    query: SketchSolutionQuery,
    evidence: SketchSolutionEvidence | null,
  ) {
    const result = options.queries.dispatch(snapshot, query, { sketchSolution: evidence })
    if (result.ok) cache = evidence
    return result
  }
  async function evaluate(
    query: SketchSolutionQuery,
    before: import("@vibeshape/domain/document").DocumentSnapshot,
    operationEpoch: number,
  ) {
    const result = await options.inspection.inspect(before, query.sketchId)
    const after = documentSnapshotSchema.safeParse(
      await options.documents.readSnapshot(query.documentId),
    )
    if (operationEpoch !== epoch)
      return failure("geometry-unavailable", "The sketch inspection was cancelled.", true)
    if (closed) return failure("geometry-unavailable", "The automation session is closed.")
    if (!after.success || after.data.id !== before.id || after.data.revision !== before.revision)
      return failure(
        "stale-query-revision",
        "The active document changed during sketch solving.",
        true,
      )
    if (!result.ok)
      return failure(
        result.code.startsWith("preview-")
          ? "geometry-unavailable"
          : inspectionFailureCode(result.code),
        "The solved sketch evidence could not be prepared.",
        true,
      )
    if (serializedQueryBytes(result.evidence, 4 * 1024 * 1024) > 4 * 1024 * 1024)
      return failure("query-result-too-large", "The solved sketch catalog exceeds the 4 MiB limit.")
    return { ok: true as const, evidence: result.evidence }
  }
  return {
    read,
    cancel() {
      epoch++
      cache = null
      options.inspection.cancel()
    },
    dispose() {
      closed = true
      epoch++
      cache = null
      options.inspection.dispose()
    },
  }
}
function sameTarget(evidence: SketchSolutionEvidence | null, query: SketchSolutionQuery) {
  return (
    evidence?.documentId === query.documentId &&
    evidence.revision === query.revision &&
    evidence.sketchId === query.sketchId
  )
}

function inspectionFailureCode(code: string): QueryDiagnosticCode {
  if (
    code === "sketch-not-found" ||
    code === "stale-geometry" ||
    code === "invalid-geometry-evidence"
  )
    return code
  return "geometry-unavailable"
}

function sameRequestedDocument(
  snapshot: import("@vibeshape/domain/document").DocumentSnapshot,
  query: SketchSolutionQuery,
) {
  return snapshot.id === query.documentId && snapshot.revision === query.revision
}
