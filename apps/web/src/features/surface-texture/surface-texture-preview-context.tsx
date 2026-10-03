import type { SurfaceTextureLayer } from "@vibeshape/domain/surface-textures"
import type { ViewerSurfaceTextureBrush } from "@vibeshape/viewer/three-viewport"
import { createContext, type ReactNode, useContext, useMemo, useState } from "react"

type SurfaceTextureDraft = Readonly<{
  documentId: string
  revision: number
  featureId: string
  layers: readonly SurfaceTextureLayer[]
}>

type PreviewState = Readonly<{
  active: boolean
  draft: SurfaceTextureDraft | null
  readyDraft: SurfaceTextureDraft | null
  showOriginal: boolean
  brush: ViewerSurfaceTextureBrush | null
  status: "idle" | "loading" | "ready" | "error"
  setDraft: (draft: SurfaceTextureDraft | null) => void
  setReadyDraft: (draft: SurfaceTextureDraft | null) => void
  setShowOriginal: (value: boolean) => void
  setBrush: (brush: ViewerSurfaceTextureBrush | null) => void
  setStatus: (status: PreviewState["status"]) => void
}>

const SurfaceTexturePreviewContext = createContext<PreviewState | null>(null)

export function SurfaceTexturePreviewProvider({
  active,
  children,
}: {
  active: boolean
  children: ReactNode
}) {
  const [draft, setDraft] = useState<SurfaceTextureDraft | null>(null)
  const [readyDraft, setReadyDraft] = useState<SurfaceTextureDraft | null>(null)
  const [showOriginal, setShowOriginal] = useState(false)
  const [brush, setBrush] = useState<ViewerSurfaceTextureBrush | null>(null)
  const [status, setStatus] = useState<PreviewState["status"]>("idle")
  const value = useMemo(
    () => ({
      active,
      draft: active ? draft : null,
      readyDraft,
      showOriginal: active && showOriginal,
      brush: active ? brush : null,
      status,
      setDraft,
      setReadyDraft,
      setShowOriginal,
      setBrush,
      setStatus,
    }),
    [active, draft, readyDraft, showOriginal, brush, status],
  )
  return (
    <SurfaceTexturePreviewContext.Provider value={value}>
      {children}
    </SurfaceTexturePreviewContext.Provider>
  )
}

export function useSurfaceTexturePreviewContext() {
  return useContext(SurfaceTexturePreviewContext)
}
