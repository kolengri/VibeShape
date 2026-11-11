import type { PrepareDrawingExportArguments } from "@vibeshape/automation-api/drawing-export-arguments"
import { DRAWING_VIEWS } from "@vibeshape/domain/drawing"
import { writeDrawingFile } from "@vibeshape/formats/drawing"
import type { ActiveDocumentDrawingResult } from "../document/document-drawing"
import { composeDocumentDrawing } from "../features/drawing/drawing-file"
import { BinaryExportPreparationError, type PreparedDrawingFile } from "./binary-export-session"

type DrawingProjector = (
  views: (typeof DRAWING_VIEWS)[number][],
  partId?: string,
) => Promise<ActiveDocumentDrawingResult>

/** Keeps the session's retryable stale-revision diagnostic and names missing exact bodies. */
function projectionFailure(
  diagnostic: Extract<ActiveDocumentDrawingResult, { ok: false }>["diagnostic"],
) {
  const message = diagnostic.message.slice(0, 512)
  if (diagnostic.sourceCode === "stale-revision")
    return new BinaryExportPreparationError("stale-revision", message, true)
  if (diagnostic.sourceCode === "drawing-too-complex")
    return new BinaryExportPreparationError("drawing-too-complex", message)
  if (diagnostic.sourceCode === "part-not-found")
    return new BinaryExportPreparationError("part-not-found", message)
  if (diagnostic.sourceCode === "no-exportable-bodies")
    return new BinaryExportPreparationError("no-drawable-bodies", message)
  return new BinaryExportPreparationError("drawing-failed", message, diagnostic.retryable)
}

/**
 * Automation counterpart of the Drawing dialog: the same document-session projection, sheet
 * composition (English sheet copy) and writers, bound to the paired document and exact revision.
 */
export function createDrawingExportPreparer(options: { project: DrawingProjector }) {
  // The binary export session checks the requested revision before and the document/revision of
  // the returned file after preparation; this source only maps projection failures.
  return async (request: PrepareDrawingExportArguments): Promise<PreparedDrawingFile> => {
    const views = DRAWING_VIEWS.filter((view) => request.settings.views.includes(view))
    const result = await options.project(views, request.partId)
    if (!result.ok) throw projectionFailure(result.diagnostic)
    const sheet = composeDocumentDrawing({
      projection: result.projection,
      settings: request.settings,
      documentName: result.documentName,
    })
    return {
      ok: true,
      documentId: result.documentId,
      revision: result.revision,
      format: request.format,
      file: writeDrawingFile(sheet, request.format),
    }
  }
}
