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
import { useDeferredValue, useEffect, useMemo, useState } from "react"
import type { DocumentControllerState } from "../../document/document-controller"
import { projectActiveDocumentDrawing } from "../../document/document-controller"
import { composeDocumentDrawing, downloadDrawing } from "./drawing-file"

export type DrawingProjector = typeof projectActiveDocumentDrawing

type ProjectionState =
  | Readonly<{ status: "idle" }>
  | Readonly<{ status: "loading"; key: string }>
  | Readonly<{ status: "ready"; key: string; projection: DrawingProjection; documentName: string }>
  | Readonly<{ status: "failed"; key: string; reason: FailureReason }>

type FailureReason = "failed" | "empty" | "tooComplex"
const FAILURE_REASONS: Readonly<Record<string, FailureReason>> = {
  "no-exportable-bodies": "empty",
  "drawing-too-complex": "tooComplex",
}
function failureReason(sourceCode: string | null): FailureReason {
  return (sourceCode && FAILURE_REASONS[sourceCode]) || "failed"
}

/** True when the rebuilt model contains a triangle-mesh body, which drawings cannot project. */
function documentHasMesh(controller: DocumentControllerState) {
  const rebuild = controller.report?.rebuild
  return (
    rebuild?.ok === true &&
    rebuild.response.geometry.some(({ geometry }) => geometry.representation === "triangle-mesh")
  )
}

/** The model offers at least one exact solid; mesh-only models cannot be projected. */
function documentHasDrawableSolid(controller: DocumentControllerState) {
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
            : {
                status: "failed",
                key,
                reason: failureReason(result.diagnostic.sourceCode),
              },
        )
      })
      .catch(() => {
        if (current) setState({ status: "failed", key, reason: "failed" })
      })
    return () => {
      current = false
    }
  }, [key, project])

  const ready = state.status === "ready" && state.key === key ? state : null
  // Typing in the title block defers the preview so recomposition never blocks the input.
  const previewSettings = useDeferredValue(settings)
  const sheet = useMemo(
    () => composeReadySheet(ready, previewSettings, copy),
    [ready, previewSettings, copy],
  )
  const previewUrl = useMemo(
    () =>
      sheet
        ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(writeDrawingSvg(sheet))}`
        : null,
    [sheet],
  )
  return {
    status: drawingStatus(controller, key, state, ready !== null),
    hasMesh: documentHasMesh(controller),
    sheet,
    previewUrl,
    download(format: DrawingFileFormat) {
      // Downloads always use the latest settings, even before the deferred preview catches up.
      const current =
        previewSettings === settings ? sheet : composeReadySheet(ready, settings, copy)
      if (!current || !ready) return false
      downloadDrawing(current, format, ready.documentName)
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
  if (state.status === "failed" && state.key === key) return state.reason
  return ready ? ("ready" as const) : ("loading" as const)
}

function composeReadySheet(
  ready: Extract<ProjectionState, { status: "ready" }> | null,
  settings: DrawingSettings,
  copy: DrawingSheetCopy,
) {
  if (!ready) return null
  const parsed = drawingSettingsSchema.safeParse(settings)
  if (!parsed.success) return null
  return composeDocumentDrawing({
    projection: ready.projection,
    settings: parsed.data,
    documentName: ready.documentName,
    copy,
  })
}
