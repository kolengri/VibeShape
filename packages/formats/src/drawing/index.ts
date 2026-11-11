import { composeDrawingSheet } from "./compose"
import { writeDrawingDxf } from "./dxf"
import { writeDrawingPdf } from "./pdf"
import type { DrawingSheet } from "./sheet"
import { writeDrawingSvg } from "./svg"

export type { ComposeDrawingInput } from "./compose"
export type { DrawingSheet, DrawingSheetCopy, SheetLayer, SheetPrimitive } from "./sheet"
export { composeDrawingSheet, writeDrawingDxf, writeDrawingPdf, writeDrawingSvg }

export const DRAWING_FILE_FORMATS = ["svg", "dxf", "pdf"] as const
export type DrawingFileFormat = (typeof DRAWING_FILE_FORMATS)[number]
export const DRAWING_MEDIA_TYPES: Readonly<Record<DrawingFileFormat, string>> = {
  svg: "image/svg+xml",
  dxf: "image/vnd.dxf",
  pdf: "application/pdf",
}

/** Encodes one composed sheet; SVG and DXF are UTF-8 text (DXF text is ASCII by construction). */
export function writeDrawingFile(sheet: DrawingSheet, format: DrawingFileFormat): Uint8Array {
  if (format === "pdf") return writeDrawingPdf(sheet)
  return new TextEncoder().encode(
    format === "svg" ? writeDrawingSvg(sheet) : writeDrawingDxf(sheet),
  )
}
