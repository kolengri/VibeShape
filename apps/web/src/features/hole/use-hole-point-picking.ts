import { useTranslations } from "@vibeshape/i18n"
import type { ViewerSketchReferenceCandidate } from "@vibeshape/viewer/three-viewport"
import {
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
  useCallback,
  useMemo,
  useRef,
  useState,
} from "react"
import type { DocumentControllerState } from "../../document/document-controller"
import type { GeometryViewportSketchContext } from "../../shell/geometry-viewport"
import type { ActivePartDesignTool } from "../part-design/part-design-tool"
import type { HolePickingContext, HolePickingRequest } from "./hole-form"
import { holePointCandidates } from "./hole-point-candidates"

type PickingState = Readonly<{ key: string; context: HolePickingContext }>
type RequestState = Readonly<{ key: string; request: HolePickingRequest }>
type HolePointCandidates = ReturnType<typeof holePointCandidates>
type LiveHolePicking = Readonly<{
  canPick: boolean
  candidates: HolePointCandidates
  context: HolePickingContext | null
  key: string | null
}>

function isHoleTool(
  activeTool: ActivePartDesignTool | null,
): activeTool is Extract<ActivePartDesignTool, { kind: "create-hole" | "edit-hole" }> {
  return activeTool?.kind === "create-hole" || activeTool?.kind === "edit-hole"
}

function holePickingKey(
  documentId: string | undefined,
  revision: number | undefined,
  tool: ActivePartDesignTool | null,
  featureId: string,
) {
  if (!documentId || revision === undefined || !isHoleTool(tool)) return null
  return `${documentId}:${revision}:${tool.kind}:${featureId}`
}

function sameHoleContext(left: HolePickingContext, right: HolePickingContext) {
  return (
    left.featureId === right.featureId &&
    left.sketchId === right.sketchId &&
    left.pointIds.length === right.pointIds.length &&
    left.pointIds.every((pointId, index) => pointId === right.pointIds[index])
  )
}

function currentRebuildResponse(
  controller: DocumentControllerState,
  snapshot: NonNullable<DocumentControllerState["report"]>["snapshot"] | undefined,
) {
  const rebuild = controller.report?.rebuild
  if (!snapshot || !rebuild?.ok) return null
  return rebuild.response.documentId === snapshot.id &&
    rebuild.response.revision === snapshot.revision
    ? rebuild.response
    : null
}

function displayHolePointCandidates(
  context: HolePickingContext | null,
  snapshot: NonNullable<DocumentControllerState["report"]>["snapshot"] | undefined,
  rebuildResponse: ReturnType<typeof currentRebuildResponse>,
  label: (ordinal: number, id: HolePickingContext["pointIds"][number]) => string,
): HolePointCandidates {
  if (!context || !snapshot || !rebuildResponse) return null
  const sketch = snapshot.sketches.find(({ id }) => id === context.sketchId)
  const display = rebuildResponse.sketches.find(({ sketchId }) => sketchId === context.sketchId)
  return sketch && display ? holePointCandidates(sketch, display, context.pointIds, label) : null
}

function documentAllowsHolePicking(controller: DocumentControllerState) {
  return (
    controller.status === "ready" &&
    controller.saveStatus !== "saving" &&
    controller.report?.mode === "read-write"
  )
}

function canOfferHolePointPicking(
  context: HolePickingContext | null,
  candidates: HolePointCandidates,
  controller: DocumentControllerState,
  hiddenSketchIds: readonly string[],
  stateKey: string | null,
  state: PickingState | null,
) {
  return (
    context !== null &&
    candidates !== null &&
    documentAllowsHolePicking(controller) &&
    !hiddenSketchIds.includes(context.sketchId) &&
    stateKey !== null &&
    state?.key === stateKey
  )
}

function pickedHolePoint(picked: ViewerSketchReferenceCandidate, live: LiveHolePicking) {
  if (
    picked.kind !== "point" ||
    !live.canPick ||
    !live.context ||
    !live.key ||
    picked.sourceSketchId !== live.context.sketchId
  )
    return null
  const candidate = live.candidates?.find(
    (current) =>
      current.sourceSketchId === picked.sourceSketchId &&
      current.sourcePointId === picked.sourcePointId,
  )
  return candidate ? { candidate, context: live.context, key: live.key } : null
}

function requestPickedHolePoint(
  picked: ViewerSketchReferenceCandidate,
  live: LiveHolePicking,
  requestIdRef: MutableRefObject<number>,
  setRequestState: Dispatch<SetStateAction<RequestState | null>>,
) {
  const selection = pickedHolePoint(picked, live)
  if (!selection) return
  requestIdRef.current += 1
  setRequestState({
    key: selection.key,
    request: {
      requestId: requestIdRef.current,
      featureId: selection.context.featureId,
      sketchId: selection.context.sketchId,
      pointId: selection.candidate.sourcePointId,
    },
  })
}

/**
 * Supplies only current, fully identified solved sketch points to the finished-sketch Hole task.
 * A missing, stale, or malformed display record disables picking rather than guessing an entity.
 */
export function useHolePointPicking(
  controller: DocumentControllerState,
  activeTool: ActivePartDesignTool | null,
  hiddenSketchIds: readonly string[],
) {
  const t = useTranslations("app.shell.viewport")
  const [state, setState] = useState<PickingState | null>(null)
  const [requestState, setRequestState] = useState<RequestState | null>(null)
  const requestIdRef = useRef(0)
  const snapshot = controller.report?.snapshot
  const stateKey = state
    ? holePickingKey(snapshot?.id, snapshot?.revision, activeTool, state.context.featureId)
    : null
  const context = state && state.key === stateKey ? state.context : null
  const rebuildResponse = currentRebuildResponse(controller, snapshot)
  const candidates = useMemo(
    () =>
      displayHolePointCandidates(context, snapshot, rebuildResponse, (ordinal, id) =>
        t("holePointLabel", { ordinal, id }),
      ),
    [context, rebuildResponse, snapshot, t],
  )
  const stateRef = useRef(state)
  const liveRef = useRef<LiveHolePicking>({
    canPick: false,
    candidates: null,
    context: null,
    key: null,
  })
  stateRef.current = state
  liveRef.current = {
    canPick: canOfferHolePointPicking(
      context,
      candidates,
      controller,
      hiddenSketchIds,
      stateKey,
      stateRef.current,
    ),
    candidates,
    context,
    key: stateKey,
  }

  const onContextChange = useCallback(
    (next: HolePickingContext | null) => {
      const key = next
        ? holePickingKey(snapshot?.id, snapshot?.revision, activeTool, next.featureId)
        : null
      if (!next || !key) setRequestState(null)
      else setRequestState((previous) => (previous?.key === key ? previous : null))
      setState((previous) => {
        if (!next || !key) return null
        return previous?.key === key && sameHoleContext(previous.context, next)
          ? previous
          : { key, context: next }
      })
    },
    [activeTool, snapshot?.id, snapshot?.revision],
  )

  const viewportContext = useMemo<GeometryViewportSketchContext | undefined>(() => {
    if (!context || !candidates) return undefined
    const key = holePickingKey(snapshot?.id, snapshot?.revision, activeTool, context.featureId)
    if (
      !canOfferHolePointPicking(
        context,
        candidates,
        controller,
        hiddenSketchIds,
        key,
        stateRef.current,
      )
    )
      return undefined
    return {
      mode: "orbit",
      frame: null,
      referenceSelection: {
        purpose: "hole-point",
        candidates,
        onSelect: (picked: ViewerSketchReferenceCandidate) =>
          requestPickedHolePoint(picked, liveRef.current, requestIdRef, setRequestState),
      },
    }
  }, [
    activeTool,
    candidates,
    context,
    controller.report?.mode,
    controller.saveStatus,
    controller.status,
    hiddenSketchIds,
    snapshot?.id,
    snapshot?.revision,
  ])

  const request =
    context &&
    requestState?.key ===
      holePickingKey(snapshot?.id, snapshot?.revision, activeTool, context.featureId)
      ? requestState.request
      : null
  return { request, onContextChange, viewportContext }
}
