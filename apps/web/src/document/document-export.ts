import type { GeometryExportFormat } from "@vibeshape/protocol"

const mediaTypes: Record<GeometryExportFormat, string> = {
  step: "model/step",
  stl: "model/stl",
}

export function portableDocumentStem(documentName: string) {
  const sanitized = [...documentName.trim()]
    .map((character) =>
      character.charCodeAt(0) < 32 || '<>:"/\\|?*'.includes(character) ? "-" : character,
    )
    .join("")
  const stem = sanitized
    .replace(/\s+/g, " ")
    .replace(/[ .]+$/g, "")
    .slice(0, 96)
  return stem || "Untitled project"
}

export function createDocumentExportFilename(documentName: string, format: GeometryExportFormat) {
  return `${portableDocumentStem(documentName)}.${format}`
}

export function downloadDocumentExport(input: {
  documentName: string
  format: GeometryExportFormat
  file: Uint8Array
}) {
  const blob = new Blob([Uint8Array.from(input.file).buffer], { type: mediaTypes[input.format] })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement("a")
  anchor.href = url
  anchor.download = createDocumentExportFilename(input.documentName, input.format)
  document.body.append(anchor)
  anchor.click()
  anchor.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 0)
}
