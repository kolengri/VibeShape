import type { ProjectedSketchCurve } from "@vibeshape/application/sketch-curve-projection"
import {
  materializeSketchDisplay,
  type SketchDisplayRecord,
} from "@vibeshape/application/sketch-display"
import {
  alignedRectangleGeometry,
  appendSketchAlignedRectangle,
  appendSketchArc,
  appendSketchCenteredAlignedRectangle,
  appendSketchCenteredSlot,
  appendSketchCenterRectangle,
  appendSketchCircle,
  appendSketchConstraint,
  appendSketchEllipse,
  appendSketchEllipticalArc,
  appendSketchLine,
  appendSketchMidpointLine,
  appendSketchPoint,
  appendSketchRectangle,
  appendSketchRegularPolygon,
  appendSketchSlotAroundLine,
  appendSketchStraightSlot,
  appendSketchTangentArc,
  appendSketchThreePointArc,
  appendSketchThreePointCircle,
  type CircularSketchPatternDefinition,
  centeredAlignedRectangleGeometry,
  circularPatternSketchEntities,
  circularSketchPatternTransforms,
  createSketchInferenceCandidateQuery,
  extendSketchCurve,
  type FeatureId,
  type FeatureRecord,
  findSketchCurvesCrossedBySegment,
  inferSketchPoint,
  isReferenceSketchDimension,
  type LinearSketchPatternDefinition,
  linearPatternSketchEntities,
  linearSketchPatternTransforms,
  MAX_REGULAR_POLYGON_SIDES,
  MAX_SKETCH_PATTERN_PREVIEW_INSTANCES,
  MIN_REGULAR_POLYGON_SIDES,
  moveSketchPoint,
  projectedExternalSketchEntities,
  projectPointToSketchEllipse,
  type RegularPolygonMode,
  regularPolygonGeometry,
  removeSketchConstraints,
  removeSketchEntities,
  type SketchConstraintDefinition,
  type SketchConstraintId,
  type SketchCurvePathHit,
  type SketchDirectionInference,
  type SketchEntity,
  type SketchEntityId,
  type SketchExternalReferenceId,
  type SketchInferenceArc,
  type SketchInferenceCandidateQuery,
  type SketchInferenceCurve,
  type SketchInferenceLine,
  type SketchInferencePoint,
  type SketchPoint2,
  type SketchPointInference,
  type SketchPointRelationInference,
  type SketchPointTarget,
  type SketchProfileSelector,
  type SketchRecord,
  setSketchDimensionValue,
  sketchConstraintEntityIds,
  sketchConstraintIdSchema,
  sketchCurvePointIds,
  sketchEllipseGeometry,
  sketchEllipseParameterForPoint,
  sketchEllipsePointAt,
  sketchEllipticalArcGeometry,
  sketchEllipticalArcStartGeometry,
  sketchEntityIdSchema,
  sketchEntityTransformOrigin,
  sketchProfileSelectorSchema,
  splitSketchCircle,
  splitSketchCurve,
  splitSketchEllipse,
  straightSlotGeometry,
  tangentArcGeometry,
  threePointArcGeometry,
  threePointCircleGeometry,
  transformSketchEntities,
  trimSketchCurve,
  type VariableDefinition,
} from "@vibeshape/domain"
import {
  appendSketchLineOffset,
  connectedSketchOffsetLineIds,
  sketchLineOffsetGeometry,
  sketchLineSignedDistance,
} from "@vibeshape/domain/sketch-offset-edit"
import { mirrorSketchEntities } from "@vibeshape/domain/sketch-transform-edit"
import { createLengthQuantity } from "@vibeshape/domain/units"
import { useFormatter, useTranslations } from "@vibeshape/i18n"
import type { SolvedSketchWire } from "@vibeshape/protocol"
import { Button, buttonVariants } from "@vibeshape/ui/components/button"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@vibeshape/ui/components/context-menu"
import { IntersectionIcon, Link2, PierceIcon, Ruler, Trash2 } from "@vibeshape/ui/components/icons"
import { Tooltip, TooltipContent, TooltipTrigger } from "@vibeshape/ui/components/tooltip"
import { cn } from "@vibeshape/ui/lib/cn"
import type {
  ViewerOriginPlane,
  ViewerOriginPlaneVisibility,
} from "@vibeshape/viewer/origin-planes"
import { viewerSketchReferenceCandidateKey } from "@vibeshape/viewer/sketch-reference-identity"
import type { ViewerFrame } from "@vibeshape/viewer/three-viewport"
import {
  type CSSProperties,
  type Dispatch,
  type KeyboardEvent,
  type MouseEvent,
  memo,
  type PointerEvent,
  type RefObject,
  type SetStateAction,
  startTransition,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type WheelEvent,
} from "react"
import { createPortal } from "react-dom"
import { OriginPlaneVisibilityControls } from "../../components/origin-plane-visibility-controls"
import {
  type ActiveSketchSolveOptions,
  type ActiveSketchSolveResult,
  createBrowserSketchConstraintId,
  createBrowserSketchEntityId,
  type DocumentControllerState,
  solveActiveSketch,
} from "../../document/document-controller"
import {
  formatDisplayAngle,
  formatDisplayArea,
  formatDisplayLength,
  useDocumentDisplayUnits,
} from "../../document/document-display-units"
import {
  applyExternalModelCandidateSelection,
  type ExternalModelGeometryCandidate,
  materializeExternalModelCandidate,
  sketchReferencesExternalModelCandidate,
} from "./external-model-geometry"
import {
  applyExternalSketchCandidateSelection,
  availableExternalSketchGeometryCandidates,
  type ExternalSketchContextGeometry,
  type ExternalSketchGeometryCandidate,
  externalReferenceMatchesCandidate,
  materializeExternalSketchCandidate,
} from "./external-sketch-points"
import {
  defaultCircularSketchPatternDefinition,
  SketchCircularPatternForm,
} from "./sketch-circular-pattern-form"
import {
  compatibleSketchConstraintToolsForSelection,
  compatibleSketchDimensionToolsForSelection,
  nextSketchDimensionSelection,
  type SketchConstraintToolKind,
  type SketchDimensionKind,
  selectedSketchConstraintEntities,
  selectedSketchEntities,
  selectedSketchLineId,
} from "./sketch-constraint-tools"
import {
  SketchDimensionInlineEditor,
  type SketchDimensionInlineEditorResult,
  type SketchDimensionOption,
} from "./sketch-dimension-inline-editor"
import {
  inferSketchDimensionKind,
  type SketchDimensionGeometry,
  sketchDimensionCanonicalValue,
  sketchDimensionWitnessPoints,
} from "./sketch-dimension-placement"
import { defaultSketchDimensionExpression } from "./sketch-dimension-value"
import {
  defaultLinearSketchPatternDefinition,
  SketchLinearPatternForm,
} from "./sketch-linear-pattern-form"
import { useSketchProjectionStoreApi } from "./sketch-projection-store"
import {
  isSketchModificationTool,
  isSketchSelectionTool,
  type SketchDraftChangeMode,
  type SketchEditorTool,
  type SketchModificationTool,
  usesSketchCrosshairCursor,
} from "./sketch-tool"
import { type SketchTransformExactValue, SketchTransformForm } from "./sketch-transform-form"
import {
  identitySketchTransform,
  isIdentitySketchTransform,
  relocateSketchTransformOrigin,
  type SketchTransformGesture,
  type SketchTransformHandle,
  SketchTransformManipulator,
  type SketchTransformPreview,
  sketchEntityTransformFromPreview,
  sketchTransformCenter,
  sketchTransformSvgValue,
  transformSketchPoint,
  updateSketchTransformFromKeyboard,
  updateSketchTransformGesture,
} from "./sketch-transform-manipulator"

type SketchSolveFunction = (
  baseRevision: number,
  sketch: SketchRecord["id"] | SketchRecord,
  options?: ActiveSketchSolveOptions,
) => Promise<ActiveSketchSolveResult>

type SolveState =
  | { kind: "idle" }
  | {
      dragTarget: SketchDragTarget | null
      kind: "loading"
      previousSolution: SolvedSketchWire | null
      sourceSketch: SketchRecord
    }
  | {
      dragTarget: SketchDragTarget | null
      kind: "solved"
      solution: SolvedSketchWire
      sourceSketch: SketchRecord
    }
  | { dragTarget: SketchDragTarget | null; kind: "error"; sourceSketch: SketchRecord }

type SketchDragTarget = SolvedSketchWire["points"][number]
type SketchDragState = Readonly<{
  active: boolean
  pointId: SketchEntityId
  sketchId: SketchRecord["id"]
  target: SketchDragTarget
}>

type SketchPointDragInput = Readonly<{
  clientX: number
  clientY: number
  suppressed: boolean
}>

type SketchViewportRectangle = Readonly<{
  height: number
  left: number
  top: number
  width: number
}>

type SketchPointDragPreview = Readonly<{
  inference: SketchPointInference
  point: SketchPoint2
}>

type SketchSolveRequest = Readonly<{
  dragTarget: SketchDragTarget | null
  requestId: number
  resetContinuation: boolean
  revision: number
  sketch: SketchRecord
}>

type SketchSolveScheduler = {
  disposed: boolean
  inFlight: boolean
  latestRequest: SketchSolveRequest | null
  latestSketch: SketchRecord | null
  latestSolution: SolvedSketchWire | null
  nextRequestId: number
  solveSketch: SketchSolveFunction
  timer: number | null
}

type SketchBounds = Readonly<{
  height: number
  minX: number
  minY: number
  width: number
}>
type DisplayPoint = Readonly<{
  construction: boolean
  id: SketchEntityId
  reusable?: boolean
  x: number
  y: number
}>
type DisplayExternalLine = Readonly<{
  id: SketchEntityId
  start: DisplayPoint
  end: DisplayPoint
}>
type DisplayExternalCurve = Exclude<SketchEntity, { type: "line" | "point" }>

type SketchCurveEntity = Exclude<SketchEntity, { type: "point" }>
type SketchPointLookup = Pick<ReadonlyMap<string, DisplayPoint>, "get">
type SketchGeometryPresentation = Readonly<{
  centerPointIds: ReadonlySet<SketchEntityId>
  curves: readonly SketchCurveEntity[]
  curvesById: ReadonlyMap<string, SketchCurveEntity>
  curvesByPointId: ReadonlyMap<string, readonly SketchCurveEntity[]>
  externalLines: readonly DisplayExternalLine[]
  externalPoints: readonly DisplayPoint[]
  externalCurves: readonly DisplayExternalCurve[]
  localPointsById: ReadonlyMap<string, DisplayPoint>
  points: readonly DisplayPoint[]
  pointsById: ReadonlyMap<string, DisplayPoint>
  solvedCircles: ReadonlyMap<string, number>
}>

type PendingGeometry =
  | Readonly<{
      kind: "line"
      start: SketchPointTarget
      startRelations: readonly SketchPointRelationInference[]
    }>
  | Readonly<{ kind: "midpoint-line"; midpoint: SketchPointTarget }>
  | Readonly<{ kind: "rectangle"; firstCorner: SketchPoint2 }>
  | Readonly<{ kind: "center-rectangle"; center: SketchPointTarget }>
  | Readonly<{ kind: "aligned-rectangle-end"; start: SketchPointTarget }>
  | Readonly<{
      end: SketchPointTarget
      kind: "aligned-rectangle-width"
      start: SketchPointTarget
    }>
  | Readonly<{ center: SketchPointTarget; kind: "centered-aligned-rectangle-side" }>
  | Readonly<{
      center: SketchPointTarget
      kind: "centered-aligned-rectangle-width"
      side: SketchPointTarget
    }>
  | Readonly<{ kind: "circle"; center: SketchPointTarget }>
  | Readonly<{ kind: "ellipse-primary"; center: SketchPointTarget }>
  | Readonly<{
      center: SketchPointTarget
      kind: "ellipse-secondary"
      primaryAxisPoint: SketchPointTarget
    }>
  | Readonly<{ center: SketchPointTarget; kind: "elliptical-arc-primary" }>
  | Readonly<{
      center: SketchPointTarget
      kind: "elliptical-arc-start"
      primaryAxisPoint: SketchPointTarget
    }>
  | Readonly<{
      center: SketchPointTarget
      kind: "elliptical-arc-end"
      primaryAxisPoint: SketchPointTarget
      secondaryAxisPoint: SketchPoint2
      startPoint: SketchPointTarget
    }>
  | Readonly<{
      center: SketchPointTarget
      kind: "regular-polygon-radius"
      mode: RegularPolygonMode
    }>
  | Readonly<{
      center: SketchPointTarget
      kind: "regular-polygon-sides"
      mode: RegularPolygonMode
      radiusPoint: SketchPointTarget
      sideCountInput: string | null
    }>
  | Readonly<{ kind: "arc-start"; center: SketchPoint2 }>
  | Readonly<{ kind: "arc-end"; center: SketchPoint2; start: SketchPoint2 }>
  | Readonly<{ kind: "three-point-arc-end"; start: SketchPointTarget }>
  | Readonly<{
      kind: "three-point-arc-point"
      end: SketchPointTarget
      start: SketchPointTarget
    }>
  | Readonly<{ kind: "three-point-circle-second"; first: SketchPointTarget }>
  | Readonly<{
      kind: "three-point-circle-third"
      first: SketchPointTarget
      second: SketchPointTarget
    }>
  | Readonly<{
      kind: "tangent-arc"
      lineId: SketchEntityId
      startPointId: SketchEntityId
    }>
  | Readonly<{
      circleId: SketchEntityId
      firstPoint: SketchPoint2
      kind: "split-circle-second"
    }>
  | Readonly<{
      ellipseId: SketchEntityId
      firstPoint: SketchPoint2
      kind: "split-ellipse-second"
    }>
  | Readonly<{ axisLineId: SketchEntityId; kind: "mirror-sources" }>
  | Readonly<{
      kind: "offset-distance"
      lineIds: readonly SketchEntityId[]
      referenceLineId: SketchEntityId
    }>
  | Readonly<{ kind: "slot-end"; start: SketchPointTarget }>
  | Readonly<{
      end: SketchPointTarget
      kind: "slot-width"
      start: SketchPointTarget
    }>
  | Readonly<{ center: SketchPointTarget; kind: "centered-slot-end" }>
  | Readonly<{
      center: SketchPointTarget
      end: SketchPointTarget
      kind: "centered-slot-width"
    }>
  | Readonly<{ kind: "slot-from-selection-width"; lineId: SketchEntityId }>

type PanGesture = Readonly<{
  bounds: SketchBounds
  clientX: number
  clientY: number
  pointerId: number
}>

type SecondaryPointerGesture = Readonly<{
  clientX: number
  clientY: number
  moved: boolean
  pendingContextMenu: Readonly<{
    clientX: number
    clientY: number
    target: Element
  }> | null
  pointerId: number
  released: boolean
}>

const MIN_VIEW_WIDTH = 200
const MIN_VIEW_HEIGHT = 150
const LIVE_DRAG_SOLVE_INTERVAL_MS = 32
const DENSE_DRAG_IDLE_SOLVE_DELAY_MS = 120
const DENSE_DRAG_SOLVE_COMPLEXITY = 128
const VERY_DENSE_DRAG_SOLVE_COMPLEXITY = 512
const SECONDARY_DRAG_CONTEXT_MENU_THRESHOLD_PX = 4
const DRAG_INFERENCE_FALLBACK_VIEWPORT = { height: 600, width: 800 } as const
const DEFAULT_REGULAR_POLYGON_SIDES = 6

function createSketchSolveScheduler(solveSketch: SketchSolveFunction): SketchSolveScheduler {
  return {
    disposed: false,
    inFlight: false,
    latestRequest: null,
    latestSketch: null,
    latestSolution: null,
    nextRequestId: 1,
    solveSketch,
    timer: null,
  }
}

async function executeSketchSolveRequest(
  scheduler: SketchSolveScheduler,
  request: SketchSolveRequest,
) {
  try {
    return await scheduler.solveSketch(request.revision, request.sketch, {
      continuation: request.resetContinuation
        ? null
        : continuationForSketch(scheduler.latestSolution, request.sketch),
      draggedPoints: request.dragTarget ? [request.dragTarget] : [],
    })
  } catch {
    return null
  }
}

function solveStateForResult(
  request: SketchSolveRequest,
  result: ActiveSketchSolveResult | null,
): SolveState {
  return result?.ok
    ? {
        dragTarget: request.dragTarget,
        kind: "solved",
        solution: result.response.solution,
        sourceSketch: request.sketch,
      }
    : { dragTarget: request.dragTarget, kind: "error", sourceSketch: request.sketch }
}

function clearSketchSolveTimer(scheduler: SketchSolveScheduler) {
  if (scheduler.timer === null) return
  window.clearTimeout(scheduler.timer)
  scheduler.timer = null
}

async function drainLatestSketchSolve(
  scheduler: SketchSolveScheduler,
  publish: (state: SolveState) => void,
) {
  if (scheduler.inFlight) return
  scheduler.inFlight = true
  try {
    let request = scheduler.latestRequest
    while (request && !scheduler.disposed) {
      clearSketchSolveTimer(scheduler)
      const result = await executeSketchSolveRequest(scheduler, request)
      if (result?.ok) scheduler.latestSolution = result.response.solution
      const latestRequest = scheduler.latestRequest
      if (!latestRequest || scheduler.disposed) return
      if (latestRequest.requestId !== request.requestId) {
        request = latestRequest
        continue
      }
      publish(solveStateForResult(request, result))
      scheduler.latestRequest = null
      return
    }
  } finally {
    scheduler.inFlight = false
  }
}

function resetInactiveSketchSolveScheduler(
  scheduler: SketchSolveScheduler,
  clearSolution: boolean,
) {
  if (clearSolution) {
    scheduler.latestSketch = null
    scheduler.latestSolution = null
  }
  scheduler.latestRequest = null
  scheduler.nextRequestId += 1
  clearSketchSolveTimer(scheduler)
}

function loadingSolveState(current: SolveState, request: SketchSolveRequest): SolveState {
  if (current.kind === "loading" && current.sourceSketch.id === request.sketch.id) return current
  return {
    dragTarget: request.dragTarget,
    kind: "loading",
    previousSolution: request.resetContinuation
      ? null
      : solutionForSketch(current, request.sketch.id),
    sourceSketch: request.sketch,
  }
}

function scheduleSketchSolve(
  scheduler: SketchSolveScheduler,
  request: SketchSolveRequest,
  publish: (state: SolveState) => void,
) {
  if (request.dragTarget) {
    clearSketchSolveTimer(scheduler)
    void drainLatestSketchSolve(scheduler, publish)
    return
  }
  clearSketchSolveTimer(scheduler)
  scheduler.timer = window.setTimeout(() => {
    scheduler.timer = null
    void drainLatestSketchSolve(scheduler, publish)
  }, 30)
}

function useSketchSolution(
  controller: DocumentControllerState,
  sketch: SketchRecord | null,
  solveSketch: SketchSolveFunction,
  dragTarget: SketchDragTarget | null,
): SolveState {
  const [state, setState] = useState<SolveState>({ kind: "idle" })
  const stableDragTarget = useMemo(
    () =>
      dragTarget
        ? {
            entityId: dragTarget.entityId,
            x: dragTarget.x,
            y: dragTarget.y,
          }
        : null,
    [dragTarget?.entityId, dragTarget?.x, dragTarget?.y],
  )
  const schedulerRef = useRef<SketchSolveScheduler | null>(null)
  if (!schedulerRef.current) schedulerRef.current = createSketchSolveScheduler(solveSketch)
  const scheduler = schedulerRef.current
  const revision = controller.report?.snapshot.revision
  const rebuildOk = controller.report?.rebuild.ok === true
  scheduler.solveSketch = solveSketch

  useEffect(() => {
    scheduler.disposed = false
    return () => {
      scheduler.disposed = true
      scheduler.latestRequest = null
      if (scheduler.timer !== null) window.clearTimeout(scheduler.timer)
    }
  }, [scheduler])

  useEffect(() => {
    if (!sketch || revision === undefined || !rebuildOk) {
      resetInactiveSketchSolveScheduler(scheduler, sketch === null)
      setState((current) => (current.kind === "idle" ? current : { kind: "idle" }))
      return
    }

    const resetContinuation =
      dragTarget === null && authoredSketchGeometryChanged(scheduler.latestSketch, sketch)
    scheduler.latestSketch = sketch
    if (resetContinuation) scheduler.latestSolution = null
    const request: SketchSolveRequest = {
      dragTarget: stableDragTarget,
      requestId: scheduler.nextRequestId,
      resetContinuation,
      revision,
      sketch,
    }
    scheduler.nextRequestId += 1
    scheduler.latestRequest = request
    setState((current) => loadingSolveState(current, request))
    scheduleSketchSolve(scheduler, request, setState)
    return () => {
      clearSketchSolveTimer(scheduler)
    }
  }, [rebuildOk, revision, scheduler, sketch, solveSketch, stableDragTarget])

  return state
}

function solutionForSketch(solveState: SolveState, sketchId: SketchRecord["id"]) {
  if (solveState.kind === "idle" || solveState.kind === "error") return null
  if (solveState.sourceSketch.id !== sketchId) return null
  return solveState.kind === "solved" ? solveState.solution : solveState.previousSolution
}

function authoredSketchGeometryChanged(previous: SketchRecord | null, next: SketchRecord) {
  if (!previous || previous.id !== next.id) return false
  const previousEntities = new Map(previous.entities.map((entity) => [entity.id, entity]))
  return next.entities.some((entity) => {
    const prior = previousEntities.get(entity.id)
    if (entity.type === "point" && prior?.type === "point") {
      return entity.x !== prior.x || entity.y !== prior.y
    }
    return entity.type === "circle" && prior?.type === "circle" && entity.radius !== prior.radius
  })
}

function solvedSolution(solveState: SolveState): SolvedSketchWire | null {
  return solveState.kind === "solved" ? solveState.solution : null
}

function dragTargetForSketch(
  activeSketch: SketchRecord | null,
  dragState: SketchDragState | null,
): SketchDragTarget | null {
  if (!activeSketch || dragState?.sketchId !== activeSketch.id) return null
  return dragState.target
}

function releasedDragTargetForSketch(
  activeSketch: SketchRecord | null,
  dragState: SketchDragState | null,
) {
  return dragState?.active === false ? dragTargetForSketch(activeSketch, dragState) : null
}

function nextSketchDragState(
  activeSketch: SketchRecord | null,
  current: SketchDragState | null,
  pointId: SketchEntityId | null,
  point?: SketchPoint2,
): SketchDragState | null {
  if (!pointId) return current === null || !current.active ? current : { ...current, active: false }
  if (!activeSketch) return null
  const authoredPoint = authoredPoints(activeSketch).find(({ id }) => id === pointId)
  const target = point ?? authoredPoint
  if (!target) return null
  if (dragStateMatchesTarget(current, pointId, target)) return current
  return {
    active: true,
    pointId,
    sketchId: activeSketch.id,
    target: { entityId: pointId, x: target.x, y: target.y },
  }
}

function dragStateMatchesTarget(
  state: SketchDragState | null,
  pointId: SketchEntityId,
  target: SketchPoint2,
) {
  if (state === null || !state.active || state.pointId !== pointId) return false
  return state.target.x === target.x && state.target.y === target.y
}

function useDraggingPointChange(
  activeSketch: SketchRecord | null,
  setDragState: Dispatch<SetStateAction<SketchDragState | null>>,
) {
  return useCallback(
    (pointId: SketchEntityId | null, point?: SketchPoint2) =>
      setDragState((current) => nextSketchDragState(activeSketch, current, pointId, point)),
    [activeSketch, setDragState],
  )
}

function sketchDisplaySolution(activeSketch: SketchRecord | null, solveState: SolveState) {
  return activeSketch ? solutionForSketch(solveState, activeSketch.id) : null
}

function continuationForSketch(solution: SolvedSketchWire | null, sketch: SketchRecord) {
  if (!solution || solution.sketchId !== sketch.id) return null
  const pointIds = new Set<string>(
    sketch.entities.flatMap((entity) => (entity.type === "point" ? [entity.id] : [])),
  )
  const circleIds = new Set<string>(
    sketch.entities.flatMap((entity) => (entity.type === "circle" ? [entity.id] : [])),
  )
  return {
    schemaVersion: 0 as const,
    sketchId: solution.sketchId,
    sourceRevision: solution.sourceRevision,
    points: solution.points.filter(({ entityId }) => pointIds.has(entityId)),
    circles: solution.circles.filter(({ entityId }) => circleIds.has(entityId)),
  }
}

function authoredPoints(sketch: SketchRecord) {
  return sketch.entities.filter(
    (entity): entity is Extract<SketchEntity, { type: "point" }> => entity.type === "point",
  )
}

function displayPoints(sketch: SketchRecord, solution: SolvedSketchWire | null) {
  const solvedById = new Map(solution?.points.map((point) => [point.entityId, point]))
  return authoredPoints(sketch).map((point): DisplayPoint => {
    const solved = solvedById.get(point.id)
    return {
      construction: point.construction,
      id: point.id,
      x: solved?.x ?? point.x,
      y: solved?.y ?? point.y,
    }
  })
}

type ExternalReference = NonNullable<SketchRecord["externalReferences"]>[number]

function displayExternalCurve(
  reference: Extract<ExternalReference, { kind: "curve" | "model-curve" }>,
  solvedById: ReadonlyMap<string, SketchPoint2>,
) {
  const projected = projectedExternalSketchEntities([reference])
  const curve = projected.find(
    (entity): entity is DisplayExternalCurve => entity.type !== "point" && entity.type !== "line",
  )
  const points = projected.filter(
    (entity): entity is Extract<SketchEntity, { type: "point" }> => entity.type === "point",
  )
  const solvedPoints = points.flatMap((point) => {
    const solved = solvedById.get(point.id)
    return solved
      ? [
          {
            construction: true,
            id: point.id,
            reusable: false,
            x: solved.x,
            y: solved.y,
          } satisfies DisplayPoint,
        ]
      : []
  })
  return curve && solvedPoints.length === points.length ? { curve, points: solvedPoints } : null
}

function displayExternalLine(
  reference: Extract<ExternalReference, { kind: "line" | "model-line" | "model-intersection" }>,
  solvedById: ReadonlyMap<string, SketchPoint2>,
): DisplayExternalLine | null {
  const start = solvedById.get(reference.projectedStartPointId)
  const end = solvedById.get(reference.projectedEndPointId)
  if (!start || !end) return null
  return {
    id: reference.projectedLineId,
    start: {
      construction: true,
      id: reference.projectedStartPointId,
      reusable: false,
      ...start,
    },
    end: {
      construction: true,
      id: reference.projectedEndPointId,
      reusable: false,
      ...end,
    },
  }
}

function displayExternalReference(
  reference: ExternalReference,
  solvedById: ReadonlyMap<string, SketchPoint2>,
) {
  if (reference.kind === "curve" || reference.kind === "model-curve") {
    const curve = displayExternalCurve(reference, solvedById)
    return curve ? { curves: [curve.curve], lines: [], points: curve.points } : null
  }
  if (
    reference.kind === "line" ||
    reference.kind === "model-line" ||
    reference.kind === "model-intersection"
  ) {
    const line = displayExternalLine(reference, solvedById)
    return line ? { curves: [], lines: [line], points: [] } : null
  }
  const point = solvedById.get(reference.projectedPointId)
  return point
    ? {
        curves: [],
        lines: [],
        points: [
          {
            construction: true,
            id: reference.projectedPointId,
            reusable: false,
            x: point.x,
            y: point.y,
          } satisfies DisplayPoint,
        ],
      }
    : null
}

function displayExternalGeometry(sketch: SketchRecord, solution: SolvedSketchWire | null) {
  const solvedById = new Map(solution?.points.map((point) => [point.entityId, point]))
  const externalPoints: DisplayPoint[] = []
  const externalLines: DisplayExternalLine[] = []
  const externalCurves: DisplayExternalCurve[] = []
  for (const reference of sketch.externalReferences ?? []) {
    const display = displayExternalReference(reference, solvedById)
    if (!display) continue
    externalCurves.push(...display.curves)
    externalLines.push(...display.lines)
    externalPoints.push(...display.points)
  }
  return { externalCurves, externalLines, externalPoints }
}

function createSketchGeometryPresentation(
  sketch: SketchRecord,
  solution: SolvedSketchWire | null,
): SketchGeometryPresentation {
  const points = displayPoints(sketch, solution)
  const { externalCurves, externalLines, externalPoints } = displayExternalGeometry(
    sketch,
    solution,
  )
  const pointsById = new Map(
    [...points, ...externalPoints, ...externalLines.flatMap(({ start, end }) => [start, end])].map(
      (point) => [point.id, point],
    ),
  )
  const curves = sketch.entities.filter(
    (entity): entity is SketchCurveEntity => entity.type !== "point",
  )
  const curvesById = new Map(curves.map((curve) => [curve.id, curve]))
  const localPointsById = new Map(points.map((point) => [point.id, point]))
  const centerPointIds = new Set<SketchEntityId>(
    curves.flatMap((curve) => ("centerPointId" in curve ? [curve.centerPointId] : [])),
  )
  const curvesByPointId = new Map<string, SketchCurveEntity[]>()
  for (const curve of curves) {
    for (const pointId of sketchCurvePointIds(curve)) {
      const incident = curvesByPointId.get(pointId)
      if (incident) incident.push(curve)
      else curvesByPointId.set(pointId, [curve])
    }
  }
  return {
    centerPointIds,
    curves,
    curvesById,
    curvesByPointId,
    externalLines,
    externalPoints,
    externalCurves,
    localPointsById,
    points,
    pointsById,
    solvedCircles: new Map(solution?.circles.map((circle) => [circle.entityId, circle.radius])),
  }
}

function sketchBounds(points: readonly SketchPoint2[]): SketchBounds {
  if (points.length === 0) {
    return { minX: -MIN_VIEW_WIDTH / 2, minY: -MIN_VIEW_HEIGHT / 2, width: 200, height: 150 }
  }
  const xs = points.map(({ x }) => x)
  const ys = points.map(({ y }) => y)
  const minX = Math.min(...xs)
  const maxX = Math.max(...xs)
  const minY = Math.min(...ys)
  const maxY = Math.max(...ys)
  const centerX = (minX + maxX) / 2
  const centerY = (minY + maxY) / 2
  const width = Math.max(maxX - minX + 40, MIN_VIEW_WIDTH)
  const height = Math.max(maxY - minY + 40, MIN_VIEW_HEIGHT)
  return { minX: centerX - width / 2, minY: centerY - height / 2, width, height }
}

function expandedSketchBounds(bounds: SketchBounds, points: readonly SketchPoint2[]): SketchBounds {
  if (points.length === 0) return bounds
  const candidates = sketchBounds(points)
  const minX = Math.min(bounds.minX, candidates.minX)
  const minY = Math.min(bounds.minY, candidates.minY)
  const maxX = Math.max(bounds.minX + bounds.width, candidates.minX + candidates.width)
  const maxY = Math.max(bounds.minY + bounds.height, candidates.minY + candidates.height)
  const next = { minX, minY, width: maxX - minX, height: maxY - minY }
  return next.minX === bounds.minX &&
    next.minY === bounds.minY &&
    next.width === bounds.width &&
    next.height === bounds.height
    ? bounds
    : next
}

function pointerToSketchPoint(
  pointer: Readonly<{ clientX: number; clientY: number }>,
  rectangle: Readonly<{ left: number; top: number; width: number; height: number }>,
  bounds: SketchBounds,
): SketchPoint2 {
  const scale = Math.min(
    bounds.width > 0 ? rectangle.width / bounds.width : 0,
    bounds.height > 0 ? rectangle.height / bounds.height : 0,
  )
  const contentWidth = bounds.width * scale
  const contentHeight = bounds.height * scale
  const contentLeft = rectangle.left + (rectangle.width - contentWidth) / 2
  const contentTop = rectangle.top + (rectangle.height - contentHeight) / 2
  const horizontal = contentWidth > 0 ? (pointer.clientX - contentLeft) / contentWidth : 0
  const vertical = contentHeight > 0 ? (pointer.clientY - contentTop) / contentHeight : 0
  return {
    x: bounds.minX + horizontal * bounds.width,
    y: bounds.minY + (1 - vertical) * bounds.height,
  }
}

function pointForTarget(sketch: SketchRecord, target: SketchPointTarget) {
  if (target.kind === "new") return target.point
  const point = sketch.entities.find(
    (entity): entity is Extract<SketchEntity, { type: "point" }> =>
      entity.id === target.pointId && entity.type === "point",
  )
  return point ? { x: point.x, y: point.y } : { x: 0, y: 0 }
}

function positiveSweep(start: SketchPoint2, end: SketchPoint2, center: SketchPoint2) {
  const fullTurn = Math.PI * 2
  const startAngle = Math.atan2(start.y - center.y, start.x - center.x)
  const endAngle = Math.atan2(end.y - center.y, end.x - center.x)
  return (((endAngle - startAngle) % fullTurn) + fullTurn) % fullTurn
}

function arcPolyline(
  center: SketchPoint2,
  start: SketchPoint2,
  end: SketchPoint2,
  segmentCount = 48,
) {
  return arcPoints(center, start, end, segmentCount)
    .map(({ x, y }) => `${x},${y}`)
    .join(" ")
}

function arcPoints(
  center: SketchPoint2,
  start: SketchPoint2,
  end: SketchPoint2,
  segmentCount = 48,
) {
  const radius = Math.hypot(start.x - center.x, start.y - center.y)
  const startAngle = Math.atan2(start.y - center.y, start.x - center.x)
  const sweep = positiveSweep(start, end, center)
  return Array.from({ length: segmentCount + 1 }, (_, index) => {
    const angle = startAngle + sweep * (index / segmentCount)
    return {
      x: center.x + Math.cos(angle) * radius,
      y: center.y + Math.sin(angle) * radius,
    }
  })
}

function profileSelectors(solution: SolvedSketchWire): readonly SketchProfileSelector[] {
  return solution.profileResult.profiles.flatMap((profile) => {
    const outer = solution.profileResult.loops[profile.outerLoopIndex]
    const holes = profile.holeLoopIndices.map((index) => solution.profileResult.loops[index])
    if (!outer || holes.some((loop) => !loop)) return []
    const parsed = sketchProfileSelectorSchema.safeParse({
      schemaVersion: 0,
      sketchId: solution.sketchId,
      outerBoundaryEntityIds: [...new Set(outer.sourceEntityIds)].sort(),
      holeBoundaryEntityIds: holes
        .flatMap((loop) => (loop ? [[...new Set(loop.sourceEntityIds)].sort()] : []))
        .sort((left, right) => left.join(":").localeCompare(right.join(":"))),
    })
    return parsed.success ? [parsed.data] : []
  })
}

function validConstraintIds(ids: readonly string[]) {
  return ids.flatMap((id) => {
    const parsed = sketchConstraintIdSchema.safeParse(id)
    return parsed.success ? [parsed.data] : []
  })
}

function toggleSelection(
  current: readonly SketchEntityId[],
  entityId: SketchEntityId,
  additive: boolean,
) {
  if (!additive) return [entityId]
  return current.includes(entityId)
    ? current.filter((candidate) => candidate !== entityId)
    : [...current, entityId]
}

function profileKey(profile: SketchProfileSelector | null) {
  return profile
    ? `${profile.outerBoundaryEntityIds.join(":")}|${profile.holeBoundaryEntityIds
        .map((hole) => hole.join(":"))
        .join("|")}`
    : null
}

function lineSamples(
  entity: Extract<SketchEntity, { type: "line" }>,
  points: ReadonlyMap<string, DisplayPoint>,
  reversed: boolean,
) {
  const start = points.get(entity.startPointId)
  const end = points.get(entity.endPointId)
  if (!start || !end) return null
  return reversed ? [end, start] : [start, end]
}

function arcSamples(
  entity: Extract<SketchEntity, { type: "arc" }>,
  points: ReadonlyMap<string, DisplayPoint>,
  reversed: boolean,
) {
  const center = points.get(entity.centerPointId)
  const start = points.get(entity.startPointId)
  const end = points.get(entity.endPointId)
  if (!center || !start || !end) return null
  const samples = arcPoints(center, start, end)
  return reversed ? samples.reverse() : samples
}

function circleSamples(
  entity: Extract<SketchEntity, { type: "circle" }>,
  points: ReadonlyMap<string, DisplayPoint>,
  solvedCircles: ReadonlyMap<string, number>,
  reversed: boolean,
) {
  const center = points.get(entity.centerPointId)
  if (!center) return null
  const radius = solvedCircles.get(entity.id) ?? entity.radius
  const samples = Array.from({ length: 65 }, (_, index) => {
    const angle = (Math.PI * 2 * index) / 64
    return { x: center.x + Math.cos(angle) * radius, y: center.y + Math.sin(angle) * radius }
  })
  return reversed ? samples.reverse() : samples
}

function ellipseGeometry(
  entity: Extract<SketchEntity, { type: "ellipse" }>,
  points: SketchPointLookup,
) {
  const center = points.get(entity.centerPointId)
  const primaryAxisPoint = points.get(entity.primaryAxisPointId)
  const secondaryAxisPoint = points.get(entity.secondaryAxisPointId)
  return center && primaryAxisPoint && secondaryAxisPoint
    ? sketchEllipseGeometry(center, primaryAxisPoint, secondaryAxisPoint)
    : null
}

function ellipseSamples(
  entity: Extract<SketchEntity, { type: "ellipse" }>,
  points: ReadonlyMap<string, DisplayPoint>,
  reversed: boolean,
) {
  const geometry = ellipseGeometry(entity, points)
  if (!geometry) return null
  const primaryDirection = {
    x: (geometry.primaryAxisPoint.x - geometry.center.x) / geometry.primaryRadius,
    y: (geometry.primaryAxisPoint.y - geometry.center.y) / geometry.primaryRadius,
  }
  const secondaryDirection = {
    x: (geometry.secondaryAxisPoint.x - geometry.center.x) / geometry.secondaryRadius,
    y: (geometry.secondaryAxisPoint.y - geometry.center.y) / geometry.secondaryRadius,
  }
  const samples = Array.from({ length: 65 }, (_, index) => {
    const angle = (Math.PI * 2 * index) / 64
    return {
      x:
        geometry.center.x +
        Math.cos(angle) * geometry.primaryRadius * primaryDirection.x +
        Math.sin(angle) * geometry.secondaryRadius * secondaryDirection.x,
      y:
        geometry.center.y +
        Math.cos(angle) * geometry.primaryRadius * primaryDirection.y +
        Math.sin(angle) * geometry.secondaryRadius * secondaryDirection.y,
    }
  })
  return reversed ? samples.reverse() : samples
}

function ellipticalArcGeometry(
  entity: Extract<SketchEntity, { type: "elliptical-arc" }>,
  points: SketchPointLookup,
) {
  const center = points.get(entity.centerPointId)
  const primaryAxisPoint = points.get(entity.primaryAxisPointId)
  const secondaryAxisPoint = points.get(entity.secondaryAxisPointId)
  const startPoint = points.get(entity.startPointId)
  const endPoint = points.get(entity.endPointId)
  return center && primaryAxisPoint && secondaryAxisPoint && startPoint && endPoint
    ? sketchEllipticalArcGeometry(
        center,
        primaryAxisPoint,
        secondaryAxisPoint,
        startPoint,
        endPoint,
      )
    : null
}

function ellipticalArcGeometrySamples(
  geometry: NonNullable<ReturnType<typeof sketchEllipticalArcGeometry>>,
) {
  const segmentCount = Math.max(8, Math.ceil((geometry.sweep / (Math.PI * 2)) * 64))
  return Array.from({ length: segmentCount + 1 }, (_, index) =>
    sketchEllipsePointAt(
      geometry,
      geometry.startParameter + (geometry.sweep * index) / segmentCount,
    ),
  )
}

function ellipticalArcSamples(
  entity: Extract<SketchEntity, { type: "elliptical-arc" }>,
  points: ReadonlyMap<string, DisplayPoint>,
  reversed: boolean,
) {
  const geometry = ellipticalArcGeometry(entity, points)
  if (!geometry) return null
  const samples = ellipticalArcGeometrySamples(geometry)
  return reversed ? samples.reverse() : samples
}

function segmentSamples(
  entity: SketchEntity,
  points: ReadonlyMap<string, DisplayPoint>,
  solvedCircles: ReadonlyMap<string, number>,
  reversed: boolean,
) {
  switch (entity.type) {
    case "line":
      return lineSamples(entity, points, reversed)
    case "arc":
      return arcSamples(entity, points, reversed)
    case "circle":
      return circleSamples(entity, points, solvedCircles, reversed)
    case "ellipse":
      return ellipseSamples(entity, points, reversed)
    case "elliptical-arc":
      return ellipticalArcSamples(entity, points, reversed)
    case "point":
      return null
  }
}

function loopPath(loopIndex: number, sketch: SketchRecord, solution: SolvedSketchWire) {
  const loop = solution.profileResult.loops[loopIndex]
  if (!loop) return null
  const entities = new Map<string, SketchEntity>(
    sketch.entities.map((entity) => [entity.id, entity]),
  )
  const points = new Map<string, DisplayPoint>(
    displayPoints(sketch, solution).map((point) => [point.id, point]),
  )
  const solvedCircles = new Map<string, number>(
    solution.circles.map((circle) => [circle.entityId, circle.radius]),
  )
  const path: string[] = []
  for (const segment of loop.segments) {
    const entity = entities.get(segment.entityId)
    if (!entity) return null
    const samples = segmentSamples(entity, points, solvedCircles, segment.reversed)
    if (!samples) return null
    for (const [index, point] of samples.entries()) {
      path.push(`${path.length === 0 && index === 0 ? "M" : "L"} ${point.x} ${point.y}`)
    }
  }
  path.push("Z")
  return path.join(" ")
}

function ProfileRegion({
  editable,
  editorTool,
  onSelect,
  profile,
  selectedKey,
  selector,
  sketch,
  solution,
}: {
  editable: boolean
  editorTool: SketchEditorTool
  onSelect: (profile: SketchProfileSelector) => void
  profile: SolvedSketchWire["profileResult"]["profiles"][number]
  selectedKey: string | null
  selector: SketchProfileSelector | undefined
  sketch: SketchRecord
  solution: SolvedSketchWire
}) {
  if (!selector) return null
  const loopIndices = [profile.outerLoopIndex, ...profile.holeLoopIndices]
  const path = loopIndices
    .map((loopIndex) => loopPath(loopIndex, sketch, solution))
    .filter((value): value is string => value !== null)
    .join(" ")
  if (!path) return null
  const selected = profileKey(selector) === selectedKey
  return (
    <path
      d={path}
      data-sketch-profile-index={profile.profileIndex}
      className={selected ? "fill-primary/25 stroke-primary" : "fill-primary/10 stroke-none"}
      strokeWidth={1}
      vectorEffect="non-scaling-stroke"
      pointerEvents={!editable || editorTool === "select" ? "auto" : "none"}
      onPointerDown={(event) => {
        event.stopPropagation()
        onSelect(selector)
      }}
    />
  )
}

function ProfileRegions({
  editable,
  editorTool,
  onSelect,
  profiles,
  selectedProfile,
  sketch,
  solution,
}: {
  editable: boolean
  editorTool: SketchEditorTool
  onSelect: (profile: SketchProfileSelector) => void
  profiles: readonly SketchProfileSelector[]
  selectedProfile: SketchProfileSelector | null
  sketch: SketchRecord
  solution: SolvedSketchWire | null
}) {
  if (!solution) return null
  const selectedKey = profileKey(selectedProfile)
  return (
    <g transform="scale(1 -1)" fillRule="evenodd">
      {solution.profileResult.profiles.map((profile) => (
        <ProfileRegion
          key={profile.profileIndex}
          editable={editable}
          editorTool={editorTool}
          profile={profile}
          selectedKey={selectedKey}
          selector={profiles[profile.profileIndex]}
          sketch={sketch}
          solution={solution}
          onSelect={onSelect}
        />
      ))}
    </g>
  )
}

const StableProfileRegions = memo(ProfileRegions)

type CurveDrawingProps = Readonly<{
  hidden: boolean
  interactive: boolean
  onPointerDown: (event: PointerEvent<SVGElement>, entityId: SketchEntityId) => void
  points: SketchPointLookup
  preselected: boolean
  selected: boolean
  solvedRadius: number | undefined
}>

function sketchCurveClassName(construction: boolean, preselected: boolean, selected: boolean) {
  if (selected) return "stroke-ring"
  if (preselected) return "stroke-preselection"
  return construction ? "stroke-muted-foreground" : "stroke-primary"
}

function interactiveCurveDrawingProps(
  entity: Exclude<SketchEntity, { type: "point" }>,
  hidden: boolean,
  interactive: boolean,
  onPointerDown: CurveDrawingProps["onPointerDown"],
) {
  if (!interactive) return { pointerEvents: "none" as const }
  return {
    "data-sketch-entity-id": entity.id,
    "data-sketch-entity-type": entity.type,
    ...(hidden
      ? { pointerEvents: "none" as const }
      : {
          onPointerDown: (event: PointerEvent<SVGElement>) => onPointerDown(event, entity.id),
        }),
  }
}

function curveDrawingProps(
  entity: Exclude<SketchEntity, { type: "point" }>,
  hidden: boolean,
  interactive: boolean,
  preselected: boolean,
  selected: boolean,
  onPointerDown: CurveDrawingProps["onPointerDown"],
) {
  return {
    className: sketchCurveClassName(entity.construction, preselected, selected),
    "data-sketch-preselected": preselected ? "true" : undefined,
    fill: "none",
    opacity: hidden ? 0 : undefined,
    ...interactiveCurveDrawingProps(entity, hidden, interactive, onPointerDown),
    strokeDasharray: entity.construction ? "6 4" : undefined,
    strokeLinecap: "round" as const,
    strokeWidth: selected || preselected ? 3 : 2,
    vectorEffect: "non-scaling-stroke" as const,
  }
}

function curveHitAreaProps(
  entityId: SketchEntityId,
  onPointerDown: CurveDrawingProps["onPointerDown"],
) {
  return {
    "data-sketch-entity-id": entityId,
    "data-sketch-hit-area": "true",
    fill: "none",
    pointerEvents: "stroke" as const,
    stroke: "transparent",
    strokeLinecap: "round" as const,
    strokeWidth: 16,
    vectorEffect: "non-scaling-stroke" as const,
    onPointerDown: (event: PointerEvent<SVGElement>) => onPointerDown(event, entityId),
  }
}

function SketchLine({
  entity,
  hidden,
  interactive,
  onPointerDown,
  points,
  preselected,
  selected,
}: Omit<CurveDrawingProps, "solvedRadius"> & {
  entity: Extract<SketchEntity, { type: "line" }>
}) {
  const start = points.get(entity.startPointId)
  const end = points.get(entity.endPointId)
  if (!start || !end) return null
  return (
    <>
      {interactive && !hidden ? (
        <line
          {...curveHitAreaProps(entity.id, onPointerDown)}
          x1={start.x}
          y1={start.y}
          x2={end.x}
          y2={end.y}
        />
      ) : null}
      <line
        {...curveDrawingProps(entity, hidden, interactive, preselected, selected, onPointerDown)}
        x1={start.x}
        y1={start.y}
        x2={end.x}
        y2={end.y}
      />
    </>
  )
}

function SketchCircle({
  entity,
  hidden,
  interactive,
  onPointerDown,
  points,
  preselected,
  selected,
  solvedRadius,
}: CurveDrawingProps & { entity: Extract<SketchEntity, { type: "circle" }> }) {
  const center = points.get(entity.centerPointId)
  if (!center) return null
  return (
    <>
      {interactive && !hidden ? (
        <circle
          {...curveHitAreaProps(entity.id, onPointerDown)}
          cx={center.x}
          cy={center.y}
          r={solvedRadius ?? entity.radius}
        />
      ) : null}
      <circle
        {...curveDrawingProps(entity, hidden, interactive, preselected, selected, onPointerDown)}
        cx={center.x}
        cy={center.y}
        r={solvedRadius ?? entity.radius}
      />
    </>
  )
}

function SketchArc({
  entity,
  hidden,
  interactive,
  onPointerDown,
  points,
  preselected,
  selected,
}: Omit<CurveDrawingProps, "solvedRadius"> & {
  entity: Extract<SketchEntity, { type: "arc" }>
}) {
  const center = points.get(entity.centerPointId)
  const start = points.get(entity.startPointId)
  const end = points.get(entity.endPointId)
  if (!center || !start || !end) return null
  const pointsValue = arcPolyline(center, start, end)
  return (
    <>
      {interactive && !hidden ? (
        <polyline {...curveHitAreaProps(entity.id, onPointerDown)} points={pointsValue} />
      ) : null}
      <polyline
        {...curveDrawingProps(entity, hidden, interactive, preselected, selected, onPointerDown)}
        points={pointsValue}
      />
    </>
  )
}

function SketchEllipse({
  entity,
  hidden,
  interactive,
  onPointerDown,
  points,
  preselected,
  selected,
}: Omit<CurveDrawingProps, "solvedRadius"> & {
  entity: Extract<SketchEntity, { type: "ellipse" }>
}) {
  const geometry = ellipseGeometry(entity, points)
  if (!geometry) return null
  return (
    <>
      {interactive && !hidden ? (
        <ellipse
          {...curveHitAreaProps(entity.id, onPointerDown)}
          cx={geometry.center.x}
          cy={geometry.center.y}
          rx={geometry.primaryRadius}
          ry={geometry.secondaryRadius}
          transform={ellipseSvgTransform(geometry)}
        />
      ) : null}
      <ellipse
        {...curveDrawingProps(entity, hidden, interactive, preselected, selected, onPointerDown)}
        cx={geometry.center.x}
        cy={geometry.center.y}
        rx={geometry.primaryRadius}
        ry={geometry.secondaryRadius}
        transform={ellipseSvgTransform(geometry)}
      />
    </>
  )
}

function SketchEllipticalArc({
  entity,
  hidden,
  interactive,
  onPointerDown,
  points,
  preselected,
  selected,
}: Omit<CurveDrawingProps, "solvedRadius"> & {
  entity: Extract<SketchEntity, { type: "elliptical-arc" }>
}) {
  const geometry = ellipticalArcGeometry(entity, points)
  if (!geometry) return null
  const pointsValue = ellipticalArcGeometrySamples(geometry)
    .map(({ x, y }) => `${x},${y}`)
    .join(" ")
  return (
    <>
      {interactive && !hidden ? (
        <polyline {...curveHitAreaProps(entity.id, onPointerDown)} points={pointsValue} />
      ) : null}
      <polyline
        {...curveDrawingProps(entity, hidden, interactive, preselected, selected, onPointerDown)}
        points={pointsValue}
      />
    </>
  )
}

function sameDisplayPoint(left: DisplayPoint | undefined, right: DisplayPoint | undefined) {
  return (
    left === right ||
    (left !== undefined &&
      right !== undefined &&
      left.id === right.id &&
      left.x === right.x &&
      left.y === right.y &&
      left.construction === right.construction)
  )
}

const SketchCurve = memo(
  function SketchCurve(
    props: CurveDrawingProps & { entity: Exclude<SketchEntity, { type: "point" }> },
  ) {
    switch (props.entity.type) {
      case "line":
        return <SketchLine {...props} entity={props.entity} />
      case "circle":
        return <SketchCircle {...props} entity={props.entity} />
      case "arc":
        return <SketchArc {...props} entity={props.entity} />
      case "ellipse":
        return <SketchEllipse {...props} entity={props.entity} />
      case "elliptical-arc":
        return <SketchEllipticalArc {...props} entity={props.entity} />
    }
  },
  (previous, next) => {
    if (
      previous.entity !== next.entity ||
      previous.hidden !== next.hidden ||
      previous.interactive !== next.interactive ||
      previous.preselected !== next.preselected ||
      previous.selected !== next.selected ||
      previous.solvedRadius !== next.solvedRadius ||
      previous.onPointerDown !== next.onPointerDown
    ) {
      return false
    }
    return sketchCurvePointIds(next.entity).every((pointId) =>
      sameDisplayPoint(previous.points.get(pointId), next.points.get(pointId)),
    )
  },
)

type SketchPointDrawingProps = Readonly<{
  center: boolean
  draggable: boolean
  dragging: boolean
  editable: boolean
  markerScale: number
  modificationTarget: boolean
  onEntityAction: (event: PointerEvent<SVGElement>, entityId: SketchEntityId) => void
  onPointPointerDown: (event: PointerEvent<SVGCircleElement>, pointId: SketchEntityId) => void
  onSelect: (entityId: SketchEntityId, additive: boolean) => void
  onTarget: (target: SketchPointTarget) => void
  point: DisplayPoint
  selectable: boolean
  selected: boolean
}>

function sketchPointMarkerClass(
  selected: boolean,
  inferenceSource: boolean,
  construction: boolean,
) {
  if (selected) return "pointer-events-none fill-ring stroke-background"
  if (inferenceSource) return "pointer-events-none fill-background stroke-preselection"
  return construction
    ? "pointer-events-none fill-background stroke-muted-foreground"
    : "pointer-events-none fill-background stroke-primary"
}

function SketchPointMarker({
  center,
  dragging,
  inferenceSource = false,
  markerScale,
  point,
  selected,
}: Pick<SketchPointDrawingProps, "center" | "dragging" | "markerScale" | "point" | "selected"> & {
  inferenceSource?: boolean
}) {
  if (center) {
    const halfExtent = 3.5 * markerScale
    const centerClass = selected
      ? "pointer-events-none stroke-ring"
      : inferenceSource
        ? "pointer-events-none stroke-preselection"
        : "pointer-events-none stroke-primary"
    return (
      <g
        data-sketch-inference-source={inferenceSource ? point.id : undefined}
        data-sketch-point-role="center"
        className={centerClass}
        opacity={dragging ? 0 : undefined}
      >
        <line
          x1={point.x - halfExtent}
          x2={point.x + halfExtent}
          y1={point.y}
          y2={point.y}
          strokeWidth={1.5}
          vectorEffect="non-scaling-stroke"
        />
        <line
          x1={point.x}
          x2={point.x}
          y1={point.y - halfExtent}
          y2={point.y + halfExtent}
          strokeWidth={1.5}
          vectorEffect="non-scaling-stroke"
        />
      </g>
    )
  }
  const size = 6 * markerScale
  return (
    <rect
      data-sketch-inference-source={inferenceSource ? point.id : undefined}
      data-sketch-point-role="vertex"
      x={point.x - size / 2}
      y={point.y - size / 2}
      width={size}
      height={size}
      rx={size / 2}
      className={sketchPointMarkerClass(selected, inferenceSource, point.construction)}
      opacity={dragging ? 0 : undefined}
      strokeWidth={2}
      vectorEffect="non-scaling-stroke"
    />
  )
}

const SketchPoint = memo(function SketchPoint({
  center,
  draggable,
  dragging,
  editable,
  markerScale,
  modificationTarget,
  onEntityAction,
  onPointPointerDown,
  onSelect,
  onTarget,
  point,
  selectable,
  selected,
}: SketchPointDrawingProps) {
  return (
    <>
      <circle
        data-sketch-entity-id={dragging ? undefined : point.id}
        data-sketch-entity-type={dragging ? undefined : "point"}
        cx={point.x}
        cy={point.y}
        r={7 * markerScale}
        fill="transparent"
        pointerEvents="all"
        stroke="none"
        onPointerDown={(event) => {
          if (event.button !== 0) return
          event.stopPropagation()
          if (selectable) {
            onSelect(point.id, event.metaKey || event.ctrlKey || event.shiftKey)
            if (draggable) onPointPointerDown(event, point.id)
          } else if (modificationTarget) {
            onEntityAction(event, point.id)
          } else if (editable) {
            onTarget({ kind: "existing", pointId: point.id })
          }
        }}
      />
      <SketchPointMarker
        center={center}
        dragging={dragging}
        markerScale={markerScale}
        point={point}
        selected={selected}
      />
    </>
  )
}, sameSketchPointDrawingProps)

const stableSketchPointDrawingKeys = [
  "center",
  "draggable",
  "dragging",
  "editable",
  "markerScale",
  "modificationTarget",
  "onEntityAction",
  "onPointPointerDown",
  "onSelect",
  "onTarget",
  "selectable",
  "selected",
] as const satisfies readonly (keyof SketchPointDrawingProps)[]

function sameSketchPointDrawingProps(
  previous: SketchPointDrawingProps,
  next: SketchPointDrawingProps,
) {
  return (
    sameDisplayPoint(previous.point, next.point) &&
    stableSketchPointDrawingKeys.every((key) => previous[key] === next[key])
  )
}

type SketchCurveModificationSupport = (
  curve: SketchCurveEntity,
  pending: PendingGeometry | null,
) => boolean

const directModificationCurveTypes: ReadonlySet<SketchCurveEntity["type"]> = new Set([
  "arc",
  "circle",
  "ellipse",
  "elliptical-arc",
  "line",
])
const extendCurveTypes: ReadonlySet<SketchCurveEntity["type"]> = new Set([
  "arc",
  "elliptical-arc",
  "line",
])
const supportsEverySketchCurve: SketchCurveModificationSupport = () => true
const sketchCurveModificationSupport = {
  "circular-pattern": supportsEverySketchCurve,
  extend: (curve) => extendCurveTypes.has(curve.type),
  "linear-pattern": supportsEverySketchCurve,
  mirror: (curve, pending) => pending?.kind === "mirror-sources" || curve.type === "line",
  offset: (curve, pending) => pending?.kind !== "offset-distance" && curve.type === "line",
  split: (curve) => directModificationCurveTypes.has(curve.type),
  transform: supportsEverySketchCurve,
  trim: (curve) => directModificationCurveTypes.has(curve.type),
} satisfies Record<SketchModificationTool, SketchCurveModificationSupport>

function supportsSketchCurveModification(
  tool: SketchModificationTool,
  curve: SketchCurveEntity,
  pending: PendingGeometry | null,
) {
  return sketchCurveModificationSupport[tool](curve, pending)
}

function SketchGeometry({
  draggingPointId,
  editable,
  markerScale,
  onCurveAction,
  onPointPointerDown,
  onSelect,
  onTarget,
  pending,
  preselectedEntityId,
  selectedEntityIds,
  presentation,
  tool,
}: {
  draggingPointId: SketchDragTarget["entityId"] | null
  editable: boolean
  markerScale: number
  onCurveAction: (event: PointerEvent<SVGElement>, entityId: SketchEntityId) => void
  onPointPointerDown: (event: PointerEvent<SVGCircleElement>, pointId: SketchEntityId) => void
  onSelect: (entityId: SketchEntityId, additive: boolean) => void
  onTarget: (target: SketchPointTarget) => void
  pending: PendingGeometry | null
  preselectedEntityId: SketchEntityId | null
  selectedEntityIds: readonly SketchEntityId[]
  presentation: SketchGeometryPresentation
  tool: SketchEditorTool
}) {
  const selectable = editable && isSketchSelectionTool(tool)
  const modifiable = editable && isSketchModificationTool(tool)
  const mirrorSourceSelection = tool === "mirror" && pending?.kind === "mirror-sources"
  const transformSourceSelection = tool === "transform"
  const selectedIds = useMemo(() => {
    const ids = new Set(selectedEntityIds)
    if (pending?.kind === "mirror-sources") ids.add(pending.axisLineId)
    return ids
  }, [pending, selectedEntityIds])
  const geometryPointerDown = useCallback(
    (event: PointerEvent<SVGElement>, entityId: SketchEntityId) => {
      if (event.button !== 0 || (!selectable && !modifiable)) return
      event.stopPropagation()
      if (selectable) onSelect(entityId, event.metaKey || event.ctrlKey || event.shiftKey)
      else onCurveAction(event, entityId)
    },
    [modifiable, onCurveAction, onSelect, selectable],
  )
  return (
    <g transform="scale(1 -1)">
      {presentation.curves.map((entity) => (
        <SketchCurve
          key={entity.id}
          entity={entity}
          hidden={Boolean(
            draggingPointId &&
              sketchCurvePointIds(entity).some((pointId) => pointId === draggingPointId),
          )}
          interactive={
            !modifiable ||
            (isSketchModificationTool(tool) &&
              supportsSketchCurveModification(tool, entity, pending))
          }
          points={presentation.pointsById}
          preselected={preselectedEntityId === entity.id}
          selected={selectedIds.has(entity.id)}
          solvedRadius={presentation.solvedCircles.get(entity.id)}
          onPointerDown={geometryPointerDown}
        />
      ))}
      {presentation.points.map((point) => (
        <SketchPoint
          key={point.id}
          center={presentation.centerPointIds.has(point.id)}
          draggable={tool === "select"}
          dragging={point.id === draggingPointId}
          editable={editable && (!modifiable || mirrorSourceSelection || transformSourceSelection)}
          markerScale={markerScale}
          modificationTarget={mirrorSourceSelection || transformSourceSelection}
          onEntityAction={geometryPointerDown}
          point={point}
          selectable={selectable}
          selected={selectedIds.has(point.id)}
          onPointPointerDown={onPointPointerDown}
          onSelect={onSelect}
          onTarget={onTarget}
        />
      ))}
    </g>
  )
}

type ExternalUseCandidate = ExternalSketchGeometryCandidate | ExternalModelGeometryCandidate

const candidateKey = viewerSketchReferenceCandidateKey

function contextGeometryKey(geometry: ExternalSketchContextGeometry) {
  const entityId =
    geometry.kind === "line"
      ? geometry.sourceLineId
      : geometry.kind === "curve"
        ? geometry.sourceEntityId
        : geometry.sourcePointId
  return `${geometry.sourceSketchId}:${entityId}`
}

function externalReferenceSourceKey(
  reference: NonNullable<SketchRecord["externalReferences"]>[number],
) {
  if (reference.kind === "pierce-point") {
    return `pierce:${reference.sourceSketchId}:${reference.sourceLineId}`
  }
  if (
    reference.kind === "model-point" ||
    reference.kind === "model-line" ||
    reference.kind === "model-pierce-point" ||
    reference.kind === "model-curve" ||
    reference.kind === "model-intersection"
  ) {
    return `model:${reference.reference.featureId}:${reference.id}`
  }
  const entityId =
    reference.kind === "line"
      ? reference.sourceLineId
      : reference.kind === "curve"
        ? reference.sourceEntityId
        : reference.sourcePointId
  return `${reference.sourceSketchId}:${entityId}`
}

function SketchExternalPoints({
  markerScale,
  onSelect,
  points,
  selectedEntityIds,
}: Readonly<{
  markerScale: number
  onSelect: ((entityId: SketchEntityId, additive: boolean) => void) | null
  points: readonly DisplayPoint[]
  selectedEntityIds: readonly SketchEntityId[]
}>) {
  if (points.length === 0) return null
  const interactive = onSelect !== null
  const selected = new Set(selectedEntityIds)
  const markerExtent = 4 * markerScale
  return (
    <g
      aria-label="External sketch references"
      className={interactive ? undefined : "pointer-events-none"}
      data-sketch-external-reference-count={points.length}
      transform="scale(1 -1)"
    >
      {points.map((point) => (
        <g
          key={point.id}
          data-sketch-external-point-id={point.id}
          className={interactive ? "cursor-crosshair" : undefined}
          onPointerDown={(event) => {
            if (!interactive || event.button !== 0) return
            event.stopPropagation()
            onSelect?.(point.id, event.metaKey || event.ctrlKey || event.shiftKey)
          }}
        >
          <circle cx={point.x} cy={point.y} r={7 * markerScale} fill="transparent" stroke="none" />
          <line
            x1={point.x - markerExtent}
            x2={point.x + markerExtent}
            y1={point.y}
            y2={point.y}
            className={selected.has(point.id) ? "stroke-amber-500" : "stroke-sky-500"}
            strokeWidth={1}
            vectorEffect="non-scaling-stroke"
          />
          <line
            x1={point.x}
            x2={point.x}
            y1={point.y - markerExtent}
            y2={point.y + markerExtent}
            className={selected.has(point.id) ? "stroke-amber-500" : "stroke-sky-500"}
            strokeWidth={1}
            vectorEffect="non-scaling-stroke"
          />
        </g>
      ))}
    </g>
  )
}

function SketchExternalLines({
  editorTool,
  lines,
  onSelect,
  selectedEntityIds,
}: Readonly<{
  editorTool: SketchEditorTool
  lines: readonly DisplayExternalLine[]
  onSelect: (entityId: SketchEntityId, additive: boolean) => void
  selectedEntityIds: readonly SketchEntityId[]
}>) {
  if (lines.length === 0) return null
  const selectable = isSketchSelectionTool(editorTool)
  const selected = new Set(selectedEntityIds)
  return (
    <g
      aria-label="External sketch lines"
      data-sketch-external-line-count={lines.length}
      transform="scale(1 -1)"
    >
      {lines.map((line) => (
        <g key={line.id} data-sketch-external-line-id={line.id}>
          {selectable ? (
            <line
              x1={line.start.x}
              y1={line.start.y}
              x2={line.end.x}
              y2={line.end.y}
              className="cursor-pointer stroke-transparent"
              strokeWidth={10}
              vectorEffect="non-scaling-stroke"
              onPointerDown={(event) => {
                if (event.button !== 0) return
                event.stopPropagation()
                onSelect(line.id, event.metaKey || event.ctrlKey || event.shiftKey)
              }}
            />
          ) : null}
          <line
            x1={line.start.x}
            y1={line.start.y}
            x2={line.end.x}
            y2={line.end.y}
            className={
              selected.has(line.id)
                ? "pointer-events-none stroke-amber-500"
                : "pointer-events-none stroke-sky-500"
            }
            strokeDasharray="5 3"
            strokeWidth={selected.has(line.id) ? 2.5 : 1.75}
            vectorEffect="non-scaling-stroke"
          />
        </g>
      ))}
    </g>
  )
}

function SketchExternalCurves({
  curves,
  editorTool,
  onSelect,
  points,
  selectedEntityIds,
  solvedCircles,
}: Readonly<{
  curves: readonly DisplayExternalCurve[]
  editorTool: SketchEditorTool
  onSelect: (entityId: SketchEntityId, additive: boolean) => void
  points: SketchPointLookup
  selectedEntityIds: readonly SketchEntityId[]
  solvedCircles: ReadonlyMap<string, number>
}>) {
  if (curves.length === 0) return null
  const selectable = isSketchSelectionTool(editorTool)
  const selected = new Set(selectedEntityIds)
  return (
    <g
      aria-label="External sketch curves"
      data-sketch-external-curve-count={curves.length}
      transform="scale(1 -1)"
    >
      {curves.map((curve) => (
        <SketchCurve
          key={curve.id}
          entity={curve}
          hidden={false}
          interactive={selectable}
          points={points}
          preselected={false}
          selected={selected.has(curve.id)}
          solvedRadius={solvedCircles.get(curve.id)}
          onPointerDown={(event, entityId) => {
            if (event.button !== 0) return
            event.stopPropagation()
            onSelect(entityId, event.metaKey || event.ctrlKey || event.shiftKey)
          }}
        />
      ))}
    </g>
  )
}

function SketchAvailableExternalGeometry({
  bounds,
  candidates,
  onUse,
}: Readonly<{
  bounds: SketchBounds
  candidates: readonly ExternalUseCandidate[]
  onUse: (candidate: ExternalUseCandidate) => void
}>) {
  const t = useTranslations("app.sketch.viewport")
  const viewportT = useTranslations("app.shell.viewport")
  const [chooser, setChooser] = useState<ExternalUseOverlapChooser | null>(null)
  const [chooserActiveIndex, setChooserActiveIndex] = useState(0)
  const [focusedPreselection, setFocusedPreselection] = useState<ExternalUsePreselection | null>(
    null,
  )
  const [hoveredPreselection, setHoveredPreselection] = useState<ExternalUsePreselection | null>(
    null,
  )
  const chooserCandidate = chooser?.choices[chooserActiveIndex]
  const preselection =
    chooser && chooserCandidate
      ? {
          candidate: chooserCandidate,
          clientX: chooser.clientX,
          clientY: chooser.clientY,
        }
      : (hoveredPreselection ?? focusedPreselection)
  const chooserRef = useRef<HTMLDivElement>(null)
  const choiceRefs = useRef<Array<HTMLButtonElement | null>>([])
  useEffect(() => {
    if (!chooser) return
    choiceRefs.current[chooserActiveIndex]?.focus()
    const closeOnPointerDown = (event: globalThis.PointerEvent) => {
      if (chooserRef.current?.contains(event.target as Node)) return
      event.preventDefault()
      event.stopPropagation()
      chooser.focusTarget.focus()
      setChooser(null)
    }
    const handleChooserKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault()
        event.stopPropagation()
        chooser.focusTarget.focus()
        setChooser(null)
        return
      }
      if (event.code !== "Backquote") return
      event.preventDefault()
      event.stopPropagation()
      setChooserActiveIndex((current) => {
        const direction = event.shiftKey ? -1 : 1
        return (current + direction + chooser.choices.length) % chooser.choices.length
      })
    }
    document.addEventListener("pointerdown", closeOnPointerDown, true)
    document.addEventListener("keydown", handleChooserKeyDown, true)
    return () => {
      document.removeEventListener("pointerdown", closeOnPointerDown, true)
      document.removeEventListener("keydown", handleChooserKeyDown, true)
    }
  }, [chooser, chooserActiveIndex])
  const useCandidate = (candidate: ExternalUseCandidate, focusTarget?: SVGGElement) => {
    focusTarget?.ownerSVGElement?.focus()
    setFocusedPreselection(null)
    setHoveredPreselection(null)
    onUse(candidate)
  }
  if (candidates.length === 0) return null
  return (
    <>
      <g
        aria-label={t("availableExternalGeometry")}
        data-sketch-available-external-geometry-count={candidates.length}
        transform="scale(1 -1)"
      >
        {candidates.map((candidate) => (
          /* biome-ignore lint/a11y/useSemanticElements: SVG groups cannot contain HTML buttons; equivalent focus and keyboard activation are provided. */
          <g
            key={candidateKey(candidate)}
            aria-label={candidate.label}
            className="group cursor-crosshair outline-none"
            data-sketch-available-external-geometry-id={availableExternalGeometryId(candidate)}
            onBlur={() => setFocusedPreselection(null)}
            onFocus={(event) => {
              const position = externalUseCandidateFocusPosition(candidate, event.currentTarget)
              setFocusedPreselection({
                candidate,
                ...position,
              })
            }}
            onPointerEnter={(event) =>
              setHoveredPreselection({ candidate, clientX: event.clientX, clientY: event.clientY })
            }
            onPointerLeave={() => setHoveredPreselection(null)}
            onPointerDown={(event) => {
              if (event.button !== 0) return
              event.preventDefault()
              event.stopPropagation()
              const rectangle = event.currentTarget.ownerSVGElement?.getBoundingClientRect()
              if (!rectangle) return useCandidate(candidate)
              const point = pointerToSketchPoint(event, rectangle, bounds)
              const choices = overlappingExternalUseCandidates(
                candidates,
                candidate,
                point,
                externalUseHitTolerance(bounds, rectangle),
              )
              if (choices.length === 1) return useCandidate(candidate, event.currentTarget)
              setChooserActiveIndex(0)
              setChooser({
                choices,
                clientX: event.clientX,
                clientY: event.clientY,
                focusTarget: event.currentTarget,
              })
            }}
            onKeyDown={(event) => {
              if (event.key !== "Enter" && event.key !== " ") return
              event.preventDefault()
              event.stopPropagation()
              useCandidate(candidate, event.currentTarget)
            }}
            role="button"
            tabIndex={0}
          >
            <SketchAvailableExternalCandidate
              candidate={candidate}
              highlighted={
                chooserCandidate !== undefined &&
                candidateKey(chooserCandidate) === candidateKey(candidate)
              }
            />
          </g>
        ))}
      </g>
      {chooser
        ? createPortal(
            <div
              ref={chooserRef}
              aria-label={t("overlapChooser")}
              className="fixed z-50 grid max-h-72 w-72 gap-1 overflow-y-auto rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
              data-sketch-external-overlap-chooser={chooser.choices.length}
              role="dialog"
              style={externalOverlapChooserPosition(chooser)}
            >
              <p className="px-2 py-1 text-xs font-medium text-muted-foreground">
                {t("overlapChooser")}
              </p>
              {chooser.choices.map((choice, index) => (
                <Button
                  key={candidateKey(choice)}
                  ref={(element) => {
                    choiceRefs.current[index] = element
                  }}
                  type="button"
                  className="h-auto justify-start whitespace-normal px-2 py-1.5 text-left"
                  data-sketch-external-overlap-active={index === chooserActiveIndex || undefined}
                  size="sm"
                  variant={index === chooserActiveIndex ? "secondary" : "ghost"}
                  onFocus={() => setChooserActiveIndex(index)}
                  onPointerEnter={() => setChooserActiveIndex(index)}
                  onClick={() => {
                    setChooser(null)
                    useCandidate(choice, chooser.focusTarget)
                  }}
                >
                  {choice.label}
                </Button>
              ))}
            </div>,
            document.body,
          )
        : null}
      {preselection
        ? createPortal(
            <div
              className="pointer-events-none fixed z-40 max-w-72 rounded-md border border-amber-500/50 bg-background/95 px-2 py-1 text-xs font-medium shadow-sm"
              data-sketch-use-target-label={preselection.candidate.label}
              role="status"
              style={externalUsePreselectionPosition(preselection)}
            >
              {viewportT("sketchReferenceCandidate", { label: preselection.candidate.label })}
            </div>,
            document.body,
          )
        : null}
    </>
  )
}

const MAX_EXTERNAL_OVERLAP_CHOICES = 8

type ExternalUseOverlapChooser = Readonly<{
  choices: readonly ExternalUseCandidate[]
  clientX: number
  clientY: number
  focusTarget: SVGGElement
}>

type ExternalUsePreselection = Readonly<{
  candidate: ExternalUseCandidate
  clientX: number
  clientY: number
}>

function externalUsePreselectionPosition(preselection: ExternalUsePreselection): CSSProperties {
  return {
    left: Math.min(Math.max(8, preselection.clientX + 12), Math.max(8, window.innerWidth - 296)),
    top: Math.min(Math.max(8, preselection.clientY + 12), Math.max(8, window.innerHeight - 48)),
  }
}

function externalUseCandidateAnchor(candidate: ExternalUseCandidate): SketchPoint2 {
  if (candidate.kind === "point" || candidate.kind === "model-point") return candidate
  if (candidate.kind === "line" || candidate.kind === "model-line") {
    return {
      x: (candidate.start.x + candidate.end.x) / 2,
      y: (candidate.start.y + candidate.end.y) / 2,
    }
  }
  return candidate.points[Math.floor(candidate.points.length / 2)] ?? { x: 0, y: 0 }
}

function externalUseCandidateFocusPosition(
  candidate: ExternalUseCandidate,
  target: SVGGElement,
): Readonly<{ clientX: number; clientY: number }> {
  const anchor = externalUseCandidateAnchor(candidate)
  const matrix = typeof target.getScreenCTM === "function" ? target.getScreenCTM() : null
  if (matrix) {
    return {
      clientX: matrix.a * anchor.x + matrix.c * anchor.y + matrix.e,
      clientY: matrix.b * anchor.x + matrix.d * anchor.y + matrix.f,
    }
  }
  const rectangle = target.getBoundingClientRect()
  return {
    clientX: rectangle.left + rectangle.width / 2,
    clientY: rectangle.top + rectangle.height / 2,
  }
}

function externalOverlapChooserPosition(chooser: ExternalUseOverlapChooser): CSSProperties {
  return {
    left: Math.min(Math.max(8, chooser.clientX + 8), Math.max(8, window.innerWidth - 296)),
    top: Math.min(Math.max(8, chooser.clientY + 8), Math.max(8, window.innerHeight - 296)),
  }
}

function externalUseHitTolerance(
  bounds: SketchBounds,
  rectangle: Readonly<{ width: number; height: number }>,
) {
  const worldPerPixel = Math.max(
    rectangle.width > 0 ? bounds.width / rectangle.width : 0,
    rectangle.height > 0 ? bounds.height / rectangle.height : 0,
  )
  return worldPerPixel * 10
}

function squaredDistanceToSegment(point: SketchPoint2, start: SketchPoint2, end: SketchPoint2) {
  const x = end.x - start.x
  const y = end.y - start.y
  const lengthSquared = x * x + y * y
  if (lengthSquared === 0) return (point.x - start.x) ** 2 + (point.y - start.y) ** 2
  const parameter = Math.min(
    1,
    Math.max(0, ((point.x - start.x) * x + (point.y - start.y) * y) / lengthSquared),
  )
  const projected = { x: start.x + parameter * x, y: start.y + parameter * y }
  return (point.x - projected.x) ** 2 + (point.y - projected.y) ** 2
}

function externalUseCandidateHit(
  candidate: ExternalUseCandidate,
  point: SketchPoint2,
  tolerance: number,
) {
  const maximumDistance = tolerance * tolerance
  if (candidate.kind === "point" || candidate.kind === "model-point") {
    return (point.x - candidate.x) ** 2 + (point.y - candidate.y) ** 2 <= maximumDistance
  }
  if (candidate.kind === "line" || candidate.kind === "model-line") {
    return squaredDistanceToSegment(point, candidate.start, candidate.end) <= maximumDistance
  }
  return candidate.points.some(
    (segmentEnd, index) =>
      index > 0 &&
      squaredDistanceToSegment(point, candidate.points[index - 1] ?? segmentEnd, segmentEnd) <=
        maximumDistance,
  )
}

function overlappingExternalUseCandidates(
  candidates: readonly ExternalUseCandidate[],
  primary: ExternalUseCandidate,
  point: SketchPoint2,
  tolerance: number,
) {
  const primaryKey = candidateKey(primary)
  const unique = new Map<string, ExternalUseCandidate>()
  for (const candidate of candidates) {
    if (externalUseCandidateHit(candidate, point, tolerance)) {
      unique.set(candidateKey(candidate), candidate)
    }
  }
  unique.set(primaryKey, primary)
  return [
    primary,
    ...[...unique]
      .filter(([key]) => key !== primaryKey)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([, candidate]) => candidate),
  ].slice(0, MAX_EXTERNAL_OVERLAP_CHOICES)
}

function SketchAvailableExternalCandidate({
  candidate,
  highlighted = false,
}: Readonly<{ candidate: ExternalUseCandidate; highlighted?: boolean }>) {
  if (candidate.kind === "curve" || candidate.kind === "model-curve") {
    const points = candidate.points.map(({ x, y }) => `${x},${y}`).join(" ")
    return (
      <>
        <polyline
          fill="none"
          pointerEvents="stroke"
          points={points}
          className="stroke-transparent"
          strokeWidth={12}
          vectorEffect="non-scaling-stroke"
        />
        <polyline
          fill="none"
          points={points}
          className={cn(
            "pointer-events-none stroke-amber-500 transition-opacity group-hover:opacity-100 group-focus:opacity-100",
            highlighted ? "opacity-100" : "opacity-0",
          )}
          strokeDasharray="5 3"
          strokeWidth={2}
          vectorEffect="non-scaling-stroke"
        />
        <title>{candidate.label}</title>
      </>
    )
  }
  if (candidate.kind === "line" || candidate.kind === "model-line") {
    return (
      <>
        <line
          x1={candidate.start.x}
          y1={candidate.start.y}
          x2={candidate.end.x}
          y2={candidate.end.y}
          className="stroke-transparent"
          pointerEvents="stroke"
          strokeWidth={12}
          vectorEffect="non-scaling-stroke"
        />
        <line
          x1={candidate.start.x}
          y1={candidate.start.y}
          x2={candidate.end.x}
          y2={candidate.end.y}
          className={cn(
            "pointer-events-none stroke-amber-500 transition-opacity group-hover:opacity-100 group-focus:opacity-100",
            highlighted ? "opacity-100" : "opacity-0",
          )}
          strokeDasharray="5 3"
          strokeWidth={2}
          vectorEffect="non-scaling-stroke"
        />
        <title>{candidate.label}</title>
      </>
    )
  }
  return (
    <>
      <circle
        cx={candidate.x}
        cy={candidate.y}
        r={10}
        fill="transparent"
        pointerEvents="all"
        stroke="none"
      />
      <circle
        cx={candidate.x}
        cy={candidate.y}
        r={5}
        className={cn(
          "pointer-events-none fill-background/75 stroke-amber-500 transition-opacity group-hover:opacity-100 group-focus:opacity-100",
          highlighted ? "opacity-100" : "opacity-0",
        )}
        strokeDasharray="3 2"
        strokeWidth={1.5}
        vectorEffect="non-scaling-stroke"
      />
      <line
        x1={candidate.x - 8}
        x2={candidate.x + 8}
        y1={candidate.y}
        y2={candidate.y}
        className="pointer-events-none stroke-amber-500 opacity-0 transition-opacity group-hover:opacity-100 group-focus:opacity-100"
        strokeWidth={1}
        vectorEffect="non-scaling-stroke"
      />
      <line
        x1={candidate.x}
        x2={candidate.x}
        y1={candidate.y - 8}
        y2={candidate.y + 8}
        className="pointer-events-none stroke-amber-500 opacity-0 transition-opacity group-hover:opacity-100 group-focus:opacity-100"
        strokeWidth={1}
        vectorEffect="non-scaling-stroke"
      />
      <title>{candidate.label}</title>
    </>
  )
}

function availableExternalGeometryId(candidate: ExternalUseCandidate) {
  if (
    candidate.kind === "model-point" ||
    candidate.kind === "model-line" ||
    candidate.kind === "model-curve"
  ) {
    return candidate.candidateId
  }
  if (candidate.kind === "line") return candidate.sourceLineId
  if (candidate.kind === "curve") return candidate.sourceEntityId
  return candidate.sourcePointId
}

function SketchExternalContextGeometry({
  geometry,
  highlightedCandidate,
}: Readonly<{
  geometry: readonly ExternalSketchContextGeometry[]
  highlightedCandidate: ExternalWakeupCandidate | null
}>) {
  const t = useTranslations("app.sketch.viewport")
  if (geometry.length === 0) return null
  const highlightedKey = highlightedCandidate ? candidateKey(highlightedCandidate) : null
  return (
    <g
      aria-label={t("earlierSketchContext")}
      className="pointer-events-none"
      data-sketch-context-geometry-count={geometry.length}
      transform="scale(1 -1)"
    >
      {geometry.map((candidate) => (
        <SketchExternalContextCandidate
          key={contextGeometryKey(candidate)}
          candidate={candidate}
          highlighted={highlightedKey === contextGeometryKey(candidate)}
        />
      ))}
    </g>
  )
}

function SketchExternalContextCandidate({
  candidate,
  highlighted,
}: Readonly<{
  candidate: ExternalSketchContextGeometry
  highlighted: boolean
}>) {
  if (candidate.kind === "curve")
    return <SketchExternalContextCurve candidate={candidate} highlighted={highlighted} />
  if (candidate.kind === "line")
    return <SketchExternalContextLine candidate={candidate} highlighted={highlighted} />
  return <SketchExternalContextPoint candidate={candidate} highlighted={highlighted} />
}

function SketchExternalModelInferenceHighlight({
  candidate,
}: Readonly<{ candidate: ExternalWakeupCandidate | null }>) {
  if (candidate?.kind === "model-point") {
    return (
      <g
        aria-label={candidate.label}
        className="pointer-events-none"
        data-sketch-model-inference-highlight
        transform="scale(1 -1)"
      >
        <circle
          cx={candidate.x}
          cy={candidate.y}
          r={7}
          className="fill-background/75 stroke-amber-500"
          strokeWidth={2}
          vectorEffect="non-scaling-stroke"
        />
        <line
          x1={candidate.x - 9}
          x2={candidate.x + 9}
          y1={candidate.y}
          y2={candidate.y}
          className="stroke-amber-500"
          strokeWidth={1.5}
          vectorEffect="non-scaling-stroke"
        />
        <line
          x1={candidate.x}
          x2={candidate.x}
          y1={candidate.y - 9}
          y2={candidate.y + 9}
          className="stroke-amber-500"
          strokeWidth={1.5}
          vectorEffect="non-scaling-stroke"
        />
        <title>{candidate.label}</title>
      </g>
    )
  }
  if (candidate?.kind === "model-curve") {
    return (
      <polyline
        aria-label={candidate.label}
        className="pointer-events-none stroke-amber-500"
        data-sketch-model-inference-highlight
        fill="none"
        points={candidate.points.map(({ x, y }) => `${x},${y}`).join(" ")}
        strokeDasharray="5 3"
        strokeWidth={3}
        transform="scale(1 -1)"
        vectorEffect="non-scaling-stroke"
      >
        <title>{candidate.label}</title>
      </polyline>
    )
  }
  if (candidate?.kind !== "model-line") return null
  return (
    <g
      className="pointer-events-none"
      data-sketch-model-inference-highlight
      transform="scale(1 -1)"
    >
      <line
        aria-label={candidate.label}
        className="stroke-amber-500"
        strokeDasharray="5 3"
        strokeWidth={3}
        vectorEffect="non-scaling-stroke"
        x1={candidate.start.x}
        x2={candidate.end.x}
        y1={candidate.start.y}
        y2={candidate.end.y}
      >
        <title>{candidate.label}</title>
      </line>
    </g>
  )
}

function externalContextPresentation(
  candidate: ExternalSketchContextGeometry,
  highlighted: boolean,
) {
  return {
    className: highlighted
      ? "stroke-amber-500"
      : candidate.construction
        ? "stroke-sketch-reference-context/75"
        : "stroke-sketch-reference-context",
    sourceLabel: highlighted ? candidate.label : undefined,
    strokeDasharray: highlighted ? undefined : candidate.construction ? "8 5" : "5 4",
    strokeWidth: highlighted ? 2.5 : 1.5,
  }
}

function SketchExternalContextCurve({
  candidate,
  highlighted,
}: Readonly<{
  candidate: Extract<ExternalSketchContextGeometry, { kind: "curve" }>
  highlighted: boolean
}>) {
  const presentation = externalContextPresentation(candidate, highlighted)
  return (
    <polyline
      className={presentation.className}
      data-sketch-context-construction={candidate.construction ? "true" : undefined}
      data-sketch-context-curve-type={candidate.sourceType}
      data-sketch-context-entity-id={candidate.sourceEntityId}
      data-sketch-context-source-sketch-id={candidate.sourceSketchId}
      data-sketch-external-inference-source={presentation.sourceLabel}
      fill="none"
      points={candidate.points.map(({ x, y }) => `${x},${y}`).join(" ")}
      strokeDasharray={presentation.strokeDasharray}
      strokeWidth={presentation.strokeWidth}
      vectorEffect="non-scaling-stroke"
    >
      <title>{candidate.label}</title>
    </polyline>
  )
}

function SketchExternalContextLine({
  candidate,
  highlighted,
}: Readonly<{
  candidate: Extract<ExternalSketchContextGeometry, { kind: "line" }>
  highlighted: boolean
}>) {
  const presentation = externalContextPresentation(candidate, highlighted)
  return (
    <line
      className={presentation.className}
      data-sketch-context-construction={candidate.construction ? "true" : undefined}
      data-sketch-context-entity-id={candidate.sourceLineId}
      data-sketch-context-source-sketch-id={candidate.sourceSketchId}
      data-sketch-external-inference-source={presentation.sourceLabel}
      strokeDasharray={presentation.strokeDasharray}
      strokeWidth={presentation.strokeWidth}
      vectorEffect="non-scaling-stroke"
      x1={candidate.start.x}
      x2={candidate.end.x}
      y1={candidate.start.y}
      y2={candidate.end.y}
    >
      <title>{candidate.label}</title>
    </line>
  )
}

function SketchExternalContextPoint({
  candidate,
  highlighted,
}: Readonly<{
  candidate: Extract<ExternalSketchContextGeometry, { kind: "point" }>
  highlighted: boolean
}>) {
  const presentation = externalContextPresentation(candidate, highlighted)
  const sharedProps = {
    className: presentation.className,
    "data-sketch-context-construction": candidate.construction ? "true" : undefined,
    "data-sketch-context-entity-id": candidate.sourcePointId,
    "data-sketch-context-source-sketch-id": candidate.sourceSketchId,
    "data-sketch-external-inference-source": presentation.sourceLabel,
    fill: "var(--color-viewport-background)",
    strokeWidth: presentation.strokeWidth,
    vectorEffect: "non-scaling-stroke" as const,
  }
  if (candidate.role === "center") {
    return (
      <rect
        {...sharedProps}
        data-sketch-context-point-role="center"
        height={5}
        width={5}
        x={candidate.x - 2.5}
        y={candidate.y - 2.5}
      >
        <title>{candidate.label}</title>
      </rect>
    )
  }
  return (
    <circle {...sharedProps} cx={candidate.x} cy={candidate.y} r={2.5}>
      <title>{candidate.label}</title>
    </circle>
  )
}

function SketchExternalReferencePresentation({
  availableCandidates,
  bounds,
  contextGeometry,
  editorTool,
  highlightedCandidate,
  externalCurves,
  externalLines,
  externalPoints,
  markerScale,
  pointsById,
  selectedEntityIds,
  solvedCircles,
  onSelect,
  onUse,
}: Readonly<{
  availableCandidates: readonly ExternalUseCandidate[]
  bounds: SketchBounds
  contextGeometry: readonly ExternalSketchContextGeometry[]
  editorTool: SketchEditorTool
  highlightedCandidate: ExternalWakeupCandidate | null
  externalCurves: readonly DisplayExternalCurve[]
  externalLines: readonly DisplayExternalLine[]
  externalPoints: readonly DisplayPoint[]
  markerScale: number
  selectedEntityIds: readonly SketchEntityId[]
  pointsById: SketchPointLookup
  solvedCircles: ReadonlyMap<string, number>
  onSelect: (entityId: SketchEntityId, additive: boolean) => void
  onUse: (candidate: ExternalUseCandidate) => void
}>) {
  return (
    <>
      <SketchExternalContextGeometry
        geometry={contextGeometry}
        highlightedCandidate={highlightedCandidate}
      />
      <SketchExternalModelInferenceHighlight candidate={highlightedCandidate} />
      <SketchDirectExternalSelection
        bounds={bounds}
        candidates={availableCandidates}
        editorTool={editorTool}
        onUse={onUse}
      />
      <SketchMaterializedExternalGeometry
        editorTool={editorTool}
        externalCurves={externalCurves}
        externalLines={externalLines}
        externalPoints={externalPoints}
        markerScale={markerScale}
        onSelect={onSelect}
        pointsById={pointsById}
        selectedEntityIds={selectedEntityIds}
        solvedCircles={solvedCircles}
      />
    </>
  )
}

function SketchDirectExternalSelection({
  bounds,
  candidates,
  editorTool,
  onUse,
}: Readonly<{
  bounds: SketchBounds
  candidates: readonly ExternalUseCandidate[]
  editorTool: SketchEditorTool
  onUse: (candidate: ExternalUseCandidate) => void
}>) {
  if (editorTool !== "select" && editorTool !== "use") return null
  return <SketchAvailableExternalGeometry bounds={bounds} candidates={candidates} onUse={onUse} />
}

function SketchMaterializedExternalGeometry({
  editorTool,
  externalCurves,
  externalLines,
  externalPoints,
  markerScale,
  onSelect,
  pointsById,
  selectedEntityIds,
  solvedCircles,
}: Readonly<{
  editorTool: SketchEditorTool
  externalCurves: readonly DisplayExternalCurve[]
  externalLines: readonly DisplayExternalLine[]
  externalPoints: readonly DisplayPoint[]
  markerScale: number
  onSelect: (entityId: SketchEntityId, additive: boolean) => void
  pointsById: SketchPointLookup
  selectedEntityIds: readonly SketchEntityId[]
  solvedCircles: ReadonlyMap<string, number>
}>) {
  return (
    <>
      <SketchExternalLines
        editorTool={editorTool}
        lines={externalLines}
        selectedEntityIds={selectedEntityIds}
        onSelect={onSelect}
      />
      <SketchExternalCurves
        curves={externalCurves}
        editorTool={editorTool}
        points={pointsById}
        selectedEntityIds={selectedEntityIds}
        solvedCircles={solvedCircles}
        onSelect={onSelect}
      />
      <SketchExternalPoints
        markerScale={markerScale}
        points={externalPoints}
        selectedEntityIds={selectedEntityIds}
        onSelect={isSketchSelectionTool(editorTool) ? onSelect : null}
      />
    </>
  )
}

function SketchExternalReferenceLayer({
  configuration,
  markerScale,
  onSelect,
  state,
}: Readonly<{
  configuration: SketchDrawingConfiguration
  markerScale: number
  onSelect: (entityId: SketchEntityId, additive: boolean) => void
  state: SketchDrawingViewProps["state"]
}>) {
  const {
    draft,
    editorTool,
    externalContextGeometry,
    externalModelCandidates,
    externalPointCandidates,
    onDraftChange,
    onEditorToolChange,
    repairReferenceId,
    selectedEntityIds,
  } = configuration
  const externalReferences = useExternalReferenceInteraction({
    candidates: externalPointCandidates,
    draft,
    editorTool,
    modelCandidates: externalModelCandidates,
    onDraftChange,
    onEditorToolChange,
    repairReferenceId,
    selectedEntityIds,
  })
  const passiveContextGeometry = useMemo(() => {
    const referencedKeys = new Set(
      (draft?.externalReferences ?? []).map(externalReferenceSourceKey),
    )
    return externalContextGeometry.filter((geometry) => {
      const key = contextGeometryKey(geometry)
      return !referencedKeys.has(key)
    })
  }, [draft, externalContextGeometry])
  return (
    <SketchExternalReferencePresentation
      availableCandidates={externalReferences.availableCandidates}
      bounds={state.bounds}
      contextGeometry={passiveContextGeometry}
      editorTool={editorTool}
      highlightedCandidate={state.externalInferenceCandidate}
      externalCurves={state.geometry.externalCurves}
      externalLines={state.geometry.externalLines}
      externalPoints={state.geometry.externalPoints}
      markerScale={markerScale}
      selectedEntityIds={selectedEntityIds}
      pointsById={state.geometry.pointsById}
      solvedCircles={state.geometry.solvedCircles}
      onSelect={onSelect}
      onUse={externalReferences.use}
    />
  )
}

function SketchContextGeometryBounds({
  geometry = [],
  modelGeometry = [],
  setBounds,
}: Readonly<{
  geometry: readonly ExternalSketchContextGeometry[]
  modelGeometry: readonly ExternalModelGeometryCandidate[]
  setBounds: Dispatch<SetStateAction<SketchBounds>>
}>) {
  useEffect(() => {
    const modelPoints = modelGeometry.flatMap<SketchPoint2>((candidate) =>
      candidate.kind === "model-line"
        ? [candidate.start, candidate.end]
        : candidate.kind === "model-curve"
          ? candidate.points
          : [candidate],
    )
    const points = [
      ...geometry.flatMap((candidate) =>
        candidate.kind === "curve"
          ? candidate.points
          : candidate.kind === "line"
            ? [candidate.start, candidate.end]
            : [candidate],
      ),
      ...modelPoints,
    ]
    setBounds((bounds) => expandedSketchBounds(bounds, points))
  }, [geometry, modelGeometry, setBounds])
  return null
}

const StableSketchGeometry = memo(SketchGeometry)

const ignoreCurveAction = () => undefined

function DraggedSketchGeometry({
  dragTarget,
  presentation,
  selectedEntityIds,
}: {
  dragTarget: SketchDragTarget | null
  presentation: SketchGeometryPresentation
  selectedEntityIds: readonly SketchEntityId[]
}) {
  const authoredPoint = dragTarget ? presentation.pointsById.get(dragTarget.entityId) : undefined
  const draggedPoint = useMemo(
    () =>
      authoredPoint && dragTarget ? { ...authoredPoint, x: dragTarget.x, y: dragTarget.y } : null,
    [authoredPoint, dragTarget],
  )
  const points = useMemo<SketchPointLookup>(
    () => ({
      get: (pointId) =>
        draggedPoint?.id === pointId ? draggedPoint : presentation.pointsById.get(pointId),
    }),
    [draggedPoint, presentation.pointsById],
  )
  if (!draggedPoint) return null
  const selectedIds = new Set(selectedEntityIds)
  const curves = presentation.curvesByPointId.get(draggedPoint.id) ?? []
  return (
    <g data-sketch-drag-overlay={draggedPoint.id} pointerEvents="none" transform="scale(1 -1)">
      {curves.map((entity) => (
        <SketchCurve
          key={entity.id}
          entity={entity}
          hidden={false}
          interactive={false}
          points={points}
          preselected={false}
          selected={selectedIds.has(entity.id)}
          solvedRadius={presentation.solvedCircles.get(entity.id)}
          onPointerDown={ignoreCurveAction}
        />
      ))}
      <circle
        data-sketch-entity-id={draggedPoint.id}
        data-sketch-entity-type="point"
        cx={draggedPoint.x}
        cy={draggedPoint.y}
        r={3}
        className={
          selectedIds.has(draggedPoint.id)
            ? "fill-ring stroke-background"
            : draggedPoint.construction
              ? "fill-background stroke-muted-foreground"
              : "fill-background stroke-primary"
        }
        strokeWidth={2}
        vectorEffect="non-scaling-stroke"
      />
    </g>
  )
}

function SketchTransformGeometry({
  entityIds,
  origin,
  presentation,
  preview,
}: Readonly<{
  entityIds: readonly SketchEntityId[]
  origin: SketchPoint2
  presentation: SketchGeometryPresentation
  preview: SketchTransformPreview
}>) {
  const selectedIds = useMemo(() => new Set(entityIds), [entityIds])
  const curves = useMemo(
    () => presentation.curves.filter(({ id }) => selectedIds.has(id)),
    [presentation.curves, selectedIds],
  )
  const pointIds = useMemo(() => {
    const ids = new Set<SketchEntityId>()
    for (const point of presentation.points) {
      if (selectedIds.has(point.id)) ids.add(point.id)
    }
    for (const curve of curves) {
      for (const pointId of sketchCurvePointIds(curve)) ids.add(pointId)
    }
    return ids
  }, [curves, presentation.points, selectedIds])
  if (isIdentitySketchTransform(preview)) return null
  return (
    <g data-sketch-transform-preview pointerEvents="none" transform={`scale(1 -1)`}>
      <g transform={sketchTransformSvgValue(origin, preview)}>
        {curves.map((entity) => (
          <SketchCurve
            key={entity.id}
            entity={entity}
            hidden={false}
            interactive={false}
            points={presentation.pointsById}
            preselected={false}
            selected
            solvedRadius={presentation.solvedCircles.get(entity.id)}
            onPointerDown={ignoreCurveAction}
          />
        ))}
        {presentation.points
          .filter(({ id }) => pointIds.has(id))
          .map((point) => (
            <circle
              key={point.id}
              cx={point.x}
              cy={point.y}
              r={3}
              className="fill-ring stroke-background"
              strokeWidth={2}
              vectorEffect="non-scaling-stroke"
            />
          ))}
      </g>
    </g>
  )
}

type ConstraintGlyph = Readonly<{
  constraintType: SketchRecord["constraints"][number]["type"]
  entityIds: readonly string[]
  external: boolean
  id: SketchConstraintId
  label: string
  point: SketchPoint2
  dimensional: boolean
  reference: boolean
}>

function midpoint(first: SketchPoint2, second: SketchPoint2): SketchPoint2 {
  return { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 }
}

function midpointForIds(
  firstId: SketchEntityId,
  secondId: SketchEntityId,
  anchors: (id: SketchEntityId) => SketchPoint2 | null,
) {
  const first = anchors(firstId)
  const second = anchors(secondId)
  return first && second ? midpoint(first, second) : null
}

function circleEntityAnchor(
  entity: Extract<SketchEntity, { type: "circle" }>,
  point: (id: SketchEntityId) => SketchPoint2 | null,
  solvedCircles: ReadonlyMap<string, number>,
) {
  const center = point(entity.centerPointId)
  if (!center) return null
  const radius = solvedCircles.get(entity.id) ?? entity.radius
  return { x: center.x + radius * 0.7, y: center.y + radius * 0.7 }
}

function ellipseEntityAnchor(
  entity: Extract<SketchEntity, { type: "ellipse" }>,
  points: ReadonlyMap<string, DisplayPoint>,
) {
  const geometry = ellipseGeometry(entity, points)
  return geometry
    ? {
        x: geometry.center.x + geometry.primaryRadius * 0.7,
        y: geometry.center.y + geometry.secondaryRadius * 0.7,
      }
    : (points.get(entity.centerPointId) ?? null)
}

function ellipticalArcEntityAnchor(
  entity: Extract<SketchEntity, { type: "elliptical-arc" }>,
  points: ReadonlyMap<string, DisplayPoint>,
) {
  const geometry = ellipticalArcGeometry(entity, points)
  return geometry
    ? sketchEllipsePointAt(geometry, geometry.startParameter + geometry.sweep / 2)
    : (points.get(entity.centerPointId) ?? null)
}

function entityAnchor(
  entity: SketchEntity | undefined,
  points: ReadonlyMap<string, DisplayPoint>,
  solvedCircles: ReadonlyMap<string, number>,
): SketchPoint2 | null {
  if (!entity) return null
  const point = (id: SketchEntityId): SketchPoint2 | null => points.get(id) ?? null
  switch (entity.type) {
    case "point":
      return point(entity.id)
    case "line":
      return midpointForIds(entity.startPointId, entity.endPointId, point)
    case "circle":
      return circleEntityAnchor(entity, point, solvedCircles)
    case "arc":
      return (
        midpointForIds(entity.startPointId, entity.endPointId, point) ?? point(entity.centerPointId)
      )
    case "ellipse":
      return ellipseEntityAnchor(entity, points)
    case "elliptical-arc":
      return ellipticalArcEntityAnchor(entity, points)
  }
}

function drivingDimensionLabel(constraint: SketchRecord["constraints"][number]) {
  if (!("value" in constraint)) return null
  return (
    constraint.value.source.expression ??
    `${constraint.value.source.value} ${constraint.value.source.unit}`
  )
}

function dimensionalLabel(
  constraint: SketchRecord["constraints"][number],
  entities: readonly SketchEntity[],
  geometry: SketchGeometryPresentation,
  displayUnits: ReturnType<typeof useDocumentDisplayUnits>,
  formatNumber: (value: number) => string,
) {
  const drivingLabel = drivingDimensionLabel(constraint)
  if (drivingLabel) return drivingLabel
  if (!isReferenceSketchDimension(constraint)) return null
  const value = sketchDimensionCanonicalValue(
    constraint.type,
    createSketchDimensionGeometry(geometry, entities),
  )
  if (value === null) return null
  const formatted =
    constraint.type === "angle"
      ? formatDisplayAngle(value, displayUnits.angle, formatNumber)
      : formatDisplayLength(value, displayUnits.length, formatNumber)
  return `(${formatted})`
}

const geometricConstraintLabels: Partial<
  Record<SketchRecord["constraints"][number]["type"], string>
> = {
  coincident: "×",
  concentric: "◎",
  equal: "=",
  fixed: "F",
  horizontal: "H",
  "horizontal-points": "H",
  midpoint: "M",
  "arc-midpoint": "M",
  "ellipse-quadrant": "◇",
  parallel: "∥",
  perpendicular: "⊥",
  "point-on-curve": "⊙",
  "point-on-ellipse": "⊙",
  "point-on-elliptical-arc": "⊙",
  "point-on-line": "⊙",
  tangent: "T",
  symmetric: "S",
  vertical: "V",
  "vertical-points": "V",
}

type AccessibleConstraintMessageKey =
  | "constraintCoincident"
  | "constraintConcentric"
  | "constraintEqual"
  | "constraintFixed"
  | "constraintHorizontal"
  | "constraintMidpoint"
  | "constraintParallel"
  | "constraintPerpendicular"
  | "constraintSymmetric"
  | "constraintTangent"
  | "constraintVertical"
  | "pointOnCurve"
  | "pointOnLine"
  | "quadrant"

const accessibleConstraintMessageKeys: Partial<
  Record<SketchRecord["constraints"][number]["type"], AccessibleConstraintMessageKey>
> = {
  "arc-midpoint": "constraintMidpoint",
  coincident: "constraintCoincident",
  concentric: "constraintConcentric",
  "ellipse-quadrant": "quadrant",
  equal: "constraintEqual",
  fixed: "constraintFixed",
  horizontal: "constraintHorizontal",
  "horizontal-points": "constraintHorizontal",
  midpoint: "constraintMidpoint",
  parallel: "constraintParallel",
  perpendicular: "constraintPerpendicular",
  "point-on-curve": "pointOnCurve",
  "point-on-ellipse": "pointOnCurve",
  "point-on-elliptical-arc": "pointOnCurve",
  "point-on-line": "pointOnLine",
  symmetric: "constraintSymmetric",
  tangent: "constraintTangent",
  vertical: "constraintVertical",
  "vertical-points": "constraintVertical",
}

const ellipseAxisDimensionAxes: Partial<
  Record<SketchRecord["constraints"][number]["type"], "primary" | "secondary">
> = {
  "primary-axis-diameter": "primary",
  "secondary-axis-diameter": "secondary",
}

type EllipseAxisDimensionConstraint = Extract<
  SketchRecord["constraints"][number],
  { type: "primary-axis-diameter" | "secondary-axis-diameter" }
>

function pairedConstraintAnchor(
  constraint: SketchRecord["constraints"][number],
  pointAnchor: (id: SketchEntityId) => SketchPoint2 | null,
  geometryAnchor: (id: SketchEntityId) => SketchPoint2 | null,
) {
  if ("firstPointId" in constraint) {
    return {
      handled: true,
      point: midpointForIds(constraint.firstPointId, constraint.secondPointId, pointAnchor),
    } as const
  }
  if ("firstEntityId" in constraint) {
    return {
      handled: true,
      point: midpointForIds(constraint.firstEntityId, constraint.secondEntityId, geometryAnchor),
    } as const
  }
  return { handled: false } as const
}

function constraintAnchor(
  constraint: SketchRecord["constraints"][number],
  pointAnchor: (id: SketchEntityId) => SketchPoint2 | null,
  geometryAnchor: (id: SketchEntityId) => SketchPoint2 | null,
  ellipseAxisAnchor: (id: SketchEntityId, axis: "primary" | "secondary") => SketchPoint2 | null,
) {
  const pairedAnchor = pairedConstraintAnchor(constraint, pointAnchor, geometryAnchor)
  if (pairedAnchor.handled) return pairedAnchor.point
  if ("pointId" in constraint) return pointAnchor(constraint.pointId)
  const ellipseAxis = ellipseAxisDimensionAxes[constraint.type]
  if (ellipseAxis) {
    return ellipseAxisAnchor((constraint as EllipseAxisDimensionConstraint).curveId, ellipseAxis)
  }
  if ("curveId" in constraint) return geometryAnchor(constraint.curveId)
  if ("arcId" in constraint) {
    return midpointForIds(constraint.lineId, constraint.arcId, geometryAnchor)
  }
  if (constraint.type === "offset") {
    const pair = constraint.linePairs[0]
    return pair ? midpointForIds(pair.sourceLineId, pair.offsetLineId, geometryAnchor) : null
  }
  if ("lineId" in constraint) return geometryAnchor(constraint.lineId)
  return null
}

function constraintGlyph(
  constraint: SketchRecord["constraints"][number],
  dimensionLabel: string | null,
  pointAnchor: (id: SketchEntityId) => SketchPoint2 | null,
  geometryAnchor: (id: SketchEntityId) => SketchPoint2 | null,
  ellipseAxisAnchor: (id: SketchEntityId, axis: "primary" | "secondary") => SketchPoint2 | null,
  projectedEntityIds: ReadonlySet<string>,
): ConstraintGlyph | null {
  const point = constraintAnchor(constraint, pointAnchor, geometryAnchor, ellipseAxisAnchor)
  const label = dimensionLabel ?? geometricConstraintLabels[constraint.type]
  const reference = isReferenceSketchDimension(constraint)
  const entityIds = sketchConstraintEntityIds(constraint)
  return point && label
    ? {
        constraintType: constraint.type,
        entityIds,
        external: entityIds.some((id) => projectedEntityIds.has(id)),
        id: constraint.id,
        label,
        point,
        dimensional: "value" in constraint || reference,
        reference,
      }
    : null
}

function constraintGlyphs(
  sketch: SketchRecord,
  geometry: SketchGeometryPresentation,
  displayUnits: ReturnType<typeof useDocumentDisplayUnits>,
  formatNumber: (value: number) => string,
) {
  const projectedEntities = projectedExternalSketchEntities(sketch.externalReferences ?? [])
  const projectedEntityIds = new Set(projectedEntities.map(({ id }) => id))
  const entities = new Map<string, SketchEntity>(
    [...sketch.entities, ...projectedEntities].map((entity) => [entity.id, entity]),
  )
  const pointAnchor = (id: SketchEntityId): SketchPoint2 | null =>
    geometry.pointsById.get(id) ?? null
  const geometryAnchor = (id: SketchEntityId) =>
    entityAnchor(entities.get(id), geometry.pointsById, geometry.solvedCircles)
  const ellipseAxisAnchor = (id: SketchEntityId, axis: "primary" | "secondary") => {
    const entity = entities.get(id)
    if (entity?.type !== "ellipse" && entity?.type !== "elliptical-arc") return null
    return (
      geometry.pointsById.get(
        axis === "primary" ? entity.primaryAxisPointId : entity.secondaryAxisPointId,
      ) ?? null
    )
  }

  return sketch.constraints
    .map((constraint) => {
      const constraintEntities = sketchConstraintEntityIds(constraint).flatMap((id) => {
        const entity = entities.get(id)
        return entity ? [entity] : []
      })
      return constraintGlyph(
        constraint,
        dimensionalLabel(constraint, constraintEntities, geometry, displayUnits, formatNumber),
        pointAnchor,
        geometryAnchor,
        ellipseAxisAnchor,
        projectedEntityIds,
      )
    })
    .filter((glyph): glyph is ConstraintGlyph => glyph !== null)
}

type SketchViewportSize = Readonly<{
  height: number
  left?: number
  top?: number
  width: number
}>

function constraintAnnotationPosition(
  point: SketchPoint2,
  bounds: SketchBounds,
  viewport: SketchViewportSize,
): CSSProperties {
  const horizontal = (point.x - bounds.minX) / bounds.width
  const vertical = (bounds.minY + bounds.height - point.y) / bounds.height
  if (viewport.width <= 0 || viewport.height <= 0) {
    return { left: `${horizontal * 100}%`, top: `${vertical * 100}%` }
  }
  const scale = Math.min(viewport.width / bounds.width, viewport.height / bounds.height)
  const offsetX = (viewport.width - bounds.width * scale) / 2
  const offsetY = (viewport.height - bounds.height * scale) / 2
  return {
    left: offsetX + horizontal * bounds.width * scale,
    top: offsetY + vertical * bounds.height * scale,
  }
}

const inlineDimensionEditorInset = 8
const inlineDimensionEditorReservedWidth = 248
const inlineDimensionEditorHalfHeight = 24

function inlineDimensionEditorPosition(
  point: SketchPoint2,
  bounds: SketchBounds,
  viewport: SketchViewportSize,
): CSSProperties {
  const position = constraintAnnotationPosition(point, bounds, viewport)
  if (typeof position.left !== "number") return position
  const maximumLeft = Math.max(
    inlineDimensionEditorInset,
    viewport.width - inlineDimensionEditorReservedWidth - inlineDimensionEditorInset,
  )
  const minimumTop = inlineDimensionEditorInset + inlineDimensionEditorHalfHeight
  const maximumTop = Math.max(
    minimumTop,
    viewport.height - inlineDimensionEditorHalfHeight - inlineDimensionEditorInset,
  )
  return {
    ...position,
    left:
      (viewport.left ?? 0) +
      Math.min(Math.max(position.left, inlineDimensionEditorInset), maximumLeft),
    position: "fixed",
    top:
      (viewport.top ?? 0) +
      Math.min(
        Math.max(typeof position.top === "number" ? position.top : 0, minimumTop),
        maximumTop,
      ),
  }
}

function useSketchViewportSize(svgRef: RefObject<SVGSVGElement | null>) {
  const [size, setSize] = useState<SketchViewportSize>({ height: 0, left: 0, top: 0, width: 0 })
  useEffect(() => {
    const svg = svgRef.current
    if (!svg) return
    const update = () => {
      const rectangle = svg.getBoundingClientRect()
      setSize({
        height: rectangle.height,
        left: rectangle.left,
        top: rectangle.top,
        width: rectangle.width,
      })
    }
    update()
    if (typeof ResizeObserver === "undefined") return
    const observer = new ResizeObserver(() => update())
    observer.observe(svg)
    return () => observer.disconnect()
  }, [svgRef])
  return size
}

type ConstraintAnnotationDrag = Readonly<{
  clientX: number
  clientY: number
  element: HTMLButtonElement
  id: SketchConstraintId
  lastClientX: number
  lastClientY: number
  point: SketchPoint2
  pointerId: number
  scale: number
}>

type ConstraintRelatedEntityInteraction = "focus" | "hover"
type ConstraintRelatedEntityChange = (
  interaction: ConstraintRelatedEntityInteraction,
  glyph: ConstraintGlyph | null,
) => void

function constraintGlyphAccessibleLabel(
  glyph: ConstraintGlyph,
  editDimensionLabel: (label: string) => string,
  selectConstraintLabel: (
    label: string,
    constraintType: SketchRecord["constraints"][number]["type"],
  ) => string,
  selectExternalConstraintLabel: (
    label: string,
    constraintType: SketchRecord["constraints"][number]["type"],
  ) => string,
) {
  if (glyph.reference) return selectConstraintLabel(glyph.label, glyph.constraintType)
  if (glyph.dimensional) return editDimensionLabel(glyph.label)
  return glyph.external
    ? selectExternalConstraintLabel(glyph.label, glyph.constraintType)
    : selectConstraintLabel(glyph.label, glyph.constraintType)
}

function constraintGlyphClassName(
  glyph: ConstraintGlyph,
  pointerEventsClass: string,
  selected: boolean,
) {
  const variant = buttonVariants({ size: "xs", variant: selected ? "secondary" : "ghost" })
  if (glyph.dimensional) {
    return cn(
      variant,
      pointerEventsClass,
      "absolute h-6 min-w-6 -translate-y-1/2 bg-background/90 px-1.5 py-0 font-mono text-[11px] shadow-xs",
      glyph.reference
        ? "border border-dashed border-muted-foreground/50 text-muted-foreground"
        : "text-foreground",
    )
  }
  return cn(
    variant,
    pointerEventsClass,
    "absolute h-6 min-w-6 -translate-y-1/2 gap-0.5 bg-background/85 px-1.5 py-0 font-mono text-[11px] font-semibold shadow-xs",
    glyph.external ? "text-sketch-reference-context" : "text-primary",
  )
}

function selectConstraintAnnotation(
  event: MouseEvent<HTMLButtonElement>,
  glyph: ConstraintGlyph,
  onSelect: (constraintId: SketchConstraintId) => void,
  suppressClickRef: RefObject<boolean>,
) {
  event.stopPropagation()
  if (suppressClickRef.current) {
    suppressClickRef.current = false
    return
  }
  onSelect(glyph.id)
}

function editConstraintAnnotation(
  event: MouseEvent<HTMLButtonElement>,
  glyph: ConstraintGlyph,
  onEditDimension: (constraintId: SketchConstraintId, point: SketchPoint2) => void,
) {
  if (!glyph.dimensional || glyph.reference) return
  event.preventDefault()
  event.stopPropagation()
  onEditDimension(glyph.id, glyph.point)
}

function beginConstraintAnnotationDrag({
  bounds,
  cleanupRef,
  dragRef,
  event,
  glyph,
  onPositionChange,
  scale,
  suppressClickRef,
}: Readonly<{
  bounds: SketchBounds
  cleanupRef: RefObject<(() => void) | null>
  dragRef: RefObject<ConstraintAnnotationDrag | null>
  event: PointerEvent<HTMLButtonElement>
  glyph: ConstraintGlyph
  onPositionChange: (constraintId: SketchConstraintId, point: SketchPoint2) => void
  scale: number
  suppressClickRef: RefObject<boolean>
}>) {
  if (!glyph.dimensional || event.button !== 0) return
  event.preventDefault()
  event.stopPropagation()
  event.currentTarget.setPointerCapture?.(event.pointerId)
  cleanupRef.current?.()
  suppressClickRef.current = false
  const overlayRectangle = event.currentTarget.parentElement?.getBoundingClientRect()
  const pointerScale = overlayRectangle
    ? Math.min(overlayRectangle.width / bounds.width, overlayRectangle.height / bounds.height)
    : scale
  dragRef.current = {
    clientX: event.clientX,
    clientY: event.clientY,
    element: event.currentTarget,
    id: glyph.id,
    lastClientX: event.clientX,
    lastClientY: event.clientY,
    point: glyph.point,
    pointerId: event.pointerId,
    scale: pointerScale,
  }
  const move = (moveEvent: globalThis.PointerEvent) => {
    const drag = dragRef.current
    if (
      !drag ||
      drag.pointerId !== moveEvent.pointerId ||
      !Number.isFinite(drag.scale) ||
      drag.scale <= 0
    ) {
      return
    }
    const deltaX = moveEvent.clientX - drag.clientX
    const deltaY = moveEvent.clientY - drag.clientY
    if (Math.hypot(deltaX, deltaY) < 3) return
    suppressClickRef.current = true
    dragRef.current = {
      ...drag,
      lastClientX: moveEvent.clientX,
      lastClientY: moveEvent.clientY,
    }
    drag.element.style.translate = `${deltaX}px ${deltaY}px`
  }
  const cleanup = () => {
    window.removeEventListener("pointermove", move)
    window.removeEventListener("pointerup", finish)
    window.removeEventListener("pointercancel", finish)
    cleanupRef.current = null
  }
  const finish = (finishEvent: globalThis.PointerEvent) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== finishEvent.pointerId) return
    const deltaX = drag.lastClientX - drag.clientX
    const deltaY = drag.lastClientY - drag.clientY
    dragRef.current = null
    drag.element.style.translate = ""
    if (Math.hypot(deltaX, deltaY) >= 3 && Number.isFinite(drag.scale) && drag.scale > 0) {
      onPositionChange(drag.id, {
        x: drag.point.x + deltaX / drag.scale,
        y: drag.point.y - deltaY / drag.scale,
      })
    }
    cleanup()
  }
  cleanupRef.current = cleanup
  window.addEventListener("pointermove", move)
  window.addEventListener("pointerup", finish)
  window.addEventListener("pointercancel", finish)
}

function constraintRelatedEntityEventHandlers(
  glyph: ConstraintGlyph,
  onChange: ConstraintRelatedEntityChange,
) {
  return {
    onBlur: () => onChange("focus", null),
    onFocus: () => onChange("focus", glyph),
    onPointerEnter: () => onChange("hover", glyph),
    onPointerLeave: () => onChange("hover", null),
  }
}

type ConstraintAnnotationInteraction = Readonly<{
  cleanupRef: RefObject<(() => void) | null>
  dragRef: RefObject<ConstraintAnnotationDrag | null>
  editDimensionLabel: (label: string) => string
  onEditDimension: (constraintId: SketchConstraintId, point: SketchPoint2) => void
  onDelete: (constraintId: SketchConstraintId) => void
  onPositionChange: (constraintId: SketchConstraintId, point: SketchPoint2) => void
  onRelatedEntitiesChange: ConstraintRelatedEntityChange
  onSelect: (constraintId: SketchConstraintId) => void
  pointerEventsClass: string
  scale: number
  selectConstraintLabel: (
    label: string,
    constraintType: SketchRecord["constraints"][number]["type"],
  ) => string
  selectExternalConstraintLabel: (
    label: string,
    constraintType: SketchRecord["constraints"][number]["type"],
  ) => string
  suppressClickRef: RefObject<boolean>
}>

function deleteConstraintAnnotation(
  event: KeyboardEvent<HTMLButtonElement>,
  glyph: ConstraintGlyph,
  onDelete: (constraintId: SketchConstraintId) => void,
) {
  if (event.key !== "Delete" && event.key !== "Backspace") return
  event.preventDefault()
  event.stopPropagation()
  onDelete(glyph.id)
}

function ConstraintAnnotation({
  bounds,
  glyph,
  interaction,
  selected,
  viewport,
}: Readonly<{
  bounds: SketchBounds
  glyph: ConstraintGlyph
  interaction: ConstraintAnnotationInteraction
  selected: boolean
  viewport: SketchViewportSize
}>) {
  const accessibleLabel = constraintGlyphAccessibleLabel(
    glyph,
    interaction.editDimensionLabel,
    interaction.selectConstraintLabel,
    interaction.selectExternalConstraintLabel,
  )
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          {...constraintRelatedEntityEventHandlers(glyph, interaction.onRelatedEntitiesChange)}
          data-sketch-constraint-id={glyph.id}
          data-sketch-constraint-kind={glyph.dimensional ? "dimension" : "geometric"}
          data-sketch-dimension-mode={glyph.reference ? "reference" : undefined}
          data-sketch-constraint-source={glyph.external ? "external" : "internal"}
          aria-label={accessibleLabel}
          aria-pressed={selected}
          className={constraintGlyphClassName(glyph, interaction.pointerEventsClass, selected)}
          style={constraintAnnotationPosition(glyph.point, bounds, viewport)}
          onClick={(event) =>
            selectConstraintAnnotation(
              event,
              glyph,
              interaction.onSelect,
              interaction.suppressClickRef,
            )
          }
          onDoubleClick={(event) =>
            editConstraintAnnotation(event, glyph, interaction.onEditDimension)
          }
          onKeyDown={(event) => deleteConstraintAnnotation(event, glyph, interaction.onDelete)}
          onPointerDown={(event) =>
            beginConstraintAnnotationDrag({
              bounds,
              cleanupRef: interaction.cleanupRef,
              dragRef: interaction.dragRef,
              event,
              glyph,
              onPositionChange: interaction.onPositionChange,
              scale: interaction.scale,
              suppressClickRef: interaction.suppressClickRef,
            })
          }
        >
          {glyph.external ? <Link2 aria-hidden="true" className="size-2.5" /> : null}
          {glyph.label}
        </button>
      </TooltipTrigger>
      <TooltipContent>{accessibleLabel}</TooltipContent>
    </Tooltip>
  )
}

function ConstraintAnnotationCollection({
  bounds,
  glyphs,
  interaction,
  selectedConstraintId,
  viewport,
}: Readonly<{
  bounds: SketchBounds
  glyphs: readonly ConstraintGlyph[]
  interaction: ConstraintAnnotationInteraction
  selectedConstraintId: SketchConstraintId | null
  viewport: SketchViewportSize
}>) {
  return (
    <div className="pointer-events-none absolute inset-0 z-10">
      {glyphs.map((glyph) => (
        <ConstraintAnnotation
          key={glyph.id}
          bounds={bounds}
          glyph={glyph}
          interaction={interaction}
          selected={selectedConstraintId === glyph.id}
          viewport={viewport}
        />
      ))}
    </div>
  )
}

function useConstraintGlyphPresentation(
  sketch: SketchRecord,
  geometry: SketchGeometryPresentation,
  dimensionLabelPositions: ReadonlyMap<SketchConstraintId, SketchPoint2>,
) {
  const displayUnits = useDocumentDisplayUnits()
  const formatter = useFormatter()
  return constraintGlyphs(sketch, geometry, displayUnits, (value) =>
    formatter.number(value, { maximumFractionDigits: 6 }),
  ).map((glyph) => {
    const position = glyph.dimensional ? dimensionLabelPositions.get(glyph.id) : null
    return position ? { ...glyph, point: position } : glyph
  })
}

type ConstraintAnnotationConfiguration = Pick<
  SketchDrawingConfiguration,
  | "editDimensionLabel"
  | "draft"
  | "onDraftChange"
  | "onConstraintSelectionChange"
  | "selectedConstraintId"
  | "selectConstraintLabel"
  | "selectExternalConstraintLabel"
>

function ConstraintAnnotations({
  bounds,
  configuration,
  dimensionLabelPositions,
  geometry,
  interactive,
  onEditDimension,
  onDimensionPositionChange,
  onRelatedEntitiesChange,
  sketch,
  viewport,
}: {
  bounds: SketchBounds
  configuration: ConstraintAnnotationConfiguration
  dimensionLabelPositions: ReadonlyMap<SketchConstraintId, SketchPoint2>
  geometry: SketchGeometryPresentation
  interactive: boolean
  onEditDimension: (constraintId: SketchConstraintId, point: SketchPoint2) => void
  onDimensionPositionChange: (constraintId: SketchConstraintId, point: SketchPoint2) => void
  onRelatedEntitiesChange: ConstraintRelatedEntityChange
  sketch: SketchRecord
  viewport: SketchViewportSize
}) {
  const pointerEventsClass = interactive ? "pointer-events-auto" : "pointer-events-none"
  const dragRef = useRef<ConstraintAnnotationDrag | null>(null)
  const dragCleanupRef = useRef<(() => void) | null>(null)
  const suppressClickRef = useRef(false)
  const scale = Math.min(viewport.width / bounds.width, viewport.height / bounds.height)
  useEffect(
    () => () => {
      dragCleanupRef.current?.()
    },
    [],
  )
  const glyphs = useConstraintGlyphPresentation(sketch, geometry, dimensionLabelPositions)
  const deleteConstraint = useCallback(
    (constraintId: SketchConstraintId) => {
      if (!configuration.draft) return
      configuration.onDraftChange(removeSketchConstraints(configuration.draft, [constraintId]))
      configuration.onConstraintSelectionChange(null)
    },
    [configuration.draft, configuration.onConstraintSelectionChange, configuration.onDraftChange],
  )
  const interaction: ConstraintAnnotationInteraction = {
    cleanupRef: dragCleanupRef,
    dragRef,
    editDimensionLabel: configuration.editDimensionLabel,
    onDelete: deleteConstraint,
    onEditDimension,
    onPositionChange: onDimensionPositionChange,
    onRelatedEntitiesChange,
    onSelect: configuration.onConstraintSelectionChange,
    pointerEventsClass,
    scale,
    selectConstraintLabel: configuration.selectConstraintLabel,
    selectExternalConstraintLabel: configuration.selectExternalConstraintLabel,
    suppressClickRef,
  }
  return (
    <ConstraintAnnotationCollection
      bounds={bounds}
      glyphs={glyphs}
      interaction={interaction}
      selectedConstraintId={configuration.selectedConstraintId}
      viewport={viewport}
    />
  )
}

const StableConstraintAnnotations = memo(ConstraintAnnotations)

function SketchDrawingAnnotations({
  configuration,
  dimensionLabelPositions,
  onEditDimension,
  onDimensionPositionChange,
  onRelatedEntitiesChange,
  sketch,
  state,
}: Pick<SketchDrawingViewProps, "configuration" | "sketch" | "state"> &
  Readonly<{
    dimensionLabelPositions: ReadonlyMap<SketchConstraintId, SketchPoint2>
    onEditDimension: (constraintId: SketchConstraintId, point: SketchPoint2) => void
    onDimensionPositionChange: (constraintId: SketchConstraintId, point: SketchPoint2) => void
    onRelatedEntitiesChange: ConstraintRelatedEntityChange
  }>) {
  const annotationConfiguration = useMemo<ConstraintAnnotationConfiguration>(
    () => ({
      editDimensionLabel: configuration.editDimensionLabel,
      draft: configuration.draft,
      onDraftChange: configuration.onDraftChange,
      onConstraintSelectionChange: configuration.onConstraintSelectionChange,
      selectedConstraintId: configuration.selectedConstraintId,
      selectConstraintLabel: configuration.selectConstraintLabel,
      selectExternalConstraintLabel: configuration.selectExternalConstraintLabel,
    }),
    [
      configuration.editDimensionLabel,
      configuration.draft,
      configuration.onDraftChange,
      configuration.onConstraintSelectionChange,
      configuration.selectedConstraintId,
      configuration.selectConstraintLabel,
      configuration.selectExternalConstraintLabel,
    ],
  )
  return (
    <StableConstraintAnnotations
      bounds={state.bounds}
      configuration={annotationConfiguration}
      dimensionLabelPositions={dimensionLabelPositions}
      geometry={state.geometry}
      interactive={state.editable && isSketchSelectionTool(configuration.editorTool)}
      onEditDimension={onEditDimension}
      onDimensionPositionChange={onDimensionPositionChange}
      onRelatedEntitiesChange={onRelatedEntitiesChange}
      sketch={sketch}
      viewport={state.viewportSize}
    />
  )
}

type PendingWithTargetStart = Extract<
  PendingGeometry,
  | { kind: "aligned-rectangle-end" }
  | { kind: "aligned-rectangle-width" }
  | { kind: "line" }
  | { kind: "slot-end" }
  | { kind: "slot-width" }
  | { kind: "three-point-arc-end" }
  | { kind: "three-point-arc-point" }
>

const pendingTargetStartKinds: ReadonlySet<PendingGeometry["kind"]> = new Set([
  "aligned-rectangle-end",
  "aligned-rectangle-width",
  "line",
  "slot-end",
  "slot-width",
  "three-point-arc-end",
  "three-point-arc-point",
])

type PendingWithTargetCenter = Extract<
  PendingGeometry,
  | { kind: "center-rectangle" }
  | { kind: "centered-aligned-rectangle-side" }
  | { kind: "centered-aligned-rectangle-width" }
  | { kind: "centered-slot-end" }
  | { kind: "centered-slot-width" }
  | { kind: "circle" }
  | { kind: "ellipse-primary" }
  | { kind: "ellipse-secondary" }
  | { kind: "elliptical-arc-primary" }
  | { kind: "elliptical-arc-start" }
  | { kind: "elliptical-arc-end" }
  | { kind: "regular-polygon-radius" }
  | { kind: "regular-polygon-sides" }
>

const pendingTargetCenterKinds: ReadonlySet<PendingGeometry["kind"]> = new Set([
  "center-rectangle",
  "centered-aligned-rectangle-side",
  "centered-aligned-rectangle-width",
  "centered-slot-end",
  "centered-slot-width",
  "circle",
  "ellipse-primary",
  "ellipse-secondary",
  "elliptical-arc-primary",
  "elliptical-arc-start",
  "elliptical-arc-end",
  "regular-polygon-radius",
  "regular-polygon-sides",
])

function hasPendingTargetStart(pending: PendingGeometry): pending is PendingWithTargetStart {
  return pendingTargetStartKinds.has(pending.kind)
}

function hasPendingTargetCenter(pending: PendingGeometry): pending is PendingWithTargetCenter {
  return pendingTargetCenterKinds.has(pending.kind)
}

function pendingTargetStart(pending: PendingGeometry): SketchPointTarget | null {
  if (hasPendingTargetStart(pending)) return pending.start
  if (pending.kind === "midpoint-line") return pending.midpoint
  if (hasPendingTargetCenter(pending)) return pending.center
  if ("first" in pending) return pending.first
  return pending.kind === "tangent-arc" ? { kind: "existing", pointId: pending.startPointId } : null
}

function lineForPendingSlot(sketch: SketchRecord, lineId: SketchEntityId) {
  const entity = sketch.entities.find(({ id }) => id === lineId)
  return entity?.type === "line" ? entity : null
}

function pendingStart(pending: PendingGeometry, sketch: SketchRecord) {
  const target = pendingTargetStart(pending)
  if (target) return pointForTarget(sketch, target)
  switch (pending.kind) {
    case "rectangle":
      return pending.firstCorner
    case "arc-start":
      return pending.center
    case "arc-end":
      return pending.start
    case "slot-from-selection-width": {
      const line = lineForPendingSlot(sketch, pending.lineId)
      return line
        ? pointForTarget(sketch, { kind: "existing", pointId: line.startPointId })
        : { x: 0, y: 0 }
    }
    case "split-circle-second":
      return pending.firstPoint
    case "split-ellipse-second":
      return pending.firstPoint
    default:
      return { x: 0, y: 0 }
  }
}

type PendingRectangle =
  | Extract<PendingGeometry, { kind: "aligned-rectangle-end" }>
  | Extract<PendingGeometry, { kind: "aligned-rectangle-width" }>
  | Extract<PendingGeometry, { kind: "centered-aligned-rectangle-side" }>
  | Extract<PendingGeometry, { kind: "centered-aligned-rectangle-width" }>
  | Extract<PendingGeometry, { kind: "rectangle" }>
  | Extract<PendingGeometry, { kind: "center-rectangle" }>

function PendingRectangleShape({
  cursor,
  pending,
  sketch,
  start,
}: {
  cursor: SketchPoint2
  pending: PendingRectangle
  sketch: SketchRecord
  start: SketchPoint2
}) {
  if (pending.kind === "aligned-rectangle-end") {
    return <line x1={start.x} y1={start.y} x2={cursor.x} y2={cursor.y} />
  }
  if (pending.kind === "aligned-rectangle-width") {
    const end = pointForTarget(sketch, pending.end)
    const geometry = alignedRectangleGeometry(start, end, cursor)
    return geometry ? (
      <polygon
        points={`${start.x},${start.y} ${end.x},${end.y} ${geometry.third.x},${geometry.third.y} ${geometry.fourth.x},${geometry.fourth.y}`}
      />
    ) : (
      <line x1={start.x} y1={start.y} x2={end.x} y2={end.y} />
    )
  }
  if (pending.kind === "centered-aligned-rectangle-side") {
    const opposite = { x: start.x * 2 - cursor.x, y: start.y * 2 - cursor.y }
    return <line x1={opposite.x} y1={opposite.y} x2={cursor.x} y2={cursor.y} />
  }
  if (pending.kind === "centered-aligned-rectangle-width") {
    const side = pointForTarget(sketch, pending.side)
    const geometry = centeredAlignedRectangleGeometry(start, side, cursor)
    const opposite = { x: start.x * 2 - side.x, y: start.y * 2 - side.y }
    return geometry ? (
      <>
        <polygon points={geometry.corners.map(({ x, y }) => `${x},${y}`).join(" ")} />
        <line
          x1={geometry.oppositeSidePoint.x}
          y1={geometry.oppositeSidePoint.y}
          x2={side.x}
          y2={side.y}
        />
      </>
    ) : (
      <line x1={opposite.x} y1={opposite.y} x2={side.x} y2={side.y} />
    )
  }
  if (pending.kind === "rectangle") {
    return (
      <rect
        x={Math.min(start.x, cursor.x)}
        y={Math.min(start.y, cursor.y)}
        width={Math.abs(cursor.x - start.x)}
        height={Math.abs(cursor.y - start.y)}
      />
    )
  }
  if (pending.kind === "center-rectangle") {
    const opposite = { x: start.x * 2 - cursor.x, y: start.y * 2 - cursor.y }
    return (
      <>
        <rect
          x={Math.min(opposite.x, cursor.x)}
          y={Math.min(opposite.y, cursor.y)}
          width={Math.abs(cursor.x - opposite.x)}
          height={Math.abs(cursor.y - opposite.y)}
        />
        <line x1={opposite.x} y1={opposite.y} x2={cursor.x} y2={cursor.y} />
        <line x1={opposite.x} y1={cursor.y} x2={cursor.x} y2={opposite.y} />
      </>
    )
  }
  return null
}

function lineAtEndpoint(sketch: SketchRecord, pointId: SketchEntityId) {
  for (let index = sketch.entities.length - 1; index >= 0; index -= 1) {
    const entity = sketch.entities[index]
    if (
      entity?.type === "line" &&
      (entity.startPointId === pointId || entity.endPointId === pointId)
    ) {
      return entity
    }
  }
  return null
}

function tangentArcReference(sketch: SketchRecord, target: SketchPointTarget) {
  if (target.kind !== "existing") return null
  const line = lineAtEndpoint(sketch, target.pointId)
  return line ? { lineId: line.id, startPointId: target.pointId } : null
}

function tangentArcInteriorPoint(
  sketch: SketchRecord,
  lineId: SketchEntityId,
  startPointId: SketchEntityId,
) {
  const line = sketch.entities.find(
    (entity): entity is Extract<SketchEntity, { type: "line" }> =>
      entity.id === lineId && entity.type === "line",
  )
  if (!line) return null
  const interiorPointId =
    line.startPointId === startPointId
      ? line.endPointId
      : line.endPointId === startPointId
        ? line.startPointId
        : null
  return interiorPointId
    ? pointForTarget(sketch, { kind: "existing", pointId: interiorPointId })
    : null
}

function PendingThreePointArcShape({
  cursor,
  pending,
  sketch,
  start,
}: {
  cursor: SketchPoint2
  pending: Extract<PendingGeometry, { kind: "three-point-arc-point" }>
  sketch: SketchRecord
  start: SketchPoint2
}) {
  const end = pointForTarget(sketch, pending.end)
  const geometry = threePointArcGeometry(start, end, cursor)
  return geometry ? (
    <polyline points={arcPolyline(geometry.center, geometry.start, geometry.end)} />
  ) : (
    <polyline points={`${start.x},${start.y} ${end.x},${end.y} ${cursor.x},${cursor.y}`} />
  )
}

function PendingThreePointCircleShape({
  cursor,
  pending,
  sketch,
  start,
}: {
  cursor: SketchPoint2
  pending: Extract<PendingGeometry, { kind: "three-point-circle-third" }>
  sketch: SketchRecord
  start: SketchPoint2
}) {
  const second = pointForTarget(sketch, pending.second)
  const geometry = threePointCircleGeometry(start, second, cursor)
  return geometry ? (
    <circle cx={geometry.center.x} cy={geometry.center.y} r={geometry.radius} />
  ) : (
    <polyline points={`${start.x},${start.y} ${second.x},${second.y} ${cursor.x},${cursor.y}`} />
  )
}

function ellipseSvgTransform(geometry: NonNullable<ReturnType<typeof sketchEllipseGeometry>>) {
  const angle =
    (Math.atan2(
      geometry.primaryAxisPoint.y - geometry.center.y,
      geometry.primaryAxisPoint.x - geometry.center.x,
    ) *
      180) /
    Math.PI
  return `rotate(${angle} ${geometry.center.x} ${geometry.center.y})`
}

function PendingEllipseShape({
  cursor,
  pending,
  sketch,
}: {
  cursor: SketchPoint2
  pending: Extract<PendingGeometry, { kind: "ellipse-primary" | "ellipse-secondary" }>
  sketch: SketchRecord
}) {
  const center = pointForTarget(sketch, pending.center)
  if (pending.kind === "ellipse-primary") {
    return <line x1={center.x} y1={center.y} x2={cursor.x} y2={cursor.y} />
  }
  const primaryAxisPoint = pointForTarget(sketch, pending.primaryAxisPoint)
  const geometry = sketchEllipseGeometry(center, primaryAxisPoint, cursor)
  if (!geometry) {
    return <line x1={center.x} y1={center.y} x2={primaryAxisPoint.x} y2={primaryAxisPoint.y} />
  }
  return (
    <>
      <ellipse
        cx={geometry.center.x}
        cy={geometry.center.y}
        rx={geometry.primaryRadius}
        ry={geometry.secondaryRadius}
        transform={ellipseSvgTransform(geometry)}
      />
      <line
        x1={geometry.center.x}
        y1={geometry.center.y}
        x2={geometry.primaryAxisPoint.x}
        y2={geometry.primaryAxisPoint.y}
      />
      <line
        x1={geometry.center.x}
        y1={geometry.center.y}
        x2={geometry.secondaryAxisPoint.x}
        y2={geometry.secondaryAxisPoint.y}
      />
    </>
  )
}

type PendingEllipticalArc = Extract<
  PendingGeometry,
  { kind: "elliptical-arc-primary" | "elliptical-arc-start" | "elliptical-arc-end" }
>

function isPendingEllipticalArc(pending: PendingGeometry | null): pending is PendingEllipticalArc {
  return (
    pending?.kind === "elliptical-arc-primary" ||
    pending?.kind === "elliptical-arc-start" ||
    pending?.kind === "elliptical-arc-end"
  )
}

function PendingEllipticalArcShape({
  cursor,
  pending,
  sketch,
}: {
  cursor: SketchPoint2
  pending: PendingEllipticalArc
  sketch: SketchRecord
}) {
  const center = pointForTarget(sketch, pending.center)
  if (pending.kind === "elliptical-arc-primary") {
    return <line x1={center.x} y1={center.y} x2={cursor.x} y2={cursor.y} />
  }
  const primaryAxisPoint = pointForTarget(sketch, pending.primaryAxisPoint)
  const geometry =
    pending.kind === "elliptical-arc-start"
      ? sketchEllipticalArcStartGeometry(center, primaryAxisPoint, cursor)
      : sketchEllipticalArcGeometry(
          center,
          primaryAxisPoint,
          pending.secondaryAxisPoint,
          pointForTarget(sketch, pending.startPoint),
          cursor,
        )
  if (!geometry) {
    return <line x1={center.x} y1={center.y} x2={primaryAxisPoint.x} y2={primaryAxisPoint.y} />
  }
  return (
    <>
      <ellipse
        cx={geometry.center.x}
        cy={geometry.center.y}
        opacity={0.55}
        rx={geometry.primaryRadius}
        ry={geometry.secondaryRadius}
        transform={ellipseSvgTransform(geometry)}
      />
      <line
        x1={geometry.center.x}
        y1={geometry.center.y}
        x2={geometry.primaryAxisPoint.x}
        y2={geometry.primaryAxisPoint.y}
      />
      <line
        x1={geometry.center.x}
        y1={geometry.center.y}
        x2={geometry.secondaryAxisPoint.x}
        y2={geometry.secondaryAxisPoint.y}
      />
      {"sweep" in geometry ? (
        <polyline
          strokeDasharray="none"
          strokeWidth={2}
          points={ellipticalArcGeometrySamples(geometry)
            .map(({ x, y }) => `${x},${y}`)
            .join(" ")}
        />
      ) : (
        <circle cx={geometry.startPoint.x} cy={geometry.startPoint.y} r={2.5} />
      )}
    </>
  )
}

function PendingTangentArcShape({
  cursor,
  pending,
  sketch,
  start,
}: {
  cursor: SketchPoint2
  pending: Extract<PendingGeometry, { kind: "tangent-arc" }>
  sketch: SketchRecord
  start: SketchPoint2
}) {
  const interior = tangentArcInteriorPoint(sketch, pending.lineId, pending.startPointId)
  const geometry = interior ? tangentArcGeometry(interior, start, cursor) : null
  if (!geometry) return <line x1={start.x} y1={start.y} x2={cursor.x} y2={cursor.y} />
  const arcStart = geometry.sharedEndpoint === "start" ? start : cursor
  const arcEnd = geometry.sharedEndpoint === "end" ? start : cursor
  return <polyline points={arcPolyline(geometry.center, arcStart, arcEnd)} />
}

type PendingSlot = Extract<
  PendingGeometry,
  | { kind: "centered-slot-end" }
  | { kind: "centered-slot-width" }
  | { kind: "slot-end" }
  | { kind: "slot-from-selection-width" }
  | { kind: "slot-width" }
>

const pendingSlotKinds: ReadonlySet<PendingGeometry["kind"]> = new Set([
  "centered-slot-end",
  "centered-slot-width",
  "slot-end",
  "slot-from-selection-width",
  "slot-width",
])

function isPendingSlot(pending: PendingGeometry): pending is PendingSlot {
  return pendingSlotKinds.has(pending.kind)
}

function PendingSlotShape({
  cursor,
  pending,
  sketch,
  start,
}: {
  cursor: SketchPoint2
  pending: PendingSlot
  sketch: SketchRecord
  start: SketchPoint2
}) {
  if (pending.kind === "slot-end") {
    return <line x1={start.x} y1={start.y} x2={cursor.x} y2={cursor.y} />
  }
  if (pending.kind === "centered-slot-end") {
    const opposite = { x: start.x * 2 - cursor.x, y: start.y * 2 - cursor.y }
    return <line x1={opposite.x} y1={opposite.y} x2={cursor.x} y2={cursor.y} />
  }
  const selectedLine =
    pending.kind === "slot-from-selection-width" ? lineForPendingSlot(sketch, pending.lineId) : null
  const selectedEnd = selectedLine
    ? pointForTarget(sketch, { kind: "existing", pointId: selectedLine.endPointId })
    : "end" in pending
      ? pointForTarget(sketch, pending.end)
      : start
  const startCenter =
    pending.kind === "centered-slot-width"
      ? { x: start.x * 2 - selectedEnd.x, y: start.y * 2 - selectedEnd.y }
      : start
  const geometry = straightSlotGeometry(startCenter, selectedEnd, cursor)
  if (!geometry) {
    return <line x1={startCenter.x} y1={startCenter.y} x2={selectedEnd.x} y2={selectedEnd.y} />
  }
  return (
    <>
      <line
        x1={geometry.startPositive.x}
        y1={geometry.startPositive.y}
        x2={geometry.endPositive.x}
        y2={geometry.endPositive.y}
      />
      <line
        x1={geometry.endNegative.x}
        y1={geometry.endNegative.y}
        x2={geometry.startNegative.x}
        y2={geometry.startNegative.y}
      />
      <polyline points={arcPolyline(selectedEnd, geometry.endNegative, geometry.endPositive)} />
      <polyline points={arcPolyline(startCenter, geometry.startPositive, geometry.startNegative)} />
      <line x1={startCenter.x} y1={startCenter.y} x2={selectedEnd.x} y2={selectedEnd.y} />
    </>
  )
}

type PendingRoundCurve = Extract<
  PendingGeometry,
  | { kind: "arc-end" }
  | { kind: "circle" }
  | { kind: "tangent-arc" }
  | { kind: "three-point-arc-point" }
  | { kind: "three-point-circle-third" }
>

const pendingRoundCurveKinds: ReadonlySet<PendingGeometry["kind"]> = new Set([
  "arc-end",
  "circle",
  "tangent-arc",
  "three-point-arc-point",
  "three-point-circle-third",
])

function isPendingRoundCurve(pending: PendingGeometry): pending is PendingRoundCurve {
  return pendingRoundCurveKinds.has(pending.kind)
}

function PendingRoundCurveShape({
  cursor,
  pending,
  sketch,
  start,
}: {
  cursor: SketchPoint2
  pending: PendingRoundCurve
  sketch: SketchRecord
  start: SketchPoint2
}) {
  switch (pending.kind) {
    case "circle":
      return (
        <circle cx={start.x} cy={start.y} r={Math.hypot(cursor.x - start.x, cursor.y - start.y)} />
      )
    case "arc-end":
      return <polyline points={arcPolyline(pending.center, pending.start, cursor)} />
    case "three-point-arc-point":
      return (
        <PendingThreePointArcShape
          cursor={cursor}
          pending={pending}
          sketch={sketch}
          start={start}
        />
      )
    case "three-point-circle-third":
      return (
        <PendingThreePointCircleShape
          cursor={cursor}
          pending={pending}
          sketch={sketch}
          start={start}
        />
      )
    case "tangent-arc":
      return (
        <PendingTangentArcShape cursor={cursor} pending={pending} sketch={sketch} start={start} />
      )
  }
}

type PendingRegularPolygon = Extract<
  PendingGeometry,
  { kind: "regular-polygon-radius" } | { kind: "regular-polygon-sides" }
>

function regularPolygonPointerSideCount(
  center: SketchPoint2,
  radiusPoint: SketchPoint2,
  cursor: SketchPoint2,
) {
  const radius = Math.hypot(radiusPoint.x - center.x, radiusPoint.y - center.y)
  const cursorRadius = Math.hypot(cursor.x - center.x, cursor.y - center.y)
  const step = Math.max(radius * 0.15, 1e-9)
  const sideCount = DEFAULT_REGULAR_POLYGON_SIDES + Math.round((cursorRadius - radius) / step)
  return Math.min(MAX_REGULAR_POLYGON_SIDES, Math.max(MIN_REGULAR_POLYGON_SIDES, sideCount))
}

function parsedRegularPolygonSideCount(value: string | null) {
  if (value === null || !/^\d{1,2}$/.test(value)) return null
  const sideCount = Number(value)
  return sideCount >= MIN_REGULAR_POLYGON_SIDES && sideCount <= MAX_REGULAR_POLYGON_SIDES
    ? sideCount
    : null
}

function regularPolygonPreview(
  cursor: SketchPoint2,
  pending: PendingRegularPolygon,
  sketch: SketchRecord,
) {
  const center = pointForTarget(sketch, pending.center)
  const radiusPoint =
    pending.kind === "regular-polygon-radius" ? cursor : pointForTarget(sketch, pending.radiusPoint)
  const typedSideCount =
    pending.kind === "regular-polygon-sides"
      ? parsedRegularPolygonSideCount(pending.sideCountInput)
      : null
  const sideCount =
    typedSideCount ??
    (pending.kind === "regular-polygon-sides"
      ? regularPolygonPointerSideCount(center, radiusPoint, cursor)
      : DEFAULT_REGULAR_POLYGON_SIDES)
  const geometry = regularPolygonGeometry(center, radiusPoint, sideCount, pending.mode)
  return geometry ? { center, geometry, radiusPoint, sideCount } : null
}

function PendingRegularPolygonShape({
  cursor,
  pending,
  sketch,
}: {
  cursor: SketchPoint2
  pending: PendingRegularPolygon
  sketch: SketchRecord
}) {
  const preview = regularPolygonPreview(cursor, pending, sketch)
  if (!preview) return null
  const labelPoint = {
    x: preview.radiusPoint.x,
    y: preview.radiusPoint.y + preview.geometry.constructionRadius * 0.12,
  }
  return (
    <g data-sketch-polygon-preview={pending.mode}>
      <circle cx={preview.center.x} cy={preview.center.y} r={preview.geometry.constructionRadius} />
      <line
        x1={preview.center.x}
        y1={preview.center.y}
        x2={preview.radiusPoint.x}
        y2={preview.radiusPoint.y}
      />
      <polygon points={preview.geometry.vertices.map(({ x, y }) => `${x},${y}`).join(" ")} />
      {pending.kind === "regular-polygon-sides" ? (
        <text
          className="fill-muted-foreground stroke-none font-mono font-semibold"
          data-sketch-polygon-side-count={preview.sideCount}
          fontSize={Math.max(preview.geometry.constructionRadius * 0.18, 1)}
          textAnchor="middle"
          transform={`translate(${labelPoint.x} ${labelPoint.y}) scale(1 -1)`}
        >
          {pending.sideCountInput ?? preview.sideCount}
        </text>
      ) : null}
    </g>
  )
}

type PendingCircleSplit = Extract<PendingGeometry, { kind: "split-circle-second" }>

function PendingCircleSplitShape({
  cursor,
  pending,
  sketch,
}: {
  cursor: SketchPoint2
  pending: PendingCircleSplit
  sketch: SketchRecord
}) {
  const circle = sketch.entities.find(({ id }) => id === pending.circleId)
  if (circle?.type !== "circle") return null
  const center = sketch.entities.find(({ id }) => id === circle.centerPointId)
  const secondPoint = projectedCirclePoint(sketch, circle, cursor)
  if (center?.type !== "point" || !secondPoint) return null
  return (
    <>
      <polyline points={arcPolyline(center, pending.firstPoint, secondPoint)} />
      <polyline points={arcPolyline(center, secondPoint, pending.firstPoint)} />
      <circle cx={pending.firstPoint.x} cy={pending.firstPoint.y} r={3} />
      <circle cx={secondPoint.x} cy={secondPoint.y} r={3} />
    </>
  )
}

type PendingEllipseSplit = Extract<PendingGeometry, { kind: "split-ellipse-second" }>

function ellipseArcPreviewPoints(
  geometry: NonNullable<ReturnType<typeof sketchEllipseGeometry>>,
  start: SketchPoint2,
  end: SketchPoint2,
) {
  const startParameter = sketchEllipseParameterForPoint(geometry, start)
  const endParameter = sketchEllipseParameterForPoint(geometry, end)
  const sweep = (((endParameter - startParameter) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)
  const segmentCount = Math.max(8, Math.ceil((sweep / (Math.PI * 2)) * 64))
  return Array.from({ length: segmentCount + 1 }, (_, index) =>
    sketchEllipsePointAt(geometry, startParameter + (sweep * index) / segmentCount),
  )
}

function PendingEllipseSplitShape({
  cursor,
  pending,
  sketch,
}: {
  cursor: SketchPoint2
  pending: PendingEllipseSplit
  sketch: SketchRecord
}) {
  const ellipse = sketch.entities.find(({ id }) => id === pending.ellipseId)
  if (ellipse?.type !== "ellipse") return null
  const points = new Map(
    sketch.entities.flatMap((entity) => (entity.type === "point" ? [[entity.id, entity]] : [])),
  )
  const geometry = ellipseGeometry(ellipse, points)
  if (!geometry) return null
  const secondPoint = projectPointToSketchEllipse(geometry, cursor).point
  const firstArc = ellipseArcPreviewPoints(geometry, pending.firstPoint, secondPoint)
  const secondArc = ellipseArcPreviewPoints(geometry, secondPoint, pending.firstPoint)
  return (
    <>
      <polyline points={firstArc.map(({ x, y }) => `${x},${y}`).join(" ")} />
      <polyline points={secondArc.map(({ x, y }) => `${x},${y}`).join(" ")} />
      <circle cx={pending.firstPoint.x} cy={pending.firstPoint.y} r={3} />
      <circle cx={secondPoint.x} cy={secondPoint.y} r={3} />
    </>
  )
}

type PendingAnalyticalCurve = Extract<
  PendingGeometry,
  | { kind: "ellipse-primary" | "ellipse-secondary" }
  | { kind: "elliptical-arc-primary" | "elliptical-arc-start" | "elliptical-arc-end" }
  | { kind: PendingRoundCurve["kind"] }
>

function isPendingAnalyticalCurve(pending: PendingGeometry): pending is PendingAnalyticalCurve {
  return (
    pending.kind === "ellipse-primary" ||
    pending.kind === "ellipse-secondary" ||
    isPendingEllipticalArc(pending) ||
    isPendingRoundCurve(pending)
  )
}

function PendingAnalyticalCurveShape({
  cursor,
  pending,
  sketch,
  start,
}: {
  cursor: SketchPoint2
  pending: PendingAnalyticalCurve
  sketch: SketchRecord
  start: SketchPoint2
}) {
  if (pending.kind === "ellipse-primary" || pending.kind === "ellipse-secondary") {
    return <PendingEllipseShape cursor={cursor} pending={pending} sketch={sketch} />
  }
  if (isPendingEllipticalArc(pending)) {
    return <PendingEllipticalArcShape cursor={cursor} pending={pending} sketch={sketch} />
  }
  return <PendingRoundCurveShape cursor={cursor} pending={pending} sketch={sketch} start={start} />
}

function PendingCurveShape({
  cursor,
  pending,
  sketch,
  start,
}: {
  cursor: SketchPoint2
  pending: Exclude<PendingGeometry, PendingRectangle>
  sketch: SketchRecord
  start: SketchPoint2
}) {
  if (pending.kind === "midpoint-line") {
    const opposite = { x: start.x * 2 - cursor.x, y: start.y * 2 - cursor.y }
    return <line x1={opposite.x} y1={opposite.y} x2={cursor.x} y2={cursor.y} />
  }
  if (isPendingSlot(pending)) {
    return <PendingSlotShape cursor={cursor} pending={pending} sketch={sketch} start={start} />
  }
  if (pending.kind === "regular-polygon-radius" || pending.kind === "regular-polygon-sides") {
    return <PendingRegularPolygonShape cursor={cursor} pending={pending} sketch={sketch} />
  }
  if (pending.kind === "split-circle-second") {
    return <PendingCircleSplitShape cursor={cursor} pending={pending} sketch={sketch} />
  }
  if (pending.kind === "split-ellipse-second") {
    return <PendingEllipseSplitShape cursor={cursor} pending={pending} sketch={sketch} />
  }
  if (isPendingAnalyticalCurve(pending)) {
    return (
      <PendingAnalyticalCurveShape
        cursor={cursor}
        pending={pending}
        sketch={sketch}
        start={start}
      />
    )
  }
  return <line x1={start.x} y1={start.y} x2={cursor.x} y2={cursor.y} />
}

function PendingShape({
  cursor,
  pending,
  sketch,
  start,
}: {
  cursor: SketchPoint2
  pending: PendingGeometry
  sketch: SketchRecord
  start: SketchPoint2
}) {
  const rectanglePending =
    pending.kind === "rectangle" ||
    pending.kind === "center-rectangle" ||
    pending.kind === "aligned-rectangle-end" ||
    pending.kind === "aligned-rectangle-width" ||
    pending.kind === "centered-aligned-rectangle-side" ||
    pending.kind === "centered-aligned-rectangle-width"
  return rectanglePending ? (
    <PendingRectangleShape cursor={cursor} pending={pending} sketch={sketch} start={start} />
  ) : (
    <PendingCurveShape cursor={cursor} pending={pending} sketch={sketch} start={start} />
  )
}

function PendingPreview({
  cursor,
  pending,
  sketch,
}: {
  cursor: SketchPoint2 | null
  pending: PendingGeometry | null
  sketch: SketchRecord
}) {
  if (!pending || !cursor || pending.kind === "mirror-sources") return null
  if (pending.kind === "offset-distance") {
    const preview = safeSketchLineOffsetPreview(sketch, pending, cursor)
    if (!preview) return null
    return (
      <g
        transform="scale(1 -1)"
        className="pointer-events-none stroke-muted-foreground"
        data-sketch-offset-distance={preview.distance}
        data-sketch-preview-tool={pending.kind}
        fill="none"
        strokeDasharray="5 4"
        strokeWidth={1.5}
        vectorEffect="non-scaling-stroke"
      >
        {preview.lines.map((line) => (
          <line
            key={line.sourceLineId}
            x1={line.start.x}
            y1={line.start.y}
            x2={line.end.x}
            y2={line.end.y}
          />
        ))}
      </g>
    )
  }
  const start = pendingStart(pending, sketch)
  return (
    <g
      transform="scale(1 -1)"
      className="pointer-events-none stroke-muted-foreground"
      data-sketch-preview-tool={pending.kind}
      fill="none"
      strokeDasharray="5 4"
      strokeWidth={1.5}
      vectorEffect="non-scaling-stroke"
    >
      <PendingShape cursor={cursor} pending={pending} sketch={sketch} start={start} />
    </g>
  )
}

type PlacementInput = Readonly<{
  construction: boolean
  direction: SketchDirectionInference | null
  draft: SketchRecord
  pending: PendingGeometry | null
  point: SketchPoint2
  relations: readonly SketchPointRelationInference[]
  target: SketchPointTarget
}>

type PlacementUpdate = Readonly<{
  creationPrecision?: SketchCreationPrecisionRequest
  draft: SketchRecord | null
  nextTool?: SketchEditorTool
  pending: PendingGeometry | null
}>

type SketchCreationPrecisionStep = Readonly<{
  anchor: SketchPoint2
  entityIds: readonly SketchEntityId[]
  initialKind: SketchDimensionKind
}>

type SketchCreationPrecisionRequest = Readonly<{
  activeStep: number
  retainForTool?: SketchEditorTool
  steps: readonly SketchCreationPrecisionStep[]
}>

function placePoint(input: PlacementInput): PlacementUpdate {
  if (input.target.kind === "existing") return { draft: null, pending: null }
  const result = appendSketchPoint(input.draft, {
    construction: input.construction,
    createEntityId: createBrowserSketchEntityId,
    point: input.point,
  })
  const pointId = result.createdEntityIds[0]
  return {
    draft: pointId
      ? appendInferredPointRelations(result.sketch, pointId, input.relations)
      : result.sketch,
    pending: null,
  }
}

function appendInferredPointRelations(
  sketch: SketchRecord,
  pointId: SketchEntityId,
  relations: readonly SketchPointRelationInference[],
) {
  return relations.reduce(
    (current, relation) => appendInferredPointRelation(current, pointId, relation),
    sketch,
  )
}

function appendInferredPointRelation(
  sketch: SketchRecord,
  pointId: SketchEntityId,
  relation: SketchPointRelationInference,
) {
  if (relation.type === "coincident") {
    return appendInferredCoincidence(sketch, pointId, relation.pointId)
  }
  if (relation.type === "horizontal-points" || relation.type === "vertical-points") {
    return appendInferredPointAlignment(sketch, pointId, relation)
  }
  if (relation.type === "point-on-curve") {
    return appendInferredPointOnCurve(sketch, pointId, relation.curveId)
  }
  if (relation.type === "point-on-ellipse") {
    return appendInferredPointOnEllipse(sketch, pointId, relation.ellipseId)
  }
  if (relation.type === "point-on-elliptical-arc") {
    return appendInferredPointOnEllipticalArc(sketch, pointId, relation.ellipticalArcId)
  }
  if (relation.type === "ellipse-quadrant") {
    return appendInferredEllipseQuadrant(sketch, pointId, relation)
  }
  if (relation.type === "arc-midpoint") {
    return appendInferredArcMidpoint(sketch, pointId, relation.arcId)
  }
  return appendInferredLineRelation(sketch, pointId, relation)
}

function appendInferredPointAlignment(
  sketch: SketchRecord,
  pointId: SketchEntityId,
  relation: Extract<
    SketchPointRelationInference,
    { type: "horizontal-points" | "vertical-points" }
  >,
) {
  const exists = sketch.constraints.some(
    (constraint) =>
      constraint.type === relation.type &&
      ((constraint.firstPointId === pointId && constraint.secondPointId === relation.pointId) ||
        (constraint.firstPointId === relation.pointId && constraint.secondPointId === pointId)),
  )
  return exists
    ? sketch
    : appendSketchConstraint(
        sketch,
        { type: relation.type, firstPointId: pointId, secondPointId: relation.pointId },
        createBrowserSketchConstraintId,
      )
}

function appendInferredPointOnCurve(
  sketch: SketchRecord,
  pointId: SketchEntityId,
  curveId: SketchEntityId,
) {
  const exists = sketch.constraints.some(
    (constraint) =>
      constraint.type === "point-on-curve" &&
      constraint.pointId === pointId &&
      constraint.curveId === curveId,
  )
  return exists
    ? sketch
    : appendSketchConstraint(
        sketch,
        { type: "point-on-curve", pointId, curveId },
        createBrowserSketchConstraintId,
      )
}

function appendInferredPointOnEllipse(
  sketch: SketchRecord,
  pointId: SketchEntityId,
  ellipseId: SketchEntityId,
) {
  const exists = sketch.constraints.some(
    (constraint) =>
      constraint.type === "point-on-ellipse" &&
      constraint.pointId === pointId &&
      constraint.ellipseId === ellipseId,
  )
  return exists
    ? sketch
    : appendSketchConstraint(
        sketch,
        { type: "point-on-ellipse", pointId, ellipseId },
        createBrowserSketchConstraintId,
      )
}

function appendInferredPointOnEllipticalArc(
  sketch: SketchRecord,
  pointId: SketchEntityId,
  ellipticalArcId: SketchEntityId,
) {
  const exists = sketch.constraints.some(
    (constraint) =>
      constraint.type === "point-on-elliptical-arc" &&
      constraint.pointId === pointId &&
      constraint.ellipticalArcId === ellipticalArcId,
  )
  return exists
    ? sketch
    : appendSketchConstraint(
        sketch,
        { type: "point-on-elliptical-arc", pointId, ellipticalArcId },
        createBrowserSketchConstraintId,
      )
}

function appendInferredArcMidpoint(
  sketch: SketchRecord,
  pointId: SketchEntityId,
  arcId: SketchEntityId,
) {
  const exists = sketch.constraints.some(
    (constraint) =>
      constraint.type === "arc-midpoint" &&
      constraint.pointId === pointId &&
      constraint.arcId === arcId,
  )
  return exists
    ? sketch
    : appendSketchConstraint(
        sketch,
        { type: "arc-midpoint", pointId, arcId },
        createBrowserSketchConstraintId,
      )
}

function appendInferredEllipseQuadrant(
  sketch: SketchRecord,
  pointId: SketchEntityId,
  relation: Extract<SketchPointRelationInference, { type: "ellipse-quadrant" }>,
) {
  const exists = sketch.constraints.some(
    (constraint) =>
      constraint.type === "ellipse-quadrant" &&
      constraint.pointId === pointId &&
      constraint.ellipseId === relation.ellipseId &&
      constraint.axis === relation.axis &&
      constraint.side === relation.side,
  )
  return exists
    ? sketch
    : appendSketchConstraint(
        sketch,
        {
          type: "ellipse-quadrant",
          pointId,
          ellipseId: relation.ellipseId,
          axis: relation.axis,
          side: relation.side,
        },
        createBrowserSketchConstraintId,
      )
}

function appendInferredLineRelation(
  sketch: SketchRecord,
  pointId: SketchEntityId,
  relation: Extract<SketchPointRelationInference, { lineId: SketchEntityId }>,
) {
  const exists = sketch.constraints.some(
    (constraint) =>
      constraint.type === relation.type &&
      constraint.pointId === pointId &&
      constraint.lineId === relation.lineId,
  )
  return exists
    ? sketch
    : appendSketchConstraint(
        sketch,
        { type: relation.type, pointId, lineId: relation.lineId },
        createBrowserSketchConstraintId,
      )
}

function appendInferredCoincidence(
  sketch: SketchRecord,
  firstPointId: SketchEntityId,
  secondPointId: SketchEntityId,
) {
  if (firstPointId === secondPointId) return sketch
  const exists = sketch.constraints.some(
    (constraint) =>
      constraint.type === "coincident" &&
      ((constraint.firstPointId === firstPointId && constraint.secondPointId === secondPointId) ||
        (constraint.firstPointId === secondPointId && constraint.secondPointId === firstPointId)),
  )
  return exists
    ? sketch
    : appendSketchConstraint(
        sketch,
        { type: "coincident", firstPointId, secondPointId },
        createBrowserSketchConstraintId,
      )
}

function applyDraggedPointInference(
  sketch: SketchRecord,
  pointId: SketchEntityId,
  inference: SketchPointInference | null,
) {
  if (!inference) return sketch
  if (inference.target.kind === "existing") {
    return appendInferredCoincidence(sketch, pointId, inference.target.pointId)
  }
  return appendInferredPointRelations(sketch, pointId, inference.relations)
}

function appendInferredDirection(
  sketch: SketchRecord,
  lineId: SketchEntityId,
  direction: SketchDirectionInference | null,
) {
  if (!direction) return sketch
  switch (direction.type) {
    case "horizontal":
    case "vertical":
      return appendSketchConstraint(
        sketch,
        { type: direction.type, lineId },
        createBrowserSketchConstraintId,
      )
    case "parallel":
    case "perpendicular":
      return appendSketchConstraint(
        sketch,
        { type: direction.type, firstEntityId: direction.lineId, secondEntityId: lineId },
        createBrowserSketchConstraintId,
      )
    case "tangent":
      return appendSketchConstraint(
        sketch,
        { type: "tangent", arcId: direction.arcId, lineId },
        createBrowserSketchConstraintId,
      )
  }
}

function placeLine(input: PlacementInput): PlacementUpdate {
  if (input.pending?.kind !== "line") {
    return {
      draft: null,
      pending: { kind: "line", start: input.target, startRelations: input.relations },
    }
  }
  const result = appendSketchLine(input.draft, {
    construction: input.construction,
    createEntityId: createBrowserSketchEntityId,
    start: input.pending.start,
    end: input.target,
  })
  const line = result.sketch.entities.at(-1)
  if (line?.type !== "line") return { draft: result.sketch, pending: null }
  const withStartRelations = appendInferredPointRelations(
    result.sketch,
    line.startPointId,
    input.pending.startRelations,
  )
  const withEndRelations = appendInferredPointRelations(
    withStartRelations,
    line.endPointId,
    input.relations,
  )
  const nextSketch = appendInferredDirection(withEndRelations, line.id, input.direction)
  return {
    draft: nextSketch,
    creationPrecision: {
      activeStep: 0,
      steps: [
        {
          anchor: input.point,
          entityIds: [line.id],
          initialKind: "distance",
        },
      ],
    },
    pending: {
      kind: "line",
      start: { kind: "existing", pointId: line.endPointId },
      startRelations: [],
    },
  }
}

function placeMidpointLine(input: PlacementInput): PlacementUpdate {
  if (input.pending?.kind !== "midpoint-line") {
    return { draft: null, pending: { kind: "midpoint-line", midpoint: input.target } }
  }
  const midpoint = pointForTarget(input.draft, input.pending.midpoint)
  const endpoint = pointForTarget(input.draft, input.target)
  const opposite = { x: midpoint.x * 2 - endpoint.x, y: midpoint.y * 2 - endpoint.y }
  const result = appendSketchMidpointLine(input.draft, {
    construction: input.construction,
    createConstraintId: createBrowserSketchConstraintId,
    createEntityId: createBrowserSketchEntityId,
    endpoint: input.target,
    midpoint: input.pending.midpoint,
  })
  const creationPrecision = lineCreationPrecision(result, [
    { anchor: input.point, end: endpoint, start: opposite },
  ])
  return {
    ...(creationPrecision ? { creationPrecision } : {}),
    draft: result.sketch,
    pending: null,
  }
}

function InferenceGlyph({
  bounds,
  inference,
}: {
  bounds: SketchBounds
  inference: SketchPointInference | null
}) {
  if (!inference || (inference.kind === "none" && inference.direction === null)) return null
  const size = Math.max(bounds.width / 90, bounds.height / 68)
  const directionGlyph = inference.direction ? directionInferenceGlyph(inference.direction) : null
  return (
    <g
      className="pointer-events-none fill-background stroke-ring text-ring"
      data-sketch-direction-inference={inference.direction?.type}
      data-sketch-inference={inference.kind !== "none" ? inference.kind : inference.direction?.type}
      transform={`translate(${inference.point.x} ${-inference.point.y})`}
    >
      {inference.alignmentGuide ? (
        <line
          x1={inference.alignmentGuide.x - inference.point.x}
          y1={-(inference.alignmentGuide.y - inference.point.y)}
          x2={0}
          y2={0}
          className="stroke-ring/70"
          data-sketch-inference-guide={inference.kind}
          strokeDasharray={`${size * 0.45} ${size * 0.35}`}
          strokeWidth={1}
          vectorEffect="non-scaling-stroke"
        />
      ) : null}
      <PointInferenceMark kind={inference.kind} size={size} />
      <DirectionInferenceMark glyph={directionGlyph} size={size} />
    </g>
  )
}

function inferenceSourceEntityIds(inference: SketchPointInference | null) {
  const ids = new Set<SketchEntityId>()
  if (!inference) return ids
  for (const relation of inference.relations) ids.add(pointRelationEntityId(relation).id)
  if (inference.target.kind === "existing") ids.add(inference.target.pointId)
  switch (inference.direction?.type) {
    case "parallel":
    case "perpendicular":
      ids.add(inference.direction.lineId)
      break
    case "tangent":
      ids.add(inference.direction.arcId)
      break
  }
  return ids
}

function SketchInferenceSourceHighlight({
  entityIds,
  markerScale,
  presentation,
}: {
  entityIds: ReadonlySet<SketchEntityId>
  markerScale: number
  presentation: SketchGeometryPresentation
}) {
  if (entityIds.size === 0) return null
  const curves: SketchCurveEntity[] = []
  const points: DisplayPoint[] = []
  for (const entityId of entityIds) {
    const curve = presentation.curvesById.get(entityId)
    const point = presentation.localPointsById.get(entityId)
    if (curve) curves.push(curve)
    if (point) points.push(point)
  }
  if (curves.length === 0 && points.length === 0) return null
  return (
    <g className="pointer-events-none" data-sketch-inference-source-layer transform="scale(1 -1)">
      {curves.map((entity) => (
        <g key={entity.id} data-sketch-inference-source={entity.id}>
          <SketchCurve
            entity={entity}
            hidden={false}
            interactive={false}
            points={presentation.pointsById}
            preselected
            selected={false}
            solvedRadius={presentation.solvedCircles.get(entity.id)}
            onPointerDown={ignoreCurveAction}
          />
        </g>
      ))}
      {points.map((point) => (
        <SketchPointMarker
          key={point.id}
          center={presentation.centerPointIds.has(point.id)}
          dragging={false}
          inferenceSource
          markerScale={markerScale}
          point={point}
          selected={false}
        />
      ))}
    </g>
  )
}

function entitiesForIds<Value>(
  entityIds: ReadonlySet<string>,
  values: readonly Value[],
  id: (value: Value) => string,
) {
  const byId = new Map(values.map((value) => [id(value), value]))
  return [...entityIds].flatMap((entityId) => {
    const value = byId.get(entityId)
    return value ? [value] : []
  })
}

function ConstraintRelatedCurveHighlight({
  entity,
  presentation,
}: {
  entity: SketchCurveEntity
  presentation: SketchGeometryPresentation
}) {
  return (
    <g data-sketch-constraint-related-entity={entity.id}>
      <SketchCurve
        entity={entity}
        hidden={false}
        interactive={false}
        points={presentation.pointsById}
        preselected
        selected={false}
        solvedRadius={presentation.solvedCircles.get(entity.id)}
        onPointerDown={ignoreCurveAction}
      />
    </g>
  )
}

function ConstraintRelatedPointHighlight({
  markerScale,
  point,
  presentation,
}: {
  markerScale: number
  point: DisplayPoint
  presentation: SketchGeometryPresentation
}) {
  return (
    <g data-sketch-constraint-related-entity={point.id}>
      <SketchPointMarker
        center={presentation.centerPointIds.has(point.id)}
        dragging={false}
        inferenceSource
        markerScale={markerScale}
        point={point}
        selected={false}
      />
    </g>
  )
}

function ConstraintRelatedExternalLineHighlight({ line }: { line: DisplayExternalLine }) {
  return (
    <line
      data-sketch-constraint-related-entity={line.id}
      x1={line.start.x}
      y1={line.start.y}
      x2={line.end.x}
      y2={line.end.y}
      className="stroke-preselection"
      strokeDasharray="5 3"
      strokeWidth={3}
      vectorEffect="non-scaling-stroke"
    />
  )
}

function ConstraintRelatedExternalPointHighlight({
  markerScale,
  point,
}: {
  markerScale: number
  point: DisplayPoint
}) {
  const markerExtent = 4 * markerScale
  return (
    <g data-sketch-constraint-related-entity={point.id}>
      <line
        x1={point.x - markerExtent}
        x2={point.x + markerExtent}
        y1={point.y}
        y2={point.y}
        className="stroke-preselection"
        strokeWidth={2}
        vectorEffect="non-scaling-stroke"
      />
      <line
        x1={point.x}
        x2={point.x}
        y1={point.y - markerExtent}
        y2={point.y + markerExtent}
        className="stroke-preselection"
        strokeWidth={2}
        vectorEffect="non-scaling-stroke"
      />
    </g>
  )
}

function SketchConstraintRelatedEntityHighlight({
  entityIds,
  markerScale,
  presentation,
}: {
  entityIds: ReadonlySet<string>
  markerScale: number
  presentation: SketchGeometryPresentation
}) {
  if (entityIds.size === 0) return null
  const curves = entitiesForIds(
    entityIds,
    [...presentation.curves, ...presentation.externalCurves],
    ({ id }) => id,
  )
  const localPoints = entitiesForIds(entityIds, presentation.points, ({ id }) => id)
  const externalLines = entitiesForIds(entityIds, presentation.externalLines, ({ id }) => id)
  const externalPoints = entitiesForIds(entityIds, presentation.externalPoints, ({ id }) => id)
  return (
    <g
      className="pointer-events-none"
      data-sketch-constraint-related-entity-layer
      transform="scale(1 -1)"
    >
      {curves.map((entity) => (
        <ConstraintRelatedCurveHighlight
          key={entity.id}
          entity={entity}
          presentation={presentation}
        />
      ))}
      {localPoints.map((point) => (
        <ConstraintRelatedPointHighlight
          key={point.id}
          markerScale={markerScale}
          point={point}
          presentation={presentation}
        />
      ))}
      {externalLines.map((line) => (
        <ConstraintRelatedExternalLineHighlight key={line.id} line={line} />
      ))}
      {externalPoints.map((point) => (
        <ConstraintRelatedExternalPointHighlight
          key={point.id}
          markerScale={markerScale}
          point={point}
        />
      ))}
    </g>
  )
}

function PointInferenceMark({ kind, size }: { kind: SketchPointInference["kind"]; size: number }) {
  if (kind === "none") return null
  if (kind === "coincident") {
    return (
      <rect
        x={-size / 2}
        y={-size / 2}
        width={size}
        height={size}
        strokeWidth={1.5}
        vectorEffect="non-scaling-stroke"
      />
    )
  }
  return (
    <text
      x={-size * 0.35}
      y={size * 0.35}
      className="fill-ring stroke-none font-mono font-semibold"
      fontSize={size}
    >
      {pointInferenceGlyph(kind)}
    </text>
  )
}

function DirectionInferenceMark({ glyph, size }: { glyph: string | null; size: number }) {
  return glyph ? (
    <text
      x={size * 0.85}
      y={-size * 0.7}
      className="fill-ring stroke-none font-mono font-semibold"
      fontSize={size}
    >
      {glyph}
    </text>
  ) : null
}

function pointInferenceGlyph(kind: SketchPointInference["kind"]) {
  switch (kind) {
    case "horizontal-alignment":
      return "H"
    case "intersection":
      return "×"
    case "midpoint":
      return "M"
    case "point-on-curve":
    case "point-on-line":
      return "⊙"
    case "quadrant":
      return "◇"
    case "vertical-alignment":
      return "V"
    default:
      return ""
  }
}

function directionInferenceGlyph(direction: SketchDirectionInference) {
  switch (direction.type) {
    case "horizontal":
      return "H"
    case "vertical":
      return "V"
    case "parallel":
      return "∥"
    case "perpendicular":
      return "⊥"
    case "tangent":
      return "T"
  }
}

function createdRectanglePoint(
  result: ReturnType<typeof appendSketchRectangle>,
  point: SketchPoint2,
) {
  const createdIds = new Set<string>(result.createdEntityIds)
  return result.sketch.entities.find(
    (entity): entity is Extract<SketchEntity, { type: "point" }> =>
      entity.type === "point" &&
      createdIds.has(entity.id) &&
      entity.x === point.x &&
      entity.y === point.y,
  )
}

function rectangleCreationPrecision(
  result: ReturnType<typeof appendSketchRectangle>,
  firstCorner: SketchPoint2,
  oppositeCorner: SketchPoint2,
): SketchCreationPrecisionRequest | undefined {
  const first = createdRectanglePoint(result, firstCorner)
  const widthEnd = createdRectanglePoint(result, {
    x: oppositeCorner.x,
    y: firstCorner.y,
  })
  const opposite = createdRectanglePoint(result, oppositeCorner)
  if (!first || !widthEnd || !opposite) return undefined
  return {
    activeStep: 0,
    steps: [
      {
        anchor: { x: (firstCorner.x + oppositeCorner.x) / 2, y: firstCorner.y },
        entityIds: [first.id, widthEnd.id],
        initialKind: "horizontal-distance",
      },
      {
        anchor: { x: oppositeCorner.x, y: (firstCorner.y + oppositeCorner.y) / 2 },
        entityIds: [widthEnd.id, opposite.id],
        initialKind: "vertical-distance",
      },
    ],
  }
}

function curveCreationPrecision(
  result: Readonly<{ createdEntityIds: readonly SketchEntityId[]; sketch: SketchRecord }>,
  curveType: Exclude<SketchCurveEntity["type"], "line">,
  steps: readonly Readonly<{
    anchor: SketchPoint2
    initialKind: SketchDimensionKind
  }>[],
): SketchCreationPrecisionRequest | undefined {
  const createdIds = new Set<string>(result.createdEntityIds)
  const curve = result.sketch.entities.find(
    (entity) => createdIds.has(entity.id) && entity.type === curveType,
  )
  return curve
    ? {
        activeStep: 0,
        steps: steps.map((step) => ({ ...step, entityIds: [curve.id] })),
      }
    : undefined
}

type SketchPlacementResult = Readonly<{
  createdEntityIds: readonly SketchEntityId[]
  sketch: SketchRecord
}>

const authoredGeometryMatchTolerance = 1e-9

function authoredPointsMatch(first: SketchPoint2, second: SketchPoint2) {
  const scale = Math.max(
    1,
    Math.abs(first.x),
    Math.abs(first.y),
    Math.abs(second.x),
    Math.abs(second.y),
  )
  return (
    Math.abs(first.x - second.x) <= authoredGeometryMatchTolerance * scale &&
    Math.abs(first.y - second.y) <= authoredGeometryMatchTolerance * scale
  )
}

function sketchPointEntity(sketch: SketchRecord, pointId: SketchEntityId) {
  const point = sketch.entities.find(({ id }) => id === pointId)
  return point?.type === "point" ? point : null
}

function createdEntityOfType<Type extends SketchEntity["type"]>(
  result: SketchPlacementResult,
  type: Type,
) {
  const createdIds = new Set<string>(result.createdEntityIds)
  return result.sketch.entities.find(
    (entity): entity is Extract<SketchEntity, { type: Type }> =>
      createdIds.has(entity.id) && entity.type === type,
  )
}

function createdLineBetween(
  result: SketchPlacementResult,
  first: SketchPoint2,
  second: SketchPoint2,
) {
  const createdIds = new Set<string>(result.createdEntityIds)
  return result.sketch.entities.find((entity) => {
    if (entity.type !== "line" || !createdIds.has(entity.id)) return false
    const start = sketchPointEntity(result.sketch, entity.startPointId)
    const end = sketchPointEntity(result.sketch, entity.endPointId)
    if (!start || !end) return false
    return (
      (authoredPointsMatch(start, first) && authoredPointsMatch(end, second)) ||
      (authoredPointsMatch(start, second) && authoredPointsMatch(end, first))
    )
  })
}

function lineCreationPrecision(
  result: SketchPlacementResult,
  segments: readonly Readonly<{
    anchor: SketchPoint2
    end: SketchPoint2
    start: SketchPoint2
  }>[],
): SketchCreationPrecisionRequest | undefined {
  const steps = segments.flatMap(({ anchor, end, start }) => {
    const line = createdLineBetween(result, start, end)
    return line ? [{ anchor, entityIds: [line.id], initialKind: "distance" as const }] : []
  })
  if (steps.length !== segments.length) return undefined
  return {
    activeStep: 0,
    steps,
  }
}

function pointPairMidpoint(first: SketchPoint2, second: SketchPoint2) {
  return { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 }
}

function adjacentLineCreationPrecision(
  result: SketchPlacementResult,
  first: SketchPoint2,
  second: SketchPoint2,
  third: SketchPoint2,
) {
  return lineCreationPrecision(result, [
    { anchor: pointPairMidpoint(first, second), end: second, start: first },
    { anchor: pointPairMidpoint(second, third), end: third, start: second },
  ])
}

function lineMidpoint(sketch: SketchRecord, lineId: SketchEntityId) {
  const line = sketch.entities.find(({ id }) => id === lineId)
  if (line?.type !== "line") return null
  const start = sketchPointEntity(sketch, line.startPointId)
  const end = sketchPointEntity(sketch, line.endPointId)
  return start && end ? pointPairMidpoint(start, end) : null
}

function slotCreationPrecision(
  result: SketchPlacementResult,
  centerLineId: SketchEntityId,
  widthAnchor: SketchPoint2,
  includeLength = true,
  retainForTool?: SketchEditorTool,
): SketchCreationPrecisionRequest | undefined {
  const endCap = createdEntityOfType(result, "arc")
  if (!endCap) return undefined
  const lengthAnchor = includeLength ? lineMidpoint(result.sketch, centerLineId) : null
  if (includeLength && !lengthAnchor) return undefined
  const lengthSteps = lengthAnchor
    ? [{ anchor: lengthAnchor, entityIds: [centerLineId], initialKind: "distance" as const }]
    : []
  return {
    activeStep: 0,
    ...(retainForTool ? { retainForTool } : {}),
    steps: [
      ...lengthSteps,
      { anchor: widthAnchor, entityIds: [endCap.id], initialKind: "diameter" },
    ],
  }
}

function placeRectangle(input: PlacementInput): PlacementUpdate {
  if (input.pending?.kind !== "rectangle") {
    return { draft: null, pending: { kind: "rectangle", firstCorner: input.point } }
  }
  const result = appendSketchRectangle(input.draft, {
    construction: input.construction,
    createConstraintId: createBrowserSketchConstraintId,
    createEntityId: createBrowserSketchEntityId,
    firstCorner: input.pending.firstCorner,
    oppositeCorner: input.point,
  })
  const creationPrecision = rectangleCreationPrecision(
    result,
    input.pending.firstCorner,
    input.point,
  )
  return {
    ...(creationPrecision ? { creationPrecision } : {}),
    draft: result.sketch,
    pending: null,
  }
}

function placeCenterRectangle(input: PlacementInput): PlacementUpdate {
  if (input.pending?.kind !== "center-rectangle") {
    return { draft: null, pending: { kind: "center-rectangle", center: input.target } }
  }
  const center = pointForTarget(input.draft, input.pending.center)
  const reflectedCorner = {
    x: center.x * 2 - input.point.x,
    y: center.y * 2 - input.point.y,
  }
  const result = appendSketchCenterRectangle(input.draft, {
    center: input.pending.center,
    construction: input.construction,
    corner: input.point,
    createConstraintId: createBrowserSketchConstraintId,
    createEntityId: createBrowserSketchEntityId,
  })
  const creationPrecision = rectangleCreationPrecision(result, reflectedCorner, input.point)
  return {
    ...(creationPrecision ? { creationPrecision } : {}),
    draft: result.sketch,
    pending: null,
  }
}

function placeAlignedRectangle(input: PlacementInput): PlacementUpdate {
  if (
    input.pending?.kind !== "aligned-rectangle-end" &&
    input.pending?.kind !== "aligned-rectangle-width"
  ) {
    return { draft: null, pending: { kind: "aligned-rectangle-end", start: input.target } }
  }
  if (input.pending.kind === "aligned-rectangle-end") {
    return {
      draft: null,
      pending: {
        kind: "aligned-rectangle-width",
        start: input.pending.start,
        end: input.target,
      },
    }
  }
  const first = pointForTarget(input.draft, input.pending.start)
  const second = pointForTarget(input.draft, input.pending.end)
  const geometry = alignedRectangleGeometry(first, second, input.point)
  const result = appendSketchAlignedRectangle(input.draft, {
    construction: input.construction,
    createConstraintId: createBrowserSketchConstraintId,
    createEntityId: createBrowserSketchEntityId,
    firstSideStart: input.pending.start,
    firstSideEnd: input.pending.end,
    widthPoint: input.point,
  })
  const creationPrecision = geometry
    ? adjacentLineCreationPrecision(result, first, second, geometry.third)
    : undefined
  return {
    ...(creationPrecision ? { creationPrecision } : {}),
    draft: result.sketch,
    pending: null,
  }
}

function placeCenteredAlignedRectangle(input: PlacementInput): PlacementUpdate {
  if (
    input.pending?.kind !== "centered-aligned-rectangle-side" &&
    input.pending?.kind !== "centered-aligned-rectangle-width"
  ) {
    return {
      draft: null,
      pending: { center: input.target, kind: "centered-aligned-rectangle-side" },
    }
  }
  if (input.pending.kind === "centered-aligned-rectangle-side") {
    return {
      draft: null,
      pending: {
        center: input.pending.center,
        kind: "centered-aligned-rectangle-width",
        side: input.target,
      },
    }
  }
  const center = pointForTarget(input.draft, input.pending.center)
  const side = pointForTarget(input.draft, input.pending.side)
  const geometry = centeredAlignedRectangleGeometry(center, side, input.point)
  const result = appendSketchCenteredAlignedRectangle(input.draft, {
    center: input.pending.center,
    construction: input.construction,
    createConstraintId: createBrowserSketchConstraintId,
    createEntityId: createBrowserSketchEntityId,
    sidePoint: input.pending.side,
    widthPoint: input.point,
  })
  const creationPrecision = geometry
    ? adjacentLineCreationPrecision(
        result,
        geometry.corners[0],
        geometry.corners[1],
        geometry.corners[2],
      )
    : undefined
  return {
    ...(creationPrecision ? { creationPrecision } : {}),
    draft: result.sketch,
    pending: null,
  }
}

function placeStraightSlot(input: PlacementInput): PlacementUpdate {
  if (input.pending?.kind !== "slot-end" && input.pending?.kind !== "slot-width") {
    return { draft: null, pending: { kind: "slot-end", start: input.target } }
  }
  if (input.pending.kind === "slot-end") {
    return {
      draft: null,
      pending: { end: input.target, kind: "slot-width", start: input.pending.start },
    }
  }
  const start = pointForTarget(input.draft, input.pending.start)
  const end = pointForTarget(input.draft, input.pending.end)
  const result = appendSketchStraightSlot(input.draft, {
    construction: input.construction,
    createConstraintId: createBrowserSketchConstraintId,
    createEntityId: createBrowserSketchEntityId,
    endCenter: input.pending.end,
    startCenter: input.pending.start,
    widthPoint: input.point,
  })
  const centerLine = createdLineBetween(result, start, end)
  const creationPrecision = centerLine
    ? slotCreationPrecision(result, centerLine.id, input.point)
    : undefined
  return {
    ...(creationPrecision ? { creationPrecision } : {}),
    draft: result.sketch,
    pending: null,
  }
}

function placeCenteredSlot(input: PlacementInput): PlacementUpdate {
  if (
    input.pending?.kind !== "centered-slot-end" &&
    input.pending?.kind !== "centered-slot-width"
  ) {
    return { draft: null, pending: { center: input.target, kind: "centered-slot-end" } }
  }
  if (input.pending.kind === "centered-slot-end") {
    return {
      draft: null,
      pending: {
        center: input.pending.center,
        end: input.target,
        kind: "centered-slot-width",
      },
    }
  }
  const center = pointForTarget(input.draft, input.pending.center)
  const end = pointForTarget(input.draft, input.pending.end)
  const opposite = { x: center.x * 2 - end.x, y: center.y * 2 - end.y }
  const result = appendSketchCenteredSlot(input.draft, {
    center: input.pending.center,
    construction: input.construction,
    createConstraintId: createBrowserSketchConstraintId,
    createEntityId: createBrowserSketchEntityId,
    endCenter: input.pending.end,
    widthPoint: input.point,
  })
  const centerLine = createdLineBetween(result, opposite, end)
  const creationPrecision = centerLine
    ? slotCreationPrecision(result, centerLine.id, input.point)
    : undefined
  return {
    ...(creationPrecision ? { creationPrecision } : {}),
    draft: result.sketch,
    pending: null,
  }
}

function placeSlotFromSelection(input: PlacementInput): PlacementUpdate {
  if (input.pending?.kind !== "slot-from-selection-width") {
    return { draft: null, nextTool: "select", pending: null }
  }
  const result = appendSketchSlotAroundLine(input.draft, {
    construction: input.construction,
    createConstraintId: createBrowserSketchConstraintId,
    createEntityId: createBrowserSketchEntityId,
    lineId: input.pending.lineId,
    widthPoint: input.point,
  })
  const creationPrecision = slotCreationPrecision(
    result,
    input.pending.lineId,
    input.point,
    false,
    "select",
  )
  return {
    ...(creationPrecision ? { creationPrecision } : {}),
    draft: result.sketch,
    nextTool: "select",
    pending: null,
  }
}

function placeCircle(input: PlacementInput): PlacementUpdate {
  if (input.pending?.kind !== "circle") {
    return { draft: null, pending: { kind: "circle", center: input.target } }
  }
  const result = appendSketchCircle(input.draft, {
    center: input.pending.center,
    construction: input.construction,
    createEntityId: createBrowserSketchEntityId,
    perimeterPoint: input.point,
  })
  const creationPrecision = curveCreationPrecision(result, "circle", [
    { anchor: input.point, initialKind: "diameter" },
  ])
  return {
    ...(creationPrecision ? { creationPrecision } : {}),
    draft: result.sketch,
    pending: null,
  }
}

function placeEllipse(input: PlacementInput): PlacementUpdate {
  if (input.pending?.kind !== "ellipse-primary" && input.pending?.kind !== "ellipse-secondary") {
    return { draft: null, pending: { center: input.target, kind: "ellipse-primary" } }
  }
  if (input.pending.kind === "ellipse-primary") {
    return {
      draft: null,
      pending: {
        center: input.pending.center,
        kind: "ellipse-secondary",
        primaryAxisPoint: input.target,
      },
    }
  }
  const result = appendSketchEllipse(input.draft, {
    center: input.pending.center,
    construction: input.construction,
    createEntityId: createBrowserSketchEntityId,
    primaryAxisPoint: input.pending.primaryAxisPoint,
    secondaryRadiusPoint: input.point,
  })
  const primaryAxisPoint = pointForTarget(result.sketch, input.pending.primaryAxisPoint)
  const creationPrecision = curveCreationPrecision(result, "ellipse", [
    { anchor: primaryAxisPoint, initialKind: "primary-axis-diameter" },
    { anchor: input.point, initialKind: "secondary-axis-diameter" },
  ])
  return {
    ...(creationPrecision ? { creationPrecision } : {}),
    draft: result.sketch,
    pending: null,
  }
}

function placeEllipticalArcPrimary(
  input: PlacementInput,
  pending: Extract<PendingEllipticalArc, { kind: "elliptical-arc-primary" }>,
): PlacementUpdate {
  return {
    draft: null,
    pending: {
      center: pending.center,
      kind: "elliptical-arc-start",
      primaryAxisPoint: input.target,
    },
  }
}

function placeEllipticalArcStart(
  input: PlacementInput,
  pending: Extract<PendingEllipticalArc, { kind: "elliptical-arc-start" }>,
): PlacementUpdate {
  const geometry = sketchEllipticalArcStartGeometry(
    pointForTarget(input.draft, pending.center),
    pointForTarget(input.draft, pending.primaryAxisPoint),
    input.point,
  )
  return geometry
    ? {
        draft: null,
        pending: {
          center: pending.center,
          kind: "elliptical-arc-end",
          primaryAxisPoint: pending.primaryAxisPoint,
          secondaryAxisPoint: geometry.secondaryAxisPoint,
          startPoint: { kind: "new", point: geometry.startPoint },
        },
      }
    : { draft: null, pending }
}

function placeEllipticalArcEnd(
  input: PlacementInput,
  pending: Extract<PendingEllipticalArc, { kind: "elliptical-arc-end" }>,
): PlacementUpdate {
  const result = appendSketchEllipticalArc(input.draft, {
    center: pending.center,
    construction: input.construction,
    createEntityId: createBrowserSketchEntityId,
    endPoint: { kind: "new", point: input.point },
    primaryAxisPoint: pending.primaryAxisPoint,
    secondaryAxisPoint: pending.secondaryAxisPoint,
    startPoint: pending.startPoint,
  })
  const creationPrecision = curveCreationPrecision(result, "elliptical-arc", [
    {
      anchor: pointForTarget(result.sketch, pending.primaryAxisPoint),
      initialKind: "primary-axis-diameter",
    },
    { anchor: pending.secondaryAxisPoint, initialKind: "secondary-axis-diameter" },
  ])
  return {
    ...(creationPrecision ? { creationPrecision } : {}),
    draft: result.sketch,
    pending: null,
  }
}

function placeEllipticalArc(input: PlacementInput): PlacementUpdate {
  const pending = input.pending
  if (!isPendingEllipticalArc(pending)) {
    return { draft: null, pending: { center: input.target, kind: "elliptical-arc-primary" } }
  }
  if (pending.kind === "elliptical-arc-primary") {
    return placeEllipticalArcPrimary(input, pending)
  }
  return pending.kind === "elliptical-arc-start"
    ? placeEllipticalArcStart(input, pending)
    : placeEllipticalArcEnd(input, pending)
}

function placeRegularPolygonRadius(
  mode: RegularPolygonMode,
  input: PlacementInput,
  pending: Extract<PendingGeometry, { kind: "regular-polygon-radius" }>,
): PlacementUpdate {
  const center = pointForTarget(input.draft, pending.center)
  if (!regularPolygonGeometry(center, input.point, DEFAULT_REGULAR_POLYGON_SIDES, mode)) {
    return { draft: null, pending }
  }
  return {
    draft: null,
    pending: {
      center: pending.center,
      kind: "regular-polygon-sides",
      mode,
      radiusPoint: input.target,
      sideCountInput: null,
    },
  }
}

function completeRegularPolygon(
  mode: RegularPolygonMode,
  input: PlacementInput,
  pending: Extract<PendingGeometry, { kind: "regular-polygon-sides" }>,
): PlacementUpdate {
  const center = pointForTarget(input.draft, pending.center)
  const radiusPoint = pointForTarget(input.draft, pending.radiusPoint)
  const typedSideCount = parsedRegularPolygonSideCount(pending.sideCountInput)
  if (pending.sideCountInput !== null && typedSideCount === null) {
    return { draft: null, pending }
  }
  const sideCount =
    typedSideCount ?? regularPolygonPointerSideCount(center, radiusPoint, input.point)
  const result = appendSketchRegularPolygon(input.draft, {
    center: pending.center,
    construction: input.construction,
    createConstraintId: createBrowserSketchConstraintId,
    createEntityId: createBrowserSketchEntityId,
    mode,
    radiusPoint: pending.radiusPoint,
    sideCount,
  })
  const creationPrecision = curveCreationPrecision(result, "circle", [
    { anchor: radiusPoint, initialKind: "radius" },
  ])
  return {
    ...(creationPrecision ? { creationPrecision } : {}),
    draft: result.sketch,
    pending: null,
  }
}

function placeRegularPolygon(mode: RegularPolygonMode, input: PlacementInput): PlacementUpdate {
  const pending = input.pending
  if (pending?.kind === "regular-polygon-radius") {
    return placeRegularPolygonRadius(mode, input, pending)
  }
  if (pending?.kind === "regular-polygon-sides") {
    return completeRegularPolygon(mode, input, pending)
  }
  return {
    draft: null,
    pending: { center: input.target, kind: "regular-polygon-radius", mode },
  }
}

const placeCircumscribedPolygon = (input: PlacementInput) =>
  placeRegularPolygon("circumscribed", input)
const placeInscribedPolygon = (input: PlacementInput) => placeRegularPolygon("inscribed", input)

function placeThreePointCircle(input: PlacementInput): PlacementUpdate {
  if (
    input.pending?.kind !== "three-point-circle-second" &&
    input.pending?.kind !== "three-point-circle-third"
  ) {
    return { draft: null, pending: { kind: "three-point-circle-second", first: input.target } }
  }
  if (input.pending.kind === "three-point-circle-second") {
    return {
      draft: null,
      pending: {
        kind: "three-point-circle-third",
        first: input.pending.first,
        second: input.target,
      },
    }
  }
  const result = appendSketchThreePointCircle(input.draft, {
    construction: input.construction,
    createConstraintId: createBrowserSketchConstraintId,
    createEntityId: createBrowserSketchEntityId,
    firstPoint: input.pending.first,
    secondPoint: input.pending.second,
    thirdPoint: input.target,
  })
  const creationPrecision = curveCreationPrecision(result, "circle", [
    { anchor: input.point, initialKind: "diameter" },
  ])
  return {
    ...(creationPrecision ? { creationPrecision } : {}),
    draft: result.sketch,
    pending: null,
  }
}

function placeArc(input: PlacementInput): PlacementUpdate {
  if (input.pending?.kind !== "arc-start" && input.pending?.kind !== "arc-end") {
    return { draft: null, pending: { kind: "arc-start", center: input.point } }
  }
  if (input.pending.kind === "arc-start") {
    return {
      draft: null,
      pending: { kind: "arc-end", center: input.pending.center, start: input.point },
    }
  }
  const result = appendSketchArc(input.draft, {
    center: input.pending.center,
    construction: input.construction,
    createEntityId: createBrowserSketchEntityId,
    start: input.pending.start,
    end: input.point,
  })
  const creationPrecision = curveCreationPrecision(result, "arc", [
    { anchor: input.point, initialKind: "radius" },
  ])
  return {
    ...(creationPrecision ? { creationPrecision } : {}),
    draft: result.sketch,
    pending: null,
  }
}

function placeTangentArc(input: PlacementInput): PlacementUpdate {
  if (input.pending?.kind !== "tangent-arc") {
    const reference = tangentArcReference(input.draft, input.target)
    return {
      draft: null,
      pending: reference ? { kind: "tangent-arc", ...reference } : null,
    }
  }
  const result = appendSketchTangentArc(input.draft, {
    construction: input.construction,
    createConstraintId: createBrowserSketchConstraintId,
    createEntityId: createBrowserSketchEntityId,
    end: input.target,
    lineId: input.pending.lineId,
    startPointId: input.pending.startPointId,
  })
  const precision = curveCreationPrecision(result, "arc", [
    { anchor: input.point, initialKind: "radius" },
  ])
  const creationPrecision = precision ? { ...precision, retainForTool: "line" as const } : undefined
  return {
    ...(creationPrecision ? { creationPrecision } : {}),
    draft: result.sketch,
    nextTool: "line",
    pending: null,
  }
}

function placeThreePointArc(input: PlacementInput): PlacementUpdate {
  if (
    input.pending?.kind !== "three-point-arc-end" &&
    input.pending?.kind !== "three-point-arc-point"
  ) {
    return { draft: null, pending: { kind: "three-point-arc-end", start: input.target } }
  }
  if (input.pending.kind === "three-point-arc-end") {
    return {
      draft: null,
      pending: {
        kind: "three-point-arc-point",
        start: input.pending.start,
        end: input.target,
      },
    }
  }
  const result = appendSketchThreePointArc(input.draft, {
    construction: input.construction,
    createEntityId: createBrowserSketchEntityId,
    firstEndpoint: input.pending.start,
    secondEndpoint: input.pending.end,
    pointOnArc: input.point,
  })
  const creationPrecision = curveCreationPrecision(result, "arc", [
    { anchor: input.point, initialKind: "radius" },
  ])
  return {
    ...(creationPrecision ? { creationPrecision } : {}),
    draft: result.sketch,
    pending: null,
  }
}

const placementBuilders = {
  "aligned-rectangle": placeAlignedRectangle,
  arc: placeArc,
  "center-rectangle": placeCenterRectangle,
  "centered-aligned-rectangle": placeCenteredAlignedRectangle,
  "centered-slot": placeCenteredSlot,
  circle: placeCircle,
  ellipse: placeEllipse,
  "elliptical-arc": placeEllipticalArc,
  "circumscribed-polygon": placeCircumscribedPolygon,
  "inscribed-polygon": placeInscribedPolygon,
  line: placeLine,
  "midpoint-line": placeMidpointLine,
  point: placePoint,
  rectangle: placeRectangle,
  slot: placeStraightSlot,
  "slot-from-selection": placeSlotFromSelection,
  "tangent-arc": placeTangentArc,
  "three-point-arc": placeThreePointArc,
  "three-point-circle": placeThreePointCircle,
} satisfies Record<
  Exclude<
    SketchEditorTool,
    "dimension" | "intersection" | "pierce" | "select" | "use" | SketchModificationTool
  >,
  (input: PlacementInput) => PlacementUpdate
>

function placementUpdate(tool: SketchEditorTool, input: PlacementInput) {
  return isSketchSelectionTool(tool) ||
    tool === "use" ||
    tool === "intersection" ||
    tool === "pierce" ||
    isSketchModificationTool(tool)
    ? null
    : placementBuilders[tool](input)
}

function safePlacementUpdate(tool: SketchEditorTool, input: PlacementInput) {
  try {
    return { ok: true as const, update: placementUpdate(tool, input) }
  } catch {
    return { ok: false as const }
  }
}

type DirectSketchModificationTool = Exclude<
  SketchModificationTool,
  "circular-pattern" | "linear-pattern" | "mirror" | "offset" | "transform"
>
type SketchCurveActionKind =
  | "circular-pattern"
  | "direct"
  | "linear-pattern"
  | "mirror"
  | "offset"
  | "split-circle"
  | "split-ellipse"
  | "transform"

const indirectSketchCurveActions = new Map<SketchModificationTool, SketchCurveActionKind>([
  ["circular-pattern", "circular-pattern"],
  ["linear-pattern", "linear-pattern"],
  ["mirror", "mirror"],
  ["offset", "offset"],
  ["transform", "transform"],
])

function isDirectSketchModificationTool(
  tool: SketchEditorTool,
): tool is DirectSketchModificationTool {
  return isSketchModificationTool(tool) && !indirectSketchCurveActions.has(tool)
}

function sketchCurveActionKind(
  tool: SketchEditorTool,
  entity: SketchEntity | undefined,
): SketchCurveActionKind | null {
  if (!isSketchModificationTool(tool)) return null
  const indirectAction = indirectSketchCurveActions.get(tool)
  if (indirectAction) return indirectAction
  if (tool !== "split") return "direct"
  if (entity?.type === "circle") return "split-circle"
  return entity?.type === "ellipse" ? "split-ellipse" : "direct"
}

function sketchModificationUpdate(
  tool: DirectSketchModificationTool,
  draft: SketchRecord,
  entityId: SketchEntityId,
  point: SketchPoint2,
) {
  const input = {
    createConstraintId: createBrowserSketchConstraintId,
    createEntityId: createBrowserSketchEntityId,
    curveId: entityId,
    point,
  }
  switch (tool) {
    case "trim":
      return trimSketchCurve(draft, input).sketch
    case "extend":
      return extendSketchCurve(draft, input).sketch
    case "split":
      return splitSketchCurve(draft, input).sketch
  }
}

function safeCircleSplitUpdate(
  draft: SketchRecord,
  circleId: SketchEntityId,
  firstPoint: SketchPoint2,
  secondPoint: SketchPoint2,
) {
  try {
    return splitSketchCircle(draft, {
      circleId,
      createConstraintId: createBrowserSketchConstraintId,
      createEntityId: createBrowserSketchEntityId,
      firstPoint,
      secondPoint,
    }).sketch
  } catch {
    return null
  }
}

function safeEllipseSplitUpdate(
  draft: SketchRecord,
  ellipseId: SketchEntityId,
  firstPoint: SketchPoint2,
  secondPoint: SketchPoint2,
) {
  try {
    return splitSketchEllipse(draft, {
      createEntityId: createBrowserSketchEntityId,
      ellipseId,
      firstPoint,
      secondPoint,
    }).sketch
  } catch {
    return null
  }
}

function projectedCirclePoint(
  draft: SketchRecord,
  circle: Extract<SketchEntity, { type: "circle" }>,
  point: SketchPoint2,
) {
  const center = draft.entities.find(({ id }) => id === circle.centerPointId)
  if (center?.type !== "point") return null
  const offsetX = point.x - center.x
  const offsetY = point.y - center.y
  const offsetLength = Math.hypot(offsetX, offsetY)
  if (offsetLength <= Number.EPSILON) return null
  return {
    x: center.x + (offsetX / offsetLength) * circle.radius,
    y: center.y + (offsetY / offsetLength) * circle.radius,
  }
}

function projectedEllipsePoint(
  draft: SketchRecord,
  ellipse: Extract<SketchEntity, { type: "ellipse" }>,
  point: SketchPoint2,
) {
  const points = new Map(
    draft.entities.flatMap((entity) => (entity.type === "point" ? [[entity.id, entity]] : [])),
  )
  const geometry = ellipseGeometry(ellipse, points)
  return geometry ? projectPointToSketchEllipse(geometry, point).point : null
}

function safeSketchModificationUpdate(
  tool: DirectSketchModificationTool,
  draft: SketchRecord,
  entityId: SketchEntityId,
  point: SketchPoint2,
) {
  try {
    return sketchModificationUpdate(tool, draft, entityId, point)
  } catch {
    return null
  }
}

type SketchTrimGesture = Readonly<{
  draft: SketchRecord
  lastPoint: SketchPoint2
  pendingHits: readonly SketchCurvePathHit[]
  pointerId: number
  sourceDraft: SketchRecord
  trimmedEntityIds: ReadonlySet<SketchEntityId>
}>

const TRIM_GESTURE_BATCH_SIZE = 8

function applySketchTrimBatch(gesture: SketchTrimGesture): SketchTrimGesture {
  let draft = gesture.draft
  for (const hit of gesture.pendingHits.slice(0, TRIM_GESTURE_BATCH_SIZE)) {
    const trimmed = safeSketchModificationUpdate("trim", draft, hit.curveId, hit.point)
    if (trimmed) draft = trimmed
  }
  return {
    ...gesture,
    draft,
    pendingHits: gesture.pendingHits.slice(TRIM_GESTURE_BATCH_SIZE),
  }
}

function createSketchTrimGesture(
  draft: SketchRecord | null,
  editorTool: SketchEditorTool,
  pointerId: number,
  entityId: SketchEntityId,
  point: SketchPoint2,
): SketchTrimGesture | null {
  if (editorTool !== "trim" || !draft) return null
  const nextDraft = safeSketchModificationUpdate("trim", draft, entityId, point)
  return nextDraft
    ? {
        draft: nextDraft,
        lastPoint: point,
        pendingHits: [],
        pointerId,
        sourceDraft: draft,
        trimmedEntityIds: new Set([entityId]),
      }
    : null
}

function appendSketchTrimPath(
  gesture: SketchTrimGesture | null,
  pointerId: number,
  point: SketchPoint2,
): SketchTrimGesture | null {
  if (!gesture || gesture.pointerId !== pointerId) return null
  const trimmedEntityIds = new Set(gesture.trimmedEntityIds)
  const pendingHits = [...gesture.pendingHits]
  for (const hit of findSketchCurvesCrossedBySegment(gesture.draft, gesture.lastPoint, point)) {
    if (trimmedEntityIds.has(hit.curveId)) continue
    trimmedEntityIds.add(hit.curveId)
    pendingHits.push(hit)
  }
  return { ...gesture, lastPoint: point, pendingHits, trimmedEntityIds }
}

function useAnimationFrameDrain(drain: () => boolean) {
  const drainRef = useRef(drain)
  const frameRef = useRef<number | null>(null)

  useLayoutEffect(() => {
    drainRef.current = drain
  }, [drain])

  const cancel = useCallback(() => {
    if (frameRef.current === null) return
    window.cancelAnimationFrame(frameRef.current)
    frameRef.current = null
  }, [])
  const schedule = useCallback(() => {
    if (frameRef.current !== null) return
    const run = () => {
      frameRef.current = null
      if (drainRef.current()) frameRef.current = window.requestAnimationFrame(run)
    }
    frameRef.current = window.requestAnimationFrame(run)
  }, [])
  const runNow = useCallback(() => {
    if (frameRef.current === null && drainRef.current()) schedule()
  }, [schedule])
  return { cancel, runNow, schedule }
}

function useCoalescedTrimPointerUpdate(
  applyUpdate: (pointerId: number, point: SketchPoint2) => boolean,
) {
  const queuedRef = useRef<Readonly<{ pointerId: number; point: SketchPoint2 }> | null>(null)
  const frameRef = useRef<number | null>(null)
  const clear = useCallback(() => {
    queuedRef.current = null
    if (frameRef.current === null) return
    window.cancelAnimationFrame(frameRef.current)
    frameRef.current = null
  }, [])
  const flush = useCallback(
    (pointerId: number) => {
      const queued = queuedRef.current
      clear()
      if (queued?.pointerId === pointerId) applyUpdate(queued.pointerId, queued.point)
    },
    [applyUpdate, clear],
  )
  const update = useCallback(
    (pointerId: number, point: SketchPoint2) => {
      queuedRef.current = { pointerId, point }
      if (frameRef.current !== null) return
      frameRef.current = window.requestAnimationFrame(() => {
        frameRef.current = null
        const queued = queuedRef.current
        queuedRef.current = null
        if (queued) applyUpdate(queued.pointerId, queued.point)
      })
    },
    [applyUpdate],
  )
  return { clear, flush, update }
}

function useSketchTrimQueue({
  gestureRef,
  releasedPublishRef,
  resetPresentation,
  setPreviewDraft,
}: Readonly<{
  gestureRef: { current: SketchTrimGesture | null }
  releasedPublishRef: { current: ((draft: SketchRecord) => void) | null }
  resetPresentation: () => void
  setPreviewDraft: Dispatch<SetStateAction<SketchRecord | null>>
}>) {
  const completeReleasedGesture = useCallback(() => {
    const gesture = gestureRef.current
    const publish = releasedPublishRef.current
    if (!gesture || gesture.pendingHits.length > 0 || !publish) return false
    gestureRef.current = null
    releasedPublishRef.current = null
    resetPresentation()
    publish(gesture.draft)
    return true
  }, [gestureRef, releasedPublishRef, resetPresentation])
  const drainTrimQueue = useCallback(() => {
    const gesture = gestureRef.current
    if (!gesture) return false
    const nextGesture = applySketchTrimBatch(gesture)
    gestureRef.current = nextGesture
    setPreviewDraft(nextGesture.draft)
    if (nextGesture.pendingHits.length === 0) completeReleasedGesture()
    return nextGesture.pendingHits.length > 0
  }, [completeReleasedGesture, gestureRef, setPreviewDraft])
  const frames = useAnimationFrameDrain(drainTrimQueue)
  return { ...frames, completeReleasedGesture }
}

function sketchCurveIdFromPointerTarget(
  target: EventTarget | null,
  draft: SketchRecord | null,
): SketchEntityId | null {
  if (!(target instanceof Element) || !draft) return null
  const entityId = target.closest("[data-sketch-entity-id]")?.getAttribute("data-sketch-entity-id")
  if (!entityId) return null
  const entity = draft.entities.find(({ id }) => id === entityId)
  return entity && entity.type !== "point" ? entity.id : null
}

function useSketchTrimGesture({
  draft,
  editorTool,
}: Readonly<{
  draft: SketchRecord | null
  editorTool: SketchEditorTool
}>) {
  const gestureRef = useRef<SketchTrimGesture | null>(null)
  const releasedPublishRef = useRef<((draft: SketchRecord) => void) | null>(null)
  const [active, setActive] = useState(false)
  const [previewDraft, setPreviewDraft] = useState<SketchRecord | null>(null)
  const [preselectedEntityId, setPreselectedEntityId] = useState<SketchEntityId | null>(null)

  const resetPresentation = useCallback(() => {
    setActive(false)
    setPreviewDraft(null)
    setPreselectedEntityId(null)
  }, [])
  const {
    cancel: cancelTrimFrame,
    completeReleasedGesture,
    runNow: runTrimQueueNow,
    schedule: scheduleTrimQueue,
  } = useSketchTrimQueue({
    gestureRef,
    releasedPublishRef,
    resetPresentation,
    setPreviewDraft,
  })

  const start = useCallback(
    (pointerId: number, entityId: SketchEntityId, point: SketchPoint2) => {
      const gesture = createSketchTrimGesture(draft, editorTool, pointerId, entityId, point)
      if (!gesture) return false
      gestureRef.current = gesture
      releasedPublishRef.current = null
      setActive(true)
      setPreselectedEntityId(null)
      return true
    },
    [draft, editorTool],
  )

  const applyUpdate = useCallback(
    (pointerId: number, point: SketchPoint2) => {
      const gesture = appendSketchTrimPath(gestureRef.current, pointerId, point)
      if (!gesture) return false
      gestureRef.current = gesture
      if (gesture.pendingHits.length > 0) runTrimQueueNow()
      return true
    },
    [runTrimQueueNow],
  )
  const {
    clear: clearPointerUpdate,
    flush: flushPointerUpdate,
    update: queuePointerUpdate,
  } = useCoalescedTrimPointerUpdate(applyUpdate)

  const update = useCallback(
    (pointerId: number, point: SketchPoint2, immediate: boolean) => {
      const gesture = gestureRef.current
      if (!gesture || gesture.pointerId !== pointerId) return false
      if (immediate) return applyUpdate(pointerId, point)
      queuePointerUpdate(pointerId, point)
      return true
    },
    [applyUpdate, queuePointerUpdate],
  )

  const finish = useCallback(
    (pointerId: number, publish: (draft: SketchRecord) => void) => {
      flushPointerUpdate(pointerId)
      const gesture = gestureRef.current
      if (!gesture || gesture.pointerId !== pointerId) return false
      releasedPublishRef.current = publish
      if (gesture.pendingHits.length === 0) completeReleasedGesture()
      else scheduleTrimQueue()
      return true
    },
    [completeReleasedGesture, flushPointerUpdate, scheduleTrimQueue],
  )

  const cancel = useCallback(
    (pointerId?: number) => {
      const gesture = gestureRef.current
      if (!gesture || (pointerId !== undefined && gesture.pointerId !== pointerId)) return false
      if (releasedPublishRef.current) return true
      gestureRef.current = null
      clearPointerUpdate()
      cancelTrimFrame()
      releasedPublishRef.current = null
      resetPresentation()
      return true
    },
    [cancelTrimFrame, clearPointerUpdate, resetPresentation],
  )

  useEffect(() => {
    const gesture = gestureRef.current
    if (editorTool !== "trim" || (gesture && gesture.sourceDraft !== draft)) {
      gestureRef.current = null
      releasedPublishRef.current = null
      clearPointerUpdate()
      cancelTrimFrame()
      resetPresentation()
    }
    return () => {
      clearPointerUpdate()
      cancelTrimFrame()
    }
  }, [cancelTrimFrame, clearPointerUpdate, draft, editorTool, resetPresentation])

  const consumeEscape = useCallback(
    (event: KeyboardEvent<SVGSVGElement>) => {
      if (event.key !== "Escape" || !cancel()) return false
      event.preventDefault()
      return true
    },
    [cancel],
  )

  return {
    active,
    cancel,
    consumeEscape,
    finish,
    preselectedEntityId,
    previewDraft,
    setPreselectedEntityId,
    start,
    update,
  }
}

type SketchTrimGestureController = ReturnType<typeof useSketchTrimGesture>

function sketchTrimDisplay(
  sketch: SketchRecord,
  solution: SolvedSketchWire | null,
  annotationSolution: SolvedSketchWire | null,
  gesture: SketchTrimGestureController,
) {
  if (!gesture.previewDraft) {
    return {
      annotationSolution: gesture.active ? null : annotationSolution,
      sketch,
      solution,
    }
  }
  return { annotationSolution: null, sketch: gesture.previewDraft, solution: null }
}

function currentSketchDragTarget(
  draggingPointId: SketchEntityId | null,
  cursor: SketchPoint2 | null,
  releasedDragTarget: SketchDragTarget | null,
): SketchDragTarget | null {
  if (!draggingPointId || !cursor) return releasedDragTarget
  return { entityId: draggingPointId, x: cursor.x, y: cursor.y }
}

function consumeTrimPointerMove({
  bounds,
  draft,
  editorTool,
  event,
  gesture,
  setCursor,
  setInference,
  svg,
}: Readonly<{
  bounds: SketchBounds
  draft: SketchRecord | null
  editorTool: SketchEditorTool
  event: PointerEvent<SVGSVGElement>
  gesture: SketchTrimGestureController
  setCursor: Dispatch<SetStateAction<SketchPoint2 | null>>
  setInference: Dispatch<SetStateAction<SketchPointInference | null>>
  svg: SVGSVGElement | null
}>) {
  if (editorTool !== "trim") return false
  const rectangle = svg?.getBoundingClientRect()
  if (!rectangle) return true
  const point = pointerToSketchPoint(event, rectangle, bounds)
  if (gesture.update(event.pointerId, point, !event.nativeEvent.isTrusted)) return true
  gesture.setPreselectedEntityId(sketchCurveIdFromPointerTarget(event.target, draft))
  setCursor(null)
  setInference(null)
  return true
}

function consumeTrimCurveAction({
  editorTool,
  entityId,
  event,
  eventPoint,
  gesture,
  svg,
}: Readonly<{
  editorTool: SketchEditorTool
  entityId: SketchEntityId
  event: PointerEvent<SVGElement>
  eventPoint: (event: PointerEvent<SVGElement>) => SketchPoint2 | null
  gesture: SketchTrimGestureController
  svg: SVGSVGElement | null
}>) {
  if (editorTool !== "trim") return false
  const point = eventPoint(event)
  if (event.button !== 0 || !point || !gesture.start(event.pointerId, entityId, point)) return true
  if (event.nativeEvent.isTrusted) svg?.setPointerCapture?.(event.pointerId)
  event.preventDefault()
  return true
}

function releaseTrimPointerCapture(event: PointerEvent<SVGSVGElement>) {
  if (!event.nativeEvent.isTrusted || !event.currentTarget.hasPointerCapture?.(event.pointerId)) {
    return
  }
  event.currentTarget.releasePointerCapture?.(event.pointerId)
}

function consumeTrimPointerUp({
  event,
  gesture,
  publish,
}: Readonly<{
  event: PointerEvent<SVGSVGElement>
  gesture: SketchTrimGestureController
  publish: (draft: SketchRecord) => void
}>) {
  if (!gesture.finish(event.pointerId, publish)) return false
  releaseTrimPointerCapture(event)
  return true
}

function consumeTrimPointerCancel({
  event,
  gesture,
  setInference,
}: Readonly<{
  event: PointerEvent<SVGSVGElement>
  gesture: SketchTrimGestureController
  setInference: Dispatch<SetStateAction<SketchPointInference | null>>
}>) {
  if (!gesture.cancel(event.pointerId)) return false
  setInference(null)
  return true
}

function safeMirrorSketchEntities(
  draft: SketchRecord,
  axisLineId: SketchEntityId,
  entityIds: readonly SketchEntityId[],
) {
  try {
    return mirrorSketchEntities(draft, {
      axisLineId,
      createConstraintId: createBrowserSketchConstraintId,
      createEntityId: createBrowserSketchEntityId,
      entityIds,
    })
  } catch {
    return null
  }
}

function safeSketchTransformOrigin(
  draft: SketchRecord | null,
  entityIds: readonly SketchEntityId[],
) {
  if (!draft || entityIds.length === 0) return null
  try {
    return sketchEntityTransformOrigin(draft, entityIds)
  } catch {
    return null
  }
}

function safeLinearPatternSketchEntities(
  draft: SketchRecord,
  entityIds: readonly SketchEntityId[],
  definition: LinearSketchPatternDefinition,
) {
  try {
    return linearPatternSketchEntities(draft, {
      createConstraintId: createBrowserSketchConstraintId,
      createEntityId: createBrowserSketchEntityId,
      definition,
      entityIds,
    })
  } catch {
    return null
  }
}

function safeCircularPatternSketchEntities(
  draft: SketchRecord,
  entityIds: readonly SketchEntityId[],
  definition: CircularSketchPatternDefinition,
) {
  try {
    return circularPatternSketchEntities(draft, {
      createConstraintId: createBrowserSketchConstraintId,
      createEntityId: createBrowserSketchEntityId,
      definition,
      entityIds,
    })
  } catch {
    return null
  }
}

function nearestDisplayedSketchPoint(
  draft: SketchRecord,
  target: SketchPoint2,
  origin: SketchPoint2,
  preview: SketchTransformPreview,
  tolerance: number,
) {
  let result: Readonly<{ distance: number; point: SketchPoint2 }> | null = null
  for (const entity of draft.entities) {
    if (entity.type !== "point") continue
    const point = transformSketchPoint(entity, origin, preview)
    const distance = Math.hypot(point.x - target.x, point.y - target.y)
    if (distance <= tolerance && (!result || distance < result.distance)) {
      result = { distance, point }
    }
  }
  return result?.point ?? null
}

function safeSketchLineOffsetPreview(
  draft: SketchRecord,
  pending: Extract<PendingGeometry, { kind: "offset-distance" }>,
  point: SketchPoint2,
) {
  try {
    const distance = sketchLineSignedDistance(draft, pending.referenceLineId, point)
    const geometry = sketchLineOffsetGeometry(draft, {
      distance,
      lineIds: pending.lineIds,
      referenceLineId: pending.referenceLineId,
    })
    return { distance, lines: geometry.lines }
  } catch {
    return null
  }
}

function safeAppendSketchLineOffset(
  draft: SketchRecord,
  pending: Extract<PendingGeometry, { kind: "offset-distance" }>,
  point: SketchPoint2,
) {
  try {
    const distance = sketchLineSignedDistance(draft, pending.referenceLineId, point)
    return appendSketchLineOffset(draft, {
      createConstraintId: createBrowserSketchConstraintId,
      createEntityId: createBrowserSketchEntityId,
      lineIds: pending.lineIds,
      referenceLineId: pending.referenceLineId,
      value: createLengthQuantity(distance),
    })
  } catch {
    return null
  }
}

type MirrorActionResolution =
  | Readonly<{
      axisLineId: SketchEntityId
      kind: "select-sources"
    }>
  | Readonly<{
      keepSelectingSources: boolean
      kind: "publish"
      result: ReturnType<typeof mirrorSketchEntities>
    }>

function resolveMirrorAction(input: {
  draft: SketchRecord
  entityId: SketchEntityId
  pending: PendingGeometry | null
  selectedEntityIds: readonly SketchEntityId[]
}): MirrorActionResolution | null {
  if (input.pending?.kind === "mirror-sources") {
    if (input.entityId === input.pending.axisLineId) return null
    const result = safeMirrorSketchEntities(input.draft, input.pending.axisLineId, [input.entityId])
    return result ? { keepSelectingSources: true, kind: "publish", result } : null
  }
  const axis = input.draft.entities.find(({ id }) => id === input.entityId)
  if (axis?.type !== "line") return null
  const sourceIds = input.selectedEntityIds.filter((selectedId) => selectedId !== axis.id)
  if (sourceIds.length === 0) return { axisLineId: axis.id, kind: "select-sources" }
  const result = safeMirrorSketchEntities(input.draft, axis.id, sourceIds)
  return result ? { keepSelectingSources: false, kind: "publish", result } : null
}

function placementInputWithInference(input: {
  construction: boolean
  draft: SketchRecord
  inference: SketchPointInference | undefined
  pending: PendingGeometry | null
  point: SketchPoint2
  target: SketchPointTarget
}): PlacementInput {
  return {
    construction: input.construction,
    direction: input.inference ? input.inference.direction : null,
    draft: input.draft,
    pending: input.pending,
    point: input.point,
    relations: input.inference ? input.inference.relations : [],
    target: input.target,
  }
}

const pointRelationReferenceKeys = {
  "arc-midpoint": "arcId",
  coincident: "pointId",
  "ellipse-quadrant": "ellipseId",
  "horizontal-points": "pointId",
  midpoint: "lineId",
  "point-on-curve": "curveId",
  "point-on-ellipse": "ellipseId",
  "point-on-elliptical-arc": "ellipticalArcId",
  "point-on-line": "lineId",
  "vertical-points": "pointId",
} as const satisfies Record<
  SketchPointRelationInference["type"],
  "arcId" | "curveId" | "ellipseId" | "ellipticalArcId" | "lineId" | "pointId"
>

function pointRelationEntityId(relation: SketchPointRelationInference) {
  const key = pointRelationReferenceKeys[relation.type]
  return {
    id: (relation as unknown as Record<typeof key, SketchEntityId>)[key],
    key,
  }
}

function inferredExternalEntityIds(
  inference: SketchPointInference | undefined,
  pending: PendingGeometry | null,
) {
  const ids = new Set<SketchEntityId>()
  const appendRelations = (relations: readonly SketchPointRelationInference[]) => {
    for (const relation of relations) {
      ids.add(pointRelationEntityId(relation).id)
    }
  }
  if (pending?.kind === "line") appendRelations(pending.startRelations)
  if (inference) {
    appendRelations(inference.relations)
    if (inference.direction?.type === "parallel" || inference.direction?.type === "perpendicular") {
      ids.add(inference.direction.lineId)
    }
  }
  return ids
}

function remapPointRelation(
  relation: SketchPointRelationInference,
  projectedIds: ReadonlyMap<SketchEntityId, SketchEntityId>,
): SketchPointRelationInference {
  const { id, key } = pointRelationEntityId(relation)
  return { ...relation, [key]: projectedIds.get(id) ?? id } as SketchPointRelationInference
}

function remapInferenceDirection(
  direction: SketchDirectionInference | null,
  projectedIds: ReadonlyMap<SketchEntityId, SketchEntityId>,
): SketchDirectionInference | null {
  if (direction?.type !== "parallel" && direction?.type !== "perpendicular") return direction
  return { ...direction, lineId: projectedIds.get(direction.lineId) ?? direction.lineId }
}

function remapPendingExternalInference(
  pending: PendingGeometry | null,
  projectedIds: ReadonlyMap<SketchEntityId, SketchEntityId>,
): PendingGeometry | null {
  return pending?.kind === "line"
    ? {
        ...pending,
        startRelations: pending.startRelations.map((relation) =>
          remapPointRelation(relation, projectedIds),
        ),
      }
    : pending
}

function materializeExternalInference(input: {
  candidatesByInferenceId: ReadonlyMap<SketchEntityId, ExternalWakeupBinding>
  draft: SketchRecord
  inference: SketchPointInference | undefined
  pending: PendingGeometry | null
}) {
  let draft = input.draft
  const projectedIds = new Map<SketchEntityId, SketchEntityId>()
  for (const sourceEntityId of inferredExternalEntityIds(input.inference, input.pending)) {
    const binding = input.candidatesByInferenceId.get(sourceEntityId)
    if (!binding) continue
    const materialized = materializeWakeupCandidate(draft, binding)
    draft = materialized.sketch
    projectedIds.set(sourceEntityId, materialized.projectedEntityId)
  }
  const inference = input.inference
    ? {
        ...input.inference,
        direction: remapInferenceDirection(input.inference.direction, projectedIds),
        relations: input.inference.relations.map((relation) =>
          remapPointRelation(relation, projectedIds),
        ),
      }
    : undefined
  return {
    draft,
    inference,
    pending: remapPendingExternalInference(input.pending, projectedIds),
  }
}

function materializeWakeupCandidate(
  draft: SketchRecord,
  binding: ExternalWakeupBinding,
): Readonly<{ projectedEntityId: SketchEntityId; sketch: SketchRecord }> {
  const candidate = binding.candidate
  if (
    candidate.kind === "model-point" ||
    candidate.kind === "model-line" ||
    candidate.kind === "model-curve"
  ) {
    return materializeModelWakeupCandidate(draft, candidate, binding.target)
  }
  return materializeSketchWakeupCandidate(draft, candidate, binding.target)
}

function materializeModelWakeupCandidate(
  draft: SketchRecord,
  candidate: Extract<
    ExternalWakeupCandidate,
    { kind: "model-curve" | "model-line" | "model-point" }
  >,
  target: ExternalWakeupBinding["target"],
) {
  const materialized = materializeExternalModelCandidate(draft, candidate)
  if (materialized.kind === "model-point") {
    return { projectedEntityId: materialized.projectedPointId, sketch: materialized.sketch }
  }
  if (materialized.kind === "model-line") {
    return { projectedEntityId: materialized.projectedLineId, sketch: materialized.sketch }
  }
  if (materialized.kind === "model-curve") {
    const projectedEntityId =
      target === "curve-center" ? materialized.projectedPointIds[0] : materialized.projectedEntityId
    if (!projectedEntityId) {
      throw new Error("External model curve center identity is unavailable.")
    }
    return { projectedEntityId, sketch: materialized.sketch }
  }
  throw new Error("External model wake-up materialization changed geometry kind.")
}

function materializeSketchWakeupCandidate(
  draft: SketchRecord,
  candidate: Extract<ExternalWakeupCandidate, { kind: "curve" | "line" | "point" }>,
  target: ExternalWakeupBinding["target"],
) {
  const materialized = materializeExternalSketchCandidate(draft, candidate)
  if (materialized.kind === "point") {
    return { projectedEntityId: materialized.projectedPointId, sketch: materialized.sketch }
  }
  if (materialized.kind === "line") {
    return { projectedEntityId: materialized.projectedLineId, sketch: materialized.sketch }
  }
  if (materialized.kind === "curve") {
    const projectedEntityId =
      target === "curve-center" ? materialized.projectedPointIds[0] : materialized.projectedEntityId
    if (!projectedEntityId) {
      throw new Error("External sketch curve center identity is unavailable.")
    }
    return { projectedEntityId, sketch: materialized.sketch }
  }
  throw new Error("External sketch wake-up materialization changed geometry kind.")
}

function externalWakeupCandidateForInference(
  inference: SketchPointInference | null,
  candidatesByInferenceId: ReadonlyMap<SketchEntityId, ExternalWakeupBinding>,
) {
  if (!inference) return null
  for (const entityId of inferredExternalEntityIds(inference, null)) {
    const binding = candidatesByInferenceId.get(entityId)
    if (binding) return binding.candidate
  }
  return null
}

function publishPlacementResolution(
  resolution: ReturnType<typeof safePlacementUpdate>,
  actions: {
    onDraftChange: SketchDrawingConfiguration["onDraftChange"]
    onEditorToolChange: SketchDrawingConfiguration["onEditorToolChange"]
    setCreationPrecision: Dispatch<SetStateAction<SketchCreationPrecisionRequest | null>>
    setInference: Dispatch<SetStateAction<SketchPointInference | null>>
    setPending: Dispatch<SetStateAction<PendingGeometry | null>>
  },
) {
  if (!resolution.ok) {
    actions.setCreationPrecision(null)
    actions.setPending(null)
    return
  }
  const { update } = resolution
  if (!update) return
  if (update.draft) actions.onDraftChange(update.draft)
  if (update.nextTool) actions.onEditorToolChange(update.nextTool)
  if (update.creationPrecision) actions.setCreationPrecision(update.creationPrecision)
  actions.setPending(update.pending)
  actions.setInference(null)
}

function pannedBounds(
  gesture: PanGesture,
  event: Readonly<{ clientX: number; clientY: number }>,
  rectangle: Readonly<{ width: number; height: number }>,
) {
  if (rectangle.width <= 0 || rectangle.height <= 0) return null
  return {
    ...gesture.bounds,
    minX:
      gesture.bounds.minX -
      ((event.clientX - gesture.clientX) / rectangle.width) * gesture.bounds.width,
    minY:
      gesture.bounds.minY +
      ((event.clientY - gesture.clientY) / rectangle.height) * gesture.bounds.height,
  }
}

function zoomedBounds(bounds: SketchBounds, focus: SketchPoint2, deltaY: number): SketchBounds {
  const scale = Math.min(2, Math.max(0.5, Math.exp(deltaY * 0.0015)))
  const width = Math.min(2_000_000, Math.max(2, bounds.width * scale))
  const height = Math.min(1_500_000, Math.max(1.5, bounds.height * scale))
  const horizontal = (focus.x - bounds.minX) / bounds.width
  const vertical = (focus.y - bounds.minY) / bounds.height
  return {
    minX: focus.x - horizontal * width,
    minY: focus.y - vertical * height,
    width,
    height,
  }
}

function consumeSketchHistoryShortcut(
  event: KeyboardEvent<SVGSVGElement>,
  onUndo: () => void,
  onRedo: () => void,
) {
  const isHistoryShortcut = (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z"
  if (!isHistoryShortcut) return false
  event.preventDefault()
  if (event.shiftKey) onRedo()
  else onUndo()
  return true
}

function consumeSketchCancel(input: {
  event: KeyboardEvent<SVGSVGElement>
  onEditorToolChange: (tool: SketchEditorTool) => void
  pending: PendingGeometry | null
  setPending: Dispatch<SetStateAction<PendingGeometry | null>>
}) {
  if (input.event.key !== "Escape" || input.pending === null) return false
  input.event.preventDefault()
  input.setPending(null)
  if (input.pending.kind === "mirror-sources") input.onEditorToolChange("select")
  return true
}

function isSketchDeleteKey(event: KeyboardEvent<SVGSVGElement>) {
  return event.key === "Delete" || event.key === "Backspace"
}

function unsnappedInference(point: SketchPoint2): SketchPointInference {
  return {
    direction: null,
    kind: "none",
    point,
    relations: [],
    target: { kind: "new", point },
  }
}

const alwaysSupportsPointInference = () => true
const neverSupportsPointInference = () => false
const pointInferenceSupport = {
  "aligned-rectangle": alwaysSupportsPointInference,
  arc: neverSupportsPointInference,
  circle: (pending) => pending?.kind !== "circle",
  ellipse: (pending) => pending?.kind !== "ellipse-secondary",
  "elliptical-arc": (pending) =>
    pending?.kind !== "elliptical-arc-start" && pending?.kind !== "elliptical-arc-end",
  "circular-pattern": neverSupportsPointInference,
  "circumscribed-polygon": (pending) => pending?.kind !== "regular-polygon-sides",
  "center-rectangle": (pending) => pending?.kind !== "center-rectangle",
  "centered-aligned-rectangle": (pending) => pending?.kind !== "centered-aligned-rectangle-width",
  "centered-slot": (pending) => pending?.kind !== "centered-slot-width",
  dimension: neverSupportsPointInference,
  extend: neverSupportsPointInference,
  "inscribed-polygon": (pending) => pending?.kind !== "regular-polygon-sides",
  intersection: neverSupportsPointInference,
  pierce: neverSupportsPointInference,
  line: alwaysSupportsPointInference,
  "linear-pattern": neverSupportsPointInference,
  "midpoint-line": alwaysSupportsPointInference,
  mirror: neverSupportsPointInference,
  offset: neverSupportsPointInference,
  point: alwaysSupportsPointInference,
  rectangle: neverSupportsPointInference,
  select: neverSupportsPointInference,
  use: neverSupportsPointInference,
  slot: (pending) => pending?.kind !== "slot-width",
  "slot-from-selection": neverSupportsPointInference,
  split: neverSupportsPointInference,
  "tangent-arc": alwaysSupportsPointInference,
  "three-point-arc": alwaysSupportsPointInference,
  "three-point-circle": alwaysSupportsPointInference,
  transform: neverSupportsPointInference,
  trim: neverSupportsPointInference,
} satisfies Record<SketchEditorTool, (pending: PendingGeometry | null) => boolean>

function supportsPointInference(editorTool: SketchEditorTool, pending: PendingGeometry | null) {
  return pointInferenceSupport[editorTool](pending)
}

function lineInferenceAnchor(
  editorTool: SketchEditorTool,
  pending: PendingGeometry | null,
  draft: SketchRecord,
) {
  if (editorTool !== "line" || pending?.kind !== "line") return null
  return {
    point: pointForTarget(draft, pending.start),
    pointId: pending.start.kind === "existing" ? pending.start.pointId : undefined,
  }
}

type SketchInferenceReferences = Readonly<{
  arcs: readonly SketchInferenceArc[]
  curves: readonly SketchInferenceCurve[]
  lines: readonly SketchInferenceLine[]
  points: readonly DisplayPoint[]
}>

type SketchPlacementInferenceReferences = Readonly<{
  arcs: readonly SketchInferenceArc[]
  curves: readonly SketchInferenceCurve[]
  lines: readonly SketchInferenceLine[]
  points: readonly SketchInferencePoint[]
}>

type SketchDragInferenceReferences = SketchPlacementInferenceReferences

type ExternalWakeupCandidate =
  | Extract<ExternalSketchGeometryCandidate, { kind: "curve" | "line" | "point" }>
  | Extract<ExternalModelGeometryCandidate, { kind: "model-curve" | "model-line" | "model-point" }>

type ExternalWakeupBinding = Readonly<{
  candidate: ExternalWakeupCandidate
  target: "curve-center" | "entity"
}>

type ExternalWakeupReferences = Readonly<{
  candidatesByInferenceId: ReadonlyMap<SketchEntityId, ExternalWakeupBinding>
  curves: readonly SketchInferenceCurve[]
  lines: readonly SketchInferenceLine[]
  points: readonly SketchInferencePoint[]
}>

const EMPTY_INFERENCE_REFERENCES: SketchInferenceReferences = {
  arcs: [],
  curves: [],
  lines: [],
  points: [],
}

const EMPTY_EXTERNAL_WAKEUP_REFERENCES: ExternalWakeupReferences = {
  candidatesByInferenceId: new Map(),
  curves: [],
  lines: [],
  points: [],
}

function sketchReferencesWakeupCandidate(draft: SketchRecord, candidate: ExternalWakeupCandidate) {
  if (
    candidate.kind === "model-point" ||
    candidate.kind === "model-line" ||
    candidate.kind === "model-curve"
  ) {
    return sketchReferencesExternalModelCandidate(draft, candidate)
  }
  return (draft.externalReferences ?? []).some((reference) =>
    externalReferenceMatchesCandidate(reference, candidate),
  )
}

function isPassiveInferenceCurve(candidate: Readonly<{ projectedType: string | null }>) {
  return (
    candidate.projectedType === "circle" ||
    candidate.projectedType === "arc" ||
    candidate.projectedType === "ellipse" ||
    candidate.projectedType === "elliptical-arc"
  )
}

function isPointOrLineWakeupCandidate(candidate: ExternalUseCandidate) {
  return (
    candidate.kind === "point" ||
    candidate.kind === "line" ||
    candidate.kind === "model-point" ||
    candidate.kind === "model-line"
  )
}

function isExternalWakeupCandidate(
  candidate: ExternalUseCandidate,
): candidate is ExternalWakeupCandidate {
  if (candidate.kind === "curve") return isPassiveInferenceCurve(candidate)
  if (candidate.kind !== "model-curve") return isPointOrLineWakeupCandidate(candidate)
  return (
    candidate.passiveEligible === true &&
    candidate.projectedGeometry !== undefined &&
    isPassiveInferenceCurve(candidate)
  )
}

function canWakeExternalCandidate(candidate: ExternalWakeupCandidate, draft: SketchRecord) {
  if (candidate.kind === "model-curve") {
    return candidate.coplanar === true && !sketchReferencesWakeupCandidate(draft, candidate)
  }
  const isCoplanar =
    candidate.kind !== "model-point" && candidate.kind !== "model-line"
      ? true
      : candidate.coplanar !== false
  return isCoplanar && !sketchReferencesWakeupCandidate(draft, candidate)
}

type MutableExternalWakeupReferences = {
  candidatesByInferenceId: Map<SketchEntityId, ExternalWakeupBinding>
  centerInferenceIdByCandidateKey: Map<string, SketchEntityId>
  curves: SketchInferenceCurve[]
  inferenceIdByCandidateKey: Map<string, SketchEntityId>
  lines: SketchInferenceLine[]
  points: SketchInferencePoint[]
}

type ExternalWakeupInferenceIdRegistry = Map<string, SketchEntityId>

function modelWakeupReferenceIdentity(
  candidate: Extract<ExternalWakeupCandidate, { featureId: FeatureId }>,
) {
  const reference = candidate.reference
  const selector = reference.semanticRole
    ? ["semantic", reference.semanticRole]
    : reference.lineageToken
      ? ["lineage", reference.lineageToken]
      : [
          "signature",
          reference.signature.geometryClass,
          reference.signature.centroid,
          reference.signature.bounds.min,
          reference.signature.bounds.max,
          reference.signature.measure,
          reference.signature.direction ?? null,
          reference.signature.directionMode ?? null,
          reference.signature.boundaryCount,
          [...reference.signature.adjacentGeometryClasses].sort(),
          reference.intent ?? null,
        ]
  return JSON.stringify([candidate.kind, reference.featureId, reference.kind, ...selector])
}

function externalWakeupCandidateIdentity(candidate: ExternalWakeupCandidate) {
  return candidate.kind === "model-point" ||
    candidate.kind === "model-line" ||
    candidate.kind === "model-curve"
    ? modelWakeupReferenceIdentity(candidate)
    : candidateKey(candidate)
}

function externalWakeupInferenceId(
  registry: ExternalWakeupInferenceIdRegistry,
  candidate: ExternalWakeupCandidate,
  role: "center" | "end" | "entity" | "start",
) {
  const key = `${externalWakeupCandidateIdentity(candidate)}:${role}`
  const existing = registry.get(key)
  if (existing) return existing
  const inferenceId = createBrowserSketchEntityId()
  registry.set(key, inferenceId)
  return inferenceId
}

function appendExternalWakeupPoint(
  candidate: ExternalWakeupCandidate,
  references: MutableExternalWakeupReferences,
  registry: ExternalWakeupInferenceIdRegistry,
) {
  if (candidate.kind !== "point" && candidate.kind !== "model-point") return
  const inferenceId = externalWakeupInferenceId(registry, candidate, "entity")
  references.inferenceIdByCandidateKey.set(candidateKey(candidate), inferenceId)
  references.candidatesByInferenceId.set(inferenceId, { candidate, target: "entity" })
  references.points.push({ id: inferenceId, reusable: false, x: candidate.x, y: candidate.y })
}

function appendExternalCurveCenter(
  candidate: ExternalWakeupCandidate,
  references: MutableExternalWakeupReferences,
  registry: ExternalWakeupInferenceIdRegistry,
) {
  if (candidate.kind !== "curve" && candidate.kind !== "model-curve") return
  const center = candidate.projectedGeometry?.points[0]
  if (!center) return
  const inferenceId = externalWakeupInferenceId(registry, candidate, "center")
  references.centerInferenceIdByCandidateKey.set(candidateKey(candidate), inferenceId)
  references.candidatesByInferenceId.set(inferenceId, { candidate, target: "curve-center" })
  references.points.push({ id: inferenceId, reusable: false, ...center })
}

function externalWakeupLineEndpointId(
  candidate: Extract<ExternalWakeupCandidate, { kind: "line" | "model-line" }>,
  references: MutableExternalWakeupReferences,
  registry: ExternalWakeupInferenceIdRegistry,
  role: "end" | "start",
  sourcePointId?: SketchEntityId,
) {
  if (candidate.kind !== "line" || !sourcePointId) {
    return externalWakeupInferenceId(registry, candidate, role)
  }
  return (
    references.inferenceIdByCandidateKey.get(`${candidate.sourceSketchId}:${sourcePointId}`) ??
    externalWakeupInferenceId(registry, candidate, role)
  )
}

function appendExternalWakeupLine(
  candidate: ExternalWakeupCandidate,
  references: MutableExternalWakeupReferences,
  registry: ExternalWakeupInferenceIdRegistry,
) {
  if (candidate.kind !== "line" && candidate.kind !== "model-line") return
  const inferenceId = externalWakeupInferenceId(registry, candidate, "entity")
  references.candidatesByInferenceId.set(inferenceId, { candidate, target: "entity" })
  references.lines.push({
    id: inferenceId,
    startPointId: externalWakeupLineEndpointId(
      candidate,
      references,
      registry,
      "start",
      candidate.kind === "line" ? candidate.sourceStartPointId : undefined,
    ),
    endPointId: externalWakeupLineEndpointId(
      candidate,
      references,
      registry,
      "end",
      candidate.kind === "line" ? candidate.sourceEndPointId : undefined,
    ),
    start: candidate.start,
    end: candidate.end,
  })
}

type ExternalProjectedCurve = ProjectedSketchCurve

function externalWakeupCircle(projection: ExternalProjectedCurve) {
  const center = projection.points[0]
  return center && projection.radius !== undefined
    ? ({ type: "circle", center, radius: projection.radius } as const)
    : null
}

function externalWakeupArc(projection: ExternalProjectedCurve) {
  const [center, start, end] = projection.points
  return center && start && end ? ({ type: "arc", center, start, end } as const) : null
}

function externalWakeupEllipse(projection: ExternalProjectedCurve) {
  const [center, primaryAxisPoint, secondaryAxisPoint] = projection.points
  return center && primaryAxisPoint && secondaryAxisPoint
    ? ({ type: "ellipse", center, primaryAxisPoint, secondaryAxisPoint } as const)
    : null
}

function externalWakeupEllipticalArc(projection: ExternalProjectedCurve) {
  const [center, primaryAxisPoint, secondaryAxisPoint, start, end] = projection.points
  return center && primaryAxisPoint && secondaryAxisPoint && start && end
    ? ({
        type: "elliptical-arc",
        center,
        primaryAxisPoint,
        secondaryAxisPoint,
        start,
        end,
      } as const)
    : null
}

function externalWakeupCurve(
  candidate: Extract<ExternalWakeupCandidate, { kind: "curve" | "model-curve" }>,
) {
  const projection = candidate.projectedGeometry
  if (projection?.type === "circle") return externalWakeupCircle(projection)
  if (projection?.type === "arc") return externalWakeupArc(projection)
  if (projection?.type === "ellipse") return externalWakeupEllipse(projection)
  return projection?.type === "elliptical-arc" ? externalWakeupEllipticalArc(projection) : null
}

function appendExternalWakeupCurve(
  candidate: ExternalWakeupCandidate,
  references: MutableExternalWakeupReferences,
  registry: ExternalWakeupInferenceIdRegistry,
) {
  if (candidate.kind !== "curve" && candidate.kind !== "model-curve") return
  const curve = externalWakeupCurve(candidate)
  if (!curve) return
  const centerPointId = references.centerInferenceIdByCandidateKey.get(candidateKey(candidate))
  if (!centerPointId) return
  const inferenceId = externalWakeupInferenceId(registry, candidate, "entity")
  references.candidatesByInferenceId.set(inferenceId, { candidate, target: "entity" })
  references.curves.push({ id: inferenceId, centerPointId, ...curve })
}

function externalWakeupReferences(
  candidates: readonly ExternalSketchGeometryCandidate[],
  modelCandidates: readonly ExternalModelGeometryCandidate[],
  draft: SketchRecord,
  registry: ExternalWakeupInferenceIdRegistry,
): ExternalWakeupReferences {
  const available = [...candidates, ...modelCandidates].filter(
    (candidate): candidate is ExternalWakeupCandidate =>
      isExternalWakeupCandidate(candidate) && canWakeExternalCandidate(candidate, draft),
  )
  const references: MutableExternalWakeupReferences = {
    candidatesByInferenceId: new Map(),
    centerInferenceIdByCandidateKey: new Map(),
    curves: [],
    inferenceIdByCandidateKey: new Map(),
    lines: [],
    points: [],
  }
  for (const candidate of available) {
    appendExternalWakeupPoint(candidate, references, registry)
  }
  for (const candidate of available) {
    appendExternalCurveCenter(candidate, references, registry)
  }
  for (const candidate of available) {
    appendExternalWakeupLine(candidate, references, registry)
  }
  for (const candidate of available) {
    appendExternalWakeupCurve(candidate, references, registry)
  }
  return references
}

function mergeSketchInferenceReferences(
  base: SketchInferenceReferences,
  wakeup: ExternalWakeupReferences,
): SketchPlacementInferenceReferences {
  return {
    arcs: base.arcs,
    curves: [...base.curves, ...wakeup.curves],
    lines: [...base.lines, ...wakeup.lines],
    points: [...base.points, ...wakeup.points],
  }
}

function appendLineInferenceReference(
  entity: Extract<SketchEntity, { type: "line" }>,
  presentation: SketchGeometryPresentation,
  lines: SketchInferenceLine[],
) {
  const start = presentation.pointsById.get(entity.startPointId)
  const end = presentation.pointsById.get(entity.endPointId)
  if (!start || !end) return
  lines.push({
    id: entity.id,
    startPointId: entity.startPointId,
    endPointId: entity.endPointId,
    start,
    end,
  })
}

function appendArcInferenceReferences(
  entity: Extract<SketchEntity, { type: "arc" }>,
  presentation: SketchGeometryPresentation,
  arcs: SketchInferenceArc[],
  curves: SketchInferenceCurve[],
) {
  const center = presentation.pointsById.get(entity.centerPointId)
  const start = presentation.pointsById.get(entity.startPointId)
  const end = presentation.pointsById.get(entity.endPointId)
  if (!center || !start || !end) return
  arcs.push({
    id: entity.id,
    center,
    startPointId: entity.startPointId,
    endPointId: entity.endPointId,
  })
  curves.push({
    id: entity.id,
    centerPointId: entity.centerPointId,
    type: "arc",
    center,
    start,
    end,
  })
}

function appendCircleInferenceReference(
  entity: Extract<SketchEntity, { type: "circle" }>,
  presentation: SketchGeometryPresentation,
  curves: SketchInferenceCurve[],
) {
  const center = presentation.pointsById.get(entity.centerPointId)
  if (!center) return
  const radius = presentation.solvedCircles.get(entity.id) ?? entity.radius
  curves.push({
    id: entity.id,
    centerPointId: entity.centerPointId,
    type: "circle",
    center,
    radius,
  })
}

function appendEllipseInferenceReference(
  entity: Extract<SketchEntity, { type: "ellipse" }>,
  presentation: SketchGeometryPresentation,
  curves: SketchInferenceCurve[],
) {
  const center = presentation.pointsById.get(entity.centerPointId)
  const primaryAxisPoint = presentation.pointsById.get(entity.primaryAxisPointId)
  const secondaryAxisPoint = presentation.pointsById.get(entity.secondaryAxisPointId)
  if (!center || !primaryAxisPoint || !secondaryAxisPoint) return
  curves.push({
    id: entity.id,
    centerPointId: entity.centerPointId,
    type: "ellipse",
    center,
    primaryAxisPoint,
    secondaryAxisPoint,
  })
}

function appendEllipticalArcInferenceReference(
  entity: Extract<SketchEntity, { type: "elliptical-arc" }>,
  presentation: SketchGeometryPresentation,
  curves: SketchInferenceCurve[],
) {
  const center = presentation.pointsById.get(entity.centerPointId)
  const primaryAxisPoint = presentation.pointsById.get(entity.primaryAxisPointId)
  const secondaryAxisPoint = presentation.pointsById.get(entity.secondaryAxisPointId)
  const start = presentation.pointsById.get(entity.startPointId)
  const end = presentation.pointsById.get(entity.endPointId)
  if (!center || !primaryAxisPoint || !secondaryAxisPoint || !start || !end) return
  curves.push({
    id: entity.id,
    centerPointId: entity.centerPointId,
    type: "elliptical-arc",
    center,
    primaryAxisPoint,
    secondaryAxisPoint,
    start,
    end,
  })
}

function appendCurveInferenceReferences(
  entity: SketchEntity,
  presentation: SketchGeometryPresentation,
  references: Pick<MutableExternalWakeupReferences, "curves" | "lines"> & {
    arcs: SketchInferenceArc[]
  },
) {
  if (entity.type === "line") {
    appendLineInferenceReference(entity, presentation, references.lines)
    return
  }
  if (entity.type === "arc") {
    appendArcInferenceReferences(entity, presentation, references.arcs, references.curves)
    return
  }
  if (entity.type === "circle") {
    appendCircleInferenceReference(entity, presentation, references.curves)
    return
  }
  if (entity.type === "ellipse") {
    appendEllipseInferenceReference(entity, presentation, references.curves)
    return
  }
  if (entity.type === "elliptical-arc") {
    appendEllipticalArcInferenceReference(entity, presentation, references.curves)
  }
}

function sketchInferenceReferences(
  presentation: SketchGeometryPresentation,
): SketchInferenceReferences {
  const lines: SketchInferenceLine[] = presentation.externalLines.map((line) => ({
    id: line.id,
    startPointId: line.start.id,
    endPointId: line.end.id,
    start: line.start,
    end: line.end,
  }))
  const references = {
    arcs: [] as SketchInferenceArc[],
    curves: [] as SketchInferenceCurve[],
    lines,
  }
  for (const entity of [...presentation.curves, ...presentation.externalCurves]) {
    appendCurveInferenceReferences(entity, presentation, references)
  }
  const externalLinePoints = presentation.externalLines.flatMap(({ start, end }) => [start, end])
  return {
    ...references,
    points: [...presentation.points, ...presentation.externalPoints, ...externalLinePoints],
  }
}

function supportsPersistentPointRelations(editorTool: SketchEditorTool) {
  return editorTool === "line" || editorTool === "point"
}

function supportsExternalPointDragInference(editorTool: SketchEditorTool) {
  return editorTool === "select"
}

function sketchInferenceTolerance(
  bounds: SketchBounds,
  rectangle: Readonly<{ width: number; height: number }>,
) {
  const worldPerPixel = Math.max(
    rectangle.width > 0 ? bounds.width / rectangle.width : 0,
    rectangle.height > 0 ? bounds.height / rectangle.height : 0,
  )
  return worldPerPixel * 10
}

function placementInferenceReferences(
  input: Parameters<typeof placementInference>[0],
  supportsRelations: boolean,
  candidates: ReturnType<SketchInferenceCandidateQuery<SketchInferencePoint>>,
) {
  return {
    arcs: input.editorTool === "line" ? input.references.arcs : [],
    curves: supportsRelations ? input.references.curves : [],
    directionLines: supportsRelations ? input.directionLines : [],
    lines: supportsRelations ? candidates.lines : [],
  }
}

function placementInferenceAnchorOptions(
  anchor: ReturnType<typeof lineInferenceAnchor>,
): Readonly<{ anchor?: SketchPoint2; anchorPointId?: SketchEntityId }> {
  if (!anchor) return {}
  return {
    anchor: anchor.point,
    ...(anchor.pointId ? { anchorPointId: anchor.pointId } : {}),
  }
}

function placementInference(input: {
  bounds: SketchBounds
  draft: SketchRecord | null
  directionLines: readonly SketchInferenceLine[]
  editorTool: SketchEditorTool
  pending: PendingGeometry | null
  point: SketchPoint2
  rectangle: Readonly<{ width: number; height: number }>
  candidateQuery: SketchInferenceCandidateQuery<SketchInferencePoint>
  references: Pick<SketchPlacementInferenceReferences, "arcs" | "curves">
  suppressed?: boolean
}): SketchPointInference {
  if (
    input.suppressed ||
    !input.draft ||
    !supportsPointInference(input.editorTool, input.pending)
  ) {
    return unsnappedInference(input.point)
  }
  const anchor = lineInferenceAnchor(input.editorTool, input.pending, input.draft)
  const supportsRelations = supportsPersistentPointRelations(input.editorTool)
  const tolerance = sketchInferenceTolerance(input.bounds, input.rectangle)
  const candidates = input.candidateQuery(input.point, tolerance)
  const references = placementInferenceReferences(input, supportsRelations, candidates)
  return inferSketchPoint({
    ...placementInferenceAnchorOptions(anchor),
    ...references,
    point: input.point,
    points: candidates.points,
    tolerance,
  })
}

function draggedPointInference(input: {
  bounds: SketchBounds
  point: SketchPoint2
  rectangle: Readonly<{ width: number; height: number }>
  references: SketchDragInferenceReferences
  suppressed: boolean
}) {
  if (input.suppressed) return unsnappedInference(input.point)
  return inferSketchPoint({
    arcs: input.references.arcs,
    curves: input.references.curves,
    lines: input.references.lines,
    point: input.point,
    points: input.references.points,
    tolerance: sketchInferenceTolerance(input.bounds, input.rectangle),
  })
}

function curveEntityPointIds(entity: SketchEntity): readonly SketchEntityId[] {
  if (entity.type === "arc") {
    return [entity.centerPointId, entity.startPointId, entity.endPointId]
  }
  if (entity.type === "circle") return [entity.centerPointId]
  if (entity.type === "ellipse") {
    return [entity.centerPointId, entity.primaryAxisPointId, entity.secondaryAxisPointId]
  }
  if (entity.type === "elliptical-arc") {
    return [
      entity.centerPointId,
      entity.primaryAxisPointId,
      entity.secondaryAxisPointId,
      entity.startPointId,
      entity.endPointId,
    ]
  }
  return []
}

function incidentCurveEntityIds(sketch: SketchRecord, pointId: SketchEntityId) {
  return new Set(
    sketch.entities.flatMap((entity) =>
      curveEntityPointIds(entity).includes(pointId) ? [entity.id] : [],
    ),
  )
}

function draggedPointCandidates(
  candidates: ReturnType<SketchInferenceCandidateQuery<SketchInferencePoint>>,
  pointId: SketchEntityId,
  sketch: SketchRecord,
): SketchDragInferenceReferences {
  const incidentCurveIds = incidentCurveEntityIds(sketch, pointId)
  return {
    arcs: candidates.arcs.filter(
      (arc) =>
        !incidentCurveIds.has(arc.id) && arc.startPointId !== pointId && arc.endPointId !== pointId,
    ),
    curves: candidates.curves.filter(
      (curve) => !incidentCurveIds.has(curve.id) && curve.centerPointId !== pointId,
    ),
    lines: candidates.lines.filter(
      (line) => line.startPointId !== pointId && line.endPointId !== pointId,
    ),
    points: candidates.points.filter(({ id }) => id !== pointId),
  }
}

function dragInferenceCellSize(bounds: SketchBounds, viewport: SketchViewportSize) {
  const measuredViewport =
    viewport.width > 0 && viewport.height > 0 ? viewport : DRAG_INFERENCE_FALLBACK_VIEWPORT
  const tolerance = sketchInferenceTolerance(bounds, measuredViewport)
  return 2 ** Math.round(Math.log2(tolerance))
}

type LiveDragSolvePolicy = Readonly<{
  delayMs: number
  mode: "debounce" | "throttle"
}>

function liveDragSolvePolicy(sketch: SketchRecord): LiveDragSolvePolicy | null {
  const complexity = sketch.entities.length + sketch.constraints.length
  if (complexity > VERY_DENSE_DRAG_SOLVE_COMPLEXITY) return null
  return complexity > DENSE_DRAG_SOLVE_COMPLEXITY
    ? { delayMs: DENSE_DRAG_IDLE_SOLVE_DELAY_MS, mode: "debounce" }
    : { delayMs: LIVE_DRAG_SOLVE_INTERVAL_MS, mode: "throttle" }
}

function updateDraggedPointFromPointer(input: {
  draggingPointId: SketchEntityId | null
  event: PointerEvent<SVGSVGElement>
  updatePointDrag: (input: SketchPointDragInput) => boolean
}) {
  if (!input.draggingPointId) return false
  input.updatePointDrag({
    clientX: input.event.clientX,
    clientY: input.event.clientY,
    suppressed: input.event.shiftKey,
  })
  return true
}

function updateSketchPanFromPointer(input: {
  event: PointerEvent<SVGSVGElement>
  panGesture: PanGesture | null
  setBounds: Dispatch<SetStateAction<SketchBounds>>
  svg: SVGSVGElement | null
}) {
  if (input.panGesture?.pointerId !== input.event.pointerId) return false
  const rectangle = input.svg?.getBoundingClientRect()
  if (!rectangle) return true
  const bounds = pannedBounds(input.panGesture, input.event, rectangle)
  if (bounds) input.setBounds(bounds)
  return true
}

function handleSketchPointerMove(input: {
  bounds: SketchBounds
  draggingPointId: SketchEntityId | null
  event: PointerEvent<SVGSVGElement>
  inferredPlacement: (
    point: SketchPoint2,
    rectangle: Readonly<{ width: number; height: number }>,
    suppressed?: boolean,
  ) => SketchPointInference
  panGesture: PanGesture | null
  setBounds: Dispatch<SetStateAction<SketchBounds>>
  setCursor: Dispatch<SetStateAction<SketchPoint2 | null>>
  setInference: Dispatch<SetStateAction<SketchPointInference | null>>
  svg: SVGSVGElement | null
  updatePointDrag: (input: SketchPointDragInput) => boolean
}) {
  if (
    updateSketchPanFromPointer({
      event: input.event,
      panGesture: input.panGesture,
      setBounds: input.setBounds,
      svg: input.svg,
    })
  ) {
    return
  }
  if (
    updateDraggedPointFromPointer({
      draggingPointId: input.draggingPointId,
      event: input.event,
      updatePointDrag: input.updatePointDrag,
    })
  ) {
    return
  }
  const rectangle = input.svg?.getBoundingClientRect()
  if (!rectangle) return
  const point = pointerToSketchPoint(input.event, rectangle, input.bounds)
  const inference = input.inferredPlacement(point, rectangle, input.event.shiftKey)
  input.setInference(inference)
  input.setCursor(inference.point)
}

type RegularPolygonKeyInput = Readonly<{
  appendAt: (target: SketchPointTarget, inference?: SketchPointInference) => void
  cursor: SketchPoint2 | null
  event: KeyboardEvent<SVGSVGElement>
  inference: SketchPointInference | null
  setPending: Dispatch<SetStateAction<PendingGeometry | null>>
}>

function updateRegularPolygonSideCountInput(
  setPending: Dispatch<SetStateAction<PendingGeometry | null>>,
  update: (value: string | null) => string | null,
) {
  setPending((current) =>
    current?.kind === "regular-polygon-sides"
      ? { ...current, sideCountInput: update(current.sideCountInput) }
      : current,
  )
}

function consumeRegularPolygonDigit(input: RegularPolygonKeyInput) {
  const { event } = input
  if (!/^\d$/.test(event.key)) return false
  event.preventDefault()
  updateRegularPolygonSideCountInput(input.setPending, (current) =>
    `${current ?? ""}${event.key}`.slice(-2),
  )
  return true
}

function consumeRegularPolygonBackspace(input: RegularPolygonKeyInput) {
  if (input.event.key !== "Backspace") return false
  input.event.preventDefault()
  updateRegularPolygonSideCountInput(input.setPending, (current) => current?.slice(0, -1) || null)
  return true
}

function isCommittableRegularPolygonSideCount(value: string | null) {
  if (value === null) return true
  return parsedRegularPolygonSideCount(value) !== null
}

function consumeRegularPolygonCommit(
  input: RegularPolygonKeyInput,
  pending: Extract<PendingGeometry, { kind: "regular-polygon-sides" }>,
) {
  if (input.event.key !== "Enter") return false
  input.event.preventDefault()
  if (input.cursor && isCommittableRegularPolygonSideCount(pending.sideCountInput)) {
    input.appendAt(
      input.inference?.target ?? { kind: "new", point: input.cursor },
      input.inference ?? undefined,
    )
  }
  return true
}

function consumeRegularPolygonSideCountKey(
  input: RegularPolygonKeyInput,
  pending: Extract<PendingGeometry, { kind: "regular-polygon-sides" }>,
) {
  return (
    consumeRegularPolygonDigit(input) ||
    consumeRegularPolygonBackspace(input) ||
    consumeRegularPolygonCommit(input, pending)
  )
}

function handleSketchKeyDown(input: {
  appendAt: (target: SketchPointTarget, inference?: SketchPointInference) => void
  cursor: SketchPoint2 | null
  draft: SketchRecord | null
  event: KeyboardEvent<SVGSVGElement>
  inference: SketchPointInference | null
  editorTool: SketchEditorTool
  onDraftChange: SketchDrawingConfiguration["onDraftChange"]
  onEditorToolChange: (tool: SketchEditorTool) => void
  onRedo: () => void
  onSelectionChange: (entityIds: readonly SketchEntityId[]) => void
  onUndo: () => void
  pending: PendingGeometry | null
  selectedEntityIds: readonly SketchEntityId[]
  setPending: Dispatch<SetStateAction<PendingGeometry | null>>
}) {
  if (consumeSketchHistoryShortcut(input.event, input.onUndo, input.onRedo)) return
  if (consumeSketchCancel(input)) return
  if (
    input.pending?.kind === "regular-polygon-sides" &&
    consumeRegularPolygonSideCountKey(input, input.pending)
  ) {
    return
  }
  if (!isSketchDeleteKey(input.event) || !input.draft) return
  input.event.preventDefault()
  input.onDraftChange(removeSketchEntities(input.draft, input.selectedEntityIds))
  input.onSelectionChange([])
}

function handleSketchWheel(input: {
  bounds: SketchBounds
  event: WheelEvent<SVGSVGElement>
  setBounds: Dispatch<SetStateAction<SketchBounds>>
  svg: SVGSVGElement | null
}) {
  input.event.preventDefault()
  if (!input.svg) return
  const focus = pointerToSketchPoint(input.event, input.svg.getBoundingClientRect(), input.bounds)
  input.setBounds(zoomedBounds(input.bounds, focus, input.event.deltaY))
}

function handleSketchCanvasPointerDown(input: {
  appendAt: (target: SketchPointTarget, inference?: SketchPointInference) => void
  bounds: SketchBounds
  editorTool: SketchEditorTool
  event: PointerEvent<SVGSVGElement>
  eventPoint: (event: PointerEvent<SVGSVGElement>) => SketchPoint2 | null
  inferredPlacement: (
    point: SketchPoint2,
    rectangle: Readonly<{ width: number; height: number }>,
    suppressed?: boolean,
  ) => SketchPointInference
  onSelectionChange: (entityIds: readonly SketchEntityId[]) => void
  setPanGesture: Dispatch<SetStateAction<PanGesture | null>>
}) {
  const { event } = input
  event.currentTarget.focus()
  if (event.button === 1 || event.button === 2) {
    event.preventDefault()
    if (event.nativeEvent.isTrusted) event.currentTarget.setPointerCapture(event.pointerId)
    input.setPanGesture({
      bounds: input.bounds,
      clientX: event.clientX,
      clientY: event.clientY,
      pointerId: event.pointerId,
    })
    return
  }
  if (isSketchSelectionTool(input.editorTool)) {
    if (event.target === event.currentTarget) input.onSelectionChange([])
    return
  }
  if (isSketchModificationTool(input.editorTool)) return
  const point = input.eventPoint(event)
  if (!point) return
  const inference = input.inferredPlacement(
    point,
    event.currentTarget.getBoundingClientRect(),
    event.shiftKey,
  )
  input.appendAt(inference.target, inference)
}

function isPrimaryEmptyCanvasPointer(event: PointerEvent<SVGSVGElement>) {
  return event.button === 0 && event.target === event.currentTarget
}

function offsetDraftFromCanvasPointer(input: {
  draft: SketchRecord | null
  editorTool: SketchEditorTool
  event: PointerEvent<SVGSVGElement>
  eventPoint: (event: PointerEvent<SVGSVGElement>) => SketchPoint2 | null
  pending: PendingGeometry | null
}) {
  if (
    input.editorTool !== "offset" ||
    input.pending?.kind !== "offset-distance" ||
    !isPrimaryEmptyCanvasPointer(input.event)
  ) {
    return undefined
  }
  const point = input.eventPoint(input.event)
  const result =
    input.draft && point ? safeAppendSketchLineOffset(input.draft, input.pending, point) : null
  return result?.sketch ?? null
}

function useSketchPointDrag({
  bounds,
  candidatesByInferenceId,
  draft,
  inferenceCandidateQuery,
  onDraftChange,
  onDraggingPointChange,
  onPreview,
  svgRef,
}: Pick<SketchDrawingConfiguration, "draft" | "onDraftChange" | "onDraggingPointChange"> & {
  bounds: SketchBounds
  candidatesByInferenceId: ReadonlyMap<SketchEntityId, ExternalWakeupBinding>
  inferenceCandidateQuery: SketchInferenceCandidateQuery<SketchInferencePoint>
  onPreview: (preview: SketchPointDragPreview) => void
  svgRef: RefObject<SVGSVGElement | null>
}) {
  const [draggingPointId, setDraggingPointId] = useState<SketchEntityId | null>(null)
  const dragFrameRef = useRef<number | null>(null)
  const dragRectangleRef = useRef<SketchViewportRectangle | null>(null)
  const dragSolveTimerRef = useRef<number | null>(null)
  const lastDragPreviewRef = useRef<SketchPointDragPreview | null>(null)
  const queuedDragInputRef = useRef<SketchPointDragInput | null>(null)
  const queuedDragSolveTargetRef = useRef<Readonly<{
    point: SketchPoint2
    pointId: SketchEntityId
  }> | null>(null)
  useEffect(
    () => () => {
      if (dragFrameRef.current !== null) window.cancelAnimationFrame(dragFrameRef.current)
      if (dragSolveTimerRef.current !== null) window.clearTimeout(dragSolveTimerRef.current)
    },
    [],
  )

  const scheduleLiveSolve = useCallback(
    (pointId: SketchEntityId, point: SketchPoint2, policy: LiveDragSolvePolicy | null) => {
      if (!policy) return
      queuedDragSolveTargetRef.current = { point, pointId }
      if (dragSolveTimerRef.current !== null) {
        if (policy.mode === "throttle") return
        window.clearTimeout(dragSolveTimerRef.current)
      }
      dragSolveTimerRef.current = window.setTimeout(() => {
        dragSolveTimerRef.current = null
        const target = queuedDragSolveTargetRef.current
        queuedDragSolveTargetRef.current = null
        if (target) {
          startTransition(() => onDraggingPointChange(target.pointId, target.point))
        }
      }, policy.delayMs)
    },
    [onDraggingPointChange],
  )

  const preview = useCallback(
    (input: SketchPointDragInput): SketchPointDragPreview | null => {
      if (!draft || !draggingPointId) return null
      const rectangle = dragRectangleRef.current
      if (!rectangle) return null
      const point = pointerToSketchPoint(input, rectangle, bounds)
      const tolerance = sketchInferenceTolerance(bounds, rectangle)
      const candidates = draggedPointCandidates(
        inferenceCandidateQuery(point, tolerance),
        draggingPointId,
        draft,
      )
      const inference = draggedPointInference({
        bounds,
        point,
        rectangle,
        references: candidates,
        suppressed: input.suppressed,
      })
      const next = { inference, point: inference.point }
      lastDragPreviewRef.current = next
      onPreview(next)
      scheduleLiveSolve(draggingPointId, next.point, liveDragSolvePolicy(draft))
      return next
    },
    [bounds, draft, draggingPointId, inferenceCandidateQuery, onPreview, scheduleLiveSolve],
  )
  const flush = useCallback(() => {
    if (dragFrameRef.current !== null) {
      window.cancelAnimationFrame(dragFrameRef.current)
      dragFrameRef.current = null
    }
    const input = queuedDragInputRef.current
    queuedDragInputRef.current = null
    return (input ? preview(input) : null) ?? lastDragPreviewRef.current
  }, [preview])
  const update = useCallback(
    (input: SketchPointDragInput) => {
      if (!draft || !draggingPointId) return false
      queuedDragInputRef.current = input
      if (dragFrameRef.current === null) {
        dragFrameRef.current = window.requestAnimationFrame(() => {
          dragFrameRef.current = null
          const queuedInput = queuedDragInputRef.current
          queuedDragInputRef.current = null
          if (queuedInput) preview(queuedInput)
        })
      }
      return true
    },
    [draft, draggingPointId, preview],
  )
  const finish = useCallback(() => {
    const finalPreview = flush()
    if (dragSolveTimerRef.current !== null) {
      window.clearTimeout(dragSolveTimerRef.current)
      dragSolveTimerRef.current = null
    }
    queuedDragSolveTargetRef.current = null
    if (draft && draggingPointId && finalPreview) {
      onDraggingPointChange(draggingPointId, finalPreview.point)
      const materialized = materializeExternalInference({
        candidatesByInferenceId,
        draft,
        inference: finalPreview.inference,
        pending: null,
      })
      const moved = moveSketchPoint(materialized.draft, draggingPointId, finalPreview.point)
      onDraftChange(
        applyDraggedPointInference(moved, draggingPointId, materialized.inference ?? null),
        "record",
      )
    }
    if (draggingPointId) onDraggingPointChange(null)
    setDraggingPointId(null)
    dragRectangleRef.current = null
    lastDragPreviewRef.current = null
  }, [candidatesByInferenceId, draft, draggingPointId, flush, onDraftChange, onDraggingPointChange])
  const start = useCallback(
    (event: PointerEvent<SVGCircleElement>, pointId: SketchEntityId) => {
      const rectangle = svgRef.current?.getBoundingClientRect()
      if (!rectangle) return
      if (event.nativeEvent.isTrusted) event.currentTarget.setPointerCapture(event.pointerId)
      dragRectangleRef.current = {
        height: rectangle.height,
        left: rectangle.left,
        top: rectangle.top,
        width: rectangle.width,
      }
      lastDragPreviewRef.current = null
      queuedDragInputRef.current = null
      queuedDragSolveTargetRef.current = null
      if (dragSolveTimerRef.current !== null) {
        window.clearTimeout(dragSolveTimerRef.current)
        dragSolveTimerRef.current = null
      }
      setDraggingPointId(pointId)
    },
    [svgRef],
  )
  return { draggingPointId, finish, start, update }
}

type SketchDrawingViewProps = Readonly<{
  configuration: SketchDrawingConfiguration
  handlers: Readonly<{
    appendAt: (target: SketchPointTarget, inference?: SketchPointInference) => void
    onCanvasPointerDown: (event: PointerEvent<SVGSVGElement>) => void
    onCircularPatternApply: (value: CircularSketchPatternDefinition) => void
    onCircularPatternCancel: () => void
    onCircularPatternPreview: (value: CircularSketchPatternDefinition | null) => void
    onCurveAction: (event: PointerEvent<SVGElement>, entityId: SketchEntityId) => void
    onDimensionPositionChange: (constraintId: SketchConstraintId, point: SketchPoint2) => void
    onEditDimension: (constraintId: SketchConstraintId, point: SketchPoint2) => void
    onKeyDown: (event: KeyboardEvent<SVGSVGElement>) => void
    onLinearPatternApply: (value: LinearSketchPatternDefinition) => void
    onLinearPatternCancel: () => void
    onLinearPatternPreview: (value: LinearSketchPatternDefinition | null) => void
    onPointPointerDown: (event: PointerEvent<SVGCircleElement>, pointId: SketchEntityId) => void
    onPointerCancel: (event: PointerEvent<SVGSVGElement>) => void
    onPointerLeave: () => void
    onPointerMove: (event: PointerEvent<SVGSVGElement>) => void
    onPointerUp: (event: PointerEvent<SVGSVGElement>) => void
    onSelection: (entityId: SketchEntityId, additive: boolean) => void
    onTransformStart: (event: PointerEvent<SVGElement>, handle: SketchTransformHandle) => void
    onTransformApply: (value: SketchTransformExactValue) => void
    onTransformCancel: () => void
    onWheel: (event: WheelEvent<SVGSVGElement>) => void
  }>
  sketch: SketchRecord
  state: Readonly<{
    annotationProfiles: readonly SketchProfileSelector[]
    annotationSolution: SolvedSketchWire | null
    bounds: SketchBounds
    cursor: SketchPoint2 | null
    dragTarget: SketchDragTarget | null
    draggingPointId: SketchEntityId | null
    dimensionLabelPositions: ReadonlyMap<SketchConstraintId, SketchPoint2>
    dimensionPreview: Readonly<{
      anchor: SketchPoint2
      witnesses: readonly SketchPoint2[]
    }> | null
    editable: boolean
    externalInferenceCandidate: ExternalWakeupCandidate | null
    geometry: SketchGeometryPresentation
    inference: SketchPointInference | null
    circularPattern: Readonly<{
      definition: CircularSketchPatternDefinition | null
      selectionKey: string
    }> | null
    linearPattern: Readonly<{
      definition: LinearSketchPatternDefinition | null
      selectionKey: string
    }> | null
    pending: PendingGeometry | null
    preselectedEntityId: SketchEntityId | null
    trimGestureActive: boolean
    transform: Readonly<{
      origin: SketchPoint2
      preview: SketchTransformPreview
    }> | null
    viewportSize: ReturnType<typeof useSketchViewportSize>
  }>
  svgRef: RefObject<SVGSVGElement | null>
}>

function SketchTransformPresentation({
  bounds,
  entityIds,
  geometry,
  transform,
  viewportSize,
  onStart,
}: Readonly<{
  bounds: SketchBounds
  entityIds: readonly SketchEntityId[]
  geometry: SketchGeometryPresentation
  transform: SketchDrawingViewProps["state"]["transform"]
  viewportSize: SketchViewportSize
  onStart: SketchDrawingViewProps["handlers"]["onTransformStart"]
}>) {
  if (!transform) return null
  const horizontalScale = viewportSize.width > 0 ? bounds.width / viewportSize.width : 0
  const verticalScale = viewportSize.height > 0 ? bounds.height / viewportSize.height : 0
  return (
    <>
      <SketchTransformGeometry
        entityIds={entityIds}
        origin={transform.origin}
        presentation={geometry}
        preview={transform.preview}
      />
      <SketchTransformManipulator
        origin={transform.origin}
        preview={transform.preview}
        worldPerPixel={Math.max(horizontalScale, verticalScale)}
        onStart={onStart}
      />
    </>
  )
}

function SketchLinearPatternPresentation({
  entityIds,
  geometry,
  pattern,
}: Readonly<{
  entityIds: readonly SketchEntityId[]
  geometry: SketchGeometryPresentation
  pattern: SketchDrawingViewProps["state"]["linearPattern"]
}>) {
  if (!pattern?.definition) return null
  let transforms: readonly ReturnType<typeof linearSketchPatternTransforms>[number][]
  try {
    transforms = linearSketchPatternTransforms(pattern.definition).slice(
      0,
      MAX_SKETCH_PATTERN_PREVIEW_INSTANCES - 1,
    )
  } catch {
    return null
  }
  return (
    <g data-sketch-linear-pattern-preview>
      {transforms.map((transform, index) => (
        <SketchTransformGeometry
          key={`${transform.translation.x}:${transform.translation.y}:${index}`}
          entityIds={entityIds}
          origin={{ x: 0, y: 0 }}
          presentation={geometry}
          preview={{
            rotationRadians: transform.rotationRadians,
            scale: 1,
            translation: transform.translation,
          }}
        />
      ))}
    </g>
  )
}

function SketchCircularPatternPresentation({
  entityIds,
  geometry,
  pattern,
}: Readonly<{
  entityIds: readonly SketchEntityId[]
  geometry: SketchGeometryPresentation
  pattern: SketchDrawingViewProps["state"]["circularPattern"]
}>) {
  if (!pattern?.definition) return null
  let transforms: readonly ReturnType<typeof circularSketchPatternTransforms>[number][]
  try {
    transforms = circularSketchPatternTransforms(pattern.definition).slice(
      0,
      MAX_SKETCH_PATTERN_PREVIEW_INSTANCES - 1,
    )
  } catch {
    return null
  }
  const { center } = pattern.definition
  return (
    <g data-sketch-circular-pattern-preview>
      {transforms.map((transform, index) => (
        <SketchTransformGeometry
          key={`${transform.rotationRadians}:${index}`}
          entityIds={entityIds}
          origin={{ x: 0, y: 0 }}
          presentation={geometry}
          preview={{
            rotationRadians: transform.rotationRadians,
            scale: 1,
            translation: transform.translation,
          }}
        />
      ))}
      <g className="pointer-events-none stroke-ring" transform="scale(1 -1)">
        <circle
          cx={center.x}
          cy={center.y}
          fill="none"
          r={5}
          strokeWidth={2}
          vectorEffect="non-scaling-stroke"
        />
        <line
          x1={center.x - 8}
          y1={center.y}
          x2={center.x + 8}
          y2={center.y}
          vectorEffect="non-scaling-stroke"
        />
        <line
          x1={center.x}
          y1={center.y - 8}
          x2={center.x}
          y2={center.y + 8}
          vectorEffect="non-scaling-stroke"
        />
      </g>
    </g>
  )
}

function SketchDimensionPlacementPreview({
  value,
}: Readonly<{
  value: SketchDrawingViewProps["state"]["dimensionPreview"]
}>) {
  if (!value) return null
  return (
    <g
      className="pointer-events-none stroke-primary"
      data-sketch-dimension-placement-preview
      transform="scale(1 -1)"
    >
      {value.witnesses.map((point, index) => (
        <line
          key={`${point.x}:${point.y}:${index}`}
          x1={point.x}
          y1={point.y}
          x2={value.anchor.x}
          y2={value.anchor.y}
          opacity={0.65}
          strokeDasharray="4 3"
          strokeWidth={1.25}
          vectorEffect="non-scaling-stroke"
        />
      ))}
      <circle
        cx={value.anchor.x}
        cy={value.anchor.y}
        fill="var(--color-viewport-background)"
        r={3.5}
        strokeWidth={1.5}
        vectorEffect="non-scaling-stroke"
      />
    </g>
  )
}

function SketchLinearPatternPanel({
  configuration,
  handlers,
  value,
}: Readonly<{
  configuration: SketchDrawingConfiguration
  handlers: SketchDrawingViewProps["handlers"]
  value: SketchDrawingViewProps["state"]["linearPattern"]
}>) {
  if (!value) return null
  return (
    <SketchLinearPatternForm
      key={value.selectionKey}
      variables={configuration.variables}
      onApply={handlers.onLinearPatternApply}
      onCancel={handlers.onLinearPatternCancel}
      onPreview={handlers.onLinearPatternPreview}
    />
  )
}

function SketchCircularPatternPanel({
  configuration,
  handlers,
  value,
}: Readonly<{
  configuration: SketchDrawingConfiguration
  handlers: SketchDrawingViewProps["handlers"]
  value: SketchDrawingViewProps["state"]["circularPattern"]
}>) {
  if (!value) return null
  return (
    <SketchCircularPatternForm
      key={value.selectionKey}
      variables={configuration.variables}
      onApply={handlers.onCircularPatternApply}
      onCancel={handlers.onCircularPatternCancel}
      onPreview={handlers.onCircularPatternPreview}
    />
  )
}

function SketchTransformPanel({
  configuration,
  handlers,
  value,
}: Readonly<{
  configuration: SketchDrawingConfiguration
  handlers: SketchDrawingViewProps["handlers"]
  value: SketchDrawingViewProps["state"]["transform"]
}>) {
  if (!value) return null
  return (
    <SketchTransformForm
      value={value}
      variables={configuration.variables}
      onApply={handlers.onTransformApply}
      onCancel={handlers.onTransformCancel}
    />
  )
}

function trimGestureAttribute(active: boolean) {
  return active ? "active" : undefined
}

function sketchContextEntityId(
  target: EventTarget | null,
  draft: SketchRecord | null,
): SketchEntityId | null {
  if (!(target instanceof Element) || !draft) return null
  const entity = target.closest(
    "[data-sketch-entity-id], [data-sketch-external-point-id], [data-sketch-external-line-id]",
  )
  const entityId =
    entity?.getAttribute("data-sketch-entity-id") ??
    entity?.getAttribute("data-sketch-external-point-id") ??
    entity?.getAttribute("data-sketch-external-line-id")
  if (!entityId) return null
  const parsedEntityId = sketchEntityIdSchema.safeParse(entityId)
  if (!parsedEntityId.success) return null
  return (
    selectedSketchConstraintEntities(draft, [parsedEntityId.data]).find(
      ({ id }) => id === parsedEntityId.data,
    )?.id ?? null
  )
}

function sketchContextEntityIds(
  target: EventTarget | null,
  draft: SketchRecord,
  selectedEntityIds: readonly SketchEntityId[],
) {
  const entityId = sketchContextEntityId(target, draft)
  if (!entityId) return selectedEntityIds
  return selectedEntityIds.includes(entityId) ? selectedEntityIds : [entityId]
}

function hasSketchSelectionActions(draft: SketchRecord, entityIds: readonly SketchEntityId[]) {
  return (
    selectedSketchEntities(draft, entityIds).length > 0 ||
    compatibleSketchConstraintToolsForSelection(draft, entityIds).length > 0 ||
    compatibleSketchDimensionToolsForSelection(draft, entityIds).length > 0
  )
}

function sketchContextActionEntityIds(input: {
  draft: SketchRecord | null
  editorTool: SketchEditorTool
  selectedEntityIds: readonly SketchEntityId[]
  target: EventTarget | null
}) {
  if (!input.draft || input.editorTool !== "select") return []
  const entityIds = sketchContextEntityIds(input.target, input.draft, input.selectedEntityIds)
  return hasSketchSelectionActions(input.draft, entityIds) ? entityIds : []
}

function consumeSecondaryContextMenu(input: {
  contextTargetRef: { current: readonly SketchEntityId[] }
  event: MouseEvent<SVGSVGElement>
  replayingRef: { current: boolean }
  secondaryGestureRef: { current: SecondaryPointerGesture | null }
}) {
  if (input.replayingRef.current) {
    input.replayingRef.current = false
    return false
  }
  const gesture = input.secondaryGestureRef.current
  if (gesture?.moved) {
    input.secondaryGestureRef.current = null
    input.contextTargetRef.current = []
    input.event.preventDefault()
    return true
  }
  if (!gesture || gesture.released) {
    input.secondaryGestureRef.current = null
    return false
  }
  input.secondaryGestureRef.current = {
    ...gesture,
    pendingContextMenu: {
      clientX: input.event.clientX,
      clientY: input.event.clientY,
      target:
        input.event.target instanceof Element ? input.event.target : input.event.currentTarget,
    },
  }
  input.event.preventDefault()
  return true
}

function useConstraintRelatedEntityHighlight(sketch: SketchRecord) {
  const [active, setActive] = useState<
    Readonly<Record<ConstraintRelatedEntityInteraction, SketchConstraintId | null>>
  >({ focus: null, hover: null })
  const highlightedConstraintId = active.hover ?? active.focus
  const entityIds = useMemo(() => {
    const constraint = sketch.constraints.find(({ id }) => id === highlightedConstraintId)
    return new Set(constraint ? sketchConstraintEntityIds(constraint) : [])
  }, [highlightedConstraintId, sketch.constraints])
  const onChange = useCallback<ConstraintRelatedEntityChange>((interaction, glyph) => {
    setActive((current) => ({ ...current, [interaction]: glyph?.id ?? null }))
  }, [])
  return { entityIds, onChange }
}

function SketchDrawingView({
  configuration,
  handlers,
  sketch,
  state,
  svgRef,
}: SketchDrawingViewProps) {
  const markerScale = sketchMarkerScale(state.bounds, state.viewportSize)
  const inferenceSources = useMemo(
    () => inferenceSourceEntityIds(state.inference),
    [state.inference],
  )
  const constraintHighlight = useConstraintRelatedEntityHighlight(sketch)
  const contextTargetRef = useRef<readonly SketchEntityId[]>([])
  const secondaryPointerGestureRef = useRef<SecondaryPointerGesture | null>(null)
  const replayingContextMenuRef = useRef(false)
  const [contextEntityIds, setContextEntityIds] = useState<readonly SketchEntityId[]>([])
  const [contextMenuOpen, setContextMenuOpen] = useState(false)
  const handlePointerDownCapture = (event: PointerEvent<SVGSVGElement>) => {
    if (event.button !== 2) return
    secondaryPointerGestureRef.current = {
      clientX: event.clientX,
      clientY: event.clientY,
      moved: false,
      pendingContextMenu: null,
      pointerId: event.pointerId,
      released: false,
    }
  }
  const handlePointerMoveCapture = (event: PointerEvent<SVGSVGElement>) => {
    const gesture = secondaryPointerGestureRef.current
    if (!gesture || gesture.pointerId !== event.pointerId || gesture.moved) return
    const moved =
      Math.hypot(event.clientX - gesture.clientX, event.clientY - gesture.clientY) >
      SECONDARY_DRAG_CONTEXT_MENU_THRESHOLD_PX
    if (!moved) return
    secondaryPointerGestureRef.current = { ...gesture, moved: true }
    contextTargetRef.current = []
    setContextMenuOpen(false)
  }
  const handlePointerUpCapture = (event: PointerEvent<SVGSVGElement>) => {
    const gesture = secondaryPointerGestureRef.current
    if (!gesture || gesture.pointerId !== event.pointerId) return
    const releasedGesture = { ...gesture, released: true }
    secondaryPointerGestureRef.current = releasedGesture
    if (gesture.moved || !gesture.pendingContextMenu) return
    secondaryPointerGestureRef.current = null
    replayingContextMenuRef.current = true
    gesture.pendingContextMenu.target.dispatchEvent(
      new MouseEvent("contextmenu", {
        bubbles: true,
        button: 2,
        cancelable: true,
        clientX: gesture.pendingContextMenu.clientX,
        clientY: gesture.pendingContextMenu.clientY,
      }),
    )
  }
  const handleContextMenuCapture = (event: MouseEvent<SVGSVGElement>) => {
    if (
      consumeSecondaryContextMenu({
        contextTargetRef,
        event,
        replayingRef: replayingContextMenuRef,
        secondaryGestureRef: secondaryPointerGestureRef,
      })
    )
      return
    const entityIds = sketchContextActionEntityIds({
      draft: configuration.draft,
      editorTool: configuration.editorTool,
      selectedEntityIds: configuration.selectedEntityIds,
      target: event.target,
    })
    contextTargetRef.current = entityIds
    if (entityIds.length === 0) event.preventDefault()
  }
  const handleContextMenuOpenChange = (open: boolean) => {
    if (!open) {
      setContextMenuOpen(false)
      return
    }
    const target = contextTargetRef.current
    if (target.length === 0) return
    setContextEntityIds(target)
    setContextMenuOpen(true)
  }
  return (
    <div className="relative size-full">
      <ContextMenu open={contextMenuOpen} onOpenChange={handleContextMenuOpenChange}>
        <ContextMenuTrigger asChild>
          <svg
            ref={svgRef}
            aria-label={configuration.ariaLabel}
            className={`size-full touch-none outline-none focus-visible:ring-2 focus-visible:ring-ring ${usesSketchCrosshairCursor(configuration.editorTool) ? "cursor-crosshair" : ""}`}
            data-sketch-dragging-point-id={state.draggingPointId ?? undefined}
            data-sketch-modification-tool={
              isSketchModificationTool(configuration.editorTool)
                ? configuration.editorTool
                : undefined
            }
            data-sketch-trim-gesture={trimGestureAttribute(state.trimGestureActive)}
            role="img"
            tabIndex={state.editable ? 0 : undefined}
            viewBox={`${state.bounds.minX} ${-state.bounds.minY - state.bounds.height} ${state.bounds.width} ${state.bounds.height}`}
            onKeyDown={handlers.onKeyDown}
            onPointerDownCapture={handlePointerDownCapture}
            onPointerDown={handlers.onCanvasPointerDown}
            onPointerMoveCapture={handlePointerMoveCapture}
            onPointerMove={handlers.onPointerMove}
            onPointerUpCapture={handlePointerUpCapture}
            onPointerUp={handlers.onPointerUp}
            onPointerCancel={handlers.onPointerCancel}
            onPointerLeave={handlers.onPointerLeave}
            onContextMenuCapture={handleContextMenuCapture}
            onWheel={handlers.onWheel}
          >
            <title>{configuration.ariaLabel}</title>
            <SketchOriginPlaneReferences
              activePlane={sketch.plane}
              bounds={state.bounds}
              visibility={configuration.originPlaneVisibility}
            />
            <g transform="scale(1 -1)" className="pointer-events-none stroke-muted-foreground/45">
              <line
                x1={state.bounds.minX}
                y1={0}
                x2={state.bounds.minX + state.bounds.width}
                y2={0}
                vectorEffect="non-scaling-stroke"
              />
              <line
                x1={0}
                y1={state.bounds.minY}
                x2={0}
                y2={state.bounds.minY + state.bounds.height}
                vectorEffect="non-scaling-stroke"
              />
            </g>
            <StableProfileRegions
              editable={state.editable}
              editorTool={configuration.editorTool}
              profiles={state.annotationProfiles}
              selectedProfile={configuration.selectedProfile}
              sketch={sketch}
              solution={state.annotationSolution}
              onSelect={configuration.onProfileSelect}
            />
            <SketchExternalReferenceLayer
              configuration={configuration}
              markerScale={markerScale}
              onSelect={handlers.onSelection}
              state={state}
            />
            <StableSketchGeometry
              draggingPointId={state.draggingPointId ?? state.dragTarget?.entityId ?? null}
              editable={state.editable}
              markerScale={markerScale}
              selectedEntityIds={configuration.selectedEntityIds}
              presentation={state.geometry}
              tool={configuration.editorTool}
              onCurveAction={
                isSketchModificationTool(configuration.editorTool)
                  ? handlers.onCurveAction
                  : ignoreCurveAction
              }
              onPointPointerDown={handlers.onPointPointerDown}
              onSelect={handlers.onSelection}
              onTarget={handlers.appendAt}
              pending={state.pending}
              preselectedEntityId={state.preselectedEntityId}
            />
            <SketchInferenceSourceHighlight
              entityIds={inferenceSources}
              markerScale={markerScale}
              presentation={state.geometry}
            />
            <SketchConstraintRelatedEntityHighlight
              entityIds={constraintHighlight.entityIds}
              markerScale={markerScale}
              presentation={state.geometry}
            />
            <DraggedSketchGeometry
              dragTarget={state.dragTarget}
              presentation={state.geometry}
              selectedEntityIds={configuration.selectedEntityIds}
            />
            <SketchTransformPresentation
              bounds={state.bounds}
              entityIds={configuration.selectedEntityIds}
              geometry={state.geometry}
              transform={state.transform}
              viewportSize={state.viewportSize}
              onStart={handlers.onTransformStart}
            />
            <SketchLinearPatternPresentation
              entityIds={configuration.selectedEntityIds}
              geometry={state.geometry}
              pattern={state.linearPattern}
            />
            <SketchCircularPatternPresentation
              entityIds={configuration.selectedEntityIds}
              geometry={state.geometry}
              pattern={state.circularPattern}
            />
            <SketchDimensionPlacementPreview value={state.dimensionPreview} />
            <PendingPreview cursor={state.cursor} pending={state.pending} sketch={sketch} />
            <InferenceGlyph bounds={state.bounds} inference={state.inference} />
          </svg>
        </ContextMenuTrigger>
        <SketchSelectionContextMenu
          draft={configuration.draft}
          entityIds={contextEntityIds}
          onDraftChange={configuration.onDraftChange}
          onEditorToolChange={configuration.onEditorToolChange}
          onSelectionChange={configuration.onSelectionChange}
          selectedEntityIds={configuration.selectedEntityIds}
        />
      </ContextMenu>
      <SketchDrawingAnnotations
        configuration={configuration}
        dimensionLabelPositions={state.dimensionLabelPositions}
        onEditDimension={handlers.onEditDimension}
        onDimensionPositionChange={handlers.onDimensionPositionChange}
        onRelatedEntitiesChange={constraintHighlight.onChange}
        sketch={sketch}
        state={state}
      />
      <SketchExternalInferenceInstruction candidate={state.externalInferenceCandidate} />
      <SketchUseInstruction editorTool={configuration.editorTool} />
      <SketchMirrorInstruction
        editorTool={configuration.editorTool}
        pending={state.pending}
        selectedEntityCount={configuration.selectedEntityIds.length}
      />
      <SketchOffsetInstruction editorTool={configuration.editorTool} pending={state.pending} />
      <SketchTransformInstruction
        editorTool={configuration.editorTool}
        selectedEntityCount={configuration.selectedEntityIds.length}
      />
      <SketchDimensionInstruction
        draft={configuration.draft}
        editorTool={configuration.editorTool}
        selectedEntityIds={configuration.selectedEntityIds}
      />
      <SketchLinearPatternInstruction
        editorTool={configuration.editorTool}
        selectedEntityCount={configuration.selectedEntityIds.length}
      />
      <SketchCircularPatternInstruction
        editorTool={configuration.editorTool}
        selectedEntityCount={configuration.selectedEntityIds.length}
      />
      <SketchLinearPatternPanel
        configuration={configuration}
        handlers={handlers}
        value={state.linearPattern}
      />
      <SketchCircularPatternPanel
        configuration={configuration}
        handlers={handlers}
        value={state.circularPattern}
      />
      <SketchTransformPanel
        configuration={configuration}
        handlers={handlers}
        value={state.transform}
      />
      <SketchPrecisionToolbar
        anchor={sketchSelectionToolbarAnchor(
          configuration.draft,
          configuration.selectedEntityIds,
          state.geometry,
          state.bounds,
          state.viewportSize,
        )}
        draft={configuration.draft}
        editorTool={configuration.editorTool}
        onDraftChange={configuration.onDraftChange}
        onEditorToolChange={configuration.onEditorToolChange}
        selectedEntityIds={configuration.selectedEntityIds}
      />
    </div>
  )
}

function sketchMarkerScale(bounds: SketchBounds, viewport: SketchViewportSize) {
  const horizontal = viewport.width > 0 ? bounds.width / viewport.width : 1
  const vertical = viewport.height > 0 ? bounds.height / viewport.height : 1
  return Math.max(horizontal, vertical)
}

const sketchPlaneReferenceClass = {
  xy: "stroke-axis-z",
  xz: "stroke-axis-y",
  yz: "stroke-axis-x",
} satisfies Record<ViewerOriginPlane, string>

/**
 * Preserves the origin-reference context without making the SVG drawing plane interactive.
 */
function SketchOriginPlaneReferences({
  activePlane,
  bounds,
  visibility,
}: {
  activePlane: SketchRecord["plane"]
  bounds: SketchBounds
  visibility: ViewerOriginPlaneVisibility
}) {
  const perpendicularPlanes = viewerOriginPlaneReferences(activePlane)
  return (
    <g transform="scale(1 -1)" className="pointer-events-none">
      {visibility[activePlane] ? (
        <rect
          className={`${sketchPlaneReferenceClass[activePlane]} fill-primary/5 opacity-60`}
          data-sketch-origin-plane={activePlane}
          height={bounds.height}
          width={bounds.width}
          x={bounds.minX}
          y={bounds.minY}
          vectorEffect="non-scaling-stroke"
        />
      ) : null}
      {perpendicularPlanes.map(({ axis, plane }) =>
        visibility[plane] ? (
          <line
            key={plane}
            className={`${sketchPlaneReferenceClass[plane]} opacity-50`}
            data-sketch-origin-plane={plane}
            vectorEffect="non-scaling-stroke"
            {...(axis === "horizontal"
              ? {
                  x1: bounds.minX,
                  x2: bounds.minX + bounds.width,
                  y1: 0,
                  y2: 0,
                }
              : {
                  x1: 0,
                  x2: 0,
                  y1: bounds.minY,
                  y2: bounds.minY + bounds.height,
                })}
          />
        ) : null,
      )}
    </g>
  )
}

function viewerOriginPlaneReferences(activePlane: ViewerOriginPlane) {
  const references: Record<
    ViewerOriginPlane,
    readonly { axis: "horizontal" | "vertical"; plane: ViewerOriginPlane }[]
  > = {
    xy: [
      { plane: "xz", axis: "horizontal" },
      { plane: "yz", axis: "vertical" },
    ],
    xz: [
      { plane: "xy", axis: "horizontal" },
      { plane: "yz", axis: "vertical" },
    ],
    yz: [
      { plane: "xy", axis: "horizontal" },
      { plane: "xz", axis: "vertical" },
    ],
  }
  return references[activePlane]
}

function SketchExternalInferenceInstruction({
  candidate,
}: Readonly<{
  candidate: ExternalWakeupCandidate | null
}>) {
  const t = useTranslations("app.sketch.viewport")
  if (!candidate) return null
  return (
    <div
      className="pointer-events-none absolute left-1/2 top-3 -translate-x-1/2 rounded-md border border-amber-500/50 bg-background/90 px-3 py-2 text-xs font-medium shadow-sm"
      data-sketch-external-inference-label={candidate.label}
      role="status"
    >
      {t("externalInferenceSource", { label: candidate.label })}
    </div>
  )
}

function SketchUseInstruction({ editorTool }: Readonly<{ editorTool: SketchEditorTool }>) {
  const t = useTranslations("app.shell.viewport")
  if (editorTool !== "use") return null
  return (
    <div
      className="pointer-events-none absolute left-1/2 top-3 -translate-x-1/2 rounded-md border bg-background/90 px-3 py-2 text-xs font-medium shadow-sm"
      data-sketch-use-instruction
      role="status"
    >
      {t("sketchReferenceSelection")}
    </div>
  )
}

function SketchMirrorInstruction({
  editorTool,
  pending,
  selectedEntityCount,
}: Readonly<{
  editorTool: SketchEditorTool
  pending: PendingGeometry | null
  selectedEntityCount: number
}>) {
  const t = useTranslations("app.sketch.viewport")
  if (editorTool !== "mirror") return null
  let instruction = t("mirrorSelectAxis")
  if (pending?.kind === "mirror-sources") instruction = t("mirrorSelectSources")
  else if (selectedEntityCount > 0) instruction = t("mirrorSelectAxisForSelection")
  return (
    <div
      className="pointer-events-none absolute left-1/2 top-3 -translate-x-1/2 rounded-md border bg-background/90 px-3 py-2 text-xs font-medium shadow-sm"
      data-sketch-mirror-instruction
      role="status"
    >
      {instruction}
    </div>
  )
}

function SketchOffsetInstruction({
  editorTool,
  pending,
}: Readonly<{
  editorTool: SketchEditorTool
  pending: PendingGeometry | null
}>) {
  const t = useTranslations("app.sketch.viewport")
  if (editorTool !== "offset") return null
  const instruction =
    pending?.kind === "offset-distance" ? t("offsetSetDistance") : t("offsetSelectSource")
  return (
    <div
      className="pointer-events-none absolute left-1/2 top-3 -translate-x-1/2 rounded-md border bg-background/90 px-3 py-2 text-xs font-medium shadow-sm"
      data-sketch-offset-instruction
      role="status"
    >
      {instruction}
    </div>
  )
}

function SketchTransformInstruction({
  editorTool,
  selectedEntityCount,
}: Readonly<{
  editorTool: SketchEditorTool
  selectedEntityCount: number
}>) {
  const t = useTranslations("app.sketch.viewport")
  if (editorTool !== "transform") return null
  return (
    <div
      className="pointer-events-none absolute left-1/2 top-3 -translate-x-1/2 rounded-md border bg-background/90 px-3 py-2 text-xs font-medium shadow-sm"
      data-sketch-transform-instruction
      role="status"
    >
      {t(selectedEntityCount > 0 ? "transformAdjust" : "transformSelectGeometry")}
    </div>
  )
}

function SketchDimensionInstruction({
  draft,
  editorTool,
  selectedEntityIds,
}: Readonly<{
  draft: SketchRecord | null
  editorTool: SketchEditorTool
  selectedEntityIds: readonly SketchEntityId[]
}>) {
  const t = useTranslations("app.sketch.viewport")
  const ready = useMemo(() => {
    if (!draft || editorTool !== "dimension") return false
    return compatibleSketchDimensionToolsForSelection(draft, selectedEntityIds).length > 0
  }, [draft, editorTool, selectedEntityIds])

  if (editorTool !== "dimension") return null
  return (
    <div
      className="pointer-events-none absolute left-1/2 top-3 -translate-x-1/2 rounded-md border bg-background/90 px-3 py-2 text-xs font-medium shadow-sm"
      data-sketch-dimension-instruction
      role="status"
    >
      {t(ready ? "dimensionPlace" : "dimensionSelectGeometry")}
    </div>
  )
}

function SketchLinearPatternInstruction({
  editorTool,
  selectedEntityCount,
}: Readonly<{
  editorTool: SketchEditorTool
  selectedEntityCount: number
}>) {
  const t = useTranslations("app.sketch.viewport")
  if (editorTool !== "linear-pattern") return null
  return (
    <div
      className="pointer-events-none absolute left-1/2 top-3 -translate-x-1/2 rounded-md border bg-background/90 px-3 py-2 text-xs font-medium shadow-sm"
      data-sketch-linear-pattern-instruction
      role="status"
    >
      {t(selectedEntityCount > 0 ? "linearPatternAdjust" : "linearPatternSelectGeometry")}
    </div>
  )
}

function SketchCircularPatternInstruction({
  editorTool,
  selectedEntityCount,
}: Readonly<{
  editorTool: SketchEditorTool
  selectedEntityCount: number
}>) {
  const t = useTranslations("app.sketch.viewport")
  if (editorTool !== "circular-pattern") return null
  return (
    <div
      className="pointer-events-none absolute left-1/2 top-3 -translate-x-1/2 rounded-md border bg-background/90 px-3 py-2 text-xs font-medium shadow-sm"
      data-sketch-circular-pattern-instruction
      role="status"
    >
      {t(selectedEntityCount > 0 ? "circularPatternAdjust" : "circularPatternSelectGeometry")}
    </div>
  )
}

function useSketchPlacementPresentation({
  draft,
  editorTool,
  selectedEntityIds,
  sketchId,
}: Pick<SketchDrawingConfiguration, "draft" | "editorTool" | "selectedEntityIds"> & {
  sketchId: SketchRecord["id"]
}) {
  const [cursor, setCursor] = useState<SketchPoint2 | null>(null)
  const [inference, setInference] = useState<SketchPointInference | null>(null)
  const [pending, setPending] = useState<PendingGeometry | null>(null)

  useEffect(() => {
    setPending(null)
    setInference(null)
  }, [editorTool, sketchId])

  const slotFromSelectionLineId =
    editorTool === "slot-from-selection" && draft
      ? selectedSketchLineId(draft, selectedEntityIds)
      : null
  useEffect(() => {
    if (editorTool !== "slot-from-selection") return
    setPending(
      slotFromSelectionLineId
        ? { kind: "slot-from-selection-width", lineId: slotFromSelectionLineId }
        : null,
    )
    setInference(null)
  }, [editorTool, slotFromSelectionLineId])

  const offsetSourceLineIds = useMemo(() => {
    if (editorTool !== "offset" || !draft || selectedEntityIds.length === 0) return []
    const selected = selectedSketchEntities(draft, selectedEntityIds)
    return selected.length === selectedEntityIds.length &&
      selected.every(({ type }) => type === "line")
      ? selected.map(({ id }) => id)
      : []
  }, [draft, editorTool, selectedEntityIds])
  useEffect(() => {
    const referenceLineId = offsetSourceLineIds[0]
    if (editorTool !== "offset" || !referenceLineId) return
    setPending((current) =>
      current?.kind === "offset-distance"
        ? current
        : { kind: "offset-distance", lineIds: offsetSourceLineIds, referenceLineId },
    )
    setInference(null)
  }, [editorTool, offsetSourceLineIds])

  return { cursor, inference, pending, setCursor, setInference, setPending }
}

function useSketchPatternInteraction<Definition>({
  defaultDefinition,
  draft,
  editorTool,
  materialize,
  onDraftChange,
  onEditorToolChange,
  onSelectionChange,
  selectedEntityIds,
  sketchId,
  tool,
}: Pick<
  SketchDrawingConfiguration,
  | "draft"
  | "editorTool"
  | "onDraftChange"
  | "onEditorToolChange"
  | "onSelectionChange"
  | "selectedEntityIds"
> & {
  defaultDefinition: Definition
  materialize: (
    draft: SketchRecord,
    entityIds: readonly SketchEntityId[],
    definition: Definition,
  ) => Readonly<{ sketch: SketchRecord }> | null
  sketchId: SketchRecord["id"]
  tool: "circular-pattern" | "linear-pattern"
}) {
  const [definition, setDefinition] = useState<Definition | null>(defaultDefinition)
  const selectionKey = selectedEntityIds.join(":")

  const reset = () => setDefinition(defaultDefinition)

  useEffect(() => {
    reset()
  }, [editorTool, sketchId])

  const commit = (value = definition) => {
    if (!draft || !value || selectedEntityIds.length === 0) return false
    const result = materialize(draft, selectedEntityIds, value)
    if (!result) return false
    onDraftChange(result.sketch, "record")
    onSelectionChange([])
    reset()
    onEditorToolChange("select")
    return true
  }

  const cancel = () => {
    reset()
    onEditorToolChange("select")
  }

  const consumeKeyDown = (event: KeyboardEvent<SVGSVGElement>) => {
    if (editorTool !== tool) return false
    if (event.key === "Escape") {
      event.preventDefault()
      cancel()
      return true
    }
    if (event.key === "Enter") {
      event.preventDefault()
      commit()
      return true
    }
    return false
  }

  const consumeCanvasPointerDown = (event: PointerEvent<SVGSVGElement>) => {
    if (editorTool !== tool || !isPrimaryEmptyCanvasPointer(event)) return false
    if (selectedEntityIds.length === 0) onSelectionChange([])
    else commit()
    return true
  }

  const selectEntity = (event: PointerEvent<SVGElement>, entityId: SketchEntityId) => {
    const additive = event.metaKey || event.ctrlKey || event.shiftKey
    onSelectionChange(toggleSelection(selectedEntityIds, entityId, additive))
  }

  return {
    apply: commit,
    cancel,
    consumeCanvasPointerDown,
    consumeKeyDown,
    preview: setDefinition,
    presentation:
      editorTool === tool && selectedEntityIds.length > 0 ? { definition, selectionKey } : null,
    selectEntity,
  }
}

function useSketchTransformInteraction({
  bounds,
  draft,
  editorTool,
  onDraftChange,
  onEditorToolChange,
  onSelectionChange,
  selectedEntityIds,
  sketchId,
  svgRef,
}: Pick<
  SketchDrawingConfiguration,
  | "draft"
  | "editorTool"
  | "onDraftChange"
  | "onEditorToolChange"
  | "onSelectionChange"
  | "selectedEntityIds"
> & {
  bounds: SketchBounds
  sketchId: SketchRecord["id"]
  svgRef: RefObject<SVGSVGElement | null>
}) {
  const [gesture, setGesture] = useState<SketchTransformGesture | null>(null)
  const [originOverride, setOriginOverride] = useState<SketchPoint2 | null>(null)
  const [preview, setPreview] = useState<SketchTransformPreview>(identitySketchTransform)
  const rectangleRef = useRef<SketchViewportRectangle | null>(null)
  const selectionKey = selectedEntityIds.join(":")
  const defaultOrigin = useMemo(
    () => (editorTool === "transform" ? safeSketchTransformOrigin(draft, selectedEntityIds) : null),
    [draft, editorTool, selectedEntityIds],
  )
  const origin = originOverride ?? defaultOrigin

  const reset = () => {
    setGesture(null)
    setOriginOverride(null)
    setPreview(identitySketchTransform)
    rectangleRef.current = null
  }

  useEffect(() => {
    reset()
  }, [editorTool, selectionKey, sketchId])

  const commit = (value?: SketchTransformExactValue) => {
    const transform = value ?? (origin ? { origin, preview } : null)
    if (
      !draft ||
      !transform ||
      selectedEntityIds.length === 0 ||
      isIdentitySketchTransform(transform.preview)
    ) {
      return false
    }
    try {
      const transformed = transformSketchEntities(draft, {
        entityIds: selectedEntityIds,
        transform: sketchEntityTransformFromPreview(transform.origin, transform.preview),
      })
      onDraftChange(transformed, "record")
      onSelectionChange([])
      reset()
      onEditorToolChange("select")
      return true
    } catch {
      return false
    }
  }

  const consumePointerMove = (event: PointerEvent<SVGSVGElement>) => {
    if (gesture?.pointerId !== event.pointerId) return false
    const rectangle = rectangleRef.current
    if (rectangle && draft) {
      const point = pointerToSketchPoint(event, rectangle, bounds)
      if (gesture.handle === "origin") {
        const worldPerPixel = Math.max(
          bounds.width / rectangle.width,
          bounds.height / rectangle.height,
        )
        const snapTolerance = worldPerPixel * 10
        const snappedPoint = nearestDisplayedSketchPoint(
          draft,
          point,
          gesture.origin,
          gesture.base,
          snapTolerance,
        )
        const relocated = relocateSketchTransformOrigin(
          gesture.origin,
          gesture.base,
          snappedPoint ?? point,
        )
        setOriginOverride(relocated.origin)
        setPreview(relocated.preview)
        return true
      }
      setPreview(updateSketchTransformGesture(gesture, point, event.shiftKey))
    }
    return true
  }

  const consumeKeyDown = (event: KeyboardEvent<SVGSVGElement>) => {
    if (editorTool !== "transform") return false
    if (event.key === "Escape") {
      event.preventDefault()
      reset()
      onEditorToolChange("select")
      return true
    }
    if (event.key === "Enter") {
      event.preventDefault()
      if (!commit()) onEditorToolChange("select")
      return true
    }
    if (!origin) return false
    const nextTransform = updateSketchTransformFromKeyboard(preview, event.key, event.shiftKey)
    if (!nextTransform) return false
    event.preventDefault()
    setPreview(nextTransform)
    return true
  }

  const cancel = () => {
    reset()
    onEditorToolChange("select")
  }

  const consumeCanvasPointerDown = (event: PointerEvent<SVGSVGElement>) => {
    if (editorTool !== "transform" || !isPrimaryEmptyCanvasPointer(event)) return false
    if (!commit()) onSelectionChange([])
    return true
  }

  const consumePointerUp = (event: PointerEvent<SVGSVGElement>) => {
    if (gesture?.pointerId !== event.pointerId) return false
    setGesture(null)
    rectangleRef.current = null
    return true
  }

  const selectEntity = (event: PointerEvent<SVGElement>, entityId: SketchEntityId) => {
    if (!isIdentitySketchTransform(preview)) return
    const additive = event.metaKey || event.ctrlKey || event.shiftKey
    onSelectionChange(toggleSelection(selectedEntityIds, entityId, additive))
  }

  const start = (event: PointerEvent<SVGElement>, handle: SketchTransformHandle) => {
    const rectangle = svgRef.current?.getBoundingClientRect()
    if (!rectangle || rectangle.width <= 0 || rectangle.height <= 0 || !origin) return
    if (event.nativeEvent.isTrusted) event.currentTarget.setPointerCapture(event.pointerId)
    const viewportRectangle = {
      height: rectangle.height,
      left: rectangle.left,
      top: rectangle.top,
      width: rectangle.width,
    }
    rectangleRef.current = viewportRectangle
    setGesture({
      base: preview,
      center: sketchTransformCenter(origin, preview),
      handle,
      origin,
      pointerId: event.pointerId,
      start: pointerToSketchPoint(event, viewportRectangle, bounds),
    })
  }

  return {
    consumeCanvasPointerDown,
    consumeKeyDown,
    consumePointerMove,
    consumePointerUp,
    applyExact: commit,
    cancel,
    presentation: editorTool === "transform" && origin ? { origin, preview } : null,
    selectEntity,
    start,
  }
}

function useSketchModificationInteractions(
  input: Pick<
    SketchDrawingConfiguration,
    | "draft"
    | "editorTool"
    | "onDraftChange"
    | "onEditorToolChange"
    | "onSelectionChange"
    | "selectedEntityIds"
  > & {
    bounds: SketchBounds
    sketchId: SketchRecord["id"]
    svgRef: RefObject<SVGSVGElement | null>
  },
) {
  return {
    circularPattern: useSketchPatternInteraction({
      ...input,
      defaultDefinition: defaultCircularSketchPatternDefinition,
      materialize: safeCircularPatternSketchEntities,
      tool: "circular-pattern",
    }),
    linearPattern: useSketchPatternInteraction({
      ...input,
      defaultDefinition: defaultLinearSketchPatternDefinition,
      materialize: safeLinearPatternSketchEntities,
      tool: "linear-pattern",
    }),
    transform: useSketchTransformInteraction(input),
  }
}

function useSketchInferencePresentation(input: {
  cellSize: number
  draft: SketchRecord | null
  editorTool: SketchEditorTool
  externalCandidates: readonly ExternalSketchGeometryCandidate[]
  externalModelCandidates: readonly ExternalModelGeometryCandidate[]
  geometry: SketchGeometryPresentation
  inference: SketchPointInference | null
}) {
  const wakeupInferenceIdRegistry = useRef<ExternalWakeupInferenceIdRegistry>(new Map())
  const baseReferences = useMemo(
    () => (input.draft ? sketchInferenceReferences(input.geometry) : EMPTY_INFERENCE_REFERENCES),
    [input.draft, input.geometry],
  )
  const wakeupReferences = useMemo(
    () =>
      input.draft &&
      (supportsPersistentPointRelations(input.editorTool) ||
        supportsExternalPointDragInference(input.editorTool))
        ? externalWakeupReferences(
            input.externalCandidates,
            input.externalModelCandidates,
            input.draft,
            wakeupInferenceIdRegistry.current,
          )
        : EMPTY_EXTERNAL_WAKEUP_REFERENCES,
    [input.draft, input.editorTool, input.externalCandidates, input.externalModelCandidates],
  )
  const placementReferences = useMemo(
    () => mergeSketchInferenceReferences(baseReferences, wakeupReferences),
    [baseReferences, wakeupReferences],
  )
  const dragCandidateQuery = useMemo(
    () =>
      createSketchInferenceCandidateQuery({
        arcs: baseReferences.arcs,
        cellSize: input.cellSize,
        curves: placementReferences.curves,
        lines: placementReferences.lines,
        points: placementReferences.points,
      }),
    [baseReferences.arcs, input.cellSize, placementReferences],
  )
  const placementCandidateQuery = useMemo(
    () =>
      createSketchInferenceCandidateQuery({
        cellSize: input.cellSize,
        lines: placementReferences.lines,
        points: placementReferences.points,
      }),
    [input.cellSize, placementReferences],
  )
  const externalInferenceCandidate = useMemo(
    () =>
      externalWakeupCandidateForInference(
        input.inference,
        wakeupReferences.candidatesByInferenceId,
      ),
    [input.inference, wakeupReferences.candidatesByInferenceId],
  )
  return {
    baseReferences,
    dragCandidateQuery,
    externalInferenceCandidate,
    externalCandidatesByInferenceId: wakeupReferences.candidatesByInferenceId,
    placementCandidateQuery,
    references: placementReferences,
  }
}

function useExternalReferenceInteraction({
  candidates,
  draft,
  editorTool,
  modelCandidates,
  onDraftChange,
  onEditorToolChange,
  repairReferenceId,
  selectedEntityIds,
}: Pick<
  SketchDrawingConfiguration,
  | "draft"
  | "editorTool"
  | "onDraftChange"
  | "onEditorToolChange"
  | "repairReferenceId"
  | "selectedEntityIds"
> & {
  candidates: readonly ExternalSketchGeometryCandidate[]
  modelCandidates: readonly ExternalModelGeometryCandidate[]
}) {
  const contextCandidates = useMemo(() => {
    return availableExternalSketchGeometryCandidates(candidates, draft, repairReferenceId)
  }, [candidates, draft, repairReferenceId])
  const availableCandidates = useMemo(
    () =>
      editorTool === "select" || editorTool === "use"
        ? [...contextCandidates, ...modelCandidates]
        : [],
    [contextCandidates, editorTool, modelCandidates],
  )
  const use = useCallback(
    (candidate: ExternalUseCandidate) => {
      if (!draft) return
      const next =
        candidate.kind === "model-point" ||
        candidate.kind === "model-line" ||
        candidate.kind === "model-curve"
          ? applyExternalModelCandidateSelection(
              draft,
              candidate,
              selectedEntityIds,
              repairReferenceId,
            )
          : applyExternalSketchCandidateSelection(
              draft,
              candidate,
              selectedEntityIds,
              repairReferenceId,
            )
      if (next !== draft) {
        onDraftChange(next)
        if (repairReferenceId) onEditorToolChange("select")
      }
    },
    [draft, onDraftChange, onEditorToolChange, repairReferenceId, selectedEntityIds],
  )
  return { availableCandidates, contextCandidates, use }
}

function sketchSplitActions({
  draft,
  eventPoint,
  pending,
  publish,
  sketch,
  setCursor,
  setPending,
}: Readonly<{
  draft: SketchRecord | null
  eventPoint: (event: PointerEvent<SVGElement>) => SketchPoint2 | null
  pending: PendingGeometry | null
  publish: (draft: SketchRecord) => void
  sketch: SketchRecord
  setCursor: Dispatch<SetStateAction<SketchPoint2 | null>>
  setPending: Dispatch<SetStateAction<PendingGeometry | null>>
}>) {
  const splitCircle = (circle: Extract<SketchEntity, { type: "circle" }>, point: SketchPoint2) => {
    const projectedPoint = projectedCirclePoint(draft ?? sketch, circle, point)
    if (!projectedPoint) return
    if (pending?.kind !== "split-circle-second" || pending.circleId !== circle.id) {
      setPending({ kind: "split-circle-second", circleId: circle.id, firstPoint: projectedPoint })
      setCursor(projectedPoint)
      return
    }
    const nextDraft = draft
      ? safeCircleSplitUpdate(draft, circle.id, pending.firstPoint, projectedPoint)
      : null
    if (nextDraft) publish(nextDraft)
  }
  const splitEllipse = (
    ellipse: Extract<SketchEntity, { type: "ellipse" }>,
    point: SketchPoint2,
  ) => {
    const projectedPoint = projectedEllipsePoint(draft ?? sketch, ellipse, point)
    if (!projectedPoint) return
    if (pending?.kind !== "split-ellipse-second" || pending.ellipseId !== ellipse.id) {
      setPending({
        kind: "split-ellipse-second",
        ellipseId: ellipse.id,
        firstPoint: projectedPoint,
      })
      setCursor(projectedPoint)
      return
    }
    const nextDraft = draft
      ? safeEllipseSplitUpdate(draft, ellipse.id, pending.firstPoint, projectedPoint)
      : null
    if (nextDraft) publish(nextDraft)
  }
  return { eventPoint, splitCircle, splitEllipse }
}

function applyMirrorAction({
  draft,
  entityId,
  pending,
  publish,
  selectedEntityIds,
  setInference,
  setPending,
  onSelectionChange,
}: Readonly<{
  draft: SketchRecord | null
  entityId: SketchEntityId
  pending: PendingGeometry | null
  publish: (result: ReturnType<typeof mirrorSketchEntities>, keepSelectingSources: boolean) => void
  selectedEntityIds: readonly SketchEntityId[]
  setInference: Dispatch<SetStateAction<SketchPointInference | null>>
  setPending: Dispatch<SetStateAction<PendingGeometry | null>>
  onSelectionChange: (entityIds: readonly SketchEntityId[]) => void
}>) {
  if (!draft) return
  const resolution = resolveMirrorAction({ draft, entityId, pending, selectedEntityIds })
  if (resolution?.kind === "select-sources") {
    onSelectionChange([])
    setInference(null)
    setPending({ axisLineId: resolution.axisLineId, kind: "mirror-sources" })
    return
  }
  if (resolution) publish(resolution.result, resolution.keepSelectingSources)
}

type SketchDimensionEditorState =
  | Readonly<{
      anchor: SketchPoint2
      entityIds: readonly SketchEntityId[]
      initialKind: SketchDimensionKind
      kind: "create"
    }>
  | Readonly<{
      anchor: SketchPoint2
      constraintId: SketchConstraintId
      initialKind: SketchDimensionKind
      kind: "edit"
    }>

type DimensionKindLabelKey =
  | "dimensionKindAngle"
  | "dimensionKindDiameter"
  | "dimensionKindDistance"
  | "dimensionKindHorizontalDistance"
  | "dimensionKindOffset"
  | "dimensionKindPrimaryAxisDiameter"
  | "dimensionKindRadius"
  | "dimensionKindSecondaryAxisDiameter"
  | "dimensionKindVerticalDistance"

function dimensionKindLabels(t: (key: DimensionKindLabelKey) => string) {
  return {
    angle: t("dimensionKindAngle"),
    diameter: t("dimensionKindDiameter"),
    distance: t("dimensionKindDistance"),
    "horizontal-distance": t("dimensionKindHorizontalDistance"),
    offset: t("dimensionKindOffset"),
    "primary-axis-diameter": t("dimensionKindPrimaryAxisDiameter"),
    radius: t("dimensionKindRadius"),
    "secondary-axis-diameter": t("dimensionKindSecondaryAxisDiameter"),
    "vertical-distance": t("dimensionKindVerticalDistance"),
  } satisfies Record<SketchDimensionKind, string>
}

type SketchDimensionLabels = ReturnType<typeof dimensionKindLabels>

function createSketchDimensionGeometry(
  geometry: SketchGeometryPresentation,
  entities: readonly SketchEntity[],
): SketchDimensionGeometry {
  const points = new Map(
    [...geometry.points, ...geometry.externalPoints].map((point) => [point.id, point]),
  )
  return {
    entities,
    point: (id) => points.get(id) ?? null,
    solvedCircleRadius: (id) => geometry.solvedCircles.get(id) ?? null,
  }
}

function useSketchDimensionPresentation({
  configuration,
  cursor,
  editor,
  geometry,
  sketch,
}: Readonly<{
  configuration: SketchDrawingConfiguration
  cursor: SketchPoint2 | null
  editor: SketchDimensionEditorState | null
  geometry: SketchGeometryPresentation
  sketch: SketchRecord
}>) {
  const t = useTranslations("app.sketch.viewport")
  const selectedEntities = useMemo(
    () =>
      selectedSketchConstraintEntities(
        configuration.draft ?? sketch,
        configuration.selectedEntityIds,
      ),
    [configuration.draft, configuration.selectedEntityIds, sketch],
  )
  const activeSketch = configuration.draft ?? sketch
  const dimensionGeometry = useMemo(
    () => createSketchDimensionGeometry(geometry, selectedEntities),
    [geometry, selectedEntities],
  )
  const labels = useMemo(() => dimensionKindLabels(t), [t])
  const options = useMemo<readonly SketchDimensionOption[]>(
    () =>
      compatibleSketchDimensionToolsForSelection(
        activeSketch,
        configuration.selectedEntityIds,
      ).flatMap((kind) => {
        const value = sketchDimensionCanonicalValue(kind, dimensionGeometry)
        return value === null ? [] : [{ kind, label: labels[kind], value }]
      }),
    [activeSketch, configuration.selectedEntityIds, dimensionGeometry, labels],
  )
  const preview = useMemo(() => {
    if (configuration.editorTool !== "dimension" || options.length === 0) return null
    const anchor = editor?.kind === "create" ? editor.anchor : cursor
    if (!anchor) return null
    const kind =
      editor?.kind === "create"
        ? editor.initialKind
        : inferSketchDimensionKind(
            options.map((option) => option.kind),
            dimensionGeometry,
            anchor,
          )
    return kind
      ? { anchor, witnesses: sketchDimensionWitnessPoints(kind, dimensionGeometry) }
      : null
  }, [configuration.editorTool, cursor, dimensionGeometry, editor, options])
  return { dimensionGeometry, labels, options, preview }
}

function editedDimensionConstraint(editor: SketchDimensionEditorState, sketch: SketchRecord) {
  if (editor.kind !== "edit") return null
  return sketch.constraints.find(({ id }) => id === editor.constraintId) ?? null
}

function dimensionEditorOptions(
  editor: SketchDimensionEditorState,
  constraint: SketchRecord["constraints"][number] | null,
  labels: SketchDimensionLabels,
  options: readonly SketchDimensionOption[],
): readonly SketchDimensionOption[] {
  if (editor.kind !== "edit" || !constraint || !("value" in constraint)) return options
  return [
    {
      kind: editor.initialKind,
      label: labels[editor.initialKind],
      value: constraint.value.value,
    },
  ]
}

function SketchDimensionEditorOverlay({
  bounds,
  configuration,
  editor,
  labels,
  moveLabel,
  onClose,
  options,
  viewportSize,
}: Readonly<{
  bounds: SketchBounds
  configuration: SketchDrawingConfiguration
  editor: SketchDimensionEditorState
  labels: SketchDimensionLabels
  moveLabel: (constraintId: SketchConstraintId, point: SketchPoint2) => void
  onClose: () => void
  options: readonly SketchDimensionOption[]
  viewportSize: SketchViewportSize
}>) {
  const displayUnits = useDocumentDisplayUnits()
  const draft = configuration.draft
  if (!draft) return null
  const editedConstraint = editedDimensionConstraint(editor, draft)
  const editorOptions = dimensionEditorOptions(editor, editedConstraint, labels, options)
  if (editorOptions.length === 0) return null
  const submit = (result: SketchDimensionInlineEditorResult) => {
    if (result.kind === "create") {
      const nextDraft = appendSketchConstraint(
        draft,
        result.definition,
        createBrowserSketchConstraintId,
      )
      const previousIds = new Set(draft.constraints.map(({ id }) => id))
      const created = nextDraft.constraints.find(({ id }) => !previousIds.has(id))
      if (created) moveLabel(created.id, editor.anchor)
      configuration.onDraftChange(nextDraft)
      configuration.onSelectionChange([])
    } else if (editor.kind === "edit") {
      configuration.onDraftChange(setSketchDimensionValue(draft, editor.constraintId, result.value))
      configuration.onConstraintSelectionChange(null)
    }
    onClose()
  }
  return (
    <SketchDimensionInlineEditor
      key={`${editor.kind}:${editor.kind === "edit" ? editor.constraintId : editor.entityIds.join(":")}`}
      displayUnits={displayUnits}
      entities={
        editor.kind === "create" ? selectedSketchConstraintEntities(draft, editor.entityIds) : []
      }
      {...(editor.kind === "edit" && editedConstraint
        ? { initialExpression: drivingDimensionLabel(editedConstraint) ?? "" }
        : {})}
      initialKind={editor.initialKind}
      mode={editor.kind}
      options={editorOptions}
      position={inlineDimensionEditorPosition(editor.anchor, bounds, viewportSize)}
      variables={configuration.variables}
      onCancel={onClose}
      onSubmit={submit}
    />
  )
}

function creationPrecisionOption(
  step: SketchCreationPrecisionStep,
  draft: SketchRecord,
  geometry: SketchGeometryPresentation,
  labels: SketchDimensionLabels,
): SketchDimensionOption | null {
  const available = compatibleSketchDimensionToolsForSelection(draft, step.entityIds)
  if (!available.includes(step.initialKind)) return null
  const entities = selectedSketchConstraintEntities(draft, step.entityIds)
  const value = sketchDimensionCanonicalValue(
    step.initialKind,
    createSketchDimensionGeometry(geometry, entities),
  )
  return value === null ? null : { kind: step.initialKind, label: labels[step.initialKind], value }
}

function SketchCreationPrecisionOverlay({
  bounds,
  configuration,
  editing,
  geometry,
  moveLabel,
  onActivate,
  onAdvance,
  onClose,
  request,
  viewportSize,
}: Readonly<{
  bounds: SketchBounds
  configuration: SketchDrawingConfiguration
  editing: boolean
  geometry: SketchGeometryPresentation
  moveLabel: (constraintId: SketchConstraintId, point: SketchPoint2) => void
  onActivate: () => void
  onAdvance: () => void
  onClose: () => void
  request: SketchCreationPrecisionRequest
  viewportSize: SketchViewportSize
}>) {
  const t = useTranslations("app.sketch.viewport")
  const labels = useMemo(() => dimensionKindLabels(t), [t])
  const displayUnits = useDocumentDisplayUnits()
  const draft = configuration.draft
  if (!draft) return null
  const step = request.steps[request.activeStep]
  if (!step) return null
  const option = creationPrecisionOption(step, draft, geometry, labels)
  if (!option) return null
  const position = inlineDimensionEditorPosition(step.anchor, bounds, viewportSize)
  if (!editing) {
    const value = defaultSketchDimensionExpression(option.kind, option.value, displayUnits)
    const label = t("creationPrecisionSetExact", { kind: option.label, value })
    const affordance = (
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label={label}
            className="absolute z-40 inline-flex max-w-52 -translate-y-1/2 items-center gap-1.5 rounded-md border border-border/80 bg-popover/95 px-2 py-1 text-xs text-popover-foreground shadow-sm backdrop-blur-sm hover:border-primary/60 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            data-sketch-creation-precision-trigger
            style={position}
            onClick={onActivate}
          >
            <Ruler aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />
            <span className="truncate">{option.label}</span>
            <span className="shrink-0 font-mono tabular-nums text-muted-foreground">{value}</span>
          </button>
        </TooltipTrigger>
        <TooltipContent>{label}</TooltipContent>
      </Tooltip>
    )
    return typeof document === "undefined" ? affordance : createPortal(affordance, document.body)
  }
  const submit = (result: SketchDimensionInlineEditorResult) => {
    if (result.kind !== "create") return
    const nextDraft = appendSketchConstraint(
      draft,
      result.definition,
      createBrowserSketchConstraintId,
    )
    const previousIds = new Set(draft.constraints.map(({ id }) => id))
    const created = nextDraft.constraints.find(({ id }) => !previousIds.has(id))
    if (created) moveLabel(created.id, step.anchor)
    configuration.onDraftChange(nextDraft, "replace")
    if (request.activeStep + 1 < request.steps.length) onAdvance()
    else onClose()
  }
  return (
    <SketchDimensionInlineEditor
      key={`${request.activeStep}:${step.entityIds.join(":")}`}
      allowReference={false}
      displayUnits={displayUnits}
      entities={selectedSketchConstraintEntities(draft, step.entityIds)}
      expressionAriaLabel={t("creationPrecisionExpression")}
      formAriaLabel={t("creationPrecisionInlineEditor")}
      initialKind={step.initialKind}
      mode="create"
      onCancel={onClose}
      onSubmit={submit}
      options={[option]}
      position={position}
      variables={configuration.variables}
    />
  )
}

function useSketchCreationPrecision({
  bounds,
  configuration,
  geometry,
  moveLabel,
  svgRef,
  viewportSize,
}: Readonly<{
  bounds: SketchBounds
  configuration: SketchDrawingConfiguration
  geometry: SketchGeometryPresentation
  moveLabel: (constraintId: SketchConstraintId, point: SketchPoint2) => void
  svgRef: RefObject<SVGSVGElement | null>
  viewportSize: SketchViewportSize
}>) {
  const [request, setRequestState] = useState<SketchCreationPrecisionRequest | null>(null)
  const [editing, setEditing] = useState(false)
  const setRequest = useCallback<Dispatch<SetStateAction<SketchCreationPrecisionRequest | null>>>(
    (next) => {
      setEditing(false)
      setRequestState(next)
    },
    [],
  )
  const close = useCallback(() => {
    setEditing(false)
    setRequestState(null)
    requestAnimationFrame(() => svgRef.current?.focus())
  }, [svgRef])
  const advance = useCallback(() => {
    setRequestState((current) =>
      current ? { ...current, activeStep: current.activeStep + 1 } : null,
    )
  }, [])
  useEffect(() => {
    setEditing(false)
    setRequestState((current) =>
      current?.retainForTool === configuration.editorTool ? current : null,
    )
  }, [configuration.editorTool])

  return {
    overlay: request ? (
      <SketchCreationPrecisionOverlay
        bounds={bounds}
        configuration={configuration}
        editing={editing}
        geometry={geometry}
        moveLabel={moveLabel}
        onActivate={() => setEditing(true)}
        onAdvance={advance}
        onClose={close}
        request={request}
        viewportSize={viewportSize}
      />
    ) : null,
    setRequest,
  }
}

function useSketchDimensionInteraction({
  bounds,
  configuration,
  cursor,
  geometry,
  sketch,
  svgRef,
  viewportSize,
}: Readonly<{
  bounds: SketchBounds
  configuration: SketchDrawingConfiguration
  cursor: SketchPoint2 | null
  geometry: SketchGeometryPresentation
  sketch: SketchRecord
  svgRef: RefObject<SVGSVGElement | null>
  viewportSize: SketchViewportSize
}>) {
  const [editor, setEditor] = useState<SketchDimensionEditorState | null>(null)
  const [labelPositions, setLabelPositions] = useState<
    ReadonlyMap<SketchConstraintId, SketchPoint2>
  >(() => new Map())
  const { dimensionGeometry, labels, options, preview } = useSketchDimensionPresentation({
    configuration,
    cursor,
    editor,
    geometry,
    sketch,
  })
  const openEditor = useCallback(
    (constraintId: SketchConstraintId, anchor: SketchPoint2) => {
      const constraint = (configuration.draft ?? sketch).constraints.find(
        ({ id }) => id === constraintId,
      )
      if (!constraint || !("value" in constraint)) return
      setEditor({ anchor, constraintId, initialKind: constraint.type, kind: "edit" })
    },
    [configuration.draft, sketch],
  )
  const moveLabel = useCallback((constraintId: SketchConstraintId, point: SketchPoint2) => {
    setLabelPositions((current) => new Map(current).set(constraintId, point))
  }, [])
  const resetEditor = useCallback(() => setEditor(null), [])
  const place = useCallback(
    (anchor: SketchPoint2) => {
      const initialKind = inferSketchDimensionKind(
        options.map((option) => option.kind),
        dimensionGeometry,
        anchor,
      )
      if (!initialKind) return false
      setEditor({
        anchor,
        entityIds: [...configuration.selectedEntityIds],
        initialKind,
        kind: "create",
      })
      return true
    },
    [configuration.selectedEntityIds, dimensionGeometry, options],
  )
  const consumeEscape = useCallback(
    (event: KeyboardEvent<SVGSVGElement>) => {
      if (event.key !== "Escape" || configuration.editorTool !== "dimension") return false
      event.preventDefault()
      if (configuration.selectedEntityIds.length > 0) {
        setEditor(null)
        configuration.onSelectionChange([])
      } else {
        configuration.onEditorToolChange("select")
      }
      return true
    },
    [
      configuration.editorTool,
      configuration.onEditorToolChange,
      configuration.onSelectionChange,
      configuration.selectedEntityIds,
    ],
  )
  const closeEditor = useCallback(() => {
    setEditor(null)
    requestAnimationFrame(() => svgRef.current?.focus())
  }, [svgRef])
  const overlay = editor ? (
    <SketchDimensionEditorOverlay
      bounds={bounds}
      configuration={configuration}
      editor={editor}
      labels={labels}
      moveLabel={moveLabel}
      onClose={closeEditor}
      options={options}
      viewportSize={viewportSize}
    />
  ) : null
  return {
    consumeEscape,
    labelPositions,
    moveLabel,
    openEditor,
    options,
    overlay,
    place,
    preview,
    resetEditor,
  }
}

function consumeDimensionCanvasPointerDown({
  editorTool,
  event,
  eventPoint,
  hasOptions,
  place,
}: Readonly<{
  editorTool: SketchEditorTool
  event: PointerEvent<SVGSVGElement>
  eventPoint: (event: PointerEvent<SVGElement>) => SketchPoint2 | null
  hasOptions: boolean
  place: (anchor: SketchPoint2) => boolean
}>) {
  if (
    editorTool !== "dimension" ||
    !hasOptions ||
    event.button !== 0 ||
    event.target !== event.currentTarget
  ) {
    return false
  }
  const anchor = eventPoint(event)
  if (anchor && place(anchor)) event.preventDefault()
  return true
}

function applySketchCurveAction({
  circularPatternSelect,
  draft,
  editorTool,
  entityId,
  event,
  eventPoint,
  linearPatternSelect,
  mirror,
  offset,
  publish,
  splitCircle,
  splitEllipse,
  transformSelect,
}: Readonly<{
  circularPatternSelect: (event: PointerEvent<SVGElement>, entityId: SketchEntityId) => void
  draft: SketchRecord | null
  editorTool: SketchEditorTool
  entityId: SketchEntityId
  event: PointerEvent<SVGElement>
  eventPoint: (event: PointerEvent<SVGElement>) => SketchPoint2 | null
  linearPatternSelect: (event: PointerEvent<SVGElement>, entityId: SketchEntityId) => void
  mirror: (entityId: SketchEntityId) => void
  offset: (entityId: SketchEntityId) => void
  publish: (draft: SketchRecord) => void
  splitCircle: (entity: Extract<SketchEntity, { type: "circle" }>, point: SketchPoint2) => void
  splitEllipse: (entity: Extract<SketchEntity, { type: "ellipse" }>, point: SketchPoint2) => void
  transformSelect: (event: PointerEvent<SVGElement>, entityId: SketchEntityId) => void
}>) {
  if (!draft) return
  const entity = draft.entities.find(({ id }) => id === entityId)
  const actionKind = sketchCurveActionKind(editorTool, entity)
  if (!actionKind) return
  const actions = {
    "circular-pattern": () => circularPatternSelect(event, entityId),
    "linear-pattern": () => linearPatternSelect(event, entityId),
    mirror: () => mirror(entityId),
    offset: () => offset(entityId),
    transform: () => transformSelect(event, entityId),
    "split-circle": () => {
      const point = eventPoint(event)
      if (point && entity?.type === "circle") splitCircle(entity, point)
    },
    "split-ellipse": () => {
      const point = eventPoint(event)
      if (point && entity?.type === "ellipse") splitEllipse(entity, point)
    },
    direct: () => {
      const point = eventPoint(event)
      if (!point || !isDirectSketchModificationTool(editorTool)) return
      const nextDraft = safeSketchModificationUpdate(editorTool, draft, entityId, point)
      if (nextDraft) publish(nextDraft)
    },
  } satisfies Record<SketchCurveActionKind, () => void>
  actions[actionKind]()
}

function useSketchCanvasViewport(geometry: SketchGeometryPresentation) {
  const [bounds, setBounds] = useState(() =>
    sketchBounds([...geometry.points, ...geometry.externalPoints]),
  )
  const svgRef = useRef<SVGSVGElement>(null)
  const viewportSize = useSketchViewportSize(svgRef)
  return { bounds, setBounds, svgRef, viewportSize }
}

function usePublishSketchProjection(bounds: SketchBounds, projectionFrame?: ViewerFrame | null) {
  const projectionStore = useSketchProjectionStoreApi()
  useLayoutEffect(() => {
    if (!projectionStore) return
    if (projectionFrame && bounds.width > 0 && bounds.height > 0) {
      projectionStore.getState().publish({ frame: projectionFrame, bounds })
      return
    }
    projectionStore.getState().clear()
  }, [bounds, projectionFrame, projectionStore])
  useEffect(
    () => () => {
      projectionStore?.getState().clear()
    },
    [projectionStore],
  )
}

function beginSketchOffsetFromSource(input: {
  draft: SketchRecord | null
  entityId: SketchEntityId
  onSelectionChange: (entityIds: readonly SketchEntityId[]) => void
  setInference: Dispatch<SetStateAction<SketchPointInference | null>>
  setPending: Dispatch<SetStateAction<PendingGeometry | null>>
}) {
  if (!input.draft) return
  const entity = input.draft.entities.find(({ id }) => id === input.entityId)
  if (entity?.type !== "line") return
  const lineIds = connectedSketchOffsetLineIds(input.draft, entity.id)
  input.onSelectionChange(lineIds)
  input.setInference(null)
  input.setPending({ kind: "offset-distance", lineIds, referenceLineId: entity.id })
}

function useAppendSketchPlacement(input: {
  configuration: Pick<
    SketchDrawingConfiguration,
    "construction" | "draft" | "editorTool" | "onDraftChange" | "onEditorToolChange"
  >
  inferencePresentation: ReturnType<typeof useSketchInferencePresentation>
  pending: PendingGeometry | null
  setCreationPrecision: Dispatch<SetStateAction<SketchCreationPrecisionRequest | null>>
  setInference: Dispatch<SetStateAction<SketchPointInference | null>>
  setPending: Dispatch<SetStateAction<PendingGeometry | null>>
}) {
  const { construction, draft, editorTool, onDraftChange, onEditorToolChange } = input.configuration
  return useCallback(
    (target: SketchPointTarget, pointInference?: SketchPointInference) => {
      if (!draft) return
      const commitsPlacement = editorTool !== "line" || input.pending?.kind === "line"
      const materialized = commitsPlacement
        ? materializeExternalInference({
            candidatesByInferenceId: input.inferencePresentation.externalCandidatesByInferenceId,
            draft,
            inference: pointInference,
            pending: input.pending,
          })
        : { draft, inference: pointInference, pending: input.pending }
      const point = pointForTarget(materialized.draft, target)
      const placementInput = placementInputWithInference({
        construction,
        draft: materialized.draft,
        inference: materialized.inference,
        pending: materialized.pending,
        point,
        target,
      })
      publishPlacementResolution(safePlacementUpdate(editorTool, placementInput), {
        onDraftChange,
        onEditorToolChange,
        setCreationPrecision: input.setCreationPrecision,
        setInference: input.setInference,
        setPending: input.setPending,
      })
    },
    [
      construction,
      draft,
      editorTool,
      input.inferencePresentation.externalCandidatesByInferenceId,
      input.pending,
      input.setCreationPrecision,
      input.setInference,
      input.setPending,
      onDraftChange,
      onEditorToolChange,
    ],
  )
}

function useSketchDrawingCanvas(
  sketch: SketchRecord,
  solution: SolvedSketchWire | null,
  projectionFrame: ViewerFrame | null | undefined,
) {
  const geometry = useMemo(
    () => createSketchGeometryPresentation(sketch, solution),
    [sketch, solution],
  )
  const viewport = useSketchCanvasViewport(geometry)
  usePublishSketchProjection(viewport.bounds, projectionFrame)
  return { geometry, ...viewport }
}

function SketchDrawing({
  configuration,
  projectionFrame,
  sketch,
}: {
  configuration: SketchDrawingConfiguration
  projectionFrame?: ViewerFrame | null
  sketch: SketchRecord
}) {
  const {
    draft,
    editorTool,
    onDraggingPointChange,
    onDraftChange,
    onEditorToolChange,
    onRedo,
    onSelectionChange,
    onUndo,
    selectedEntityIds,
    solution,
    annotationSolution,
  } = configuration
  const trimGesture = useSketchTrimGesture({ draft, editorTool })
  const trimDisplay = sketchTrimDisplay(sketch, solution, annotationSolution, trimGesture)
  const { bounds, geometry, setBounds, svgRef, viewportSize } = useSketchDrawingCanvas(
    trimDisplay.sketch,
    trimDisplay.solution,
    projectionFrame,
  )
  const [panGesture, setPanGesture] = useState<PanGesture | null>(null)
  const { cursor, inference, pending, setCursor, setInference, setPending } =
    useSketchPlacementPresentation({ draft, editorTool, selectedEntityIds, sketchId: sketch.id })
  const dimensions = useSketchDimensionInteraction({
    bounds,
    configuration,
    cursor,
    geometry,
    sketch,
    svgRef,
    viewportSize,
  })
  const resetDimensionEditor = dimensions.resetEditor
  const creationPrecision = useSketchCreationPrecision({
    bounds,
    configuration,
    geometry,
    moveLabel: dimensions.moveLabel,
    svgRef,
    viewportSize,
  })
  const editable = draft !== null
  const { circularPattern, linearPattern, transform } = useSketchModificationInteractions({
    bounds,
    draft,
    editorTool,
    onDraftChange,
    onEditorToolChange,
    onSelectionChange,
    selectedEntityIds,
    sketchId: sketch.id,
    svgRef,
  })
  const annotationProfiles = useSolvedProfiles(trimDisplay.annotationSolution)
  const inferencePresentation = useSketchInferencePresentation({
    cellSize: dragInferenceCellSize(bounds, viewportSize),
    draft,
    editorTool,
    externalCandidates: configuration.externalPointCandidates,
    externalModelCandidates: configuration.externalModelCandidates,
    geometry,
    inference,
  })
  const appendAt = useAppendSketchPlacement({
    configuration,
    inferencePresentation,
    pending,
    setCreationPrecision: creationPrecision.setRequest,
    setInference,
    setPending,
  })
  const handleDragPreview = useCallback((preview: SketchPointDragPreview) => {
    setCursor(preview.point)
    setInference(preview.inference)
  }, [])
  const {
    draggingPointId,
    finish: finishPointDrag,
    start: startPointDrag,
    update: updatePointDrag,
  } = useSketchPointDrag({
    bounds,
    candidatesByInferenceId: inferencePresentation.externalCandidatesByInferenceId,
    draft,
    inferenceCandidateQuery: inferencePresentation.dragCandidateQuery,
    onDraftChange,
    onDraggingPointChange,
    onPreview: handleDragPreview,
    svgRef,
  })
  const dragTarget = currentSketchDragTarget(
    draggingPointId,
    cursor,
    configuration.releasedDragTarget,
  )
  const eventPoint = (event: PointerEvent<SVGElement>) => {
    const svg = svgRef.current
    return svg ? pointerToSketchPoint(event, svg.getBoundingClientRect(), bounds) : null
  }
  const inferredPlacement = (
    point: SketchPoint2,
    rectangle: Readonly<{ width: number; height: number }>,
    suppressed = false,
  ) =>
    placementInference({
      bounds,
      candidateQuery: inferencePresentation.placementCandidateQuery,
      draft,
      directionLines: inferencePresentation.baseReferences.lines,
      editorTool,
      pending,
      point,
      rectangle,
      references: inferencePresentation.references,
      suppressed,
    })
  const handlePointerMove = (event: PointerEvent<SVGSVGElement>) => {
    if (
      consumeTrimPointerMove({
        bounds,
        draft,
        editorTool,
        event,
        gesture: trimGesture,
        setCursor,
        setInference,
        svg: svgRef.current,
      })
    )
      return
    if (transform.consumePointerMove(event)) return
    handleSketchPointerMove({
      bounds,
      draggingPointId,
      event,
      inferredPlacement,
      panGesture,
      setBounds,
      setCursor,
      setInference,
      svg: svgRef.current,
      updatePointDrag,
    })
  }
  const handleKeyDown = (event: KeyboardEvent<SVGSVGElement>) => {
    if (trimGesture.consumeEscape(event)) return
    if (transform.consumeKeyDown(event)) return
    if (circularPattern.consumeKeyDown(event)) return
    if (linearPattern.consumeKeyDown(event)) return
    if (dimensions.consumeEscape(event)) return
    handleSketchKeyDown({
      appendAt,
      cursor,
      draft,
      editorTool,
      event,
      inference,
      onDraftChange,
      onEditorToolChange,
      onRedo,
      onSelectionChange,
      onUndo,
      pending,
      selectedEntityIds,
      setPending,
    })
  }
  const handleCanvasPointerDown = (event: PointerEvent<SVGSVGElement>) => {
    if (transform.consumeCanvasPointerDown(event)) return
    if (circularPattern.consumeCanvasPointerDown(event)) return
    if (linearPattern.consumeCanvasPointerDown(event)) return
    if (
      consumeDimensionCanvasPointerDown({
        editorTool,
        event,
        eventPoint,
        hasOptions: dimensions.options.length > 0,
        place: dimensions.place,
      })
    )
      return
    const offsetDraft = offsetDraftFromCanvasPointer({
      draft,
      editorTool,
      event,
      eventPoint,
      pending,
    })
    if (offsetDraft !== undefined) {
      if (offsetDraft) publishModificationDraft(offsetDraft)
      return
    }
    handleSketchCanvasPointerDown({
      appendAt,
      bounds,
      editorTool,
      event,
      eventPoint,
      inferredPlacement,
      onSelectionChange,
      setPanGesture,
    })
  }
  const publishModificationDraft = (nextDraft: SketchRecord) => {
    onDraftChange(nextDraft)
    onSelectionChange([])
    setPending(null)
    setInference(null)
  }
  const { splitCircle, splitEllipse } = sketchSplitActions({
    draft,
    eventPoint,
    pending,
    publish: publishModificationDraft,
    setCursor,
    setPending,
    sketch,
  })
  const publishMirrorDraft = (
    result: ReturnType<typeof mirrorSketchEntities>,
    keepSelectingSources: boolean,
  ) => {
    if (result.createdEntityIds.length === 0) return
    onDraftChange(result.sketch)
    onSelectionChange([])
    setInference(null)
    if (keepSelectingSources) return
    setPending(null)
    onEditorToolChange("select")
  }
  const handleMirrorAction = (entityId: SketchEntityId) =>
    applyMirrorAction({
      draft,
      entityId,
      onSelectionChange,
      pending,
      publish: publishMirrorDraft,
      selectedEntityIds,
      setInference,
      setPending,
    })
  const handleOffsetSourceAction = (entityId: SketchEntityId) =>
    beginSketchOffsetFromSource({
      draft,
      entityId,
      onSelectionChange,
      setInference,
      setPending,
    })
  const handleCurveAction = (event: PointerEvent<SVGElement>, entityId: SketchEntityId) => {
    if (
      consumeTrimCurveAction({
        editorTool,
        entityId,
        event,
        eventPoint,
        gesture: trimGesture,
        svg: svgRef.current,
      })
    )
      return
    applySketchCurveAction({
      circularPatternSelect: circularPattern.selectEntity,
      draft,
      editorTool,
      entityId,
      event,
      eventPoint,
      linearPatternSelect: linearPattern.selectEntity,
      mirror: handleMirrorAction,
      offset: handleOffsetSourceAction,
      publish: publishModificationDraft,
      splitCircle,
      splitEllipse,
      transformSelect: transform.selectEntity,
    })
  }
  const handlePointerUp = (event: PointerEvent<SVGSVGElement>) => {
    if (consumeTrimPointerUp({ event, gesture: trimGesture, publish: publishModificationDraft }))
      return
    if (transform.consumePointerUp(event)) return
    finishPointDrag()
    setInference(null)
    setPanGesture(null)
  }
  const handlePointerCancel = (event: PointerEvent<SVGSVGElement>) => {
    if (consumeTrimPointerCancel({ event, gesture: trimGesture, setInference })) return
    handlePointerUp(event)
  }
  const handlePointerLeave = () => {
    if (draggingPointId || trimGesture.active) return
    trimGesture.setPreselectedEntityId(null)
    setCursor(null)
    setInference(null)
  }
  const handleWheel = (event: WheelEvent<SVGSVGElement>) => {
    handleSketchWheel({ bounds, event, setBounds, svg: svgRef.current })
  }
  const handlePointPointerDown = useCallback(
    (event: PointerEvent<SVGCircleElement>, pointId: SketchEntityId) => {
      setCursor(null)
      setInference(null)
      startPointDrag(event, pointId)
    },
    [startPointDrag],
  )
  const handleSelection = useCallback(
    (entityId: SketchEntityId, additive: boolean) => {
      resetDimensionEditor()
      onSelectionChange(
        editorTool === "dimension" && draft && !additive
          ? nextSketchDimensionSelection(draft, selectedEntityIds, entityId)
          : toggleSelection(selectedEntityIds, entityId, additive),
      )
    },
    [draft, editorTool, onSelectionChange, resetDimensionEditor, selectedEntityIds],
  )
  return (
    <>
      <SketchContextGeometryBounds
        geometry={configuration.externalContextGeometry}
        modelGeometry={configuration.externalModelCandidates}
        setBounds={setBounds}
      />
      <SketchDrawingView
        configuration={configuration}
        handlers={{
          appendAt,
          onCanvasPointerDown: handleCanvasPointerDown,
          onCircularPatternApply: circularPattern.apply,
          onCircularPatternCancel: circularPattern.cancel,
          onCircularPatternPreview: circularPattern.preview,
          onCurveAction: handleCurveAction,
          onDimensionPositionChange: dimensions.moveLabel,
          onEditDimension: dimensions.openEditor,
          onKeyDown: handleKeyDown,
          onLinearPatternApply: linearPattern.apply,
          onLinearPatternCancel: linearPattern.cancel,
          onLinearPatternPreview: linearPattern.preview,
          onPointPointerDown: handlePointPointerDown,
          onPointerCancel: handlePointerCancel,
          onPointerLeave: handlePointerLeave,
          onPointerMove: handlePointerMove,
          onPointerUp: handlePointerUp,
          onSelection: handleSelection,
          onTransformStart: transform.start,
          onTransformApply: transform.applyExact,
          onTransformCancel: transform.cancel,
          onWheel: handleWheel,
        }}
        sketch={trimDisplay.sketch}
        state={{
          annotationProfiles,
          annotationSolution: trimDisplay.annotationSolution,
          bounds,
          circularPattern: circularPattern.presentation,
          cursor,
          dragTarget,
          draggingPointId,
          dimensionLabelPositions: dimensions.labelPositions,
          dimensionPreview: dimensions.preview,
          editable,
          externalInferenceCandidate: inferencePresentation.externalInferenceCandidate,
          geometry,
          inference,
          linearPattern: linearPattern.presentation,
          pending,
          preselectedEntityId: editorTool === "trim" ? trimGesture.preselectedEntityId : null,
          transform: transform.presentation,
          trimGestureActive: trimGesture.active,
          viewportSize,
        }}
        svgRef={svgRef}
      />
      {dimensions.overlay}
      {creationPrecision.overlay}
    </>
  )
}

function solveStatusLabel(
  solveState: SolveState,
  labels: Readonly<Record<SolvedSketchWire["status"], string>>,
) {
  return solveState.kind === "solved" ? labels[solveState.solution.status] : null
}

function currentSolveState(solveState: SolveState, activeSketch: SketchRecord | null): SolveState {
  if (
    solveState.kind === "idle" ||
    (activeSketch !== null && solveState.sourceSketch.id === activeSketch.id)
  ) {
    return solveState
  }
  return { kind: "idle" }
}

function isReleasedSketchDrag(dragState: SketchDragState | null): dragState is SketchDragState {
  return dragState !== null && !dragState.active
}

function isCompletedSketchSolve(
  solveState: SolveState,
): solveState is Extract<SolveState, { kind: "error" | "solved" }> {
  return solveState.kind === "error" || solveState.kind === "solved"
}

function matchesReleasedDragTarget(target: SketchDragTarget | null, dragState: SketchDragState) {
  if (target === null) return false
  return (
    target.entityId === dragState.pointId &&
    target.x === dragState.target.x &&
    target.y === dragState.target.y
  )
}

function hasSettledReleasedDrag(
  activeSketch: SketchRecord | null,
  dragState: SketchDragState | null,
  solveState: SolveState,
) {
  if (!isReleasedSketchDrag(dragState) || activeSketch === null) return false
  if (!isCompletedSketchSolve(solveState)) return false
  if (solveState.sourceSketch.id !== activeSketch.id) return false
  return matchesReleasedDragTarget(solveState.dragTarget, dragState)
}

function useReleasedDragSettlement(
  activeSketch: SketchRecord | null,
  dragState: SketchDragState | null,
  solveState: SolveState,
  setDragState: Dispatch<SetStateAction<SketchDragState | null>>,
) {
  useEffect(() => {
    if (hasSettledReleasedDrag(activeSketch, dragState, solveState)) setDragState(null)
  }, [activeSketch, dragState, setDragState, solveState])
}

function useSketchSolutionNotifications(
  solution: SolvedSketchWire | null,
  profiles: readonly SketchProfileSelector[],
  onProfilesChange: (profiles: readonly SketchProfileSelector[]) => void,
  onFailedConstraintsChange: (constraintIds: readonly SketchConstraintId[]) => void,
) {
  useEffect(() => {
    onProfilesChange(solution ? profiles : [])
  }, [onProfilesChange, profiles, solution])

  useEffect(() => {
    onFailedConstraintsChange(solution ? validConstraintIds(solution.failedConstraintIds) : [])
  }, [onFailedConstraintsChange, solution])
}

function solveMessage(
  solveState: SolveState,
  labels: Readonly<{ failed: string; loading: string; status: string | null }>,
) {
  if (solveState.kind === "loading") return labels.loading
  if (solveState.kind === "error") return labels.failed
  return labels.status
}

function sketchSolvePresentation({
  copy,
  empty,
  formatNumber,
  lengthUnit,
  solution,
  solveState,
}: Readonly<{
  copy: Readonly<{
    degreesOfFreedom: (count: number) => string
    emptyDraft: string
    emptyDraftHint: string
    failed: string
    failedStatus: string
    fullyConstrained: string
    loading: string
    overConstrained: string
    profile: (area: string, perimeter: string) => string
    underConstrained: string
  }>
  empty: boolean
  formatNumber: (value: number) => string
  lengthUnit: ReturnType<typeof useDocumentDisplayUnits>["length"]
  solution: SolvedSketchWire | null
  solveState: SolveState
}>) {
  const status = solveStatusLabel(solveState, {
    "fully-constrained": copy.fullyConstrained,
    "under-constrained": copy.underConstrained,
    "over-constrained": copy.overConstrained,
    failed: copy.failedStatus,
  })
  const profile = solution?.profileResult.profiles[0]
  return {
    degreesOfFreedom: empty
      ? copy.emptyDraftHint
      : solution
        ? copy.degreesOfFreedom(solution.degreesOfFreedom)
        : null,
    profileText: profile
      ? copy.profile(
          formatDisplayArea(profile.area, lengthUnit, formatNumber),
          formatDisplayLength(profile.perimeter, lengthUnit, formatNumber),
        )
      : null,
    statusText: empty
      ? copy.emptyDraft
      : solveMessage(solveState, { failed: copy.failed, loading: copy.loading, status }),
  }
}

type SketchDrawingConfiguration = Readonly<{
  ariaLabel: string
  annotationSolution: SolvedSketchWire | null
  construction: boolean
  draft: SketchRecord | null
  externalContextGeometry: readonly ExternalSketchContextGeometry[]
  externalModelCandidates: readonly ExternalModelGeometryCandidate[]
  externalPointCandidates: readonly ExternalSketchGeometryCandidate[]
  editDimensionLabel: (label: string) => string
  editorTool: SketchEditorTool
  onConstraintSelectionChange: (constraintId: SketchConstraintId | null) => void
  onDraftChange: (sketch: SketchRecord, mode?: SketchDraftChangeMode) => void
  onDraggingPointChange: (pointId: SketchEntityId | null, point?: SketchPoint2) => void
  onEditorToolChange: (tool: SketchEditorTool) => void
  onOriginPlaneVisibilityChange: (plane: ViewerOriginPlane, visible: boolean) => void
  onProfileSelect: (profile: SketchProfileSelector) => void
  onRedo: () => void
  onSelectionChange: (entityIds: readonly SketchEntityId[]) => void
  onUndo: () => void
  originPlaneVisibility: ViewerOriginPlaneVisibility
  repairReferenceId: SketchExternalReferenceId | null
  releasedDragTarget: SketchDragTarget | null
  selectConstraintLabel: (
    label: string,
    constraintType: SketchRecord["constraints"][number]["type"],
  ) => string
  selectExternalConstraintLabel: (
    label: string,
    constraintType: SketchRecord["constraints"][number]["type"],
  ) => string
  selectedConstraintId: SketchConstraintId | null
  selectedEntityIds: readonly SketchEntityId[]
  selectedProfile: SketchProfileSelector | null
  solution: SolvedSketchWire | null
  variables: readonly VariableDefinition[]
}>

function SketchViewportContent({
  activeSketch,
  configuration,
  emptyMessage,
  projectionFrame,
}: {
  activeSketch: SketchRecord | null
  configuration: SketchDrawingConfiguration
  emptyMessage: string
  projectionFrame?: ViewerFrame | null
}) {
  if (!activeSketch) {
    return (
      <div className="absolute inset-0 grid place-items-center px-6 text-center">
        <p className="max-w-sm text-sm text-muted-foreground">{emptyMessage}</p>
      </div>
    )
  }
  return (
    <SketchDrawing
      key={activeSketch.id}
      configuration={configuration}
      projectionFrame={projectionFrame ?? null}
      sketch={activeSketch}
    />
  )
}

const StableSketchViewportContent = memo(SketchViewportContent)

function SketchSolveOverlay({
  active,
  contextGeometry,
  contextSketchLabels,
  degreesOfFreedom,
  profileText,
  status,
}: {
  active: boolean
  contextGeometry: readonly ExternalSketchContextGeometry[]
  contextSketchLabels: ReadonlyMap<string, string>
  degreesOfFreedom: string | null
  profileText: string | null
  status: string | null
}) {
  const t = useTranslations("app.sketch.viewport")
  if (!active) return null
  const contextSources = new Map<string, { count: number; label: string }>()
  for (const geometry of contextGeometry) {
    const current = contextSources.get(geometry.sourceSketchId)
    contextSources.set(geometry.sourceSketchId, {
      count: (current?.count ?? 0) + 1,
      label: contextSketchLabels.get(geometry.sourceSketchId) ?? geometry.label,
    })
  }
  return (
    <div className="pointer-events-none absolute left-3 top-3 grid gap-1 rounded-md border bg-background/90 px-3 py-2 text-xs shadow-sm">
      <span className="font-medium" role="status">
        {status}
      </span>
      {degreesOfFreedom ? <span className="text-muted-foreground">{degreesOfFreedom}</span> : null}
      {profileText ? <span className="text-muted-foreground">{profileText}</span> : null}
      {contextSources.size > 0 ? (
        <fieldset className="mt-1 grid gap-1 border-x-0 border-b-0 border-t border-border/70 pt-1.5 text-sketch-reference-context">
          <legend className="flex items-center gap-1.5 pr-1 font-medium">
            <Link2 aria-hidden="true" className="size-3.5" />
            {t("referenceContext")}
          </legend>
          {[...contextSources.entries()].map(([sourceSketchId, source]) => (
            <span key={sourceSketchId} className="pl-5 text-muted-foreground">
              {t("referenceContextSource", source)}
            </span>
          ))}
        </fieldset>
      ) : null}
    </div>
  )
}

function SketchOrientation({ plane }: { plane: SketchRecord["plane"] | null }) {
  const t = useTranslations("app.sketch.viewport")
  const displayUnits = useDocumentDisplayUnits()
  if (!plane) return null
  return (
    <div className="pointer-events-none absolute bottom-3 left-3 rounded-sm border bg-background/90 px-2 py-1 font-mono text-xs text-muted-foreground">
      {t("orientation", { plane: plane.toUpperCase(), unit: displayUnits.length })}
    </div>
  )
}

const constraintToolSymbols = {
  coincident: "×",
  concentric: "◎",
  equal: "=",
  fixed: "F",
  horizontal: "H",
  midpoint: "M",
  parallel: "∥",
  perpendicular: "⊥",
  "point-on-curve": "⊙",
  "point-on-line": "⊙",
  symmetric: "S",
  tangent: "T",
  vertical: "V",
} satisfies Record<SketchConstraintToolKind, string>

type SketchSelectionToolbarAnchor = Readonly<{
  placement: "above" | "below"
  x: CSSProperties["left"]
  y: CSSProperties["top"]
}>

function sketchSelectionToolbarAnchor(
  draft: SketchRecord | null,
  entityIds: readonly SketchEntityId[],
  geometry: SketchGeometryPresentation,
  bounds: SketchBounds,
  viewport: SketchViewportSize,
): SketchSelectionToolbarAnchor | null {
  if (!draft) return null
  const pointIds = new Set<SketchEntityId>()
  for (const entity of selectedSketchConstraintEntities(draft, entityIds)) {
    if (entity.type === "point") pointIds.add(entity.id)
    else for (const pointId of sketchCurvePointIds(entity)) pointIds.add(pointId)
  }
  const points = [...pointIds].flatMap((pointId) => {
    const point = geometry.pointsById.get(pointId)
    return point ? [point] : []
  })
  if (points.length === 0) return null
  const minimumX = Math.min(...points.map(({ x }) => x))
  const maximumX = Math.max(...points.map(({ x }) => x))
  const maximumY = Math.max(...points.map(({ y }) => y))
  if (viewport.width <= 0 || viewport.height <= 0) {
    const fallback = constraintAnnotationPosition(
      { x: (minimumX + maximumX) / 2, y: maximumY },
      bounds,
      viewport,
    )
    return { placement: "above", x: fallback.left, y: fallback.top }
  }
  const positions = points.map((point) => {
    const position = constraintAnnotationPosition(point, bounds, viewport)
    return { x: Number(position.left), y: Number(position.top) }
  })
  const left = Math.min(...positions.map(({ x }) => x))
  const right = Math.max(...positions.map(({ x }) => x))
  const top = Math.min(...positions.map(({ y }) => y))
  const bottom = Math.max(...positions.map(({ y }) => y))
  const horizontalInset = Math.min(144, Math.max(0, viewport.width / 2 - 8))
  const x = Math.min(
    Math.max((left + right) / 2, horizontalInset),
    viewport.width - horizontalInset,
  )
  return top >= 48
    ? { placement: "above", x, y: top - 8 }
    : { placement: "below", x, y: bottom + 8 }
}

function useSketchConstraintToolLabels() {
  const t = useTranslations("app.shell.taskPanel.sketch")
  return {
    coincident: t("coincident"),
    concentric: t("concentric"),
    equal: t("equal"),
    fixed: t("fixed"),
    horizontal: t("horizontal"),
    midpoint: t("midpoint"),
    parallel: t("parallel"),
    perpendicular: t("perpendicular"),
    "point-on-curve": t("pointOnCurve"),
    "point-on-line": t("pointOnLine"),
    symmetric: t("symmetricConstraint"),
    tangent: t("tangent"),
    vertical: t("vertical"),
  } satisfies Record<SketchConstraintToolKind, string>
}

function SketchConstraintToolbarAction({
  definition,
  kind,
  label,
  onApply,
}: Readonly<{
  definition: SketchConstraintDefinition
  kind: SketchConstraintToolKind
  label: string
  onApply: (definition: SketchConstraintDefinition) => void
}>) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          aria-label={label}
          onClick={() => onApply(definition)}
        >
          <span aria-hidden="true" className="font-mono text-sm font-semibold">
            {constraintToolSymbols[kind]}
          </span>
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

function SketchDimensionToolbarAction({
  label,
  onActivate,
}: Readonly<{ label: string; onActivate: () => void }>) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          aria-label={label}
          onClick={onActivate}
        >
          <Ruler aria-hidden="true" />
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

function sketchPrecisionActions(
  draft: SketchRecord | null,
  selectedEntityIds: readonly SketchEntityId[],
) {
  if (!draft) return null
  const constraints = compatibleSketchConstraintToolsForSelection(draft, selectedEntityIds)
  const dimensions = compatibleSketchDimensionToolsForSelection(draft, selectedEntityIds)
  return constraints.length === 0 && dimensions.length === 0
    ? null
    : { constraints, draft, hasDimensions: dimensions.length > 0 }
}

function SketchPrecisionToolbar({
  anchor,
  draft,
  editorTool,
  onDraftChange,
  onEditorToolChange,
  selectedEntityIds,
}: Readonly<{
  anchor: SketchSelectionToolbarAnchor | null
  draft: SketchRecord | null
  editorTool: SketchEditorTool
  onDraftChange: (sketch: SketchRecord, mode?: SketchDraftChangeMode) => void
  onEditorToolChange: (tool: SketchEditorTool) => void
  selectedEntityIds: readonly SketchEntityId[]
}>) {
  const labels = useSketchConstraintToolLabels()
  const viewportT = useTranslations("app.sketch.viewport")
  const actions = sketchPrecisionActions(draft, selectedEntityIds)
  if (!anchor || editorTool !== "select" || !actions) return null
  const apply = (definition: SketchConstraintDefinition) => {
    onDraftChange(
      appendSketchConstraint(actions.draft, definition, createBrowserSketchConstraintId),
    )
  }
  return (
    <div
      aria-label={viewportT("precisionTools")}
      className={cn(
        "absolute z-20 flex max-w-72 -translate-x-1/2 flex-wrap items-center justify-center gap-0.5 rounded-md border bg-background/95 p-1 shadow-md backdrop-blur-sm",
        anchor.placement === "above" && "-translate-y-full",
      )}
      data-sketch-selection-toolbar
      role="toolbar"
      style={{ left: anchor.x, top: anchor.y }}
    >
      {actions.constraints.map(({ definition, kind }) => (
        <SketchConstraintToolbarAction
          key={kind}
          definition={definition}
          kind={kind}
          label={labels[kind]}
          onApply={apply}
        />
      ))}
      {actions.hasDimensions ? (
        <SketchDimensionToolbarAction
          label={viewportT("dimensionTool")}
          onActivate={() => onEditorToolChange("dimension")}
        />
      ) : null}
    </div>
  )
}

function SketchSelectionContextMenu({
  draft,
  entityIds,
  onDraftChange,
  onEditorToolChange,
  onSelectionChange,
  selectedEntityIds,
}: Readonly<{
  draft: SketchRecord | null
  entityIds: readonly SketchEntityId[]
  onDraftChange: (sketch: SketchRecord, mode?: SketchDraftChangeMode) => void
  onEditorToolChange: (tool: SketchEditorTool) => void
  onSelectionChange: (entityIds: readonly SketchEntityId[]) => void
  selectedEntityIds: readonly SketchEntityId[]
}>) {
  const labels = useSketchConstraintToolLabels()
  const viewportT = useTranslations("app.sketch.viewport")
  if (!draft) return null
  const constraints = compatibleSketchConstraintToolsForSelection(draft, entityIds)
  const dimensions = compatibleSketchDimensionToolsForSelection(draft, entityIds)
  const authoredEntityIds = selectedSketchEntities(draft, entityIds).map(({ id }) => id)
  const hasPrecisionActions = constraints.length > 0 || dimensions.length > 0
  if (!hasPrecisionActions && authoredEntityIds.length === 0) return null
  const apply = (definition: SketchConstraintDefinition) => {
    onDraftChange(appendSketchConstraint(draft, definition, createBrowserSketchConstraintId))
  }
  const startDimension = () => {
    onSelectionChange(entityIds)
    onEditorToolChange("dimension")
  }
  const removeGeometry = () => {
    const nextDraft = removeSketchEntities(draft, authoredEntityIds)
    const survivingEntityIds = new Set(
      selectedSketchConstraintEntities(nextDraft, selectedEntityIds).map(({ id }) => id),
    )
    onDraftChange(nextDraft)
    onSelectionChange(selectedEntityIds.filter((id) => survivingEntityIds.has(id)))
  }
  return (
    <ContextMenuContent aria-label={viewportT("contextActions")}>
      <ContextMenuLabel>{viewportT("contextActions")}</ContextMenuLabel>
      {constraints.map(({ definition, kind }) => (
        <ContextMenuItem key={kind} onSelect={() => apply(definition)}>
          <span aria-hidden="true" className="w-4 text-center font-mono font-semibold">
            {constraintToolSymbols[kind]}
          </span>
          {labels[kind]}
        </ContextMenuItem>
      ))}
      {dimensions.length > 0 ? (
        <ContextMenuItem onSelect={startDimension}>
          <Ruler aria-hidden="true" />
          {viewportT("dimensionTool")}
        </ContextMenuItem>
      ) : null}
      {hasPrecisionActions && authoredEntityIds.length > 0 ? <ContextMenuSeparator /> : null}
      {authoredEntityIds.length > 0 ? (
        <ContextMenuItem
          className="text-destructive focus:bg-destructive/10 focus:text-destructive"
          onSelect={removeGeometry}
        >
          <Trash2 aria-hidden="true" />
          {viewportT("deleteGeometry")}
        </ContextMenuItem>
      ) : null}
    </ContextMenuContent>
  )
}

function IntersectionAction({
  active,
  onEditorToolChange,
}: Readonly<{
  active: boolean
  onEditorToolChange: (tool: SketchEditorTool) => void
}>) {
  const t = useTranslations("app.shell.taskPanel.sketch")
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          size="icon-sm"
          variant={active ? "secondary" : "ghost"}
          aria-label={t("intersection")}
          aria-pressed={active}
          onClick={() => onEditorToolChange(active ? "select" : "intersection")}
        >
          <IntersectionIcon aria-hidden="true" />
        </Button>
      </TooltipTrigger>
      <TooltipContent>{t("intersection")}</TooltipContent>
    </Tooltip>
  )
}

function PierceAction({
  active,
  enabled,
  onEditorToolChange,
}: Readonly<{
  active: boolean
  enabled: boolean
  onEditorToolChange: (tool: SketchEditorTool) => void
}>) {
  const t = useTranslations("app.shell.taskPanel.sketch")
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          size="icon-sm"
          variant={active ? "secondary" : "ghost"}
          aria-label={t("pierce")}
          aria-pressed={active}
          disabled={!enabled}
          onClick={() => onEditorToolChange(active ? "select" : "pierce")}
        >
          <PierceIcon aria-hidden="true" />
        </Button>
      </TooltipTrigger>
      <TooltipContent>{enabled ? t("pierce") : t("pierceSelectionRequired")}</TooltipContent>
    </Tooltip>
  )
}

function pierceSelectionEnabled(
  draft: SketchRecord,
  selectedEntityIds: readonly SketchEntityId[],
  candidateCount: number,
) {
  if (candidateCount === 0 || selectedEntityIds.length !== 1) return false
  return draft.entities.find(({ id }) => id === selectedEntityIds[0])?.type === "point"
}

function SketchExternalReferenceToolbar({
  draft,
  editorTool,
  modelCandidateCount,
  onEditorToolChange,
  pierceCandidateCount,
  selectedEntityIds,
}: Readonly<{
  draft: SketchRecord | null
  editorTool: SketchEditorTool
  modelCandidateCount: number
  onEditorToolChange: (tool: SketchEditorTool) => void
  pierceCandidateCount: number
  selectedEntityIds: readonly SketchEntityId[]
}>) {
  if (!draft || modelCandidateCount + pierceCandidateCount === 0) return null
  return (
    <div className="flex items-center gap-0.5 rounded-md border bg-background/90 p-1 shadow-sm backdrop-blur-sm">
      {modelCandidateCount > 0 ? (
        <IntersectionAction
          active={editorTool === "intersection"}
          onEditorToolChange={onEditorToolChange}
        />
      ) : null}
      {pierceCandidateCount > 0 ? (
        <PierceAction
          active={editorTool === "pierce"}
          enabled={pierceSelectionEnabled(draft, selectedEntityIds, pierceCandidateCount)}
          onEditorToolChange={onEditorToolChange}
        />
      ) : null}
    </div>
  )
}

type SketchViewportState = Readonly<{
  construction: boolean
  controller: DocumentControllerState
  draft: SketchRecord | null
  editorTool: SketchEditorTool
  externalContextGeometry: readonly ExternalSketchContextGeometry[]
  externalModelCandidates: readonly ExternalModelGeometryCandidate[]
  externalPointCandidates: readonly ExternalSketchGeometryCandidate[]
  originPlaneVisibility: ViewerOriginPlaneVisibility
  pierceCandidateCount?: number
  repairReferenceId: SketchExternalReferenceId | null
  selectedConstraintId: SketchConstraintId | null
  selectedEntityIds: readonly SketchEntityId[]
  selectedProfile: SketchProfileSelector | null
  sketch: SketchRecord | null
  supportFeatures: readonly FeatureRecord[]
  projectionFrame?: ViewerFrame | null
}>

type SketchViewportActions = Readonly<{
  onDisplayChange: (display: SketchDisplayRecord | null) => void
  onDraftChange: (sketch: SketchRecord, mode?: SketchDraftChangeMode) => void
  onEditorToolChange: (tool: SketchEditorTool) => void
  onFailedConstraintsChange: (constraintIds: readonly SketchConstraintId[]) => void
  onOriginPlaneVisibilityChange: (plane: ViewerOriginPlane, visible: boolean) => void
  onConstraintSelectionChange: (constraintId: SketchConstraintId | null) => void
  onProfilesChange: (profiles: readonly SketchProfileSelector[]) => void
  onReferenceDimensionLabelsChange: (labels: Readonly<Record<string, string>>) => void
  onProfileSelect: (profile: SketchProfileSelector) => void
  onRedo: () => void
  onSelectionChange: (entityIds: readonly SketchEntityId[]) => void
  onUndo: () => void
}>

function useSolvedProfiles(solution: SolvedSketchWire | null) {
  return useMemo(() => (solution ? profileSelectors(solution) : []), [solution])
}

function useSketchViewportPresentation(
  activeSketch: SketchRecord | null,
  draft: SketchRecord | null,
  solution: SolvedSketchWire | null,
  displaySolution: SolvedSketchWire | null,
  solveState: SolveState,
) {
  const t = useTranslations("app.sketch.viewport")
  const formatter = useFormatter()
  const displayUnits = useDocumentDisplayUnits()
  const editDimensionLabel = useCallback((label: string) => t("editDimension", { label }), [t])
  const accessibleConstraintLabel = useCallback(
    (label: string, constraintType: SketchRecord["constraints"][number]["type"]) => {
      const messageKey = accessibleConstraintMessageKeys[constraintType]
      return messageKey ? t(messageKey) : label
    },
    [t],
  )
  const selectConstraintLabel = useCallback(
    (label: string, constraintType: SketchRecord["constraints"][number]["type"]) =>
      t("selectConstraint", { label: accessibleConstraintLabel(label, constraintType) }),
    [accessibleConstraintLabel, t],
  )
  const selectExternalConstraintLabel = useCallback(
    (label: string, constraintType: SketchRecord["constraints"][number]["type"]) =>
      t("selectExternalConstraint", { label: accessibleConstraintLabel(label, constraintType) }),
    [accessibleConstraintLabel, t],
  )
  const solve = sketchSolvePresentation({
    copy: {
      degreesOfFreedom: (count) => t("degreesOfFreedom", { count }),
      emptyDraft: t("emptyDraft"),
      emptyDraftHint: t("emptyDraftHint"),
      failed: t("solveFailed"),
      failedStatus: t("failed"),
      fullyConstrained: t("fullyConstrained"),
      loading: t("solving"),
      overConstrained: t("overConstrained"),
      profile: (area, perimeter) => t("profile", { area, perimeter }),
      underConstrained: t("underConstrained"),
    },
    empty:
      activeSketch === null ||
      (activeSketch.entities.length === 0 && (activeSketch.externalReferences?.length ?? 0) === 0),
    formatNumber: (value) => formatter.number(value, { maximumFractionDigits: 6 }),
    lengthUnit: displayUnits.length,
    solution,
    solveState,
  })
  const referenceDimensionLabels = useMemo(() => {
    if (!activeSketch) return {}
    const geometry = createSketchGeometryPresentation(activeSketch, displaySolution)
    return Object.fromEntries(
      constraintGlyphs(activeSketch, geometry, displayUnits, (value) =>
        formatter.number(value, { maximumFractionDigits: 6 }),
      ).flatMap((glyph) => (glyph.reference ? [[glyph.id, glyph.label] as const] : [])),
    )
  }, [activeSketch, displaySolution, displayUnits, formatter])
  return {
    ariaLabel: t("ariaLabel"),
    drawingLabel: draft === null ? t("solvedDrawing") : t("draftDrawing"),
    editDimensionLabel,
    emptyMessage: t("empty"),
    referenceDimensionLabels,
    selectConstraintLabel,
    selectExternalConstraintLabel,
    solve,
  }
}

function useActiveSketchDisplay({
  activeSketch,
  controller,
  displaySolution,
  features,
  interactive,
  onDisplayChange,
}: Readonly<{
  activeSketch: SketchRecord | null
  controller: DocumentControllerState
  displaySolution: SolvedSketchWire | null
  features: readonly FeatureRecord[]
  interactive: boolean
  onDisplayChange: SketchViewportActions["onDisplayChange"]
}>) {
  const display = useMemo(() => {
    const snapshot = controller.report?.snapshot
    if (interactive || !snapshot || !activeSketch) return null
    const rebuild = controller.report?.rebuild
    return materializeSketchDisplay(
      snapshot,
      activeSketch,
      displaySolution,
      features,
      rebuild?.ok && rebuild.response ? rebuild.response.geometry : [],
    )
  }, [
    activeSketch,
    controller.report?.rebuild,
    controller.report?.snapshot,
    displaySolution,
    features,
    interactive,
  ])
  useEffect(() => onDisplayChange(display), [display, onDisplayChange])
  useEffect(() => () => onDisplayChange(null), [onDisplayChange])
}

function useStableSketchDrawingConfiguration(configuration: SketchDrawingConfiguration) {
  const {
    annotationSolution,
    ariaLabel,
    construction,
    draft,
    editDimensionLabel,
    editorTool,
    externalContextGeometry,
    externalModelCandidates,
    externalPointCandidates,
    onConstraintSelectionChange,
    onDraftChange,
    onDraggingPointChange,
    onEditorToolChange,
    onOriginPlaneVisibilityChange,
    onProfileSelect,
    onRedo,
    onSelectionChange,
    onUndo,
    originPlaneVisibility,
    repairReferenceId,
    releasedDragTarget,
    selectedConstraintId,
    selectedEntityIds,
    selectedProfile,
    selectConstraintLabel,
    selectExternalConstraintLabel,
    solution,
    variables,
  } = configuration
  return useMemo<SketchDrawingConfiguration>(
    () => configuration,
    [
      annotationSolution,
      ariaLabel,
      construction,
      draft,
      editDimensionLabel,
      editorTool,
      externalContextGeometry,
      externalModelCandidates,
      externalPointCandidates,
      onConstraintSelectionChange,
      onDraftChange,
      onDraggingPointChange,
      onEditorToolChange,
      onOriginPlaneVisibilityChange,
      onProfileSelect,
      onRedo,
      onSelectionChange,
      onUndo,
      originPlaneVisibility,
      repairReferenceId,
      releasedDragTarget,
      selectedConstraintId,
      selectedEntityIds,
      selectedProfile,
      selectConstraintLabel,
      selectExternalConstraintLabel,
      solution,
      variables,
    ],
  )
}

function useSketchViewportSolveModel({
  controller,
  draft,
  interactive,
  onDisplayChange,
  onFailedConstraintsChange,
  onProfilesChange,
  onReferenceDimensionLabelsChange,
  sketch,
  solveSketch,
  supportFeatures,
}: Readonly<{
  controller: DocumentControllerState
  draft: SketchRecord | null
  interactive: boolean
  onDisplayChange: SketchViewportActions["onDisplayChange"]
  onFailedConstraintsChange: SketchViewportActions["onFailedConstraintsChange"]
  onProfilesChange: SketchViewportActions["onProfilesChange"]
  onReferenceDimensionLabelsChange: SketchViewportActions["onReferenceDimensionLabelsChange"]
  sketch: SketchRecord | null
  solveSketch: SketchSolveFunction
  supportFeatures: readonly FeatureRecord[]
}>) {
  const [dragState, setDragState] = useState<SketchDragState | null>(null)
  const activeSketch = draft ?? sketch
  const dragTarget = useMemo(
    () => dragTargetForSketch(activeSketch, dragState),
    [activeSketch, dragState],
  )
  const releasedDragTarget = useMemo(
    () => releasedDragTargetForSketch(activeSketch, dragState),
    [activeSketch, dragState],
  )
  const onDraggingPointChange = useDraggingPointChange(activeSketch, setDragState)
  const solveState = useSketchSolution(controller, activeSketch, solveSketch, dragTarget)
  useReleasedDragSettlement(activeSketch, dragState, solveState, setDragState)
  const activeSolveState = currentSolveState(solveState, activeSketch)
  const solution = solvedSolution(activeSolveState)
  const displaySolution = sketchDisplaySolution(activeSketch, solveState)
  useActiveSketchDisplay({
    activeSketch,
    controller,
    displaySolution,
    features: supportFeatures,
    interactive,
    onDisplayChange,
  })
  const profiles = useSolvedProfiles(solution)
  useSketchSolutionNotifications(solution, profiles, onProfilesChange, onFailedConstraintsChange)
  const presentation = useSketchViewportPresentation(
    activeSketch,
    draft,
    solution,
    displaySolution,
    activeSolveState,
  )
  useEffect(
    () => onReferenceDimensionLabelsChange(presentation.referenceDimensionLabels),
    [onReferenceDimensionLabelsChange, presentation.referenceDimensionLabels],
  )
  return {
    activeSketch,
    displaySolution,
    onDraggingPointChange,
    presentation,
    releasedDragTarget,
  }
}

export function SketchViewport({
  actions,
  interactive = true,
  solveSketch = solveActiveSketch,
  overlay = false,
  state,
}: {
  actions: SketchViewportActions
  interactive?: boolean
  overlay?: boolean
  solveSketch?: SketchSolveFunction
  state: SketchViewportState
}) {
  const {
    construction,
    controller,
    draft,
    editorTool,
    externalContextGeometry,
    externalModelCandidates,
    externalPointCandidates,
    originPlaneVisibility,
    repairReferenceId,
    selectedConstraintId,
    selectedEntityIds,
    selectedProfile,
    sketch,
    supportFeatures,
  } = state
  const {
    onDraftChange,
    onDisplayChange,
    onEditorToolChange,
    onConstraintSelectionChange,
    onFailedConstraintsChange,
    onOriginPlaneVisibilityChange,
    onProfilesChange,
    onReferenceDimensionLabelsChange,
    onProfileSelect,
    onRedo,
    onSelectionChange,
    onUndo,
  } = actions
  const { activeSketch, displaySolution, onDraggingPointChange, presentation, releasedDragTarget } =
    useSketchViewportSolveModel({
      controller,
      draft,
      interactive,
      onDisplayChange,
      onFailedConstraintsChange,
      onProfilesChange,
      onReferenceDimensionLabelsChange,
      sketch,
      solveSketch,
      supportFeatures,
    })
  const drawingConfiguration = useStableSketchDrawingConfiguration({
    ariaLabel: presentation.drawingLabel,
    annotationSolution: displaySolution,
    construction,
    draft,
    externalContextGeometry,
    externalModelCandidates,
    externalPointCandidates,
    editDimensionLabel: presentation.editDimensionLabel,
    editorTool,
    onConstraintSelectionChange,
    onDraggingPointChange,
    onEditorToolChange,
    onOriginPlaneVisibilityChange,
    selectedProfile,
    selectedConstraintId,
    selectedEntityIds,
    selectConstraintLabel: presentation.selectConstraintLabel,
    selectExternalConstraintLabel: presentation.selectExternalConstraintLabel,
    solution: displaySolution,
    variables: controller.report?.snapshot.variables ?? [],
    onDraftChange,
    onProfileSelect,
    onRedo,
    onSelectionChange,
    onUndo,
    originPlaneVisibility,
    repairReferenceId,
    releasedDragTarget,
  })
  const contextSketchLabels = useMemo(
    () => new Map(controller.report?.snapshot.sketches.map(({ id, label }) => [id, label]) ?? []),
    [controller.report?.snapshot.sketches],
  )

  return (
    <section
      aria-label={presentation.ariaLabel}
      aria-hidden={interactive ? undefined : true}
      className={cn(
        "relative min-h-0 overflow-hidden",
        overlay ? "absolute inset-0 z-10 bg-transparent" : "bg-viewport-background",
        !interactive && "pointer-events-none opacity-0",
      )}
      data-interactive={interactive ? "true" : "false"}
      data-overlay={overlay ? "true" : undefined}
      inert={interactive ? undefined : true}
    >
      <StableSketchViewportContent
        activeSketch={activeSketch}
        emptyMessage={presentation.emptyMessage}
        configuration={drawingConfiguration}
        projectionFrame={state.projectionFrame ?? null}
      />
      <SketchSolveOverlay
        active={activeSketch !== null}
        contextGeometry={externalContextGeometry}
        contextSketchLabels={contextSketchLabels}
        degreesOfFreedom={presentation.solve.degreesOfFreedom}
        profileText={presentation.solve.profileText}
        status={presentation.solve.statusText}
      />
      <div className="absolute right-3 top-3 flex flex-col items-end gap-1">
        <SketchExternalReferenceToolbar
          draft={draft}
          editorTool={editorTool}
          modelCandidateCount={externalModelCandidates.length}
          onEditorToolChange={onEditorToolChange}
          pierceCandidateCount={state.pierceCandidateCount ?? 0}
          selectedEntityIds={selectedEntityIds}
        />
      </div>
      <div className="absolute bottom-3 right-3">
        <OriginPlaneVisibilityControls
          onChange={onOriginPlaneVisibilityChange}
          visibility={originPlaneVisibility}
        />
      </div>
      <SketchOrientation plane={activeSketch?.plane ?? null} />
    </section>
  )
}
