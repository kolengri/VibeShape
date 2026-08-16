import {
  appendSketchArc,
  appendSketchCenterRectangle,
  appendSketchCircle,
  appendSketchConstraint,
  appendSketchLine,
  appendSketchPoint,
  appendSketchRectangle,
  appendSketchThreePointArc,
  inferSketchPoint,
  moveSketchPoint,
  removeSketchEntities,
  type SketchAxisInference,
  type SketchConstraintDefinition,
  type SketchConstraintId,
  type SketchEntity,
  type SketchEntityId,
  type SketchPoint2,
  type SketchPointInference,
  type SketchPointTarget,
  type SketchProfileSelector,
  type SketchRecord,
  sketchConstraintIdSchema,
  sketchProfileSelectorSchema,
  threePointArcGeometry,
} from "@vibeshape/domain"
import { useFormatter, useTranslations } from "@vibeshape/i18n"
import type { SolvedSketchWire } from "@vibeshape/protocol"
import { Button } from "@vibeshape/ui/components/button"
import { Ruler } from "@vibeshape/ui/components/icons"
import { Tooltip, TooltipContent, TooltipTrigger } from "@vibeshape/ui/components/tooltip"
import {
  type CSSProperties,
  type Dispatch,
  type KeyboardEvent,
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
} from "./sketch-constraint-tools"
import type { SketchDraftChangeMode, SketchEditorTool } from "./sketch-tool"

type SketchSolveFunction = (
  baseRevision: number,
  sketch: SketchRecord["id"] | SketchRecord,
  options?: ActiveSketchSolveOptions,
) => Promise<ActiveSketchSolveResult>

type SolveState =
  | { kind: "idle" }
  | {
      kind: "loading"
      previousSolution: SolvedSketchWire | null
      sourceSketch: SketchRecord
    }
  | { kind: "solved"; solution: SolvedSketchWire; sourceSketch: SketchRecord }
  | { kind: "error"; sourceSketch: SketchRecord }

type SketchDragTarget = SolvedSketchWire["points"][number]
type SketchDragState = Readonly<{
  active: boolean
  pointId: SketchEntityId
  sketchId: SketchRecord["id"]
}>

type SketchSolveRequest = Readonly<{
  dragTarget: SketchDragTarget | null
  requestId: number
  revision: number
  sketch: SketchRecord
}>

type SketchSolveScheduler = {
  disposed: boolean
  inFlight: boolean
  latestRequest: SketchSolveRequest | null
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

type PendingGeometry =
  | Readonly<{ kind: "line"; start: SketchPointTarget }>
  | Readonly<{ kind: "rectangle"; firstCorner: SketchPoint2 }>
  | Readonly<{ kind: "center-rectangle"; center: SketchPointTarget }>
  | Readonly<{ kind: "circle"; center: SketchPointTarget }>
  | Readonly<{ kind: "arc-start"; center: SketchPoint2 }>
  | Readonly<{ kind: "arc-end"; center: SketchPoint2; start: SketchPoint2 }>
  | Readonly<{ kind: "three-point-arc-end"; start: SketchPointTarget }>
  | Readonly<{
      kind: "three-point-arc-point"
      end: SketchPointTarget
      start: SketchPointTarget
    }>

type PanGesture = Readonly<{
  bounds: SketchBounds
  clientX: number
  clientY: number
  pointerId: number
}>

const MIN_VIEW_WIDTH = 200
const MIN_VIEW_HEIGHT = 150

function createSketchSolveScheduler(solveSketch: SketchSolveFunction): SketchSolveScheduler {
  return {
    disposed: false,
    inFlight: false,
    latestRequest: null,
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
      continuation: continuationForSketch(scheduler.latestSolution, request.sketch),
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
    ? { kind: "solved", solution: result.response.solution, sourceSketch: request.sketch }
    : { kind: "error", sourceSketch: request.sketch }
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
      if (!sketch) scheduler.latestSolution = null
      scheduler.latestRequest = null
      scheduler.nextRequestId += 1
      if (scheduler.timer !== null) {
        window.clearTimeout(scheduler.timer)
        scheduler.timer = null
      }
      setState((current) => (current.kind === "idle" ? current : { kind: "idle" }))
      return
    }

    const request: SketchSolveRequest = {
      dragTarget,
      requestId: scheduler.nextRequestId,
      revision,
      sketch,
    }
    scheduler.nextRequestId += 1
    scheduler.latestRequest = request
    setState((current) =>
      current.kind === "loading" && current.sourceSketch.id === sketch.id
        ? current
        : {
            kind: "loading",
            previousSolution: solutionForSketch(current, sketch.id),
            sourceSketch: sketch,
          },
    )

    if (scheduler.timer !== null) window.clearTimeout(scheduler.timer)
    scheduler.timer = window.setTimeout(() => {
      scheduler.timer = null
      void drainLatestSketchSolve(scheduler, setState)
    }, 30)
    return () => {
      if (scheduler.timer !== null) {
        window.clearTimeout(scheduler.timer)
        scheduler.timer = null
      }
    }
  }, [dragTarget, rebuildOk, revision, scheduler, sketch, solveSketch])

  return state
}

function solutionForSketch(solveState: SolveState, sketchId: SketchRecord["id"]) {
  if (solveState.kind === "idle" || solveState.kind === "error") return null
  if (solveState.sourceSketch.id !== sketchId) return null
  return solveState.kind === "solved" ? solveState.solution : solveState.previousSolution
}

function solvedSolution(solveState: SolveState): SolvedSketchWire | null {
  return solveState.kind === "solved" ? solveState.solution : null
}

function solutionWithDragTarget(
  solution: SolvedSketchWire | null,
  dragTarget: SketchDragTarget | null,
) {
  if (!solution || !dragTarget) return solution
  let replaced = false
  const points = solution.points.map((point) => {
    if (point.entityId !== dragTarget.entityId) return point
    replaced = true
    return dragTarget
  })
  return replaced ? { ...solution, points } : solution
}

function dragTargetForSketch(
  activeSketch: SketchRecord | null,
  dragState: SketchDragState | null,
): SketchDragTarget | null {
  if (!activeSketch || dragState?.sketchId !== activeSketch.id) return null
  const point = authoredPoints(activeSketch).find((entity) => entity.id === dragState.pointId)
  return point ? { entityId: point.id, x: point.x, y: point.y } : null
}

function nextSketchDragState(
  activeSketch: SketchRecord | null,
  current: SketchDragState | null,
  pointId: SketchEntityId | null,
): SketchDragState | null {
  if (pointId && activeSketch) return { active: true, pointId, sketchId: activeSketch.id }
  return current ? { ...current, active: false } : null
}

function useDraggingPointChange(
  activeSketch: SketchRecord | null,
  setDragState: Dispatch<SetStateAction<SketchDragState | null>>,
) {
  return useCallback(
    (pointId: SketchEntityId | null) =>
      setDragState((current) => nextSketchDragState(activeSketch, current, pointId)),
    [activeSketch, setDragState],
  )
}

function useSketchDisplaySolution(
  activeSketch: SketchRecord | null,
  solveState: SolveState,
  dragTarget: SketchDragTarget | null,
) {
  const previousSolution = activeSketch ? solutionForSketch(solveState, activeSketch.id) : null
  return useMemo(
    () => solutionWithDragTarget(previousSolution, dragTarget),
    [dragTarget, previousSolution],
  )
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

type CurveDrawingProps = Readonly<{
  onPointerDown: (event: PointerEvent<SVGElement>, entityId: SketchEntityId) => void
  points: ReadonlyMap<string, DisplayPoint>
  selected: boolean
  solvedRadius: number | undefined
}>

function curveDrawingProps(
  entity: Exclude<SketchEntity, { type: "point" }>,
  selected: boolean,
  onPointerDown: CurveDrawingProps["onPointerDown"],
) {
  let className = "stroke-primary"
  if (entity.construction) className = "stroke-muted-foreground"
  if (selected) className = "stroke-ring"
  return {
    className,
    "data-sketch-entity-id": entity.id,
    "data-sketch-entity-type": entity.type,
    fill: "none",
    strokeDasharray: entity.construction ? "6 4" : undefined,
    strokeLinecap: "round" as const,
    strokeWidth: selected ? 3 : 2,
    vectorEffect: "non-scaling-stroke" as const,
    onPointerDown: (event: PointerEvent<SVGElement>) => onPointerDown(event, entity.id),
  }
}

function SketchLine({
  entity,
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
      {...curveDrawingProps(entity, selected, onPointerDown)}
      x1={start.x}
      y1={start.y}
      x2={end.x}
      y2={end.y}
    />
  )
}

function SketchCircle({
  entity,
  onPointerDown,
  points,
  selected,
  solvedRadius,
}: CurveDrawingProps & { entity: Extract<SketchEntity, { type: "circle" }> }) {
  const center = points.get(entity.centerPointId)
  if (!center) return null
  return (
    <circle
      {...curveDrawingProps(entity, selected, onPointerDown)}
      cx={center.x}
      cy={center.y}
      r={solvedRadius ?? entity.radius}
    />
  )
}

function SketchArc({
  entity,
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
      {...curveDrawingProps(entity, selected, onPointerDown)}
      points={arcPolyline(center, start, end)}
    />
  )
}

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
}

function SketchGeometry({
  editable,
  onPointPointerDown,
  onSelect,
  onTarget,
  selectedEntityIds,
  sketch,
  solution,
  tool,
}: {
  editable: boolean
  onPointPointerDown: (event: PointerEvent<SVGCircleElement>, pointId: SketchEntityId) => void
  onSelect: (entityId: SketchEntityId, additive: boolean) => void
  onTarget: (target: SketchPointTarget) => void
  selectedEntityIds: readonly SketchEntityId[]
  sketch: SketchRecord
  solution: SolvedSketchWire | null
  tool: SketchEditorTool
}) {
  const points = displayPoints(sketch, solution)
  const pointsById = new Map(points.map((point) => [point.id, point]))
  const solvedCircles = new Map(solution?.circles.map((circle) => [circle.entityId, circle.radius]))
  const selectable = editable && tool === "select"
  const geometryPointerDown = (event: PointerEvent<SVGElement>, entityId: SketchEntityId) => {
    if (!selectable) return
    event.stopPropagation()
    onSelect(entityId, event.metaKey || event.ctrlKey || event.shiftKey)
  }
  return (
    <g transform="scale(1 -1)">
      {sketch.entities
        .filter(
          (entity): entity is Exclude<SketchEntity, { type: "point" }> => entity.type !== "point",
        )
        .map((entity) => (
          <SketchCurve
            key={entity.id}
            entity={entity}
            points={pointsById}
            selected={selectedEntityIds.includes(entity.id)}
            solvedRadius={solvedCircles.get(entity.id)}
            onPointerDown={geometryPointerDown}
          />
        ))}
      {points.map((point) => {
        const pointId = point.id
        return (
          <circle
            key={pointId}
            data-sketch-entity-id={pointId}
            data-sketch-entity-type="point"
            cx={point.x}
            cy={point.y}
            r={3}
            className={
              selectedEntityIds.includes(pointId)
                ? "fill-ring stroke-background"
                : point.construction
                  ? "fill-background stroke-muted-foreground"
                  : "fill-background stroke-primary"
            }
            strokeWidth={2}
            vectorEffect="non-scaling-stroke"
            onPointerDown={(event) => {
              event.stopPropagation()
              if (selectable) {
                onSelect(pointId, event.metaKey || event.ctrlKey || event.shiftKey)
                onPointPointerDown(event, pointId)
              } else if (editable) {
                onTarget({ kind: "existing", pointId })
              }
            }}
          />
        )
      })}
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
  constraintLabel,
  onSelect,
  selectedConstraintId,
  sketch,
  solution,
  viewport,
}: {
  bounds: SketchBounds
  constraintLabel: (dimensional: boolean, label: string) => string
  onSelect: (constraintId: SketchConstraintId) => void
  selectedConstraintId: SketchConstraintId | null
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
          aria-label={constraintLabel(glyph.dimensional, glyph.label)}
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

function pendingStart(pending: PendingGeometry, sketch: SketchRecord) {
  switch (pending.kind) {
    case "line":
      return pointForTarget(sketch, pending.start)
    case "rectangle":
      return pending.firstCorner
    case "center-rectangle":
      return pointForTarget(sketch, pending.center)
    case "circle":
      return pointForTarget(sketch, pending.center)
    case "arc-start":
      return pending.center
    case "arc-end":
      return pending.start
    case "three-point-arc-end":
    case "three-point-arc-point":
      return pointForTarget(sketch, pending.start)
  }
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
  if (pending.kind === "circle") {
    return (
      <circle cx={start.x} cy={start.y} r={Math.hypot(cursor.x - start.x, cursor.y - start.y)} />
    )
  }
  if (pending.kind === "arc-end") {
    return <polyline points={arcPolyline(pending.center, pending.start, cursor)} />
  }
  if (pending.kind === "three-point-arc-point") {
    const end = pointForTarget(sketch, pending.end)
    const geometry = threePointArcGeometry(start, end, cursor)
    return geometry ? (
      <polyline points={arcPolyline(geometry.center, geometry.start, geometry.end)} />
    ) : (
      <polyline points={`${start.x},${start.y} ${end.x},${end.y} ${cursor.x},${cursor.y}`} />
    )
  }
  return <line x1={start.x} y1={start.y} x2={cursor.x} y2={cursor.y} />
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
  if (!pending || !cursor) return null
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
  axis: SketchAxisInference | null
  construction: boolean
  draft: SketchRecord
  pending: PendingGeometry | null
  point: SketchPoint2
  target: SketchPointTarget
}>

type PlacementUpdate = Readonly<{
  draft: SketchRecord | null
  pending: PendingGeometry | null
}>

function placePoint(input: PlacementInput): PlacementUpdate {
  if (input.target.kind === "existing") return { draft: null, pending: null }
  return {
    draft: appendSketchPoint(input.draft, {
      construction: input.construction,
      createEntityId: createBrowserSketchEntityId,
      point: input.point,
    }).sketch,
    pending: null,
  }
}

function placeLine(input: PlacementInput): PlacementUpdate {
  if (input.pending?.kind !== "line") {
    return { draft: null, pending: { kind: "line", start: input.target } }
  }
  const result = appendSketchLine(input.draft, {
    construction: input.construction,
    createEntityId: createBrowserSketchEntityId,
    start: input.pending.start,
    end: input.target,
  })
  const line = result.sketch.entities.at(-1)
  const nextSketch =
    line?.type === "line" && input.axis
      ? appendSketchConstraint(
          result.sketch,
          { type: input.axis, lineId: line.id },
          createBrowserSketchConstraintId,
        )
      : result.sketch
  return {
    draft: nextSketch,
    pending:
      line?.type === "line"
        ? { kind: "line", start: { kind: "existing", pointId: line.endPointId } }
        : null,
  }
}

function InferenceGlyph({
  bounds,
  inference,
}: {
  bounds: SketchBounds
  inference: SketchPointInference | null
}) {
  if (!inference || (inference.axis === null && inference.target.kind === "new")) return null
  const size = Math.max(bounds.width / 90, bounds.height / 68)
  const pointSnapped = inference.target.kind === "existing"
  return (
    <g
      className="pointer-events-none fill-background stroke-ring text-ring"
      data-sketch-inference={pointSnapped ? "coincident" : inference.axis}
      transform={`translate(${inference.point.x} ${-inference.point.y})`}
    >
      {pointSnapped ? (
        <rect
          x={-size / 2}
          y={-size / 2}
          width={size}
          height={size}
          strokeWidth={1.5}
          vectorEffect="non-scaling-stroke"
        />
      ) : (
        <text
          x={size * 0.7}
          y={-size * 0.7}
          className="fill-ring stroke-none font-mono font-semibold"
          fontSize={size}
        >
          {inference.axis === "horizontal" ? "H" : "V"}
        </text>
      )}
    </g>
  )
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
  arc: placeArc,
  "center-rectangle": placeCenterRectangle,
  circle: placeCircle,
  line: placeLine,
  point: placePoint,
  rectangle: placeRectangle,
  "three-point-arc": placeThreePointArc,
} satisfies Record<Exclude<SketchEditorTool, "select">, (input: PlacementInput) => PlacementUpdate>

function placementUpdate(tool: SketchEditorTool, input: PlacementInput) {
  return tool === "select" ? null : placementBuilders[tool](input)
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

function consumePendingPlacementCancel(
  event: KeyboardEvent<SVGSVGElement>,
  hasPendingPlacement: boolean,
  cancel: () => void,
) {
  if (event.key !== "Escape" || !hasPendingPlacement) return false
  event.preventDefault()
  cancel()
  return true
}

function isSketchDeleteKey(event: KeyboardEvent<SVGSVGElement>) {
  return event.key === "Delete" || event.key === "Backspace"
}

function unsnappedInference(point: SketchPoint2): SketchPointInference {
  return { axis: null, point, target: { kind: "new", point } }
}

const alwaysSupportsPointInference = () => true
const neverSupportsPointInference = () => false
const pointInferenceSupport = {
  arc: neverSupportsPointInference,
  circle: (pending) => pending?.kind !== "circle",
  "center-rectangle": (pending) => pending?.kind !== "center-rectangle",
  line: alwaysSupportsPointInference,
  point: alwaysSupportsPointInference,
  rectangle: neverSupportsPointInference,
  select: neverSupportsPointInference,
  "three-point-arc": alwaysSupportsPointInference,
} satisfies Record<SketchEditorTool, (pending: PendingGeometry | null) => boolean>

function supportsPointInference(editorTool: SketchEditorTool, pending: PendingGeometry | null) {
  return pointInferenceSupport[editorTool](pending)
}

function lineInferenceAnchor(
  editorTool: SketchEditorTool,
  pending: PendingGeometry | null,
  draft: SketchRecord,
) {
  return editorTool === "line" && pending?.kind === "line"
    ? pointForTarget(draft, pending.start)
    : null
}

function placementInference(input: {
  bounds: SketchBounds
  draft: SketchRecord | null
  editorTool: SketchEditorTool
  pending: PendingGeometry | null
  point: SketchPoint2
  rectangle: Readonly<{ width: number; height: number }>
  solution: SolvedSketchWire | null
}): SketchPointInference {
  if (!input.draft || !supportsPointInference(input.editorTool, input.pending)) {
    return unsnappedInference(input.point)
  }
  const worldPerPixel = Math.max(
    input.rectangle.width > 0 ? input.bounds.width / input.rectangle.width : 0,
    input.rectangle.height > 0 ? input.bounds.height / input.rectangle.height : 0,
  )
  const anchor = lineInferenceAnchor(input.editorTool, input.pending, input.draft)
  return inferSketchPoint({
    ...(anchor ? { anchor } : {}),
    point: input.point,
    points: displayPoints(input.draft, input.solution),
    tolerance: worldPerPixel * 10,
  })
}

function SketchDrawing({
  configuration,
  sketch,
}: {
  configuration: SketchDrawingConfiguration
  sketch: SketchRecord
}) {
  const {
    ariaLabel,
    construction,
    draft,
    editorTool,
    onDraggingPointChange,
    onDraftChange,
    onConstraintSelectionChange,
    onProfileSelect,
    onRedo,
    onSelectionChange,
    onUndo,
    selectedEntityIds,
    selectedConstraintId,
    selectedProfile,
    solution,
  } = configuration
  const [bounds, setBounds] = useState(() => sketchBounds(displayPoints(sketch, solution)))
  const [cursor, setCursor] = useState<SketchPoint2 | null>(null)
  const [inference, setInference] = useState<SketchPointInference | null>(null)
  const [draggingPointId, setDraggingPointId] = useState<SketchEntityId | null>(null)
  const [panGesture, setPanGesture] = useState<PanGesture | null>(null)
  const [pending, setPending] = useState<PendingGeometry | null>(null)
  const dragRecordedRef = useRef(false)
  const dragFrameRef = useRef<number | null>(null)
  const queuedDragPointRef = useRef<SketchPoint2 | null>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const viewportSize = useSketchViewportSize(svgRef)
  const editable = draft !== null

  useEffect(() => {
    setPending(null)
    setInference(null)
  }, [editorTool, sketch.id])

  useEffect(
    () => () => {
      if (dragFrameRef.current !== null) window.cancelAnimationFrame(dragFrameRef.current)
    },
    [],
  )

  const eventPoint = (event: PointerEvent<SVGSVGElement | SVGCircleElement>) => {
    const svg = svgRef.current
    return svg ? pointerToSketchPoint(event, svg.getBoundingClientRect(), bounds) : null
  }
  const inferredPlacement = (
    point: SketchPoint2,
    rectangle: Readonly<{ width: number; height: number }>,
  ) => placementInference({ bounds, draft, editorTool, pending, point, rectangle, solution })
  const appendAt = (target: SketchPointTarget, axis: SketchAxisInference | null = null) => {
    if (!draft) return
    const point = pointForTarget(draft, target)
    try {
      const update = placementUpdate(editorTool, {
        axis,
        construction,
        draft,
        pending,
        point,
        target,
      })
      if (!update) return
      if (update.draft) onDraftChange(update.draft)
      setPending(update.pending)
      setInference(null)
    } catch {
      setPending(null)
    }
  }
  const updatePanFromPointer = (event: PointerEvent<SVGSVGElement>) => {
    if (panGesture?.pointerId !== event.pointerId) return false
    const rectangle = svgRef.current?.getBoundingClientRect()
    if (!rectangle) return true
    const nextBounds = pannedBounds(panGesture, event, rectangle)
    if (nextBounds) setBounds(nextBounds)
    return true
  }
  const commitDraggedPoint = (point: SketchPoint2) => {
    if (!draft || !draggingPointId) return false
    onDraftChange(
      moveSketchPoint(draft, draggingPointId, point),
      dragRecordedRef.current ? "replace" : "record",
    )
    dragRecordedRef.current = true
    return true
  }
  const flushDraggedPoint = () => {
    if (dragFrameRef.current !== null) {
      window.cancelAnimationFrame(dragFrameRef.current)
      dragFrameRef.current = null
    }
    const point = queuedDragPointRef.current
    queuedDragPointRef.current = null
    if (point) commitDraggedPoint(point)
  }
  const updateDraggedPoint = (point: SketchPoint2) => {
    if (!draft || !draggingPointId) return false
    queuedDragPointRef.current = point
    if (dragFrameRef.current === null) {
      dragFrameRef.current = window.requestAnimationFrame(() => {
        dragFrameRef.current = null
        const queuedPoint = queuedDragPointRef.current
        queuedDragPointRef.current = null
        if (queuedPoint) commitDraggedPoint(queuedPoint)
      })
    }
    return true
  }
  const handlePointerMove = (event: PointerEvent<SVGSVGElement>) => {
    if (updatePanFromPointer(event)) return
    const point = eventPoint(event)
    if (!point || updateDraggedPoint(point)) return
    const rectangle = svgRef.current?.getBoundingClientRect()
    const nextInference = rectangle ? inferredPlacement(point, rectangle) : null
    setInference(nextInference)
    setCursor(nextInference?.point ?? point)
  }
  const handleKeyDown = (event: KeyboardEvent<SVGSVGElement>) => {
    if (consumeSketchHistoryShortcut(event, onUndo, onRedo)) return
    if (consumePendingPlacementCancel(event, pending !== null, () => setPending(null))) return
    if (!isSketchDeleteKey(event) || !draft) return
    event.preventDefault()
    onDraftChange(removeSketchEntities(draft, selectedEntityIds))
    onSelectionChange([])
  }
  const handleCanvasPointerDown = (event: PointerEvent<SVGSVGElement>) => {
    event.currentTarget.focus()
    const pan = event.button === 1 || (event.button === 0 && event.shiftKey)
    if (pan) {
      event.preventDefault()
      event.currentTarget.setPointerCapture(event.pointerId)
      setPanGesture({
        bounds,
        clientX: event.clientX,
        clientY: event.clientY,
        pointerId: event.pointerId,
      })
      return
    }
    if (event.target !== event.currentTarget) return
    if (editorTool === "select") {
      onSelectionChange([])
      return
    }
    const point = eventPoint(event)
    const rectangle = event.currentTarget.getBoundingClientRect()
    if (point) {
      const nextInference = inferredPlacement(point, rectangle)
      appendAt(nextInference.target, nextInference.axis)
    }
  }
  const handlePointerUp = () => {
    flushDraggedPoint()
    if (draggingPointId) onDraggingPointChange(null)
    setDraggingPointId(null)
    dragRecordedRef.current = false
    setPanGesture(null)
  }
  const handlePointerLeave = () => {
    setCursor(null)
    setInference(null)
    handlePointerUp()
  }
  const handleWheel = (event: WheelEvent<SVGSVGElement>) => {
    event.preventDefault()
    const svg = svgRef.current
    if (!svg) return
    const focus = pointerToSketchPoint(event, svg.getBoundingClientRect(), bounds)
    setBounds(zoomedBounds(bounds, focus, event.deltaY))
  }
  const handlePointPointerDown = (
    event: PointerEvent<SVGCircleElement>,
    pointId: SketchEntityId,
  ) => {
    if (event.nativeEvent.isTrusted) event.currentTarget.setPointerCapture(event.pointerId)
    setCursor(null)
    setInference(null)
    dragRecordedRef.current = false
    setDraggingPointId(pointId)
    onDraggingPointChange(pointId)
  }
  const handleSelection = (entityId: SketchEntityId, additive: boolean) => {
    onSelectionChange(toggleSelection(selectedEntityIds, entityId, additive))
  }
  return (
    <div className="relative size-full">
      <svg
        ref={svgRef}
        aria-label={ariaLabel}
        className="size-full touch-none outline-none focus-visible:ring-2 focus-visible:ring-ring"
        role="img"
        tabIndex={editable ? 0 : undefined}
        viewBox={`${bounds.minX} ${-bounds.minY - bounds.height} ${bounds.width} ${bounds.height}`}
        onKeyDown={handleKeyDown}
        onPointerDown={handleCanvasPointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onPointerLeave={handlePointerLeave}
        onWheel={handleWheel}
      >
        <title>{ariaLabel}</title>
        <g transform="scale(1 -1)" className="pointer-events-none stroke-muted-foreground/45">
          <line
            x1={bounds.minX}
            y1={0}
            x2={bounds.minX + bounds.width}
            y2={0}
            vectorEffect="non-scaling-stroke"
          />
          <line
            x1={0}
            y1={bounds.minY}
            x2={0}
            y2={bounds.minY + bounds.height}
            vectorEffect="non-scaling-stroke"
          />
        </g>
        <ProfileRegions
          editable={editable}
          editorTool={editorTool}
          profiles={solution ? profileSelectors(solution) : []}
          selectedProfile={selectedProfile}
          sketch={sketch}
          solution={solution}
          onSelect={onProfileSelect}
        />
        <SketchGeometry
          editable={editable}
          selectedEntityIds={selectedEntityIds}
          sketch={sketch}
          solution={solution}
          tool={editorTool}
          onPointPointerDown={handlePointPointerDown}
          onSelect={handleSelection}
          onTarget={appendAt}
        />
        <PendingPreview cursor={cursor} pending={pending} sketch={sketch} />
        <InferenceGlyph bounds={bounds} inference={inference} />
      </svg>
      <ConstraintAnnotations
        bounds={bounds}
        constraintLabel={(dimensional, label) =>
          dimensional
            ? configuration.editDimensionLabel(label)
            : configuration.selectConstraintLabel(label)
        }
        selectedConstraintId={selectedConstraintId}
        sketch={sketch}
        solution={solution}
        viewport={viewportSize}
        onSelect={onConstraintSelectionChange}
      />
    </div>
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

function hasSettledReleasedDrag(
  activeSketch: SketchRecord | null,
  dragState: SketchDragState | null,
  solveState: SolveState,
) {
  return (
    dragState !== null &&
    !dragState.active &&
    activeSketch !== null &&
    solveState.kind !== "idle" &&
    solveState.kind !== "loading" &&
    solveState.sourceSketch.id === activeSketch.id
  )
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
  construction: boolean
  draft: SketchRecord | null
  editDimensionLabel: (label: string) => string
  editorTool: SketchEditorTool
  onConstraintSelectionChange: (constraintId: SketchConstraintId) => void
  onDraftChange: (sketch: SketchRecord, mode?: SketchDraftChangeMode) => void
  onDraggingPointChange: (pointId: SketchEntityId | null) => void
  onProfileSelect: (profile: SketchProfileSelector) => void
  onRedo: () => void
  onSelectionChange: (entityIds: readonly SketchEntityId[]) => void
  onUndo: () => void
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
  onFailedConstraintsChange: (constraintIds: readonly SketchConstraintId[]) => void
  onConstraintSelectionChange: (constraintId: SketchConstraintId | null) => void
  onProfilesChange: (profiles: readonly SketchProfileSelector[]) => void
  onProfileSelect: (profile: SketchProfileSelector) => void
  onRedo: () => void
  onSelectionChange: (entityIds: readonly SketchEntityId[]) => void
  onUndo: () => void
}>

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
    onConstraintSelectionChange,
    onFailedConstraintsChange,
    onProfilesChange,
    onProfileSelect,
    onRedo,
    onSelectionChange,
    onUndo,
  } = actions
  const t = useTranslations("app.sketch.viewport")
  const formatter = useFormatter()
  const displayUnits = useDocumentDisplayUnits()
  const [dragState, setDragState] = useState<SketchDragState | null>(null)
  const number = (value: number) => formatter.number(value, { maximumFractionDigits: 6 })
  const activeSketch = draft ?? sketch
  const dragTarget = useMemo(
    () => dragTargetForSketch(activeSketch, dragState),
    [activeSketch, dragState],
  )
  const handleDraggingPointChange = useDraggingPointChange(activeSketch, setDragState)
  const solveState = useSketchSolution(controller, activeSketch, solveSketch, dragTarget)
  useReleasedDragSettlement(activeSketch, dragState, solveState, setDragState)
  const activeSolveState = currentSolveState(solveState, activeSketch)
  const solution = solvedSolution(activeSolveState)
  const displaySolution = useSketchDisplaySolution(activeSketch, solveState, dragTarget)
  const profiles = useMemo(() => (solution ? profileSelectors(solution) : []), [solution])
  useSketchSolutionNotifications(solution, profiles, onProfilesChange, onFailedConstraintsChange)
  const { degreesOfFreedom, profileText, statusText } = sketchSolvePresentation({
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
    empty: activeSketch?.entities.length === 0,
    formatNumber: number,
    lengthUnit: displayUnits.length,
    solution,
    solveState: activeSolveState,
  })

  return (
    <section
      aria-label={t("ariaLabel")}
      className="relative min-h-0 overflow-hidden bg-viewport-background"
    >
      <SketchViewportContent
        activeSketch={activeSketch}
        emptyMessage={t("empty")}
        configuration={{
          ariaLabel: draft ? t("draftDrawing") : t("solvedDrawing"),
          construction,
          draft,
          editDimensionLabel: (label) => t("editDimension", { label }),
          editorTool,
          onConstraintSelectionChange,
          onDraggingPointChange: handleDraggingPointChange,
          selectedProfile,
          selectedConstraintId,
          selectedEntityIds,
          selectConstraintLabel: (label) => t("selectConstraint", { label }),
          solution: displaySolution,
          onDraftChange,
          onProfileSelect,
          onRedo,
          onSelectionChange,
          onUndo,
        }}
      />
      <SketchSolveOverlay
        active={activeSketch !== null}
        degreesOfFreedom={degreesOfFreedom}
        profileText={profileText}
        status={statusText}
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
