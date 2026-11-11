import type { SketchDisplayRecord } from "@vibeshape/application/sketch-display"
import type { SketchRecord } from "@vibeshape/domain"
import { useTranslations } from "@vibeshape/i18n"
import type {
  ViewerSketchReferenceCandidate,
  ViewerVector3,
} from "@vibeshape/viewer/three-viewport"
import { useCallback, useMemo, useRef, useState } from "react"
import type { DocumentControllerState } from "../../document/document-controller"
import type { GeometryViewportSketchContext } from "../../shell/geometry-viewport"
import type { ActivePartDesignTool } from "../part-design/part-design-tool"

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
type CurveKind = "line" | "arc" | "circle" | "cubic-bezier"
type Frame = SketchDisplayRecord["frame"]
const CURVE_SAMPLES = 48

function isPatternTool(tool: ActivePartDesignTool | null) {
  return tool?.kind === "create-pattern" || tool?.kind === "edit-pattern"
}

function local(frame: Frame, point: ViewerVector3): [number, number] {
  const offset = point.map((value, axis) => value - (frame.origin[axis] ?? 0))
  const dot = (axis: readonly number[]) =>
    offset.reduce((total, value, index) => total + value * (axis[index] ?? 0), 0)
  return [dot(frame.xAxis), dot(frame.yAxis)]
}

function world(frame: Frame, [x, y]: readonly [number, number]): ViewerVector3 {
  const [ox = 0, oy = 0, oz = 0] = frame.origin
  return [
    ox + (frame.xAxis[0] ?? 0) * x + (frame.yAxis[0] ?? 0) * y,
    oy + (frame.xAxis[1] ?? 0) * x + (frame.yAxis[1] ?? 0) * y,
    oz + (frame.xAxis[2] ?? 0) * x + (frame.yAxis[2] ?? 0) * y,
  ]
}

/** Samples a counterclockwise sketch arc or full circle in the sketch plane. */
function arcPoints(frame: Frame, center: ViewerVector3, start: ViewerVector3, sweep?: number) {
  const [cx, cy] = local(frame, center)
  const [sx, sy] = local(frame, start)
  const radius = Math.hypot(sx - cx, sy - cy)
  const from = Math.atan2(sy - cy, sx - cx)
  const span = sweep ?? 2 * Math.PI
  return Array.from({ length: CURVE_SAMPLES + 1 }, (_, index) => {
    const angle = from + (span * index) / CURVE_SAMPLES
    return world(frame, [cx + radius * Math.cos(angle), cy + radius * Math.sin(angle)])
  })
}

function counterclockwiseSweep(
  frame: Frame,
  center: ViewerVector3,
  start: ViewerVector3,
  end: ViewerVector3,
) {
  const [cx, cy] = local(frame, center)
  const [sx, sy] = local(frame, start)
  const [ex, ey] = local(frame, end)
  const sweep = Math.atan2(ey - cy, ex - cx) - Math.atan2(sy - cy, sx - cx)
  return sweep <= 0 ? sweep + 2 * Math.PI : sweep
}

function bezierPoints(controls: readonly ViewerVector3[]) {
  const [p0, p1, p2, p3] = controls as [ViewerVector3, ViewerVector3, ViewerVector3, ViewerVector3]
  return Array.from({ length: CURVE_SAMPLES + 1 }, (_, index) => {
    const t = index / CURVE_SAMPLES
    const u = 1 - t
    return [0, 1, 2].map(
      (axis) =>
        u * u * u * (p0[axis] ?? 0) +
        3 * u * u * t * (p1[axis] ?? 0) +
        3 * u * t * t * (p2[axis] ?? 0) +
        t * t * t * (p3[axis] ?? 0),
    ) as unknown as ViewerVector3
  })
}

type Entity = SketchRecord["entities"][number]
type Position = (id: string) => ViewerVector3 | undefined
type CurveBase = Readonly<{ label: string; sourceSketchId: string; sourceEntityId: string }>

function arcCandidate(
  entity: Extract<Entity, { type: "arc" }>,
  frame: Frame,
  position: Position,
  base: CurveBase,
): ViewerSketchReferenceCandidate | null {
  const [center, start, end] = [entity.centerPointId, entity.startPointId, entity.endPointId].map(
    position,
  )
  if (!center || !start || !end) return null
  const sweep = counterclockwiseSweep(frame, center, start, end)
  return {
    ...base,
    kind: "curve",
    sourceType: "arc",
    points: arcPoints(frame, center, start, sweep),
  }
}

function circleCandidate(
  entity: Extract<Entity, { type: "circle" }>,
  frame: Frame,
  position: Position,
  base: CurveBase,
): ViewerSketchReferenceCandidate | null {
  const center = position(entity.centerPointId)
  if (!center) return null
  const [cx, cy] = local(frame, center)
  const start = world(frame, [cx + entity.radius, cy])
  return { ...base, kind: "curve", sourceType: "circle", points: arcPoints(frame, center, start) }
}

function bezierCandidate(
  entity: Extract<Entity, { type: "cubic-bezier" }>,
  position: Position,
  base: CurveBase,
): ViewerSketchReferenceCandidate | null {
  const controls = [
    entity.startPointId,
    entity.control1PointId,
    entity.control2PointId,
    entity.endPointId,
  ].map(position)
  return controls.every(Boolean)
    ? {
        ...base,
        kind: "curve",
        sourceType: "cubic-bezier",
        points: bezierPoints(controls as ViewerVector3[]),
      }
    : null
}

function candidate(
  sketch: SketchRecord,
  frame: Frame,
  entity: Entity,
  position: Position,
  label: string,
): ViewerSketchReferenceCandidate | null {
  const base = { label, sourceSketchId: sketch.id, sourceEntityId: entity.id }
  switch (entity.type) {
    case "line": {
      const start = position(entity.startPointId)
      const end = position(entity.endPointId)
      return start && end
        ? { label, sourceSketchId: sketch.id, kind: "line", start, end, sourceLineId: entity.id }
        : null
    }
    case "arc":
      return arcCandidate(entity, frame, position, base)
    case "circle":
      return circleCandidate(entity, frame, position, base)
    case "cubic-bezier":
      return bezierCandidate(entity, position, base)
    default:
      return null
  }
}

/**
 * Projects selectable non-construction path curves of one solved sketch into world space. Elliptical
 * arcs remain available through the task panel's keyboard list.
 */
function patternPathCandidates(
  sketch: SketchRecord,
  display: SketchDisplayRecord,
  label: (kind: CurveKind, number: number) => string,
): readonly ViewerSketchReferenceCandidate[] {
  if (display.sketchId !== sketch.id) return []
  const positions = new Map(
    (display.solvedPoints ?? []).map(({ entityId, position }) => [entityId, position] as const),
  )
  const position = (id: string) => {
    const value = positions.get(id)
    return value?.every(Number.isFinite) ? (value as ViewerVector3) : undefined
  }
  return sketch.entities.flatMap((entity, index) => {
    if (entity.construction) return []
    if (!["line", "arc", "circle", "cubic-bezier"].includes(entity.type)) return []
    const result = candidate(
      sketch,
      display.frame,
      entity,
      position,
      label(entity.type as CurveKind, index + 1),
    )
    return result ? [result] : []
  })
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
