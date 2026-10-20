import { previewSurfaceTextureRelief } from "@vibeshape/application/surface-textures"
import type { ViewerMesh } from "@vibeshape/viewer/three-viewport"
import { useEffect, useMemo, useState } from "react"
import type { DocumentControllerState } from "../../document/document-controller"
import { useSurfaceTexturePreviewContext } from "./surface-texture-preview-context"
import { createSurfaceTexturePreviewWorker } from "./surface-texture-preview-worker"

export function useTexturedMeshes(
  controller: DocumentControllerState,
  sources: readonly ViewerMesh[],
  committedOnly = false,
) {
  const transientContext = useSurfaceTexturePreviewContext()
  const context = committedOnly ? null : transientContext
  const authority = controller.authoredSnapshot
  const report = controller.report
  const draft = context?.draft
  const layers = useMemo(() => {
    const committed = authority && "surfaceTextures" in authority ? authority.surfaceTextures : []
    if (
      !draft ||
      draft.documentId !== report?.snapshot.id ||
      draft.revision !== report.snapshot.revision
    )
      return committed
    return [...committed.filter(({ featureId }) => featureId !== draft.featureId), ...draft.layers]
  }, [authority, draft, report?.snapshot.id, report?.snapshot.revision])
  const [result, setResult] = useState<{
    source: readonly ViewerMesh[]
    layers: typeof layers
    meshes: readonly ViewerMesh[]
  } | null>(null)
  const [failed, setFailed] = useState(false)
  const setStatus = context?.setStatus
  const setReadyDraft = context?.setReadyDraft
  useEffect(() => {
    if (!report || !layers.some(({ enabled }) => enabled)) {
      setStatus?.("idle")
      setFailed(false)
      return
    }
    let current = true
    const cancellation = new AbortController()
    setStatus?.("loading")
    setFailed(false)
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const textured = await previewSurfaceTextureRelief({
            report,
            layers,
            sources,
            requiredLayers: draft?.layers,
            createWorker: createSurfaceTexturePreviewWorker,
            signal: cancellation.signal,
          })
          if (!current) return
          const meshes = sources.map((source) =>
            (() => {
              const previewed = textured.find((item) => item.source === source)
              return previewed ? { ...source, ...previewed.mesh, textureSource: source } : source
            })(),
          )
          setResult({ source: sources, layers, meshes })
          setReadyDraft?.(draft ?? null)
          setStatus?.("ready")
        } catch {
          if (current) {
            setFailed(true)
            setStatus?.("error")
          }
        }
      })()
    }, 150)
    return () => {
      current = false
      clearTimeout(timer)
      cancellation.abort()
    }
  }, [layers, report, sources, setStatus, setReadyDraft, draft])
  // Keep the last preview while a replacement is being computed, but never across source revisions.
  if (context?.showOriginal || failed || !layers.some(({ enabled }) => enabled)) return sources
  return result?.source === sources ? result.meshes : sources
}
