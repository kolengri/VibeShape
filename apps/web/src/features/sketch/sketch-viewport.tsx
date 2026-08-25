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
  type FeatureRecord,
  inferSketchPoint,
  type LinearSketchPatternDefinition,
  linearPatternSketchEntities,
  linearSketchPatternTransforms,
  MAX_REGULAR_POLYGON_SIDES,
  MAX_SKETCH_PATTERN_PREVIEW_INSTANCES,
  MIN_REGULAR_POLYGON_SIDES,
  moveSketchPoint,
  projectPointToSketchEllipse,
  projectedExternalSketchEntities,
  type RegularPolygonMode,
  regularPolygonGeometry,
  removeSketchEntities,
  type SketchConstraintDefinition,
  type SketchConstraintId,
  type SketchDirectionInference,
  type SketchEntity,
  type SketchEntityId,
  type SketchInferenceArc,
  type SketchInferenceCandidateQuery,
  type SketchInferenceLine,
  type SketchPoint2,
  type SketchPointInference,
  type SketchPointRelationInference,
  type SketchPointTarget,
  type SketchProfileSelector,
  type SketchRecord,
  setSketchDimensionValue,
  sketchConstraintIdSchema,
  sketchCurvePointIds,
  sketchEllipseGeometry,
  sketchEllipseParameterForPoint,
  sketchEllipsePointAt,
  sketchEllipticalArcGeometry,
  sketchEllipticalArcStartGeometry,
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
import { Link2, Ruler } from "@vibeshape/ui/components/icons"
import { Tooltip, TooltipContent, TooltipTrigger } from "@vibeshape/ui/components/tooltip"
import { cn } from "@vibeshape/ui/lib/cn"
import type {
  ViewerOriginPlane,
  ViewerOriginPlaneVisibility,
} from "@vibeshape/viewer/origin-planes"
import {
  type CSSProperties,
  type Dispatch,
  type KeyboardEvent,
  memo,
  type PointerEvent,
  type RefObject,
  type SetStateAction,
  startTransition,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type WheelEvent,
} from "react"
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
  formatDisplayArea,
  formatDisplayLength,
  useDocumentDisplayUnits,
} from "../../document/document-display-units"
import {
  applyExternalSketchCandidate,
  type ExternalSketchContextGeometry,
  type ExternalSketchGeometryCandidate,
  externalReferenceMatchesCandidate,
} from "./external-sketch-points"
import {
  defaultCircularSketchPatternDefinition,
  SketchCircularPatternForm,
} from "./sketch-circular-pattern-form"
import {
  compatibleSketchConstraintTools,
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
import {
  defaultLinearSketchPatternDefinition,
  SketchLinearPatternForm,
} from "./sketch-linear-pattern-form"
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
  curvesByPointId: ReadonlyMap<string, readonly SketchCurveEntity[]>
  externalLines: readonly DisplayExternalLine[]
  externalPoints: readonly DisplayPoint[]
  externalCurves: readonly DisplayExternalCurve[]
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

const MIN_VIEW_WIDTH = 200
const MIN_VIEW_HEIGHT = 150
const LIVE_DRAG_SOLVE_INTERVAL_MS = 32
const DENSE_DRAG_IDLE_SOLVE_DELAY_MS = 120
const DENSE_DRAG_SOLVE_COMPLEXITY = 128
const VERY_DENSE_DRAG_SOLVE_COMPLEXITY = 512
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
      dragTarget,
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
  }, [dragTarget, rebuildOk, revision, scheduler, sketch, solveSketch])

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
  if (!pointId) return current === null ? null : { ...current, active: false }
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
  reference: Extract<ExternalReference, { kind: "curve" }>,
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
      ? [{ construction: true, id: point.id, x: solved.x, y: solved.y } satisfies DisplayPoint]
      : []
  })
  return curve && solvedPoints.length === points.length ? { curve, points: solvedPoints } : null
}

function displayExternalLine(
  reference: Extract<ExternalReference, { kind: "line" | "model-line" }>,
  solvedById: ReadonlyMap<string, SketchPoint2>,
): DisplayExternalLine | null {
  const start = solvedById.get(reference.projectedStartPointId)
  const end = solvedById.get(reference.projectedEndPointId)
  if (!start || !end) return null
  return {
    id: reference.projectedLineId,
    start: { construction: true, id: reference.projectedStartPointId, ...start },
    end: { construction: true, id: reference.projectedEndPointId, ...end },
  }
}

function displayExternalGeometry(sketch: SketchRecord, solution: SolvedSketchWire | null) {
  const solvedById = new Map(solution?.points.map((point) => [point.entityId, point]))
  const externalPoints: DisplayPoint[] = []
  const externalLines: DisplayExternalLine[] = []
  const externalCurves: DisplayExternalCurve[] = []
  for (const reference of sketch.externalReferences ?? []) {
    if (reference.kind === "curve") {
      const curve = displayExternalCurve(reference, solvedById)
      if (curve) {
        externalCurves.push(curve.curve)
        externalPoints.push(...curve.points)
      }
      continue
    }
    if (reference.kind !== "line" && reference.kind !== "model-line") {
      const point = solvedById.get(reference.projectedPointId)
      if (point) {
        externalPoints.push({
          construction: true,
          id: reference.projectedPointId,
          x: point.x,
          y: point.y,
        })
      }
      continue
    }
    const line = displayExternalLine(reference, solvedById)
    if (line) externalLines.push(line)
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
  const pointsById = new Map([...points, ...externalPoints].map((point) => [point.id, point]))
  const curves = sketch.entities.filter(
    (entity): entity is SketchCurveEntity => entity.type !== "point",
  )
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
    curvesByPointId,
    externalLines,
    externalPoints,
    externalCurves,
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
  const horizontal = rectangle.width > 0 ? (pointer.clientX - rectangle.left) / rectangle.width : 0
  const vertical = rectangle.height > 0 ? (pointer.clientY - rectangle.top) / rectangle.height : 0
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
  selected: boolean
  solvedRadius: number | undefined
}>

function curveDrawingProps(
  entity: Exclude<SketchEntity, { type: "point" }>,
  hidden: boolean,
  interactive: boolean,
  selected: boolean,
  onPointerDown: CurveDrawingProps["onPointerDown"],
) {
  let className = "stroke-primary"
  if (entity.construction) className = "stroke-muted-foreground"
  if (selected) className = "stroke-ring"
  return {
    className,
    fill: "none",
    opacity: hidden ? 0 : undefined,
    ...(interactive
      ? {
          "data-sketch-entity-id": entity.id,
          "data-sketch-entity-type": entity.type,
        }
      : {}),
    ...(interactive && !hidden
      ? {
          onPointerDown: (event: PointerEvent<SVGElement>) => onPointerDown(event, entity.id),
        }
      : { pointerEvents: "none" as const }),
    strokeDasharray: entity.construction ? "6 4" : undefined,
    strokeLinecap: "round" as const,
    strokeWidth: selected ? 3 : 2,
    vectorEffect: "non-scaling-stroke" as const,
  }
}

function curveHitAreaProps(
  entityId: SketchEntityId,
  onPointerDown: CurveDrawingProps["onPointerDown"],
) {
  return {
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
        {...curveDrawingProps(entity, hidden, interactive, selected, onPointerDown)}
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
        {...curveDrawingProps(entity, hidden, interactive, selected, onPointerDown)}
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
        {...curveDrawingProps(entity, hidden, interactive, selected, onPointerDown)}
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
        {...curveDrawingProps(entity, hidden, interactive, selected, onPointerDown)}
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
        {...curveDrawingProps(entity, hidden, interactive, selected, onPointerDown)}
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

function sketchPointMarkerClass(selected: boolean, construction: boolean) {
  if (selected) return "pointer-events-none fill-ring stroke-background"
  return construction
    ? "pointer-events-none fill-background stroke-muted-foreground"
    : "pointer-events-none fill-background stroke-primary"
}

function SketchPointMarker({
  center,
  dragging,
  markerScale,
  point,
  selected,
}: Pick<SketchPointDrawingProps, "center" | "dragging" | "markerScale" | "point" | "selected">) {
  if (center) {
    const halfExtent = 3.5 * markerScale
    const centerClass = selected
      ? "pointer-events-none stroke-ring"
      : "pointer-events-none stroke-primary"
    return (
      <g data-sketch-point-role="center" className={centerClass} opacity={dragging ? 0 : undefined}>
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
      data-sketch-point-role="vertex"
      x={point.x - size / 2}
      y={point.y - size / 2}
      width={size}
      height={size}
      rx={size / 2}
      className={sketchPointMarkerClass(selected, point.construction)}
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
      if (!selectable && !modifiable) return
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

function candidateKey(candidate: ExternalSketchGeometryCandidate) {
  const entityId =
    candidate.kind === "line"
      ? candidate.sourceLineId
      : candidate.kind === "curve"
        ? candidate.sourceEntityId
        : candidate.sourcePointId
  return `${candidate.sourceSketchId}:${entityId}`
}

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
  if (reference.kind === "model-point" || reference.kind === "model-line") {
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

function hasCoincidentPointConstraint(
  sketch: SketchRecord,
  firstPointId: SketchEntityId,
  secondPointId: SketchEntityId,
) {
  return sketch.constraints.some(
    (constraint) =>
      constraint.type === "coincident" &&
      ((constraint.firstPointId === firstPointId && constraint.secondPointId === secondPointId) ||
        (constraint.firstPointId === secondPointId && constraint.secondPointId === firstPointId)),
  )
}

function attachExternalPointToSelection(
  sketch: SketchRecord,
  projectedPointId: SketchEntityId,
  selectedEntityIds: readonly SketchEntityId[],
) {
  const selectedPoints = selectedSketchEntities(sketch, selectedEntityIds).filter(
    (entity): entity is Extract<SketchEntity, { type: "point" }> => entity.type === "point",
  )
  if (selectedPoints.length !== 1) return sketch
  const selectedPoint = selectedPoints[0]
  if (!selectedPoint || hasCoincidentPointConstraint(sketch, selectedPoint.id, projectedPointId)) {
    return sketch
  }
  return appendSketchConstraint(
    sketch,
    {
      type: "coincident",
      firstPointId: selectedPoint.id,
      secondPointId: projectedPointId,
    },
    createBrowserSketchConstraintId,
  )
}

function SketchExternalPoints({
  markerScale,
  onAttach,
  onSelect,
  points,
  selectedEntityIds,
}: Readonly<{
  markerScale: number
  onAttach: ((projectedPointId: SketchEntityId) => void) | null
  onSelect: ((entityId: SketchEntityId, additive: boolean) => void) | null
  points: readonly DisplayPoint[]
  selectedEntityIds: readonly SketchEntityId[]
}>) {
  if (points.length === 0) return null
  const interactive = onAttach !== null || onSelect !== null
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
            if (!interactive) return
            event.stopPropagation()
            if (onSelect) {
              onSelect(point.id, event.metaKey || event.ctrlKey || event.shiftKey)
            } else {
              onAttach?.(point.id)
            }
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
            className={selected.has(line.id) ? "stroke-amber-500" : "stroke-sky-500"}
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
          selected={selected.has(curve.id)}
          solvedRadius={solvedCircles.get(curve.id)}
          onPointerDown={(event, entityId) => {
            event.stopPropagation()
            onSelect(entityId, event.metaKey || event.ctrlKey || event.shiftKey)
          }}
        />
      ))}
    </g>
  )
}

function SketchAvailableExternalGeometry({
  candidates,
  onUse,
}: Readonly<{
  candidates: readonly ExternalSketchGeometryCandidate[]
  onUse: (candidate: ExternalSketchGeometryCandidate) => void
}>) {
  if (candidates.length === 0) return null
  return (
    <g
      aria-label="Available external sketch geometry"
      data-sketch-available-external-geometry-count={candidates.length}
      transform="scale(1 -1)"
    >
      {candidates.map((candidate) => (
        <g
          key={candidateKey(candidate)}
          className="cursor-crosshair"
          data-sketch-available-external-geometry-id={
            candidate.kind === "line"
              ? candidate.sourceLineId
              : candidate.kind === "curve"
                ? candidate.sourceEntityId
                : candidate.sourcePointId
          }
          onPointerDown={(event) => {
            event.stopPropagation()
            onUse(candidate)
          }}
        >
          {candidate.kind === "curve" ? (
            <>
              <polyline
                fill="none"
                points={candidate.points.map(({ x, y }) => `${x},${y}`).join(" ")}
                className="stroke-transparent"
                strokeWidth={12}
                vectorEffect="non-scaling-stroke"
              />
              <polyline
                fill="none"
                points={candidate.points.map(({ x, y }) => `${x},${y}`).join(" ")}
                className="stroke-sky-400"
                strokeDasharray="5 3"
                strokeWidth={2}
                vectorEffect="non-scaling-stroke"
              />
            </>
          ) : candidate.kind === "line" ? (
            <>
              <line
                x1={candidate.start.x}
                y1={candidate.start.y}
                x2={candidate.end.x}
                y2={candidate.end.y}
                className="stroke-transparent"
                strokeWidth={12}
                vectorEffect="non-scaling-stroke"
              />
              <line
                x1={candidate.start.x}
                y1={candidate.start.y}
                x2={candidate.end.x}
                y2={candidate.end.y}
                className="stroke-sky-400"
                strokeDasharray="5 3"
                strokeWidth={2}
                vectorEffect="non-scaling-stroke"
              />
            </>
          ) : (
            <>
              <circle
                cx={candidate.x}
                cy={candidate.y}
                r={5}
                className="fill-background/75 stroke-sky-400"
                strokeDasharray="3 2"
                strokeWidth={1.5}
                vectorEffect="non-scaling-stroke"
              />
              <line
                x1={candidate.x - 8}
                x2={candidate.x + 8}
                y1={candidate.y}
                y2={candidate.y}
                className="stroke-sky-400"
                strokeWidth={1}
                vectorEffect="non-scaling-stroke"
              />
              <line
                x1={candidate.x}
                x2={candidate.x}
                y1={candidate.y - 8}
                y2={candidate.y + 8}
                className="stroke-sky-400"
                strokeWidth={1}
                vectorEffect="non-scaling-stroke"
              />
            </>
          )}
          <title>{candidate.label}</title>
        </g>
      ))}
    </g>
  )
}

function SketchExternalContextGeometry({
  geometry,
}: Readonly<{
  geometry: readonly ExternalSketchContextGeometry[]
}>) {
  const t = useTranslations("app.sketch.viewport")
  if (geometry.length === 0) return null
  return (
    <g
      aria-label={t("earlierSketchContext")}
      className="pointer-events-none stroke-muted-foreground/55"
      data-sketch-context-geometry-count={geometry.length}
      transform="scale(1 -1)"
    >
      {geometry.map((candidate) =>
        candidate.kind === "curve" ? (
          <polyline
            key={contextGeometryKey(candidate)}
            data-sketch-context-curve-type={candidate.sourceType}
            fill="none"
            points={candidate.points.map(({ x, y }) => `${x},${y}`).join(" ")}
            strokeDasharray="5 3"
            strokeWidth={1.25}
            vectorEffect="non-scaling-stroke"
          >
            <title>{candidate.label}</title>
          </polyline>
        ) : candidate.kind === "line" ? (
          <line
            key={contextGeometryKey(candidate)}
            x1={candidate.start.x}
            y1={candidate.start.y}
            x2={candidate.end.x}
            y2={candidate.end.y}
            strokeDasharray="5 3"
            strokeWidth={1.25}
            vectorEffect="non-scaling-stroke"
          >
            <title>{candidate.label}</title>
          </line>
        ) : candidate.role === "center" ? (
          <rect
            key={contextGeometryKey(candidate)}
            data-sketch-context-point-role="center"
            fill="var(--color-viewport-background)"
            height={5}
            width={5}
            x={candidate.x - 2.5}
            y={candidate.y - 2.5}
            strokeWidth={1.25}
            vectorEffect="non-scaling-stroke"
          >
            <title>{candidate.label}</title>
          </rect>
        ) : (
          <circle
            key={contextGeometryKey(candidate)}
            cx={candidate.x}
            cy={candidate.y}
            fill="var(--color-viewport-background)"
            r={2.5}
            strokeWidth={1.25}
            vectorEffect="non-scaling-stroke"
          >
            <title>{candidate.label}</title>
          </circle>
        ),
      )}
    </g>
  )
}

function SketchExternalReferencePresentation({
  availableCandidates,
  contextGeometry,
  editorTool,
  externalCurves,
  externalLines,
  externalPoints,
  markerScale,
  pointsById,
  selectedEntityIds,
  solvedCircles,
  onAttach,
  onSelect,
  onUse,
}: Readonly<{
  availableCandidates: readonly ExternalSketchGeometryCandidate[]
  contextGeometry: readonly ExternalSketchContextGeometry[]
  editorTool: SketchEditorTool
  externalCurves: readonly DisplayExternalCurve[]
  externalLines: readonly DisplayExternalLine[]
  externalPoints: readonly DisplayPoint[]
  markerScale: number
  selectedEntityIds: readonly SketchEntityId[]
  pointsById: SketchPointLookup
  solvedCircles: ReadonlyMap<string, number>
  onAttach: (projectedPointId: SketchEntityId) => void
  onSelect: (entityId: SketchEntityId, additive: boolean) => void
  onUse: (candidate: ExternalSketchGeometryCandidate) => void
}>) {
  return (
    <>
      <SketchExternalContextGeometry geometry={contextGeometry} />
      {editorTool === "use" ? (
        <SketchAvailableExternalGeometry candidates={availableCandidates} onUse={onUse} />
      ) : null}
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
        onAttach={editorTool === "select" && selectedEntityIds.length === 1 ? onAttach : null}
        onSelect={editorTool === "dimension" ? onSelect : null}
      />
    </>
  )
}

function SketchExternalReferenceLayer({
  candidates,
  contextGeometry = [],
  draft,
  editorTool,
  externalCurves,
  externalLines,
  externalPoints,
  markerScale,
  pointsById,
  selectedEntityIds,
  solvedCircles,
  onDraftChange,
  onSelect,
}: Readonly<{
  candidates: readonly ExternalSketchGeometryCandidate[]
  contextGeometry: readonly ExternalSketchContextGeometry[]
  draft: SketchRecord | null
  editorTool: SketchEditorTool
  externalCurves: readonly DisplayExternalCurve[]
  externalLines: readonly DisplayExternalLine[]
  externalPoints: readonly DisplayPoint[]
  markerScale: number
  selectedEntityIds: readonly SketchEntityId[]
  pointsById: SketchPointLookup
  solvedCircles: ReadonlyMap<string, number>
  onDraftChange: (sketch: SketchRecord, mode?: SketchDraftChangeMode) => void
  onSelect: (entityId: SketchEntityId, additive: boolean) => void
}>) {
  const externalReferences = useExternalReferenceInteraction({
    candidates,
    draft,
    editorTool,
    onDraftChange,
    selectedEntityIds,
  })
  const passiveContextGeometry = useMemo(() => {
    const availableKeys = new Set(externalReferences.availableCandidates.map(candidateKey))
    const referencedKeys = new Set(
      (draft?.externalReferences ?? []).map(externalReferenceSourceKey),
    )
    return contextGeometry.filter((geometry) => {
      const key = contextGeometryKey(geometry)
      return !availableKeys.has(key) && !referencedKeys.has(key)
    })
  }, [contextGeometry, draft, externalReferences.availableCandidates])
  return (
    <SketchExternalReferencePresentation
      availableCandidates={externalReferences.availableCandidates}
      contextGeometry={passiveContextGeometry}
      editorTool={editorTool}
      externalCurves={externalCurves}
      externalLines={externalLines}
      externalPoints={externalPoints}
      markerScale={markerScale}
      selectedEntityIds={selectedEntityIds}
      pointsById={pointsById}
      solvedCircles={solvedCircles}
      onAttach={externalReferences.attach}
      onSelect={onSelect}
      onUse={externalReferences.use}
    />
  )
}

function SketchContextGeometryBounds({
  geometry = [],
  setBounds,
}: Readonly<{
  geometry: readonly ExternalSketchContextGeometry[]
  setBounds: Dispatch<SetStateAction<SketchBounds>>
}>) {
  useEffect(() => {
    const points = geometry.flatMap((candidate) =>
      candidate.kind === "curve"
        ? candidate.points
        : candidate.kind === "line"
          ? [candidate.start, candidate.end]
          : [candidate],
    )
    setBounds((bounds) => expandedSketchBounds(bounds, points))
  }, [geometry, setBounds])
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
  id: SketchConstraintId
  label: string
  point: SketchPoint2
  dimensional: boolean
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

function dimensionalLabel(constraint: SketchRecord["constraints"][number]) {
  if (!("value" in constraint)) return null
  return (
    constraint.value.source.expression ??
    `${constraint.value.source.value} ${constraint.value.source.unit}`
  )
}

const geometricConstraintLabels: Partial<
  Record<SketchRecord["constraints"][number]["type"], string>
> = {
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
  tangent: "T",
  symmetric: "S",
  vertical: "V",
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
  pointAnchor: (id: SketchEntityId) => SketchPoint2 | null,
  geometryAnchor: (id: SketchEntityId) => SketchPoint2 | null,
  ellipseAxisAnchor: (id: SketchEntityId, axis: "primary" | "secondary") => SketchPoint2 | null,
): ConstraintGlyph | null {
  const point = constraintAnchor(constraint, pointAnchor, geometryAnchor, ellipseAxisAnchor)
  const label = dimensionalLabel(constraint) ?? geometricConstraintLabels[constraint.type]
  return point && label
    ? { id: constraint.id, label, point, dimensional: "value" in constraint }
    : null
}

function constraintGlyphs(sketch: SketchRecord, solution: SolvedSketchWire | null) {
  const points = new Map(displayPoints(sketch, solution).map((point) => [point.id, point]))
  const entities = new Map(sketch.entities.map((entity) => [entity.id, entity]))
  const solvedCircles = new Map(solution?.circles.map((circle) => [circle.entityId, circle.radius]))
  const pointAnchor = (id: SketchEntityId): SketchPoint2 | null => points.get(id) ?? null
  const geometryAnchor = (id: SketchEntityId) =>
    entityAnchor(entities.get(id), points, solvedCircles)
  const ellipseAxisAnchor = (id: SketchEntityId, axis: "primary" | "secondary") => {
    const entity = entities.get(id)
    if (entity?.type !== "ellipse" && entity?.type !== "elliptical-arc") return null
    return (
      points.get(axis === "primary" ? entity.primaryAxisPointId : entity.secondaryAxisPointId) ??
      null
    )
  }

  return sketch.constraints
    .map((constraint) =>
      constraintGlyph(constraint, pointAnchor, geometryAnchor, ellipseAxisAnchor),
    )
    .filter((glyph): glyph is ConstraintGlyph => glyph !== null)
}

type SketchViewportSize = Readonly<{ height: number; width: number }>

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

function useSketchViewportSize(svgRef: RefObject<SVGSVGElement | null>) {
  const [size, setSize] = useState<SketchViewportSize>({ height: 0, width: 0 })
  useEffect(() => {
    const svg = svgRef.current
    if (!svg) return
    const update = (width: number, height: number) => setSize({ width, height })
    const rectangle = svg.getBoundingClientRect()
    update(rectangle.width, rectangle.height)
    if (typeof ResizeObserver === "undefined") return
    const observer = new ResizeObserver(([entry]) => {
      if (entry) update(entry.contentRect.width, entry.contentRect.height)
    })
    observer.observe(svg)
    return () => observer.disconnect()
  }, [svgRef])
  return size
}

function ConstraintAnnotations({
  bounds,
  dimensionLabelPositions,
  editDimensionLabel,
  interactive,
  onEditDimension,
  onDimensionPositionChange,
  onSelect,
  selectedConstraintId,
  selectConstraintLabel,
  sketch,
  solution,
  viewport,
}: {
  bounds: SketchBounds
  dimensionLabelPositions: ReadonlyMap<SketchConstraintId, SketchPoint2>
  editDimensionLabel: (label: string) => string
  interactive: boolean
  onEditDimension: (constraintId: SketchConstraintId, point: SketchPoint2) => void
  onDimensionPositionChange: (constraintId: SketchConstraintId, point: SketchPoint2) => void
  onSelect: (constraintId: SketchConstraintId) => void
  selectedConstraintId: SketchConstraintId | null
  selectConstraintLabel: (label: string) => string
  sketch: SketchRecord
  solution: SolvedSketchWire | null
  viewport: SketchViewportSize
}) {
  const pointerEventsClass = interactive ? "pointer-events-auto" : "pointer-events-none"
  const dragRef = useRef<{
    clientX: number
    clientY: number
    element: HTMLButtonElement
    id: SketchConstraintId
    lastClientX: number
    lastClientY: number
    point: SketchPoint2
    pointerId: number
    scale: number
  } | null>(null)
  const dragCleanupRef = useRef<(() => void) | null>(null)
  const suppressClickRef = useRef(false)
  const scale = Math.min(viewport.width / bounds.width, viewport.height / bounds.height)
  useEffect(
    () => () => {
      dragCleanupRef.current?.()
    },
    [],
  )
  const glyphs = constraintGlyphs(sketch, solution).map((glyph) => {
    const position = glyph.dimensional ? dimensionLabelPositions.get(glyph.id) : null
    return position ? { ...glyph, point: position } : glyph
  })
  return (
    <div className="pointer-events-none absolute inset-0">
      {glyphs.map((glyph) => (
        <button
          key={glyph.id}
          type="button"
          data-sketch-constraint-id={glyph.id}
          data-sketch-constraint-kind={glyph.dimensional ? "dimension" : "geometric"}
          aria-label={
            glyph.dimensional ? editDimensionLabel(glyph.label) : selectConstraintLabel(glyph.label)
          }
          aria-pressed={selectedConstraintId === glyph.id}
          className={cn(
            buttonVariants({
              size: "xs",
              variant: selectedConstraintId === glyph.id ? "secondary" : "ghost",
            }),
            glyph.dimensional
              ? `${pointerEventsClass} absolute h-5 min-w-5 -translate-y-1/2 bg-background/85 px-1 py-0 font-mono text-[10px] text-foreground shadow-xs`
              : `${pointerEventsClass} absolute h-5 min-w-5 -translate-y-1/2 bg-background/75 px-1 py-0 font-mono text-[10px] font-semibold text-primary shadow-xs`,
          )}
          style={constraintAnnotationPosition(glyph.point, bounds, viewport)}
          onClick={(event) => {
            event.stopPropagation()
            if (suppressClickRef.current) {
              suppressClickRef.current = false
              return
            }
            onSelect(glyph.id)
          }}
          onDoubleClick={(event) => {
            if (!glyph.dimensional) return
            event.preventDefault()
            event.stopPropagation()
            onEditDimension(glyph.id, glyph.point)
          }}
          onPointerDown={(event) => {
            if (!glyph.dimensional || event.button !== 0) return
            event.preventDefault()
            event.stopPropagation()
            event.currentTarget.setPointerCapture?.(event.pointerId)
            dragCleanupRef.current?.()
            suppressClickRef.current = false
            const overlayRectangle = event.currentTarget.parentElement?.getBoundingClientRect()
            const pointerScale = overlayRectangle
              ? Math.min(
                  overlayRectangle.width / bounds.width,
                  overlayRectangle.height / bounds.height,
                )
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
              drag.lastClientX = moveEvent.clientX
              drag.lastClientY = moveEvent.clientY
              drag.element.style.translate = `${deltaX}px ${deltaY}px`
            }
            const cleanup = () => {
              window.removeEventListener("pointermove", move)
              window.removeEventListener("pointerup", finish)
              window.removeEventListener("pointercancel", finish)
              dragCleanupRef.current = null
            }
            const finish = (finishEvent: globalThis.PointerEvent) => {
              if (dragRef.current?.pointerId !== finishEvent.pointerId) return
              const drag = dragRef.current
              const deltaX = drag.lastClientX - drag.clientX
              const deltaY = drag.lastClientY - drag.clientY
              dragRef.current = null
              drag.element.style.translate = ""
              if (
                Math.hypot(deltaX, deltaY) >= 3 &&
                Number.isFinite(drag.scale) &&
                drag.scale > 0
              ) {
                onDimensionPositionChange(drag.id, {
                  x: drag.point.x + deltaX / drag.scale,
                  y: drag.point.y - deltaY / drag.scale,
                })
              }
              cleanup()
            }
            dragCleanupRef.current = cleanup
            window.addEventListener("pointermove", move)
            window.addEventListener("pointerup", finish)
            window.addEventListener("pointercancel", finish)
          }}
        >
          {glyph.label}
        </button>
      ))}
    </div>
  )
}

const StableConstraintAnnotations = memo(ConstraintAnnotations)

function SketchDrawingAnnotations({
  configuration,
  dimensionLabelPositions,
  onEditDimension,
  onDimensionPositionChange,
  sketch,
  state,
}: Pick<SketchDrawingViewProps, "configuration" | "sketch" | "state"> &
  Readonly<{
    dimensionLabelPositions: ReadonlyMap<SketchConstraintId, SketchPoint2>
    onEditDimension: (constraintId: SketchConstraintId, point: SketchPoint2) => void
    onDimensionPositionChange: (constraintId: SketchConstraintId, point: SketchPoint2) => void
  }>) {
  return (
    <StableConstraintAnnotations
      bounds={state.bounds}
      dimensionLabelPositions={dimensionLabelPositions}
      editDimensionLabel={configuration.editDimensionLabel}
      interactive={state.editable && isSketchSelectionTool(configuration.editorTool)}
      onEditDimension={onEditDimension}
      onDimensionPositionChange={onDimensionPositionChange}
      selectedConstraintId={configuration.selectedConstraintId}
      selectConstraintLabel={configuration.selectConstraintLabel}
      sketch={sketch}
      solution={configuration.annotationSolution}
      viewport={state.viewportSize}
      onSelect={configuration.onConstraintSelectionChange}
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
  draft: SketchRecord | null
  nextTool?: SketchEditorTool
  pending: PendingGeometry | null
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
  return relations.reduce((current, relation) => {
    const exists = current.constraints.some(
      (constraint) =>
        constraint.type === relation.type &&
        constraint.pointId === pointId &&
        constraint.lineId === relation.lineId,
    )
    return exists
      ? current
      : appendSketchConstraint(
          current,
          { type: relation.type, pointId, lineId: relation.lineId },
          createBrowserSketchConstraintId,
        )
  }, sketch)
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
  return {
    draft: appendSketchMidpointLine(input.draft, {
      construction: input.construction,
      createConstraintId: createBrowserSketchConstraintId,
      createEntityId: createBrowserSketchEntityId,
      endpoint: input.target,
      midpoint: input.pending.midpoint,
    }).sketch,
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
      <PointInferenceMark kind={inference.kind} size={size} />
      <DirectionInferenceMark glyph={directionGlyph} size={size} />
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
    case "intersection":
      return "×"
    case "midpoint":
      return "M"
    case "point-on-line":
      return "⊙"
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

function placeRectangle(input: PlacementInput): PlacementUpdate {
  if (input.pending?.kind !== "rectangle") {
    return { draft: null, pending: { kind: "rectangle", firstCorner: input.point } }
  }
  return {
    draft: appendSketchRectangle(input.draft, {
      construction: input.construction,
      createConstraintId: createBrowserSketchConstraintId,
      createEntityId: createBrowserSketchEntityId,
      firstCorner: input.pending.firstCorner,
      oppositeCorner: input.point,
    }).sketch,
    pending: null,
  }
}

function placeCenterRectangle(input: PlacementInput): PlacementUpdate {
  if (input.pending?.kind !== "center-rectangle") {
    return { draft: null, pending: { kind: "center-rectangle", center: input.target } }
  }
  return {
    draft: appendSketchCenterRectangle(input.draft, {
      center: input.pending.center,
      construction: input.construction,
      corner: input.point,
      createConstraintId: createBrowserSketchConstraintId,
      createEntityId: createBrowserSketchEntityId,
    }).sketch,
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
  return {
    draft: appendSketchAlignedRectangle(input.draft, {
      construction: input.construction,
      createConstraintId: createBrowserSketchConstraintId,
      createEntityId: createBrowserSketchEntityId,
      firstSideStart: input.pending.start,
      firstSideEnd: input.pending.end,
      widthPoint: input.point,
    }).sketch,
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
  return {
    draft: appendSketchCenteredAlignedRectangle(input.draft, {
      center: input.pending.center,
      construction: input.construction,
      createConstraintId: createBrowserSketchConstraintId,
      createEntityId: createBrowserSketchEntityId,
      sidePoint: input.pending.side,
      widthPoint: input.point,
    }).sketch,
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
  return {
    draft: appendSketchStraightSlot(input.draft, {
      construction: input.construction,
      createConstraintId: createBrowserSketchConstraintId,
      createEntityId: createBrowserSketchEntityId,
      endCenter: input.pending.end,
      startCenter: input.pending.start,
      widthPoint: input.point,
    }).sketch,
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
  return {
    draft: appendSketchCenteredSlot(input.draft, {
      center: input.pending.center,
      construction: input.construction,
      createConstraintId: createBrowserSketchConstraintId,
      createEntityId: createBrowserSketchEntityId,
      endCenter: input.pending.end,
      widthPoint: input.point,
    }).sketch,
    pending: null,
  }
}

function placeSlotFromSelection(input: PlacementInput): PlacementUpdate {
  if (input.pending?.kind !== "slot-from-selection-width") {
    return { draft: null, nextTool: "select", pending: null }
  }
  return {
    draft: appendSketchSlotAroundLine(input.draft, {
      construction: input.construction,
      createConstraintId: createBrowserSketchConstraintId,
      createEntityId: createBrowserSketchEntityId,
      lineId: input.pending.lineId,
      widthPoint: input.point,
    }).sketch,
    nextTool: "select",
    pending: null,
  }
}

function placeCircle(input: PlacementInput): PlacementUpdate {
  if (input.pending?.kind !== "circle") {
    return { draft: null, pending: { kind: "circle", center: input.target } }
  }
  return {
    draft: appendSketchCircle(input.draft, {
      center: input.pending.center,
      construction: input.construction,
      createEntityId: createBrowserSketchEntityId,
      perimeterPoint: input.point,
    }).sketch,
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
  return {
    draft: appendSketchEllipse(input.draft, {
      center: input.pending.center,
      construction: input.construction,
      createEntityId: createBrowserSketchEntityId,
      primaryAxisPoint: input.pending.primaryAxisPoint,
      secondaryRadiusPoint: input.point,
    }).sketch,
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
  return {
    draft: appendSketchEllipticalArc(input.draft, {
      center: pending.center,
      construction: input.construction,
      createEntityId: createBrowserSketchEntityId,
      endPoint: { kind: "new", point: input.point },
      primaryAxisPoint: pending.primaryAxisPoint,
      secondaryAxisPoint: pending.secondaryAxisPoint,
      startPoint: pending.startPoint,
    }).sketch,
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
  return {
    draft: appendSketchRegularPolygon(input.draft, {
      center: pending.center,
      construction: input.construction,
      createConstraintId: createBrowserSketchConstraintId,
      createEntityId: createBrowserSketchEntityId,
      mode,
      radiusPoint: pending.radiusPoint,
      sideCount,
    }).sketch,
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
  return {
    draft: appendSketchThreePointCircle(input.draft, {
      construction: input.construction,
      createConstraintId: createBrowserSketchConstraintId,
      createEntityId: createBrowserSketchEntityId,
      firstPoint: input.pending.first,
      secondPoint: input.pending.second,
      thirdPoint: input.target,
    }).sketch,
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
  return {
    draft: appendSketchArc(input.draft, {
      center: input.pending.center,
      construction: input.construction,
      createEntityId: createBrowserSketchEntityId,
      start: input.pending.start,
      end: input.point,
    }).sketch,
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
  return {
    draft: appendSketchTangentArc(input.draft, {
      construction: input.construction,
      createConstraintId: createBrowserSketchConstraintId,
      createEntityId: createBrowserSketchEntityId,
      end: input.target,
      lineId: input.pending.lineId,
      startPointId: input.pending.startPointId,
    }).sketch,
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
  return {
    draft: appendSketchThreePointArc(input.draft, {
      construction: input.construction,
      createEntityId: createBrowserSketchEntityId,
      firstEndpoint: input.pending.start,
      secondEndpoint: input.pending.end,
      pointOnArc: input.point,
    }).sketch,
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
  Exclude<SketchEditorTool, "dimension" | "select" | "use" | SketchModificationTool>,
  (input: PlacementInput) => PlacementUpdate
>

function placementUpdate(tool: SketchEditorTool, input: PlacementInput) {
  return isSketchSelectionTool(tool) || tool === "use" || isSketchModificationTool(tool)
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

function publishPlacementResolution(
  resolution: ReturnType<typeof safePlacementUpdate>,
  actions: {
    onDraftChange: SketchDrawingConfiguration["onDraftChange"]
    onEditorToolChange: SketchDrawingConfiguration["onEditorToolChange"]
    setInference: Dispatch<SetStateAction<SketchPointInference | null>>
    setPending: Dispatch<SetStateAction<PendingGeometry | null>>
  },
) {
  if (!resolution.ok) {
    actions.setPending(null)
    return
  }
  const { update } = resolution
  if (!update) return
  if (update.draft) actions.onDraftChange(update.draft)
  if (update.nextTool) actions.onEditorToolChange(update.nextTool)
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
  lines: readonly SketchInferenceLine[]
  points: readonly DisplayPoint[]
}>

const EMPTY_INFERENCE_REFERENCES: SketchInferenceReferences = {
  arcs: [],
  lines: [],
  points: [],
}

function sketchInferenceReferences(
  presentation: SketchGeometryPresentation,
): SketchInferenceReferences {
  const lines: SketchInferenceLine[] = []
  const arcs: SketchInferenceArc[] = []
  for (const entity of presentation.curves) {
    if (entity.type === "line") {
      const start = presentation.pointsById.get(entity.startPointId)
      const end = presentation.pointsById.get(entity.endPointId)
      if (start && end) {
        lines.push({
          id: entity.id,
          startPointId: entity.startPointId,
          endPointId: entity.endPointId,
          start,
          end,
        })
      }
    }
    if (entity.type === "arc") {
      const center = presentation.pointsById.get(entity.centerPointId)
      if (center) {
        arcs.push({
          id: entity.id,
          center,
          startPointId: entity.startPointId,
          endPointId: entity.endPointId,
        })
      }
    }
  }
  return { arcs, lines, points: presentation.points }
}

function supportsPersistentPointRelations(editorTool: SketchEditorTool) {
  return editorTool === "line" || editorTool === "point"
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

function placementInference(input: {
  bounds: SketchBounds
  draft: SketchRecord | null
  editorTool: SketchEditorTool
  pending: PendingGeometry | null
  point: SketchPoint2
  rectangle: Readonly<{ width: number; height: number }>
  references: SketchInferenceReferences
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
  return inferSketchPoint({
    ...(anchor
      ? {
          anchor: anchor.point,
          ...(anchor.pointId ? { anchorPointId: anchor.pointId } : {}),
        }
      : {}),
    arcs: input.editorTool === "line" ? input.references.arcs : [],
    lines: supportsRelations ? input.references.lines : [],
    point: input.point,
    points: input.references.points,
    tolerance: sketchInferenceTolerance(input.bounds, input.rectangle),
  })
}

function draggedPointInference(input: {
  bounds: SketchBounds
  point: SketchPoint2
  rectangle: Readonly<{ width: number; height: number }>
  references: SketchInferenceReferences
  suppressed: boolean
}) {
  if (input.suppressed) return unsnappedInference(input.point)
  return inferSketchPoint({
    lines: input.references.lines,
    point: input.point,
    points: input.references.points,
    tolerance: sketchInferenceTolerance(input.bounds, input.rectangle),
  })
}

function draggedPointCandidates(
  candidates: ReturnType<SketchInferenceCandidateQuery<DisplayPoint>>,
  pointId: SketchEntityId,
): Omit<SketchInferenceReferences, "arcs"> {
  return {
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
    event.currentTarget.setPointerCapture(event.pointerId)
    input.setPanGesture({
      bounds: input.bounds,
      clientX: event.clientX,
      clientY: event.clientY,
      pointerId: event.pointerId,
    })
    return
  }
  if (event.target !== event.currentTarget) return
  if (isSketchSelectionTool(input.editorTool)) {
    input.onSelectionChange([])
    return
  }
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
  draft,
  inferenceCandidateQuery,
  onDraftChange,
  onDraggingPointChange,
  onPreview,
  svgRef,
}: Pick<SketchDrawingConfiguration, "draft" | "onDraftChange" | "onDraggingPointChange"> & {
  bounds: SketchBounds
  inferenceCandidateQuery: SketchInferenceCandidateQuery<DisplayPoint>
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
      )
      const inference = draggedPointInference({
        bounds,
        point,
        rectangle,
        references: { arcs: [], ...candidates },
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
      const moved = moveSketchPoint(draft, draggingPointId, finalPreview.point)
      onDraftChange(
        applyDraggedPointInference(moved, draggingPointId, finalPreview.inference),
        "record",
      )
    }
    if (draggingPointId) onDraggingPointChange(null)
    setDraggingPointId(null)
    dragRectangleRef.current = null
    lastDragPreviewRef.current = null
  }, [draft, draggingPointId, flush, onDraftChange, onDraggingPointChange])
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

function SketchDrawingView({
  configuration,
  handlers,
  sketch,
  state,
  svgRef,
}: SketchDrawingViewProps) {
  const markerScale = sketchMarkerScale(state.bounds, state.viewportSize)
  return (
    <div className="relative size-full">
      <svg
        ref={svgRef}
        aria-label={configuration.ariaLabel}
        className={`size-full touch-none outline-none focus-visible:ring-2 focus-visible:ring-ring ${usesSketchCrosshairCursor(configuration.editorTool) ? "cursor-crosshair" : ""}`}
        data-sketch-dragging-point-id={state.draggingPointId ?? undefined}
        data-sketch-modification-tool={
          isSketchModificationTool(configuration.editorTool) ? configuration.editorTool : undefined
        }
        role="img"
        tabIndex={state.editable ? 0 : undefined}
        viewBox={`${state.bounds.minX} ${-state.bounds.minY - state.bounds.height} ${state.bounds.width} ${state.bounds.height}`}
        onKeyDown={handlers.onKeyDown}
        onPointerDown={handlers.onCanvasPointerDown}
        onPointerMove={handlers.onPointerMove}
        onPointerUp={handlers.onPointerUp}
        onPointerCancel={handlers.onPointerUp}
        onPointerLeave={handlers.onPointerLeave}
        onContextMenu={(event) => event.preventDefault()}
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
          solution={configuration.annotationSolution}
          onSelect={configuration.onProfileSelect}
        />
        <SketchExternalReferenceLayer
          candidates={configuration.externalPointCandidates}
          contextGeometry={configuration.externalContextGeometry}
          draft={configuration.draft}
          editorTool={configuration.editorTool}
          externalCurves={state.geometry.externalCurves}
          externalLines={state.geometry.externalLines}
          externalPoints={state.geometry.externalPoints}
          markerScale={markerScale}
          pointsById={state.geometry.pointsById}
          selectedEntityIds={configuration.selectedEntityIds}
          solvedCircles={state.geometry.solvedCircles}
          onDraftChange={configuration.onDraftChange}
          onSelect={handlers.onSelection}
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
      <SketchDrawingAnnotations
        configuration={configuration}
        dimensionLabelPositions={state.dimensionLabelPositions}
        onEditDimension={handlers.onEditDimension}
        onDimensionPositionChange={handlers.onDimensionPositionChange}
        sketch={sketch}
        state={state}
      />
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
  geometry: SketchGeometryPresentation
}) {
  const references = useMemo(
    () => (input.draft ? sketchInferenceReferences(input.geometry) : EMPTY_INFERENCE_REFERENCES),
    [input.draft, input.geometry],
  )
  const candidateQuery = useMemo(
    () =>
      createSketchInferenceCandidateQuery({
        cellSize: input.cellSize,
        lines: references.lines,
        points: references.points,
      }),
    [input.cellSize, references],
  )
  return { candidateQuery, references }
}

function useExternalReferenceInteraction({
  candidates,
  draft,
  editorTool,
  onDraftChange,
  selectedEntityIds,
}: Pick<
  SketchDrawingConfiguration,
  "draft" | "editorTool" | "onDraftChange" | "selectedEntityIds"
> & {
  candidates: readonly ExternalSketchGeometryCandidate[]
}) {
  const contextCandidates = useMemo(() => {
    if (!draft) return []
    const references = draft.externalReferences ?? []
    return candidates.filter(
      (candidate) =>
        !references.some((reference) => externalReferenceMatchesCandidate(reference, candidate)),
    )
  }, [candidates, draft])
  const availableCandidates = useMemo(
    () => (editorTool === "use" ? contextCandidates : []),
    [contextCandidates, editorTool],
  )
  const use = useCallback(
    (candidate: ExternalSketchGeometryCandidate) => {
      if (!draft) return
      const next = applyExternalSketchCandidate(draft, candidate, selectedEntityIds)
      if (next !== draft) onDraftChange(next)
    },
    [draft, onDraftChange, selectedEntityIds],
  )
  const attach = useCallback(
    (projectedPointId: SketchEntityId) => {
      if (!draft) return
      const next = attachExternalPointToSelection(draft, projectedPointId, selectedEntityIds)
      if (next !== draft) onDraftChange(next)
    },
    [draft, onDraftChange, selectedEntityIds],
  )
  return { attach, availableCandidates, contextCandidates, use }
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
        ? { initialExpression: dimensionalLabel(editedConstraint) ?? "" }
        : {})}
      initialKind={editor.initialKind}
      mode={editor.kind}
      options={editorOptions}
      position={constraintAnnotationPosition(editor.anchor, bounds, viewportSize)}
      variables={configuration.variables}
      onCancel={onClose}
      onSubmit={submit}
    />
  )
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

function SketchDrawing({
  configuration,
  sketch,
}: {
  configuration: SketchDrawingConfiguration
  sketch: SketchRecord
}) {
  const {
    construction,
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
  const geometry = useMemo(
    () => createSketchGeometryPresentation(sketch, solution),
    [sketch, solution],
  )
  const { bounds, setBounds, svgRef, viewportSize } = useSketchCanvasViewport(geometry)
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
  const annotationProfiles = useMemo(
    () => (annotationSolution ? profileSelectors(annotationSolution) : []),
    [annotationSolution],
  )
  const inferencePresentation = useSketchInferencePresentation({
    cellSize: dragInferenceCellSize(bounds, viewportSize),
    draft,
    geometry,
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
    draft,
    inferenceCandidateQuery: inferencePresentation.candidateQuery,
    onDraftChange,
    onDraggingPointChange,
    onPreview: handleDragPreview,
    svgRef,
  })
  const dragTarget = useMemo<SketchDragTarget | null>(
    () =>
      draggingPointId && cursor
        ? { entityId: draggingPointId, x: cursor.x, y: cursor.y }
        : configuration.releasedDragTarget,
    [configuration.releasedDragTarget, cursor, draggingPointId],
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
      draft,
      editorTool,
      pending,
      point,
      rectangle,
      references: inferencePresentation.references,
      suppressed,
    })
  const appendAt = useCallback(
    (target: SketchPointTarget, pointInference?: SketchPointInference) => {
      if (!draft) return
      const point = pointForTarget(draft, target)
      const input = placementInputWithInference({
        construction,
        draft,
        inference: pointInference,
        pending,
        point,
        target,
      })
      publishPlacementResolution(safePlacementUpdate(editorTool, input), {
        onDraftChange,
        onEditorToolChange,
        setInference,
        setPending,
      })
    },
    [construction, draft, editorTool, onDraftChange, onEditorToolChange, pending],
  )
  const handlePointerMove = (event: PointerEvent<SVGSVGElement>) => {
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
  const handleOffsetSourceAction = (entityId: SketchEntityId) => {
    if (!draft) return
    const entity = draft.entities.find(({ id }) => id === entityId)
    if (entity?.type !== "line") return
    const lineIds = connectedSketchOffsetLineIds(draft, entity.id)
    onSelectionChange(lineIds)
    setInference(null)
    setPending({ kind: "offset-distance", lineIds, referenceLineId: entity.id })
  }
  const handleCurveAction = (event: PointerEvent<SVGElement>, entityId: SketchEntityId) => {
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
    if (transform.consumePointerUp(event)) return
    finishPointDrag()
    setInference(null)
    setPanGesture(null)
  }
  const handlePointerLeave = () => {
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
          onPointerLeave: handlePointerLeave,
          onPointerMove: handlePointerMove,
          onPointerUp: handlePointerUp,
          onSelection: handleSelection,
          onTransformStart: transform.start,
          onTransformApply: transform.applyExact,
          onTransformCancel: transform.cancel,
          onWheel: handleWheel,
        }}
        sketch={sketch}
        state={{
          annotationProfiles,
          bounds,
          circularPattern: circularPattern.presentation,
          cursor,
          dragTarget,
          draggingPointId,
          dimensionLabelPositions: dimensions.labelPositions,
          dimensionPreview: dimensions.preview,
          editable,
          geometry,
          inference,
          linearPattern: linearPattern.presentation,
          pending,
          transform: transform.presentation,
          viewportSize,
        }}
        svgRef={svgRef}
      />
      {dimensions.overlay}
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
  externalPointCandidates: readonly ExternalSketchGeometryCandidate[]
  editDimensionLabel: (label: string) => string
  editorTool: SketchEditorTool
  onConstraintSelectionChange: (constraintId: SketchConstraintId) => void
  onDraftChange: (sketch: SketchRecord, mode?: SketchDraftChangeMode) => void
  onDraggingPointChange: (pointId: SketchEntityId | null, point?: SketchPoint2) => void
  onEditorToolChange: (tool: SketchEditorTool) => void
  onOriginPlaneVisibilityChange: (plane: ViewerOriginPlane, visible: boolean) => void
  onProfileSelect: (profile: SketchProfileSelector) => void
  onRedo: () => void
  onSelectionChange: (entityIds: readonly SketchEntityId[]) => void
  onUndo: () => void
  originPlaneVisibility: ViewerOriginPlaneVisibility
  releasedDragTarget: SketchDragTarget | null
  selectConstraintLabel: (label: string) => string
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
}: {
  activeSketch: SketchRecord | null
  configuration: SketchDrawingConfiguration
  emptyMessage: string
}) {
  if (!activeSketch) {
    return (
      <div className="absolute inset-0 grid place-items-center px-6 text-center">
        <p className="max-w-sm text-sm text-muted-foreground">{emptyMessage}</p>
      </div>
    )
  }
  return <SketchDrawing key={activeSketch.id} configuration={configuration} sketch={activeSketch} />
}

const StableSketchViewportContent = memo(SketchViewportContent)

function SketchSolveOverlay({
  active,
  degreesOfFreedom,
  profileText,
  status,
}: {
  active: boolean
  degreesOfFreedom: string | null
  profileText: string | null
  status: string | null
}) {
  if (!active) return null
  return (
    <div className="pointer-events-none absolute left-3 top-3 grid gap-1 rounded-md border bg-background/90 px-3 py-2 text-xs shadow-sm">
      <span className="font-medium" role="status">
        {status}
      </span>
      {degreesOfFreedom ? <span className="text-muted-foreground">{degreesOfFreedom}</span> : null}
      {profileText ? <span className="text-muted-foreground">{profileText}</span> : null}
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

function SketchPrecisionToolbar({
  draft,
  editorTool,
  onDraftChange,
  onEditorToolChange,
  selectedEntityIds,
}: Readonly<{
  draft: SketchRecord | null
  editorTool: SketchEditorTool
  onDraftChange: (sketch: SketchRecord, mode?: SketchDraftChangeMode) => void
  onEditorToolChange: (tool: SketchEditorTool) => void
  selectedEntityIds: readonly SketchEntityId[]
}>) {
  const t = useTranslations("app.shell.taskPanel.sketch")
  const viewportT = useTranslations("app.sketch.viewport")
  const entities = useMemo(
    () => (draft ? selectedSketchConstraintEntities(draft, selectedEntityIds) : []),
    [draft, selectedEntityIds],
  )
  const constraints = compatibleSketchConstraintTools(entities)
  const dimensions = draft
    ? compatibleSketchDimensionToolsForSelection(draft, selectedEntityIds)
    : []
  if (!draft || editorTool !== "select" || (constraints.length === 0 && dimensions.length === 0)) {
    return null
  }
  const labels: Record<SketchConstraintToolKind, string> = {
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
  }
  const apply = (definition: SketchConstraintDefinition) => {
    onDraftChange(appendSketchConstraint(draft, definition, createBrowserSketchConstraintId))
  }
  return (
    <div
      aria-label={viewportT("precisionTools")}
      className="flex items-center gap-0.5 rounded-md border bg-background/90 p-1 shadow-sm backdrop-blur-sm"
      role="toolbar"
    >
      {constraints.map(({ definition, kind }) => (
        <Tooltip key={kind}>
          <TooltipTrigger asChild>
            <Button
              type="button"
              size="icon-sm"
              variant="ghost"
              aria-label={labels[kind]}
              onClick={() => apply(definition)}
            >
              <span aria-hidden="true" className="font-mono text-sm font-semibold">
                {constraintToolSymbols[kind]}
              </span>
            </Button>
          </TooltipTrigger>
          <TooltipContent>{labels[kind]}</TooltipContent>
        </Tooltip>
      ))}
      {dimensions.length > 0 ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              size="icon-sm"
              variant="ghost"
              aria-label={viewportT("dimensionTool")}
              onClick={() => onEditorToolChange("dimension")}
            >
              <Ruler aria-hidden="true" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{viewportT("dimensionTool")}</TooltipContent>
        </Tooltip>
      ) : null}
    </div>
  )
}

function SketchExternalReferenceToolbar({
  candidates,
  draft,
  editorTool,
  onEditorToolChange,
}: Readonly<{
  candidates: readonly ExternalSketchGeometryCandidate[]
  draft: SketchRecord | null
  editorTool: SketchEditorTool
  onEditorToolChange: (tool: SketchEditorTool) => void
}>) {
  const t = useTranslations("app.shell.taskPanel.sketch")
  const availableCandidates = useMemo(() => {
    if (!draft) return []
    const references = draft.externalReferences ?? []
    return candidates.filter(
      (candidate) =>
        !references.some((reference) => externalReferenceMatchesCandidate(reference, candidate)),
    )
  }, [candidates, draft])
  if (!draft || availableCandidates.length === 0) return null
  const active = editorTool === "use"
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          size="icon-sm"
          variant={active ? "secondary" : "ghost"}
          aria-label={t("useExternalGeometry")}
          aria-pressed={active}
          onClick={() => onEditorToolChange(active ? "select" : "use")}
        >
          <Link2 aria-hidden="true" />
        </Button>
      </TooltipTrigger>
      <TooltipContent>{t("useExternalGeometry")}</TooltipContent>
    </Tooltip>
  )
}

type SketchViewportState = Readonly<{
  construction: boolean
  controller: DocumentControllerState
  draft: SketchRecord | null
  editorTool: SketchEditorTool
  externalContextGeometry: readonly ExternalSketchContextGeometry[]
  externalPointCandidates: readonly ExternalSketchGeometryCandidate[]
  originPlaneVisibility: ViewerOriginPlaneVisibility
  selectedConstraintId: SketchConstraintId | null
  selectedEntityIds: readonly SketchEntityId[]
  selectedProfile: SketchProfileSelector | null
  sketch: SketchRecord | null
  supportFeatures: readonly FeatureRecord[]
}>

type SketchViewportActions = Readonly<{
  onDisplayChange: (display: SketchDisplayRecord | null) => void
  onDraftChange: (sketch: SketchRecord, mode?: SketchDraftChangeMode) => void
  onEditorToolChange: (tool: SketchEditorTool) => void
  onFailedConstraintsChange: (constraintIds: readonly SketchConstraintId[]) => void
  onOriginPlaneVisibilityChange: (plane: ViewerOriginPlane, visible: boolean) => void
  onConstraintSelectionChange: (constraintId: SketchConstraintId | null) => void
  onProfilesChange: (profiles: readonly SketchProfileSelector[]) => void
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
  solveState: SolveState,
) {
  const t = useTranslations("app.sketch.viewport")
  const formatter = useFormatter()
  const displayUnits = useDocumentDisplayUnits()
  const editDimensionLabel = useCallback((label: string) => t("editDimension", { label }), [t])
  const selectConstraintLabel = useCallback(
    (label: string) => t("selectConstraint", { label }),
    [t],
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
    empty: activeSketch === null || activeSketch.entities.length === 0,
    formatNumber: (value) => formatter.number(value, { maximumFractionDigits: 6 }),
    lengthUnit: displayUnits.length,
    solution,
    solveState,
  })
  return {
    ariaLabel: t("ariaLabel"),
    drawingLabel: draft === null ? t("solvedDrawing") : t("draftDrawing"),
    editDimensionLabel,
    emptyMessage: t("empty"),
    selectConstraintLabel,
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
    return materializeSketchDisplay(snapshot, activeSketch, displaySolution, features)
  }, [activeSketch, controller.report?.snapshot, displaySolution, features, interactive])
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
    releasedDragTarget,
    selectedConstraintId,
    selectedEntityIds,
    selectedProfile,
    selectConstraintLabel,
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
      releasedDragTarget,
      selectedConstraintId,
      selectedEntityIds,
      selectedProfile,
      selectConstraintLabel,
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
    activeSolveState,
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
    externalPointCandidates,
    originPlaneVisibility,
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
    solution: displaySolution,
    variables: controller.report?.snapshot.variables ?? [],
    onDraftChange,
    onProfileSelect,
    onRedo,
    onSelectionChange,
    onUndo,
    originPlaneVisibility,
    releasedDragTarget,
  })

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
      />
      <SketchSolveOverlay
        active={activeSketch !== null}
        degreesOfFreedom={presentation.solve.degreesOfFreedom}
        profileText={presentation.solve.profileText}
        status={presentation.solve.statusText}
      />
      <div className="absolute right-3 top-3 flex flex-col items-end gap-1">
        <SketchExternalReferenceToolbar
          candidates={externalPointCandidates}
          draft={draft}
          editorTool={editorTool}
          onEditorToolChange={onEditorToolChange}
        />
        <SketchPrecisionToolbar
          draft={draft}
          editorTool={editorTool}
          selectedEntityIds={selectedEntityIds}
          onDraftChange={onDraftChange}
          onEditorToolChange={onEditorToolChange}
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
