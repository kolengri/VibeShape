import {
  appendSketchArc,
  appendSketchCircle,
  appendSketchConstraint,
  appendSketchLine,
  appendSketchPoint,
  appendSketchRectangle,
  inferSketchPoint,
  moveSketchPoint,
  removeSketchEntities,
  type SketchAxisInference,
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
} from "@vibeshape/domain"
import { useFormatter, useTranslations } from "@vibeshape/i18n"
import type { SolvedSketchWire } from "@vibeshape/protocol"
import {
  type KeyboardEvent,
  type PointerEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
  type WheelEvent,
} from "react"
import {
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
import type { SketchDraftChangeMode, SketchEditorTool } from "./sketch-tool"

type SketchSolveFunction = (
  baseRevision: number,
  sketch: SketchRecord["id"] | SketchRecord,
) => Promise<ActiveSketchSolveResult>

type SolveState =
  | { kind: "idle" }
  | { kind: "loading"; sourceSketch: SketchRecord }
  | { kind: "solved"; solution: SolvedSketchWire; sourceSketch: SketchRecord }
  | { kind: "error"; sourceSketch: SketchRecord }

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
  | Readonly<{ kind: "circle"; center: SketchPointTarget }>
  | Readonly<{ kind: "arc-start"; center: SketchPoint2 }>
  | Readonly<{ kind: "arc-end"; center: SketchPoint2; start: SketchPoint2 }>

type PanGesture = Readonly<{
  bounds: SketchBounds
  clientX: number
  clientY: number
  pointerId: number
}>

const MIN_VIEW_WIDTH = 200
const MIN_VIEW_HEIGHT = 150

function useSketchSolution(
  controller: DocumentControllerState,
  sketch: SketchRecord | null,
  solveSketch: SketchSolveFunction,
): SolveState {
  const [state, setState] = useState<SolveState>({ kind: "idle" })
  const revision = controller.report?.snapshot.revision
  const rebuildOk = controller.report?.rebuild.ok === true

  useEffect(() => {
    if (!sketch || revision === undefined || !rebuildOk) {
      setState({ kind: "idle" })
      return
    }
    let cancelled = false
    setState({ kind: "loading", sourceSketch: sketch })
    const timeout = window.setTimeout(() => {
      void solveSketch(revision, sketch).then((result) => {
        if (cancelled) return
        setState(
          result.ok
            ? { kind: "solved", solution: result.response.solution, sourceSketch: sketch }
            : { kind: "error", sourceSketch: sketch },
        )
      })
    }, 30)
    return () => {
      cancelled = true
      window.clearTimeout(timeout)
    }
  }, [rebuildOk, revision, sketch, solveSketch])

  return state
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
  parallel: "∥",
  perpendicular: "⊥",
  "point-on-curve": "⊙",
  "point-on-line": "⊙",
  tangent: "T",
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

function ConstraintGlyphs({
  bounds,
  sketch,
  solution,
}: {
  bounds: SketchBounds
  sketch: SketchRecord
  solution: SolvedSketchWire | null
}) {
  const fontSize = Math.max(bounds.width / 105, bounds.height / 78)
  return (
    <g className="pointer-events-none">
      {constraintGlyphs(sketch, solution).map((glyph) => (
        <text
          key={glyph.id}
          x={glyph.point.x + fontSize * 0.45}
          y={-glyph.point.y - fontSize * 0.45}
          data-sketch-constraint-id={glyph.id}
          data-sketch-constraint-kind={glyph.dimensional ? "dimension" : "geometric"}
          className={
            glyph.dimensional
              ? "fill-foreground stroke-background font-mono"
              : "fill-primary stroke-background font-mono font-semibold"
          }
          fontSize={fontSize}
          paintOrder="stroke"
          strokeWidth={3}
        >
          {glyph.label}
        </text>
      ))}
    </g>
  )
}

function pendingStart(pending: PendingGeometry, sketch: SketchRecord) {
  switch (pending.kind) {
    case "line":
      return pointForTarget(sketch, pending.start)
    case "rectangle":
      return pending.firstCorner
    case "circle":
      return pointForTarget(sketch, pending.center)
    case "arc-start":
      return pending.center
    case "arc-end":
      return pending.start
  }
}

function PendingShape({
  cursor,
  pending,
  start,
}: {
  cursor: SketchPoint2
  pending: PendingGeometry
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
  if (pending.kind === "circle") {
    return (
      <circle cx={start.x} cy={start.y} r={Math.hypot(cursor.x - start.x, cursor.y - start.y)} />
    )
  }
  if (pending.kind === "arc-end") {
    return <polyline points={arcPolyline(pending.center, pending.start, cursor)} />
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
      fill="none"
      strokeDasharray="5 4"
      strokeWidth={1.5}
      vectorEffect="non-scaling-stroke"
    >
      <PendingShape cursor={cursor} pending={pending} start={start} />
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

const placementBuilders = {
  arc: placeArc,
  circle: placeCircle,
  line: placeLine,
  point: placePoint,
  rectangle: placeRectangle,
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

function supportsPointInference(editorTool: SketchEditorTool, pending: PendingGeometry | null) {
  switch (editorTool) {
    case "line":
    case "point":
      return true
    case "circle":
      return pending?.kind !== "circle"
    case "arc":
    case "rectangle":
    case "select":
      return false
  }
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
    onDraftChange,
    onProfileSelect,
    onRedo,
    onSelectionChange,
    onUndo,
    selectedEntityIds,
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
  const svgRef = useRef<SVGSVGElement>(null)
  const editable = draft !== null

  useEffect(() => {
    setPending(null)
    setInference(null)
  }, [editorTool, sketch.id])

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
  const updateDraggedPoint = (point: SketchPoint2) => {
    if (!draft || !draggingPointId) return false
    setCursor(point)
    setInference(null)
    onDraftChange(
      moveSketchPoint(draft, draggingPointId, point),
      dragRecordedRef.current ? "replace" : "record",
    )
    dragRecordedRef.current = true
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
    dragRecordedRef.current = false
    setDraggingPointId(pointId)
  }
  const handleSelection = (entityId: SketchEntityId, additive: boolean) => {
    onSelectionChange(toggleSelection(selectedEntityIds, entityId, additive))
  }
  return (
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
      <ConstraintGlyphs bounds={bounds} sketch={sketch} solution={solution} />
      <PendingPreview cursor={cursor} pending={pending} sketch={sketch} />
      <InferenceGlyph bounds={bounds} inference={inference} />
    </svg>
  )
}

function solveStatusLabel(
  solveState: SolveState,
  labels: Readonly<Record<SolvedSketchWire["status"], string>>,
) {
  return solveState.kind === "solved" ? labels[solveState.solution.status] : null
}

function currentSolveState(solveState: SolveState, activeSketch: SketchRecord | null): SolveState {
  if (solveState.kind === "idle" || solveState.sourceSketch === activeSketch) return solveState
  return { kind: "idle" }
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
  editorTool: SketchEditorTool
  onDraftChange: (sketch: SketchRecord, mode?: SketchDraftChangeMode) => void
  onProfileSelect: (profile: SketchProfileSelector) => void
  onRedo: () => void
  onSelectionChange: (entityIds: readonly SketchEntityId[]) => void
  onUndo: () => void
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

type SketchViewportState = Readonly<{
  construction: boolean
  controller: DocumentControllerState
  draft: SketchRecord | null
  editorTool: SketchEditorTool
  selectedEntityIds: readonly SketchEntityId[]
  selectedProfile: SketchProfileSelector | null
  sketch: SketchRecord | null
}>

type SketchViewportActions = Readonly<{
  onDraftChange: (sketch: SketchRecord, mode?: SketchDraftChangeMode) => void
  onFailedConstraintsChange: (constraintIds: readonly SketchConstraintId[]) => void
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
    selectedEntityIds,
    selectedProfile,
    sketch,
  } = state
  const {
    onDraftChange,
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
  const number = (value: number) => formatter.number(value, { maximumFractionDigits: 6 })
  const activeSketch = draft ?? sketch
  const solveState = useSketchSolution(controller, activeSketch, solveSketch)
  const activeSolveState = currentSolveState(solveState, activeSketch)
  const solution = activeSolveState.kind === "solved" ? activeSolveState.solution : null
  const profiles = useMemo(() => (solution ? profileSelectors(solution) : []), [solution])
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

  useEffect(() => {
    onProfilesChange(solution ? profiles : [])
  }, [onProfilesChange, profiles, solution])

  useEffect(() => {
    onFailedConstraintsChange(solution ? validConstraintIds(solution.failedConstraintIds) : [])
  }, [onFailedConstraintsChange, solution])

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
          editorTool,
          selectedProfile,
          selectedEntityIds,
          solution,
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
      <SketchOrientation plane={activeSketch?.plane ?? null} />
    </section>
  )
}
