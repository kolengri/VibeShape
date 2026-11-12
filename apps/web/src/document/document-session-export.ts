import type {
  PersistentDocumentSession,
  PersistentDocumentSessionDiagnostic,
  PersistentDocumentSessionReport,
} from "@vibeshape/application/persistent-document-session"
import type {
  GeometryExportFormat,
  MeshExportQuality,
  PrintPreparationResult,
} from "@vibeshape/protocol"
import {
  currentGeometryFailure,
  prepareDocumentGeometryExport,
  producedRevisionFailure,
} from "./document-geometry-export"

export type ActiveDocumentExportResult =
  | {
      ok: true
      format: GeometryExportFormat
      file: Uint8Array
      bodyCount: number
      documentName: string
      printPreparation?: PrintPreparationResult
    }
  | { ok: false; diagnostic: PersistentDocumentSessionDiagnostic }

type ExportSession = Pick<
  PersistentDocumentSession,
  "exportDocument" | "snapshot" | "authoredSnapshot"
>

const staleExport: ActiveDocumentExportResult = {
  ok: false,
  diagnostic: {
    code: "export-failed",
    message: "The active project changed during export. Prepare the current revision again.",
    retryable: true,
    sourceCode: "stale-revision",
  },
}

/**
 * Exports the committed geometry of the captured revision. The report must describe that
 * revision with a successful rebuild, and the worker, which exports its last successful rebuild,
 * must have produced that revision itself; otherwise nothing from an earlier revision leaves.
 */
export async function exportSessionGeometry(input: {
  session: ExportSession
  report: PersistentDocumentSessionReport
  format: GeometryExportFormat
  partId?: string | undefined
  meshQuality?: MeshExportQuality | undefined
  isCurrent: () => boolean
}): Promise<ActiveDocumentExportResult> {
  const { session, report, format } = input
  const { revision, name } = session.snapshot
  const notCurrent = currentGeometryFailure(report, revision)
  if (notCurrent) return { ok: false, diagnostic: notCurrent }
  const prepared = prepareDocumentGeometryExport(
    session.authoredSnapshot,
    report,
    format,
    input.partId,
    input.meshQuality,
  )
  if (!prepared.ok) return prepared
  const result = await session.exportDocument(format, prepared.options)
  if (!input.isCurrent() || session.snapshot.revision !== revision) return staleExport
  if (!result.ok) return result
  const older = producedRevisionFailure(result.response.revision, revision)
  if (older) return { ok: false, diagnostic: older }
  const { file, bodyCount, printPreparation } = result.response
  return {
    ok: true,
    format: result.response.format,
    file,
    bodyCount,
    documentName: name,
    ...(printPreparation ? { printPreparation } : {}),
  }
}
