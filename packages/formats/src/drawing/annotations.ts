import type { DrawingSettings } from "@vibeshape/domain/drawing"
import type { DrawingCurve } from "@vibeshape/protocol"
import type { ViewPlacement } from "./layout"
import { type SheetPoint, type SheetPrimitive, sheetNumber } from "./sheet"

export const TEXT_HEIGHT_MM = 3.5
const ARROW_LENGTH_MM = 3
const ARROW_HALF_WIDTH_MM = 0.5
const DIMENSION_OFFSET_MM = 8
const EXTENSION_GAP_MM = 1.5
const EXTENSION_OVERSHOOT_MM = 1.5
const LEADER_LENGTH_MM = 8
const SHOULDER_LENGTH_MM = 4
const MAX_DIAMETER_CALLOUTS = 8

/** Filled arrowhead with its tip at `tip`, pointing away from `from`. */
function arrowhead(tip: SheetPoint, from: SheetPoint): SheetPrimitive {
  const length = Math.hypot(tip[0] - from[0], tip[1] - from[1]) || 1
  const ux = (tip[0] - from[0]) / length
  const uy = (tip[1] - from[1]) / length
  const base: SheetPoint = [tip[0] - ux * ARROW_LENGTH_MM, tip[1] - uy * ARROW_LENGTH_MM]
  return {
    kind: "arrow",
    layer: "dimension",
    points: [
      tip,
      [base[0] - uy * ARROW_HALF_WIDTH_MM, base[1] + ux * ARROW_HALF_WIDTH_MM],
      [base[0] + uy * ARROW_HALF_WIDTH_MM, base[1] - ux * ARROW_HALF_WIDTH_MM],
    ],
  }
}

/** Dimension value in the requested display unit; geometry stays in millimetres. */
function formatLength(millimetres: number, units: DrawingSettings["units"]) {
  return units === "in" ? sheetNumber(millimetres / 25.4, 3) : sheetNumber(millimetres, 2)
}

/** Overall width below and overall height left of an orthographic view; callouts use the right. */
export function overallDimensions(
  placement: ViewPlacement,
  units: DrawingSettings["units"],
): SheetPrimitive[] {
  const { rect, projection } = placement
  const { min, max } = projection.bounds
  const result: SheetPrimitive[] = []
  const left = rect.x
  const right = rect.x + rect.width
  const bottom = rect.y
  const top = rect.y + rect.height
  if (max[0] - min[0] > 1e-6) {
    const y = bottom - DIMENSION_OFFSET_MM
    result.push(
      line([left, bottom - EXTENSION_GAP_MM], [left, y - EXTENSION_OVERSHOOT_MM]),
      line([right, bottom - EXTENSION_GAP_MM], [right, y - EXTENSION_OVERSHOOT_MM]),
      line([left, y], [right, y]),
      arrowhead([left, y], [right, y]),
      arrowhead([right, y], [left, y]),
      text([(left + right) / 2, y + 1], formatLength(max[0] - min[0], units), "middle", 0),
    )
  }
  if (max[1] - min[1] > 1e-6) {
    const x = left - DIMENSION_OFFSET_MM
    result.push(
      line([left - EXTENSION_GAP_MM, bottom], [x - EXTENSION_OVERSHOOT_MM, bottom]),
      line([left - EXTENSION_GAP_MM, top], [x - EXTENSION_OVERSHOOT_MM, top]),
      line([x, bottom], [x, top]),
      arrowhead([x, bottom], [x, top]),
      arrowhead([x, top], [x, bottom]),
      text([x - 1, (bottom + top) / 2], formatLength(max[1] - min[1], units), "middle", 90),
    )
  }
  return result
}

/**
 * One leader per distinct diameter of the visible full circles in a view, prefixed with the
 * occurrence count when the same diameter repeats. Hidden circles are never called out.
 */
export function diameterCallouts(
  placement: ViewPlacement,
  units: DrawingSettings["units"],
  factor: number,
): SheetPrimitive[] {
  const circles = placement.projection.edges.flatMap((edge) =>
    edge.visibility === "visible" && edge.curve.kind === "circle" ? [edge.curve] : [],
  )
  const groups = new Map<string, Extract<DrawingCurve, { kind: "circle" }>[]>()
  for (const circle of uniqueCircles(circles)) {
    const key = sheetNumber(circle.radius, 6)
    groups.set(key, [...(groups.get(key) ?? []), circle])
  }
  const ordered = [...groups.values()]
    .map((members) => members.sort(byCenter))
    .sort((left, right) => (right[0]?.radius ?? 0) - (left[0]?.radius ?? 0))
    .slice(0, MAX_DIAMETER_CALLOUTS)
  return ordered.flatMap((members) => {
    const circle = members[0]
    if (!circle) return []
    const center: SheetPoint = [
      placement.origin[0] + circle.center[0] * factor,
      placement.origin[1] + circle.center[1] * factor,
    ]
    const radius = circle.radius * factor
    const diagonal = Math.SQRT1_2
    const tip: SheetPoint = [center[0] + radius * diagonal, center[1] + radius * diagonal]
    const elbow: SheetPoint = [
      tip[0] + LEADER_LENGTH_MM * diagonal,
      tip[1] + LEADER_LENGTH_MM * diagonal,
    ]
    const end: SheetPoint = [elbow[0] + SHOULDER_LENGTH_MM, elbow[1]]
    const count = members.length > 1 ? `${members.length}× ` : ""
    return [
      line(elbow, tip),
      line(elbow, end),
      arrowhead(tip, elbow),
      text(
        [end[0] + 1, end[1] - 1],
        `${count}Ø${formatLength(circle.radius * 2, units)}`,
        "start",
        0,
      ),
    ]
  })
}

function uniqueCircles(circles: readonly Extract<DrawingCurve, { kind: "circle" }>[]) {
  const seen = new Set<string>()
  return circles.filter((circle) => {
    const key = [circle.center[0], circle.center[1], circle.radius]
      .map((value) => sheetNumber(value, 4))
      .join(":")
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function byCenter(
  left: Extract<DrawingCurve, { kind: "circle" }>,
  right: Extract<DrawingCurve, { kind: "circle" }>,
) {
  return left.center[0] - right.center[0] || left.center[1] - right.center[1]
}

function line(start: SheetPoint, end: SheetPoint): SheetPrimitive {
  return { kind: "line", layer: "dimension", start, end }
}

function text(
  position: SheetPoint,
  value: string,
  align: "start" | "middle" | "end",
  rotation: 0 | 90,
): SheetPrimitive {
  return {
    kind: "text",
    layer: "dimension",
    position,
    height: TEXT_HEIGHT_MM,
    text: value,
    align,
    rotation,
  }
}
