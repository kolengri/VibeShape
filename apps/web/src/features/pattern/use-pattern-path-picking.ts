import { useTranslations } from "@vibeshape/i18n"
import type { ViewerSketchReferenceCandidate } from "@vibeshape/viewer/three-viewport"
import { useCallback, useMemo, useRef, useState } from "react"
import type { DocumentControllerState } from "../../document/document-controller"
import type { GeometryViewportSketchContext } from "../../shell/geometry-viewport"
import type { ActivePartDesignTool } from "../part-design/part-design-tool"
import { patternPathCandidates } from "./pattern-path-candidates"

export type PatternPathPickingContext = Readonly<{
  featureId: string
  sketchId: string
}>
export type PatternPathPickingRequest = Readonly<{
  requestId: number
  featureId: string
  sketchId: string
  entityId: string
}>
function isPatternTool(tool: ActivePartDesignTool | null) {
  return tool?.kind === "create-pattern" || tool?.kind === "edit-pattern"
}

function pickedCurve(picked: ViewerSketchReferenceCandidate) {
  if (picked.kind === "line")
    return { sketchId: picked.sourceSketchId, entityId: picked.sourceLineId }
  return picked.kind === "curve"
    ? { sketchId: picked.sourceSketchId, entityId: picked.sourceEntityId }
    : null
}

function currentDisplay(controller: DocumentControllerState, sketchId: string) {
  const report = controller.report
  const rebuild = report?.rebuild
  if (!report || !rebuild?.ok) return null
  if (
    rebuild.response.documentId !== report.snapshot.id ||
    rebuild.response.revision !== report.snapshot.revision
  )
    return null
  return rebuild.response.sketches.find((display) => display.sketchId === sketchId) ?? null
}

/**
 * Offers the Pattern task's chosen path sketch curves for viewport toggling. A stale, hidden or
 * read-only document disables picking; the task panel remains the keyboard path.
 */
export function usePatternPathPicking(
  controller: DocumentControllerState,
  activeTool: ActivePartDesignTool | null,
  hiddenSketchIds: readonly string[],
) {
  const t = useTranslations("app.bodyPattern")
  const [context, setContext] = useState<PatternPathPickingContext | null>(null)
  // A request belongs to one document revision so a remounted task never replays an old pick.
  const [request, setRequest] = useState<Readonly<{
    revisionKey: string
    request: PatternPathPickingRequest
  }> | null>(null)
  const requestId = useRef(0)
  const snapshot = controller.report?.snapshot
  const revisionKey = snapshot ? `${snapshot.id}:${snapshot.revision}` : ""
  const active =
    context !== null &&
    isPatternTool(activeTool) &&
    controller.status === "ready" &&
    controller.saveStatus !== "saving" &&
    controller.report?.mode === "read-write" &&
    !hiddenSketchIds.includes(context.sketchId)
  const candidates = useMemo(() => {
    if (!active || !context || !snapshot) return []
    const sketch = snapshot.sketches.find(({ id }) => id === context.sketchId)
    const display = currentDisplay(controller, context.sketchId)
    return sketch && display
      ? patternPathCandidates(sketch, display, (kind, number) =>
          t("curveOption", { kind: kind.replaceAll("-", "_"), number }),
        )
      : []
  }, [active, context, controller, snapshot, t])
  const onContextChange = useCallback((next: PatternPathPickingContext | null) => {
    setContext((previous) =>
      previous?.featureId === next?.featureId && previous?.sketchId === next?.sketchId
        ? previous
        : next,
    )
    if (!next) setRequest(null)
  }, [])
  const viewportContext = useMemo<GeometryViewportSketchContext | undefined>(() => {
    if (!context || candidates.length === 0) return undefined
    return {
      mode: "orbit",
      frame: null,
      referenceSelection: {
        purpose: "pattern-path",
        candidates,
        onSelect: (picked) => {
          const curve = pickedCurve(picked)
          if (!curve || curve.sketchId !== context.sketchId) return
          requestId.current += 1
          setRequest({
            revisionKey,
            request: {
              requestId: requestId.current,
              featureId: context.featureId,
              sketchId: context.sketchId,
              entityId: curve.entityId,
            },
          })
        },
      },
    }
  }, [candidates, context, revisionKey])
  return {
    request: active && request?.revisionKey === revisionKey ? request.request : null,
    onContextChange,
    viewportContext,
  }
}
