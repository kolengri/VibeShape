import type { DrawingSettings } from "@vibeshape/domain/drawing"
import {
  composeDrawingSheet,
  DRAWING_MEDIA_TYPES,
  type DrawingFileFormat,
  type DrawingSheet,
  type DrawingSheetCopy,
  writeDrawingFile,
} from "@vibeshape/formats/drawing"
import type { DrawingProjection } from "@vibeshape/protocol"
import { portableDocumentStem } from "../../document/document-export"
import en from "../../i18n/messages/en.json"

type SheetCopyMessages = (typeof en)["app"]["drawing"]["sheet"]

/** Builds sheet text from the drawing catalog; MCP output uses the English source catalog. */
export function drawingSheetCopy(
  catalog: SheetCopyMessages = en.app.drawing.sheet,
): DrawingSheetCopy {
  return {
    viewLabels: catalog.viewLabels,
    captions: catalog.captions,
    projections: catalog.projections,
    units: catalog.units,
  }
}

export function composeDocumentDrawing(input: {
  projection: DrawingProjection
  settings: DrawingSettings
  documentName: string
  copy?: DrawingSheetCopy
}): DrawingSheet {
  return composeDrawingSheet({
    projection: input.projection,
    settings: input.settings,
    copy: input.copy ?? drawingSheetCopy(),
    documentTitle: input.documentName,
  })
}

export function drawingFilename(documentName: string, format: DrawingFileFormat) {
  return `${portableDocumentStem(documentName)} drawing.${format}`
}

/** Serializes the composed sheet and starts a browser download of the same bytes MCP returns. */
export function downloadDrawing(
  sheet: DrawingSheet,
  format: DrawingFileFormat,
  documentName: string,
) {
  const bytes = writeDrawingFile(sheet, format)
  const url = URL.createObjectURL(
    new Blob([Uint8Array.from(bytes).buffer], { type: DRAWING_MEDIA_TYPES[format] }),
  )
  const anchor = document.createElement("a")
  anchor.href = url
  anchor.download = drawingFilename(documentName, format)
  document.body.append(anchor)
  anchor.click()
  anchor.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 0)
}
