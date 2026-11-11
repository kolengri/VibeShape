import {
  DRAWING_VIEWS,
  type DrawingSettings,
  drawingSettingsSchema,
} from "@vibeshape/domain/drawing"
import {
  type DrawingFileFormat,
  type DrawingSheetCopy,
  writeDrawingSvg,
} from "@vibeshape/formats/drawing"
import type { DrawingProjection, DrawingViewId } from "@vibeshape/protocol"
import { useEffect, useMemo, useState } from "react"
import type { DocumentControllerState } from "../../document/document-controller"
import { projectActiveDocumentDrawing } from "../../document/document-controller"
import { composeDocumentDrawing, downloadDrawing } from "./drawing-file"

export type DrawingProjector = typeof projectActiveDocumentDrawing

type ProjectionState =
  | Readonly<{ status: "idle" }>
  | Readonly<{ status: "loading"; key: string }>
  | Readonly<{ status: "ready"; key: string; projection: DrawingProjection; documentName: string }>
  | Readonly<{ status: "failed"; key: string }>

/** The model offers at least one exact solid; mesh-only models cannot be projected. */
export function documentHasDrawableSolid(controller: DocumentControllerState) {
  const rebuild = controller.report?.rebuild
  return (
    rebuild?.ok === true &&
    rebuild.response.geometry.some(
      ({ geometry }) =>
        geometry.shape.solidCount > 0 && geometry.representation !== "triangle-mesh",
    )
  )
}

/** Stable request key: projections depend on document, revision, part and the set of views only. */
function projectionKey(
  controller: DocumentControllerState,
  partId: string | undefined,
  views: readonly string[],
) {
  const snapshot = controller.report?.snapshot
  if (controller.status !== "ready" || !snapshot || !documentHasDrawableSolid(controller))
    return null
  return [snapshot.id, snapshot.revision, partId ?? "", ...views].join("|")
}

/**
 * Projects views once per document revision, part and view set, then recomposes the sheet locally
 * for sheet, scale and title-block changes. Stale projections are ignored.
 */
export function useDrawing(input: {
  controller: DocumentControllerState
  partId: string | undefined
  settings: DrawingSettings
  copy: DrawingSheetCopy
  project?: DrawingProjector
}) {
  const { controller, partId, settings, copy } = input
  const project = input.project ?? projectActiveDocumentDrawing
  const viewList = DRAWING_VIEWS.filter((view) => settings.views.includes(view))
  const key = projectionKey(controller, partId, viewList)
  const [state, setState] = useState<ProjectionState>({ status: "idle" })

  useEffect(() => {
    if (!key) {
      setState({ status: "idle" })
      return
    }
    let current = true
    setState({ status: "loading", key })
    const [, , part = "", ...views] = key.split("|")
    project(views as DrawingViewId[], part || undefined)
      .then((result) => {
        if (!current) return
        setState(
          result.ok
            ? {
                status: "ready",
                key,
                projection: result.projection,
                documentName: result.documentName,
              }
            : { status: "failed", key },
        )
      })
      .catch(() => {
        if (current) setState({ status: "failed", key })
      })
    return () => {
      current = false
    }
  }, [key, project])

  const ready = state.status === "ready" && state.key === key ? state : null
  const sheet = useMemo(() => {
    if (!ready) return null
    const parsed = drawingSettingsSchema.safeParse(settings)
    if (!parsed.success) return null
    return composeDocumentDrawing({
      projection: ready.projection,
      settings: parsed.data,
      documentName: ready.documentName,
      copy,
    })
  }, [ready, settings, copy])
  const previewUrl = useMemo(
    () =>
      sheet
        ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(writeDrawingSvg(sheet))}`
        : null,
    [sheet],
  )
  return {
    status: drawingStatus(controller, key, state, ready !== null),
    sheet,
    previewUrl,
    download(format: DrawingFileFormat) {
      if (!sheet || !ready) return false
      downloadDrawing(sheet, format, ready.documentName)
      return true
    },
  }
}

function drawingStatus(
  controller: DocumentControllerState,
  key: string | null,
  state: ProjectionState,
  ready: boolean,
) {
  if (!key) return controller.status === "ready" ? ("empty" as const) : ("loading" as const)
  if (state.status === "failed" && state.key === key) return "failed" as const
  return ready ? ("ready" as const) : ("loading" as const)
}
