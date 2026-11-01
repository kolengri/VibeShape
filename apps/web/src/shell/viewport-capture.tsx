import type { ModelPreviewCamera } from "@vibeshape/viewer/model-preview"
import type { ViewerMesh } from "@vibeshape/viewer/three-viewport"
import { createContext, type ReactNode, useContext, useState } from "react"
import type { PictureRepresentationIssue } from "../features/picture-render/picture-render-eligibility"

export type PictureSource = Readonly<{
  documentId: string
  revision: number
  meshes: readonly ViewerMesh[]
  unsupported?: PictureRepresentationIssue
  camera?: ModelPreviewCamera
}>
type PictureSourceReader = () => PictureSource | null

type Capture = () => Promise<Blob | null>

export function createViewportCapturePort() {
  const captures = new Set<Capture>()
  const pictures = new Set<PictureSourceReader>()
  const listeners = new Set<() => void>()
  const changed = () => {
    for (const listener of listeners) listener()
  }
  return {
    subscribePicture(listener: () => void) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    registerPicture(source: PictureSourceReader) {
      pictures.add(source)
      changed()
      return () => {
        pictures.delete(source)
        changed()
      }
    },
    pictureSource() {
      for (const read of [...pictures].reverse()) {
        const source = read()
        if (source) return source
      }
      return null
    },
    register(capture: Capture) {
      captures.add(capture)
      return () => {
        captures.delete(capture)
      }
    },
    async capture() {
      for (const capture of [...captures].reverse()) {
        const image = await capture()
        if (!captures.has(capture)) return null
        if (image) return image
      }
      return null
    },
  }
}

const ViewportCaptureContext = createContext<ReturnType<typeof createViewportCapturePort> | null>(
  null,
)

export function ViewportCaptureProvider({ children }: { children: ReactNode }) {
  const [port] = useState(createViewportCapturePort)
  return <ViewportCaptureContext value={port}>{children}</ViewportCaptureContext>
}

export function useViewportCapture() {
  return useContext(ViewportCaptureContext)
}
