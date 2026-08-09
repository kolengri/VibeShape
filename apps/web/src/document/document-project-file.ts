import { VSHAPE_MEDIA_TYPE } from "@vibeshape/formats/vshape"
import { portableDocumentStem } from "./document-export"

export function createProjectBackupFilename(documentName: string) {
  return `${portableDocumentStem(documentName)}.vshape`
}

export function downloadProjectBackup(input: { documentName: string; file: Uint8Array }) {
  const blob = new Blob([Uint8Array.from(input.file).buffer], { type: VSHAPE_MEDIA_TYPE })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement("a")
  anchor.href = url
  anchor.download = createProjectBackupFilename(input.documentName)
  document.body.append(anchor)
  anchor.click()
  anchor.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 0)
}
