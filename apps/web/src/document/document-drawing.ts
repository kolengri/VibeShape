import type {
  PersistentDocumentSession,
  PersistentDocumentSessionDiagnostic,
  PersistentDocumentSessionReport,
} from "@vibeshape/application/persistent-document-session"
import type { DrawingProjection, DrawingViewId } from "@vibeshape/protocol"
import { prepareDocumentGeometryExport } from "./document-geometry-export"

export type ActiveDocumentDrawingResult =
  | Readonly<{
      ok: true
      projection: DrawingProjection
      documentId: string
      revision: number
      documentName: string
    }>
  | Readonly<{ ok: false; diagnostic: PersistentDocumentSessionDiagnostic }>

type DrawingSession = Pick<
  PersistentDocumentSession,
  "projectDrawing" | "snapshot" | "authoredSnapshot"
>

const staleDrawing: ActiveDocumentDrawingResult = {
  ok: false,
  diagnostic: {
    code: "export-failed",
    message: "The active project changed while drawing. Prepare the current revision again.",
    retryable: true,
    sourceCode: "stale-revision",
  },
}

/**
 * Projects the committed terminal bodies (all exact bodies, or one authored Part) at the captured
 * revision. Part selection reuses the geometry-export body plan, so drawings and exports agree.
 */
export async function projectSessionDrawing(input: {
  session: DrawingSession
  report: PersistentDocumentSessionReport
  views: readonly DrawingViewId[]
  partId?: string | undefined
  isCurrent: () => boolean
}): Promise<ActiveDocumentDrawingResult> {
  const { session } = input
  const { id, revision, name } = session.snapshot
  // Without a Part the worker draws every exact terminal body and skips triangle meshes.
  const plan = input.partId
    ? prepareDocumentGeometryExport(session.authoredSnapshot, input.report, "step", input.partId)
    : { ok: true as const, options: {} }
  if (!plan.ok) return plan
  const result = await session.projectDrawing(
    input.views,
    plan.options.bodies ? { bodies: plan.options.bodies } : {},
  )
  if (!input.isCurrent() || session.snapshot.revision !== revision) return staleDrawing
  if (!result.ok) return result
  return { ok: true, projection: result.projection, documentId: id, revision, documentName: name }
}
