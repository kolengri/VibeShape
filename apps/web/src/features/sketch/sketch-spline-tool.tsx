import {
  appendSketchSpline,
  type SketchPoint2,
  type SketchPointTarget,
  type SketchRecord,
} from "@vibeshape/domain"
import {
  interpolatingSplineControls,
  MAX_SPLINE_THROUGH_POINTS,
  MIN_SPLINE_POINT_SPACING_MM,
} from "@vibeshape/domain/sketch-spline"
import { useTranslations } from "@vibeshape/i18n"
import { cn } from "@vibeshape/ui/lib/cn"
import {
  createBrowserSketchConstraintId,
  createBrowserSketchEntityId,
} from "../../document/document-controller"
import { SAFE_VIEWPORT_CENTER } from "../../shell/viewport-chrome-styles"

/** Through-points picked so far; nothing reaches the draft until the spline completes. */
export type PendingSpline = Readonly<{ kind: "spline"; points: readonly SketchPointTarget[] }>

function targetPoint(sketch: SketchRecord, target: SketchPointTarget): SketchPoint2 {
  if (target.kind === "new") return target.point
  const entity = sketch.entities.find(({ id }) => id === target.pointId)
  if (entity?.type !== "point") throw new TypeError("A spline target must reference a point.")
  return entity
}

function sameTarget(sketch: SketchRecord, first: SketchPointTarget, second: SketchPointTarget) {
  if (first.kind === "existing" && second.kind === "existing") {
    return first.pointId === second.pointId
  }
  const a = targetPoint(sketch, first)
  const b = targetPoint(sketch, second)
  return Math.hypot(a.x - b.x, a.y - b.y) <= MIN_SPLINE_POINT_SPACING_MM
}

function canClose(pending: PendingSpline) {
  return pending.points.length >= 3
}

function commitSpline(
  input: Readonly<{ construction: boolean; draft: SketchRecord }>,
  points: readonly SketchPointTarget[],
  closed: boolean,
) {
  const result = appendSketchSpline(input.draft, {
    points,
    closed,
    construction: input.construction,
    createConstraintId: createBrowserSketchConstraintId,
    createEntityId: createBrowserSketchEntityId,
  })
  return { draft: result.sketch, pending: null }
}

/**
 * Adds one through-point, or completes the spline as one draft change: picking the first
 * through-point closes it and repeating the last one (a double-click) finishes it open.
 */
export function placeSplineThroughPoint(
  input: Readonly<{
    construction: boolean
    draft: SketchRecord
    pending: PendingSpline | null
    target: SketchPointTarget
  }>,
): Readonly<{ draft: SketchRecord | null; pending: PendingSpline | null }> {
  const pending = input.pending
  if (!pending) return { draft: null, pending: { kind: "spline", points: [input.target] } }
  const [first] = pending.points
  const last = pending.points.at(-1)
  if (first && canClose(pending) && sameTarget(input.draft, first, input.target)) {
    return commitSpline(input, pending.points, true)
  }
  if (last && sameTarget(input.draft, last, input.target)) {
    return pending.points.length >= 2
      ? commitSpline(input, pending.points, false)
      : { draft: null, pending }
  }
  const points = [...pending.points, input.target]
  if (points.length >= MAX_SPLINE_THROUGH_POINTS) return commitSpline(input, points, false)
  return { draft: null, pending: { kind: "spline", points } }
}

/** Snaps a pick within the inference tolerance to the first or last pending through-point. */
export function splineCompletionSnap(
  sketch: SketchRecord,
  pending: PendingSpline,
  point: SketchPoint2,
  tolerance: number,
): SketchPointTarget | null {
  const [first] = pending.points
  const last = pending.points.at(-1)
  const near = (target: SketchPointTarget | undefined) => {
    if (!target) return false
    const position = targetPoint(sketch, target)
    return Math.hypot(position.x - point.x, position.y - point.y) <= tolerance
  }
  if (canClose(pending) && near(first)) return first ?? null
  return near(last) ? (last ?? null) : null
}

/** Enter finishes an open spline and Shift+Enter closes it by repeating the matching pick. */
export function splineKeyboardCompletionTarget(
  pending: PendingSpline,
  closed: boolean,
): SketchPointTarget | null {
  if (closed) return canClose(pending) ? (pending.points[0] ?? null) : null
  return pending.points.length >= 2 ? (pending.points.at(-1) ?? null) : null
}

function previewPath(points: readonly SketchPoint2[]) {
  const [start] = points
  if (!start || points.length < 2) return null
  try {
    const segments = interpolatingSplineControls(points, false)
    return segments
      .map(
        ({ control1, control2 }, index) =>
          `C ${control1.x} ${control1.y} ${control2.x} ${control2.y} ${points[index + 1]?.x} ${points[index + 1]?.y}`,
      )
      .reduce((path, segment) => `${path} ${segment}`, `M ${start.x} ${start.y}`)
  } catch {
    return null
  }
}

export function PendingSplineShape({
  cursor,
  pending,
  sketch,
}: Readonly<{ cursor: SketchPoint2; pending: PendingSpline; sketch: SketchRecord }>) {
  const picked = pending.points.map((target) => targetPoint(sketch, target))
  const last = picked.at(-1)
  // Right after a pick the cursor rests on it; preview the committed picks alone.
  const resting =
    last !== undefined &&
    Math.hypot(cursor.x - last.x, cursor.y - last.y) <= MIN_SPLINE_POINT_SPACING_MM
  const path = previewPath(resting ? picked : [...picked, cursor])
  const first = picked[0]
  return (
    <>
      {path ? (
        <path
          data-sketch-interpolated-spline-preview
          d={path}
          strokeDasharray="none"
          strokeWidth={2}
        />
      ) : null}
      {picked.map((point, index) => (
        <circle
          // Through-points are only appended while the preview is active.
          key={index}
          cx={point.x}
          cy={point.y}
          r={1.5}
          data-sketch-spline-through-point={index}
        />
      ))}
      {first && canClose(pending) ? (
        <circle
          cx={first.x}
          cy={first.y}
          r={3}
          fill="none"
          strokeDasharray="none"
          data-sketch-spline-close-target
        />
      ) : null}
    </>
  )
}

export function SketchInterpolatedSplineInstruction({
  active,
  pending,
}: Readonly<{ active: boolean; pending: PendingSpline | null }>) {
  const t = useTranslations("app.sketch.viewport")
  if (!active) return null
  const count = pending?.points.length ?? 0
  const step = count === 0 ? "start" : count === 1 ? "second" : count === 2 ? "open" : "closable"
  return (
    <div
      className={cn(
        "pointer-events-none absolute top-3 -translate-x-1/2 rounded-md border bg-background/90 px-3 py-2 text-xs font-medium shadow-sm",
        SAFE_VIEWPORT_CENTER,
      )}
      data-sketch-interpolated-spline-instruction
      role="status"
    >
      {t("interpolatedSplinePlacement", { count, step })}
    </div>
  )
}
