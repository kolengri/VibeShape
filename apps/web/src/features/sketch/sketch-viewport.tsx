import {
  alignedRectangleGeometry,
  appendSketchAlignedRectangle,
  appendSketchArc,
  appendSketchCenteredAlignedRectangle,
  appendSketchCenteredSlot,
  appendSketchCenterRectangle,
  appendSketchCircle,
  appendSketchConstraint,
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
  centeredAlignedRectangleGeometry,
  extendSketchCurve,
  inferSketchPoint,
  MAX_REGULAR_POLYGON_SIDES,
  MIN_REGULAR_POLYGON_SIDES,
  moveSketchPoint,
  type RegularPolygonMode,
  regularPolygonGeometry,
  removeSketchEntities,
  type SketchConstraintDefinition,
  type SketchConstraintId,
  type SketchDirectionInference,
  type SketchEntity,
  type SketchEntityId,
  type SketchInferenceArc,
  type SketchInferenceLine,
  type SketchPoint2,
  type SketchPointInference,
  type SketchPointRelationInference,
  type SketchPointTarget,
  type SketchProfileSelector,
  type SketchRecord,
  sketchConstraintIdSchema,
  sketchEntityTransformOrigin,
  sketchProfileSelectorSchema,
  splitSketchCircle,
  splitSketchCurve,
  straightSlotGeometry,
  tangentArcGeometry,
  threePointArcGeometry,
  threePointCircleGeometry,
  transformSketchEntities,
  trimSketchCurve,
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
import { Button } from "@vibeshape/ui/components/button"
import { Ruler } from "@vibeshape/ui/components/icons"
import { Tooltip, TooltipContent, TooltipTrigger } from "@vibeshape/ui/components/tooltip"
import {
  type CSSProperties,
  type Dispatch,
  type KeyboardEvent,
  memo,
  type PointerEvent,
  type RefObject,
  type SetStateAction,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type WheelEvent,
} from "react"
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
  compatibleSketchConstraintTools,
  compatibleSketchDimensionTools,
  type SketchConstraintToolKind,
  selectedSketchEntities,
  selectedSketchLineId,
} from "./sketch-constraint-tools"
import {
  isSketchModificationTool,
  type SketchDraftChangeMode,
  type SketchEditorTool,
  type SketchModificationTool,
} from "./sketch-tool"
import {
  identitySketchTransform,
  isIdentitySketchTransform,
  type SketchTransformGesture,
  type SketchTransformHandle,
  SketchTransformManipulator,
  type SketchTransformPreview,
  sketchEntityTransformFromPreview,
  sketchTransformCenter,
  sketchTransformSvgValue,
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

type SketchCurveEntity = Exclude<SketchEntity, { type: "point" }>
type SketchPointLookup = Pick<ReadonlyMap<string, DisplayPoint>, "get">
type SketchGeometryPresentation = Readonly<{
  curves: readonly SketchCurveEntity[]
  curvesByPointId: ReadonlyMap<string, readonly SketchCurveEntity[]>
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
const LIVE_DRAG_SOLVE_INTERVAL_MS = 48
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

function createSketchGeometryPresentation(
  sketch: SketchRecord,
  solution: SolvedSketchWire | null,
): SketchGeometryPresentation {
  const points = displayPoints(sketch, solution)
  const pointsById = new Map(points.map((point) => [point.id, point]))
  const curves = sketch.entities.filter(
    (entity): entity is SketchCurveEntity => entity.type !== "point",
  )
  const curvesByPointId = new Map<string, SketchCurveEntity[]>()
  for (const curve of curves) {
    for (const pointId of curvePointIds(curve)) {
      const incident = curvesByPointId.get(pointId)
      if (incident) incident.push(curve)
      else curvesByPointId.set(pointId, [curve])
    }
  }
  return {
    curves,
    curvesByPointId,
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
    <line
      {...curveDrawingProps(entity, hidden, interactive, selected, onPointerDown)}
      x1={start.x}
      y1={start.y}
      x2={end.x}
      y2={end.y}
    />
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
    <circle
      {...curveDrawingProps(entity, hidden, interactive, selected, onPointerDown)}
      cx={center.x}
      cy={center.y}
      r={solvedRadius ?? entity.radius}
    />
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
  return (
    <polyline
      {...curveDrawingProps(entity, hidden, interactive, selected, onPointerDown)}
      points={arcPolyline(center, start, end)}
    />
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

function curvePointIds(entity: Exclude<SketchEntity, { type: "point" }>) {
  switch (entity.type) {
    case "line":
      return [entity.startPointId, entity.endPointId]
    case "circle":
      return [entity.centerPointId]
    case "arc":
      return [entity.centerPointId, entity.startPointId, entity.endPointId]
  }
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
    return curvePointIds(next.entity).every((pointId) =>
      sameDisplayPoint(previous.points.get(pointId), next.points.get(pointId)),
    )
  },
)

type SketchPointDrawingProps = Readonly<{
  dragging: boolean
  editable: boolean
  modificationTarget: boolean
  onEntityAction: (event: PointerEvent<SVGElement>, entityId: SketchEntityId) => void
  onPointPointerDown: (event: PointerEvent<SVGCircleElement>, pointId: SketchEntityId) => void
  onSelect: (entityId: SketchEntityId, additive: boolean) => void
  onTarget: (target: SketchPointTarget) => void
  point: DisplayPoint
  selectable: boolean
  selected: boolean
}>

const SketchPoint = memo(function SketchPoint({
  dragging,
  editable,
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
        r={7}
        fill="transparent"
        pointerEvents="all"
        stroke="none"
        onPointerDown={(event) => {
          event.stopPropagation()
          if (selectable) {
            onSelect(point.id, event.metaKey || event.ctrlKey || event.shiftKey)
            onPointPointerDown(event, point.id)
          } else if (modificationTarget) {
            onEntityAction(event, point.id)
          } else if (editable) {
            onTarget({ kind: "existing", pointId: point.id })
          }
        }}
      />
      <circle
        cx={point.x}
        cy={point.y}
        r={3}
        className={
          selected
            ? "pointer-events-none fill-ring stroke-background"
            : point.construction
              ? "pointer-events-none fill-background stroke-muted-foreground"
              : "pointer-events-none fill-background stroke-primary"
        }
        opacity={dragging ? 0 : undefined}
        strokeWidth={2}
        vectorEffect="non-scaling-stroke"
      />
    </>
  )
}, sameSketchPointDrawingProps)

const stableSketchPointDrawingKeys = [
  "dragging",
  "editable",
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

function supportsSketchCurveModification(
  tool: SketchModificationTool,
  curve: SketchCurveEntity,
  pending: PendingGeometry | null,
) {
  if (tool === "mirror") return pending?.kind === "mirror-sources" || curve.type === "line"
  if (tool === "offset") return pending?.kind !== "offset-distance" && curve.type === "line"
  if (tool === "transform") return true
  return tool !== "extend" || curve.type !== "circle"
}

function SketchGeometry({
  draggingPointId,
  editable,
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
  onCurveAction: (event: PointerEvent<SVGElement>, entityId: SketchEntityId) => void
  onPointPointerDown: (event: PointerEvent<SVGCircleElement>, pointId: SketchEntityId) => void
  onSelect: (entityId: SketchEntityId, additive: boolean) => void
  onTarget: (target: SketchPointTarget) => void
  pending: PendingGeometry | null
  selectedEntityIds: readonly SketchEntityId[]
  presentation: SketchGeometryPresentation
  tool: SketchEditorTool
}) {
  const selectable = editable && tool === "select"
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
            draggingPointId && curvePointIds(entity).some((pointId) => pointId === draggingPointId),
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
          dragging={point.id === draggingPointId}
          editable={editable && (!modifiable || mirrorSourceSelection || transformSourceSelection)}
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
      for (const pointId of curvePointIds(curve)) ids.add(pointId)
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
    case "circle": {
      const center = point(entity.centerPointId)
      if (!center) return null
      const radius = solvedCircles.get(entity.id) ?? entity.radius
      return { x: center.x + radius * 0.7, y: center.y + radius * 0.7 }
    }
    case "arc":
      return (
        midpointForIds(entity.startPointId, entity.endPointId, point) ?? point(entity.centerPointId)
      )
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

function constraintAnchor(
  constraint: SketchRecord["constraints"][number],
  pointAnchor: (id: SketchEntityId) => SketchPoint2 | null,
  geometryAnchor: (id: SketchEntityId) => SketchPoint2 | null,
) {
  if ("firstPointId" in constraint) {
    return midpointForIds(constraint.firstPointId, constraint.secondPointId, pointAnchor)
  }
  if ("firstEntityId" in constraint) {
    return midpointForIds(constraint.firstEntityId, constraint.secondEntityId, geometryAnchor)
  }
  if ("pointId" in constraint) return pointAnchor(constraint.pointId)
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
): ConstraintGlyph | null {
  const point = constraintAnchor(constraint, pointAnchor, geometryAnchor)
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

  return sketch.constraints
    .map((constraint) => constraintGlyph(constraint, pointAnchor, geometryAnchor))
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
  editDimensionLabel,
  onSelect,
  selectedConstraintId,
  selectConstraintLabel,
  sketch,
  solution,
  viewport,
}: {
  bounds: SketchBounds
  editDimensionLabel: (label: string) => string
  onSelect: (constraintId: SketchConstraintId) => void
  selectedConstraintId: SketchConstraintId | null
  selectConstraintLabel: (label: string) => string
  sketch: SketchRecord
  solution: SolvedSketchWire | null
  viewport: SketchViewportSize
}) {
  return (
    <div className="pointer-events-none absolute inset-0">
      {constraintGlyphs(sketch, solution).map((glyph) => (
        <Button
          key={glyph.id}
          type="button"
          size="xs"
          variant={selectedConstraintId === glyph.id ? "secondary" : "ghost"}
          data-sketch-constraint-id={glyph.id}
          data-sketch-constraint-kind={glyph.dimensional ? "dimension" : "geometric"}
          aria-label={
            glyph.dimensional ? editDimensionLabel(glyph.label) : selectConstraintLabel(glyph.label)
          }
          aria-pressed={selectedConstraintId === glyph.id}
          className={
            glyph.dimensional
              ? "pointer-events-auto absolute h-5 min-w-5 -translate-y-1/2 bg-background/85 px-1 py-0 font-mono text-[10px] text-foreground shadow-xs"
              : "pointer-events-auto absolute h-5 min-w-5 -translate-y-1/2 bg-background/75 px-1 py-0 font-mono text-[10px] font-semibold text-primary shadow-xs"
          }
          style={constraintAnnotationPosition(glyph.point, bounds, viewport)}
          onClick={(event) => {
            event.stopPropagation()
            onSelect(glyph.id)
          }}
        >
          {glyph.label}
        </Button>
      ))}
    </div>
  )
}

const StableConstraintAnnotations = memo(ConstraintAnnotations)

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
  if (isPendingRoundCurve(pending)) {
    return (
      <PendingRoundCurveShape cursor={cursor} pending={pending} sketch={sketch} start={start} />
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
  Exclude<SketchEditorTool, "select" | SketchModificationTool>,
  (input: PlacementInput) => PlacementUpdate
>

function placementUpdate(tool: SketchEditorTool, input: PlacementInput) {
  return tool === "select" || isSketchModificationTool(tool) ? null : placementBuilders[tool](input)
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
  "mirror" | "offset" | "transform"
>
type SketchCurveActionKind = "direct" | "mirror" | "offset" | "split-circle" | "transform"

function isDirectSketchModificationTool(
  tool: SketchEditorTool,
): tool is DirectSketchModificationTool {
  return (
    isSketchModificationTool(tool) && tool !== "mirror" && tool !== "offset" && tool !== "transform"
  )
}

function sketchCurveActionKind(
  tool: SketchEditorTool,
  entity: SketchEntity | undefined,
): SketchCurveActionKind | null {
  if (!isSketchModificationTool(tool)) return null
  if (tool === "mirror" || tool === "offset") return tool
  if (tool === "transform") return "transform"
  return tool === "split" && entity?.type === "circle" ? "split-circle" : "direct"
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
  "circumscribed-polygon": (pending) => pending?.kind !== "regular-polygon-sides",
  "center-rectangle": (pending) => pending?.kind !== "center-rectangle",
  "centered-aligned-rectangle": (pending) => pending?.kind !== "centered-aligned-rectangle-width",
  "centered-slot": (pending) => pending?.kind !== "centered-slot-width",
  extend: neverSupportsPointInference,
  "inscribed-polygon": (pending) => pending?.kind !== "regular-polygon-sides",
  line: alwaysSupportsPointInference,
  "midpoint-line": alwaysSupportsPointInference,
  mirror: neverSupportsPointInference,
  offset: neverSupportsPointInference,
  point: alwaysSupportsPointInference,
  rectangle: neverSupportsPointInference,
  select: neverSupportsPointInference,
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

function draggedPointReferences(
  references: SketchInferenceReferences,
  pointId: SketchEntityId | null,
): SketchInferenceReferences {
  if (!pointId) return EMPTY_INFERENCE_REFERENCES
  return {
    arcs: [],
    lines: references.lines.filter(
      (line) => line.startPointId !== pointId && line.endPointId !== pointId,
    ),
    points: references.points.filter(({ id }) => id !== pointId),
  }
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
  if (input.editorTool === "select") {
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

function useSketchPointDrag({
  bounds,
  draft,
  inferenceReferences,
  onDraftChange,
  onDraggingPointChange,
  onPreview,
  svgRef,
}: Pick<SketchDrawingConfiguration, "draft" | "onDraftChange" | "onDraggingPointChange"> & {
  bounds: SketchBounds
  inferenceReferences: SketchInferenceReferences
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
  const references = useMemo(
    () => draggedPointReferences(inferenceReferences, draggingPointId),
    [draggingPointId, inferenceReferences],
  )

  useEffect(
    () => () => {
      if (dragFrameRef.current !== null) window.cancelAnimationFrame(dragFrameRef.current)
      if (dragSolveTimerRef.current !== null) window.clearTimeout(dragSolveTimerRef.current)
    },
    [],
  )

  const scheduleLiveSolve = useCallback(
    (pointId: SketchEntityId, point: SketchPoint2) => {
      queuedDragSolveTargetRef.current = { point, pointId }
      if (dragSolveTimerRef.current !== null) return
      dragSolveTimerRef.current = window.setTimeout(() => {
        dragSolveTimerRef.current = null
        const target = queuedDragSolveTargetRef.current
        queuedDragSolveTargetRef.current = null
        if (target) onDraggingPointChange(target.pointId, target.point)
      }, LIVE_DRAG_SOLVE_INTERVAL_MS)
    },
    [onDraggingPointChange],
  )

  const preview = useCallback(
    (input: SketchPointDragInput): SketchPointDragPreview | null => {
      if (!draft || !draggingPointId) return null
      const rectangle = dragRectangleRef.current
      if (!rectangle) return null
      const point = pointerToSketchPoint(input, rectangle, bounds)
      const inference = draggedPointInference({
        bounds,
        point,
        rectangle,
        references,
        suppressed: input.suppressed,
      })
      const next = { inference, point: inference.point }
      lastDragPreviewRef.current = next
      onPreview(next)
      scheduleLiveSolve(draggingPointId, next.point)
      return next
    },
    [bounds, draft, draggingPointId, onPreview, references, scheduleLiveSolve, svgRef],
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
    onCurveAction: (event: PointerEvent<SVGElement>, entityId: SketchEntityId) => void
    onKeyDown: (event: KeyboardEvent<SVGSVGElement>) => void
    onPointPointerDown: (event: PointerEvent<SVGCircleElement>, pointId: SketchEntityId) => void
    onPointerLeave: () => void
    onPointerMove: (event: PointerEvent<SVGSVGElement>) => void
    onPointerUp: (event: PointerEvent<SVGSVGElement>) => void
    onSelection: (entityId: SketchEntityId, additive: boolean) => void
    onTransformStart: (event: PointerEvent<SVGElement>, handle: SketchTransformHandle) => void
    onWheel: (event: WheelEvent<SVGSVGElement>) => void
  }>
  sketch: SketchRecord
  state: Readonly<{
    annotationProfiles: readonly SketchProfileSelector[]
    bounds: SketchBounds
    cursor: SketchPoint2 | null
    dragTarget: SketchDragTarget | null
    draggingPointId: SketchEntityId | null
    editable: boolean
    geometry: SketchGeometryPresentation
    inference: SketchPointInference | null
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

function SketchDrawingView({
  configuration,
  handlers,
  sketch,
  state,
  svgRef,
}: SketchDrawingViewProps) {
  return (
    <div className="relative size-full">
      <svg
        ref={svgRef}
        aria-label={configuration.ariaLabel}
        className={`size-full touch-none outline-none focus-visible:ring-2 focus-visible:ring-ring ${isSketchModificationTool(configuration.editorTool) ? "cursor-crosshair" : ""}`}
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
        <StableSketchGeometry
          draggingPointId={state.draggingPointId ?? state.dragTarget?.entityId ?? null}
          editable={state.editable}
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
        <PendingPreview cursor={state.cursor} pending={state.pending} sketch={sketch} />
        <InferenceGlyph bounds={state.bounds} inference={state.inference} />
      </svg>
      <StableConstraintAnnotations
        bounds={state.bounds}
        editDimensionLabel={configuration.editDimensionLabel}
        selectedConstraintId={configuration.selectedConstraintId}
        selectConstraintLabel={configuration.selectConstraintLabel}
        sketch={sketch}
        solution={configuration.annotationSolution}
        viewport={state.viewportSize}
        onSelect={configuration.onConstraintSelectionChange}
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
  const [preview, setPreview] = useState<SketchTransformPreview>(identitySketchTransform)
  const rectangleRef = useRef<SketchViewportRectangle | null>(null)
  const selectionKey = selectedEntityIds.join(":")
  const origin = useMemo(
    () => (editorTool === "transform" ? safeSketchTransformOrigin(draft, selectedEntityIds) : null),
    [draft, editorTool, selectedEntityIds],
  )

  const reset = () => {
    setGesture(null)
    setPreview(identitySketchTransform)
    rectangleRef.current = null
  }

  useEffect(() => {
    reset()
  }, [editorTool, selectionKey, sketchId])

  const commit = () => {
    if (!draft || !origin || selectedEntityIds.length === 0 || isIdentitySketchTransform(preview)) {
      return false
    }
    try {
      const transformed = transformSketchEntities(draft, {
        entityIds: selectedEntityIds,
        transform: sketchEntityTransformFromPreview(origin, preview),
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
    if (rectangle) {
      setPreview(
        updateSketchTransformGesture(
          gesture,
          pointerToSketchPoint(event, rectangle, bounds),
          event.shiftKey,
        ),
      )
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
    if (!rectangle || !origin) return
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
      pointerId: event.pointerId,
      start: pointerToSketchPoint(event, viewportRectangle, bounds),
    })
  }

  return {
    consumeCanvasPointerDown,
    consumeKeyDown,
    consumePointerMove,
    consumePointerUp,
    presentation: editorTool === "transform" && origin ? { origin, preview } : null,
    selectEntity,
    start,
  }
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
  const [bounds, setBounds] = useState(() => sketchBounds(geometry.points))
  const [panGesture, setPanGesture] = useState<PanGesture | null>(null)
  const { cursor, inference, pending, setCursor, setInference, setPending } =
    useSketchPlacementPresentation({ draft, editorTool, selectedEntityIds, sketchId: sketch.id })
  const svgRef = useRef<SVGSVGElement>(null)
  const viewportSize = useSketchViewportSize(svgRef)
  const editable = draft !== null
  const transform = useSketchTransformInteraction({
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
  const inferenceReferences = useMemo(
    () => (draft ? sketchInferenceReferences(geometry) : EMPTY_INFERENCE_REFERENCES),
    [draft, geometry],
  )
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
    inferenceReferences,
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
      references: inferenceReferences,
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
    const primaryEmptyCanvas = isPrimaryEmptyCanvasPointer(event)
    if (editorTool === "offset" && pending?.kind === "offset-distance" && primaryEmptyCanvas) {
      const point = eventPoint(event)
      const result = draft && point ? safeAppendSketchLineOffset(draft, pending, point) : null
      if (result) publishModificationDraft(result.sketch)
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
  const handleCircleSplitAction = (
    circle: Extract<SketchEntity, { type: "circle" }>,
    point: SketchPoint2,
  ) => {
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
    if (nextDraft) publishModificationDraft(nextDraft)
  }
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
  const handleMirrorAction = (entityId: SketchEntityId) => {
    if (!draft) return
    const resolution = resolveMirrorAction({ draft, entityId, pending, selectedEntityIds })
    if (resolution?.kind === "select-sources") {
      onSelectionChange([])
      setInference(null)
      setPending({ axisLineId: resolution.axisLineId, kind: "mirror-sources" })
      return
    }
    if (resolution) publishMirrorDraft(resolution.result, resolution.keepSelectingSources)
  }
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
    if (!draft) return
    const entity = draft.entities.find(({ id }) => id === entityId)
    const actionKind = sketchCurveActionKind(editorTool, entity)
    if (!actionKind) return
    const actions = {
      mirror: () => handleMirrorAction(entityId),
      offset: () => handleOffsetSourceAction(entityId),
      transform: () => transform.selectEntity(event, entityId),
      "split-circle": () => {
        const point = eventPoint(event)
        if (point && entity?.type === "circle") handleCircleSplitAction(entity, point)
      },
      direct: () => {
        const point = eventPoint(event)
        if (!point || !isDirectSketchModificationTool(editorTool)) return
        const nextDraft = safeSketchModificationUpdate(editorTool, draft, entityId, point)
        if (nextDraft) publishModificationDraft(nextDraft)
      },
    } satisfies Record<SketchCurveActionKind, () => void>
    actions[actionKind]()
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
      onSelectionChange(toggleSelection(selectedEntityIds, entityId, additive))
    },
    [onSelectionChange, selectedEntityIds],
  )
  return (
    <SketchDrawingView
      configuration={configuration}
      handlers={{
        appendAt,
        onCanvasPointerDown: handleCanvasPointerDown,
        onCurveAction: handleCurveAction,
        onKeyDown: handleKeyDown,
        onPointPointerDown: handlePointPointerDown,
        onPointerLeave: handlePointerLeave,
        onPointerMove: handlePointerMove,
        onPointerUp: handlePointerUp,
        onSelection: handleSelection,
        onTransformStart: transform.start,
        onWheel: handleWheel,
      }}
      sketch={sketch}
      state={{
        annotationProfiles,
        bounds,
        cursor,
        dragTarget,
        draggingPointId,
        editable,
        geometry,
        inference,
        pending,
        transform: transform.presentation,
        viewportSize,
      }}
      svgRef={svgRef}
    />
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
  editDimensionLabel: (label: string) => string
  editorTool: SketchEditorTool
  onConstraintSelectionChange: (constraintId: SketchConstraintId) => void
  onDraftChange: (sketch: SketchRecord, mode?: SketchDraftChangeMode) => void
  onDraggingPointChange: (pointId: SketchEntityId | null, point?: SketchPoint2) => void
  onEditorToolChange: (tool: SketchEditorTool) => void
  onProfileSelect: (profile: SketchProfileSelector) => void
  onRedo: () => void
  onSelectionChange: (entityIds: readonly SketchEntityId[]) => void
  onUndo: () => void
  releasedDragTarget: SketchDragTarget | null
  selectConstraintLabel: (label: string) => string
  selectedConstraintId: SketchConstraintId | null
  selectedEntityIds: readonly SketchEntityId[]
  selectedProfile: SketchProfileSelector | null
  solution: SolvedSketchWire | null
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
  selectedEntityIds,
}: Readonly<{
  draft: SketchRecord | null
  editorTool: SketchEditorTool
  onDraftChange: (sketch: SketchRecord, mode?: SketchDraftChangeMode) => void
  selectedEntityIds: readonly SketchEntityId[]
}>) {
  const t = useTranslations("app.shell.taskPanel.sketch")
  const viewportT = useTranslations("app.sketch.viewport")
  const entities = useMemo(
    () => (draft ? selectedSketchEntities(draft, selectedEntityIds) : []),
    [draft, selectedEntityIds],
  )
  const constraints = compatibleSketchConstraintTools(entities)
  const dimensions = compatibleSketchDimensionTools(entities)
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
      className="absolute right-3 top-3 flex items-center gap-0.5 rounded-md border bg-background/90 p-1 shadow-sm backdrop-blur-sm"
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
              aria-controls="sketch-dimension-expression"
              aria-label={viewportT("dimensionTool")}
              onClick={() => document.getElementById("sketch-dimension-expression")?.focus()}
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

type SketchViewportState = Readonly<{
  construction: boolean
  controller: DocumentControllerState
  draft: SketchRecord | null
  editorTool: SketchEditorTool
  selectedConstraintId: SketchConstraintId | null
  selectedEntityIds: readonly SketchEntityId[]
  selectedProfile: SketchProfileSelector | null
  sketch: SketchRecord | null
}>

type SketchViewportActions = Readonly<{
  onDraftChange: (sketch: SketchRecord, mode?: SketchDraftChangeMode) => void
  onEditorToolChange: (tool: SketchEditorTool) => void
  onFailedConstraintsChange: (constraintIds: readonly SketchConstraintId[]) => void
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

export function SketchViewport({
  actions,
  solveSketch = solveActiveSketch,
  state,
}: {
  actions: SketchViewportActions
  solveSketch?: SketchSolveFunction
  state: SketchViewportState
}) {
  const {
    construction,
    controller,
    draft,
    editorTool,
    selectedConstraintId,
    selectedEntityIds,
    selectedProfile,
    sketch,
  } = state
  const {
    onDraftChange,
    onEditorToolChange,
    onConstraintSelectionChange,
    onFailedConstraintsChange,
    onProfilesChange,
    onProfileSelect,
    onRedo,
    onSelectionChange,
    onUndo,
  } = actions
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
  const handleDraggingPointChange = useDraggingPointChange(activeSketch, setDragState)
  const solveState = useSketchSolution(controller, activeSketch, solveSketch, dragTarget)
  useReleasedDragSettlement(activeSketch, dragState, solveState, setDragState)
  const activeSolveState = currentSolveState(solveState, activeSketch)
  const solution = solvedSolution(activeSolveState)
  const displaySolution = sketchDisplaySolution(activeSketch, solveState)
  const profiles = useSolvedProfiles(solution)
  useSketchSolutionNotifications(solution, profiles, onProfilesChange, onFailedConstraintsChange)
  const presentation = useSketchViewportPresentation(
    activeSketch,
    draft,
    solution,
    activeSolveState,
  )
  const drawingConfiguration = useMemo<SketchDrawingConfiguration>(
    () => ({
      ariaLabel: presentation.drawingLabel,
      annotationSolution: displaySolution,
      construction,
      draft,
      editDimensionLabel: presentation.editDimensionLabel,
      editorTool,
      onConstraintSelectionChange,
      onDraggingPointChange: handleDraggingPointChange,
      onEditorToolChange,
      selectedProfile,
      selectedConstraintId,
      selectedEntityIds,
      selectConstraintLabel: presentation.selectConstraintLabel,
      solution: displaySolution,
      onDraftChange,
      onProfileSelect,
      onRedo,
      onSelectionChange,
      onUndo,
      releasedDragTarget,
    }),
    [
      construction,
      displaySolution,
      draft,
      editorTool,
      handleDraggingPointChange,
      onConstraintSelectionChange,
      onDraftChange,
      onEditorToolChange,
      onProfileSelect,
      onRedo,
      onSelectionChange,
      onUndo,
      presentation.drawingLabel,
      presentation.editDimensionLabel,
      presentation.selectConstraintLabel,
      releasedDragTarget,
      selectedConstraintId,
      selectedEntityIds,
      selectedProfile,
    ],
  )

  return (
    <section
      aria-label={presentation.ariaLabel}
      className="relative min-h-0 overflow-hidden bg-viewport-background"
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
      <SketchPrecisionToolbar
        draft={draft}
        editorTool={editorTool}
        selectedEntityIds={selectedEntityIds}
        onDraftChange={onDraftChange}
      />
      <SketchOrientation plane={activeSketch?.plane ?? null} />
    </section>
  )
}
