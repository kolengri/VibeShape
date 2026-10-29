import type { MeshImportInspection, SourceImportInspection } from "@vibeshape/protocol"
import { useEffect, useMemo } from "react"
import type { WorkspaceTaskPreview } from "../../shell/workspace-task-context"
import type { LightweightingSource } from "./lightweighting-model"

/** Publish inspected disposable geometry; authored meshes and document authority stay unchanged. */
export function useLightweightingViewportPreview(
  ready: {
    source: LightweightingSource
    inspection: MeshImportInspection | SourceImportInspection
  } | null,
  onPreviewChange?: (preview: WorkspaceTaskPreview | null) => void,
  onReady?: (ready: boolean) => void,
) {
  const preview = useMemo<WorkspaceTaskPreview | null>(
    () =>
      ready
        ? {
            ...(onReady ? { onReady } : {}),
            meshes: ready.inspection.outputs.map(({ mesh }, index) => ({
              ...mesh,
              featureId: `lightweighting-preview-${ready.source.contentHash}-${index}`,
              appearance: "preview",
            })),
          }
        : null,
    [ready, onReady],
  )
  useEffect(() => {
    onPreviewChange?.(preview)
    return () => onPreviewChange?.(null)
  }, [onPreviewChange, preview])
}
