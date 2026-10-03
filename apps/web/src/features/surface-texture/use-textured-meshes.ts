import { resolveSurfaceTextureExportLayers } from "@vibeshape/application/surface-textures"
import {
  createGeometryRequestEnvelope,
  GeometryWorkerClient,
} from "@vibeshape/geometry-worker/client"
import { DEFAULT_SURFACE_TEXTURE_QUALITY } from "@vibeshape/protocol"
import type { ViewerMesh } from "@vibeshape/viewer/three-viewport"
import { useEffect, useMemo, useState } from "react"
import type { DocumentControllerState } from "../../document/document-controller"
import { useSurfaceTexturePreviewContext } from "./surface-texture-preview-context"

export function useTexturedMeshes(
  controller: DocumentControllerState,
  sources: readonly ViewerMesh[],
) {
  const context = useSurfaceTexturePreviewContext()
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
    let client: GeometryWorkerClient | null = null
    setStatus?.("loading")
    setFailed(false)
    const timer = setTimeout(() => {
      void (async () => {
        try {
          if (
            draft?.layers.some(
              (layer) =>
                layer.enabled &&
                !sources.some(
                  (source) =>
                    source.featureId === layer.featureId &&
                    (source.outputRole ?? "result") === layer.target.outputRole,
                ),
            )
          )
            throw new Error(
              "Show the textured body or choose a current body before previewing its relief.",
            )
          const groups = resolveSurfaceTextureExportLayers(report, layers, sources)
          client = new GeometryWorkerClient()
          const textured = await Promise.all(
            groups.map(async (group) => {
              const source = sources.find(
                (mesh) =>
                  mesh.featureId === group.featureId &&
                  (mesh.outputRole ?? "result") === group.outputRole,
              )
              if (!source) throw new Error("Surface texture source is unavailable.")
              const response = await client?.previewSurfaceTextureMesh(
                createGeometryRequestEnvelope(
                  `${report.snapshot.id}:texture:${group.featureId}:${group.outputRole}`,
                  report.snapshot.revision,
                  report.snapshot.revision,
                ),
                {
                  positions: new Float32Array(source.positions),
                  normals: new Float32Array(source.normals),
                  indices: new Uint32Array(source.indices),
                  triangleFaceIds: new Uint32Array(source.triangleFaceIds),
                },
                group.layers,
                DEFAULT_SURFACE_TEXTURE_QUALITY,
              )
              if (response?.type !== "surfaceTexturePreviewed")
                throw new Error("Surface texture preview failed.")
              return { ...source, ...response.mesh, textureSource: source }
            }),
          )
          if (!current) return
          const meshes = sources.map(
            (source) =>
              textured.find(
                (mesh) =>
                  mesh.featureId === source.featureId && mesh.outputRole === source.outputRole,
              ) ?? source,
          )
          setResult({ source: sources, layers, meshes })
          setReadyDraft?.(draft ?? null)
          setStatus?.("ready")
        } catch {
          if (current) {
            setFailed(true)
            setStatus?.("error")
          }
        } finally {
          client?.terminate()
        }
      })()
    }, 150)
    return () => {
      current = false
      clearTimeout(timer)
      client?.terminate()
    }
  }, [layers, report, sources, setStatus, setReadyDraft, draft])
  // Keep the last preview while a replacement is being computed, but never across source revisions.
  if (context?.showOriginal || failed || !layers.some(({ enabled }) => enabled)) return sources
  return result?.source === sources ? result.meshes : sources
}
