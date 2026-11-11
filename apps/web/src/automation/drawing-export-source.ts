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

/**
 * Automation counterpart of the Drawing dialog: the same document-session projection, sheet
 * composition (English sheet copy) and writers, bound to the paired document and exact revision.
 */
export function createDrawingExportPreparer(options: {
  documentId: string
  currentRevision: () => number
  project: DrawingProjector
}) {
  return async (request: PrepareDrawingExportArguments): Promise<PreparedDrawingFile> => {
    if (options.currentRevision() !== request.revision) return { ok: false }
    const views = DRAWING_VIEWS.filter((view) => request.settings.views.includes(view))
    const result = await options.project(views, request.partId)
    if (!result.ok)
      throw new BinaryExportPreparationError(
        "drawing-failed",
        result.diagnostic.message.slice(0, 512),
      )
    if (result.documentId !== options.documentId || result.revision !== request.revision)
      return { ok: false }
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
