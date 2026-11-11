import type { DrawingSettings } from "@vibeshape/domain/drawing"
import type { DrawingCurve } from "@vibeshape/protocol"
import type { ViewPlacement } from "./layout"
import { type SheetPoint, type SheetPrimitive, sheetNumber } from "./sheet"
import { primitiveBox } from "./text-metrics"

export const TEXT_HEIGHT_MM = 3.5
const ARROW_LENGTH_MM = 3
const ARROW_HALF_WIDTH_MM = 0.5
const DIMENSION_OFFSET_MM = 8
const EXTENSION_GAP_MM = 1.5
const EXTENSION_OVERSHOOT_MM = 1.5
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

type Circle = Extract<DrawingCurve, { kind: "circle" }>
type Box = readonly [minX: number, minY: number, maxX: number, maxY: number]

/** Clear space kept around every placed annotation text. */
const CALLOUT_GAP_MM = 0.5
/** Leader shelves, spaced by more than the text height plus the gap. */
const LEADER_LENGTHS_MM = [8, 13, 18, 23, 28] as const
/** Leader directions tried on each shelf: up-right, up-left, down-right, down-left. */
const LEADER_ANGLES = [Math.PI / 4, (3 * Math.PI) / 4, -Math.PI / 4, (-3 * Math.PI) / 4] as const

export type PlacedCallouts = Readonly<{ primitives: SheetPrimitive[]; omitted: number }>

/**
 * One leader per distinct diameter of the visible full circles in a view, prefixed with the
 * occurrence count when the same diameter repeats; hidden circles are never called out. Callouts
 * are placed greedily in a fixed order (by centre, then radius, so concentric rings are placed in
 * turn): each tries the leader shelves and directions in order and takes the first whose label and
 * shoulder clear every box placed so far, including `obstacles`. A callout that fits nowhere, or
 * beyond the first eight diameters, is omitted and counted rather than drawn over other text.
 */
export function diameterCallouts(
  placement: ViewPlacement,
  units: DrawingSettings["units"],
  factor: number,
  obstacles: readonly Box[],
): PlacedCallouts {
  const circles = placement.projection.edges.flatMap((edge) =>
    edge.visibility === "visible" && edge.curve.kind === "circle" ? [edge.curve] : [],
  )
  const groups = new Map<string, Circle[]>()
  for (const circle of uniqueCircles(circles)) {
    const key = sheetNumber(circle.radius, 6)
    groups.set(key, [...(groups.get(key) ?? []), circle])
  }
  const ranked = [...groups.values()]
    .map((members) => members.sort(byCenter))
    .sort((left, right) => (right[0]?.radius ?? 0) - (left[0]?.radius ?? 0))
  const chosen = ranked
    .slice(0, MAX_DIAMETER_CALLOUTS)
    .sort((left, right) => compareAnchors(left[0], right[0]))
  const placed = [...obstacles]
  const rings = uniqueCircles(circles).map(
    (circle): Ring => ({
      center: [
        placement.origin[0] + circle.center[0] * factor,
        placement.origin[1] + circle.center[1] * factor,
      ],
      radius: circle.radius * factor,
    }),
  )
  const primitives: SheetPrimitive[] = []
  let omitted = ranked.length - chosen.length
  for (const members of chosen) {
    const callout = placeCallout(members, placement, units, factor, { boxes: placed, rings })
    if (!callout) {
      omitted += 1
      continue
    }
    primitives.push(...callout.primitives)
    placed.push(...callout.boxes)
  }
  return { primitives, omitted }
}

function compareAnchors(left: Circle | undefined, right: Circle | undefined) {
  if (!left || !right) return 0
  return byCenter(left, right) || left.radius - right.radius
}

type Ring = Readonly<{ center: SheetPoint; radius: number }>

function placeCallout(
  members: readonly Circle[],
  placement: ViewPlacement,
  units: DrawingSettings["units"],
  factor: number,
  avoid: Readonly<{ boxes: readonly Box[]; rings: readonly Ring[] }>,
) {
  const circle = members[0]
  if (!circle) return null
  const center: SheetPoint = [
    placement.origin[0] + circle.center[0] * factor,
    placement.origin[1] + circle.center[1] * factor,
  ]
  const label = `${members.length > 1 ? `${members.length}× ` : ""}Ø${formatLength(circle.radius * 2, units)}`
  for (const length of LEADER_LENGTHS_MM)
    for (const angle of LEADER_ANGLES) {
      const candidate = calloutAt(center, circle.radius * factor, angle, length, label)
      const [textBox] = candidate.boxes
      if (
        textBox &&
        candidate.boxes.every((box) => avoid.boxes.every((other) => !boxesOverlap(box, other))) &&
        avoid.rings.every((ring) => !boxCrossesRing(textBox, ring))
      )
        return candidate
    }
  return null
}

function calloutAt(
  center: SheetPoint,
  radius: number,
  angle: number,
  length: number,
  label: string,
) {
  const direction: SheetPoint = [Math.cos(angle), Math.sin(angle)]
  const side = direction[0] >= 0 ? 1 : -1
  const tip: SheetPoint = [center[0] + radius * direction[0], center[1] + radius * direction[1]]
  const elbow: SheetPoint = [tip[0] + length * direction[0], tip[1] + length * direction[1]]
  const end: SheetPoint = [elbow[0] + side * SHOULDER_LENGTH_MM, elbow[1]]
  const value = text([end[0] + side, end[1] - 1], label, side > 0 ? "start" : "end", 0)
  return {
    primitives: [line(elbow, tip), line(elbow, end), arrowhead(tip, elbow), value],
    boxes: [primitiveBox(value), primitiveBox(line(elbow, end))],
  }
}

/** True when the circle's curve passes through the box (expanded by the gap), not merely around it. */
function boxCrossesRing(box: Box, ring: Ring) {
  const [x0, y0, x1, y1] = [
    box[0] - CALLOUT_GAP_MM,
    box[1] - CALLOUT_GAP_MM,
    box[2] + CALLOUT_GAP_MM,
    box[3] + CALLOUT_GAP_MM,
  ]
  const [cx, cy] = ring.center
  const nearest = Math.hypot(Math.max(x0 - cx, 0, cx - x1), Math.max(y0 - cy, 0, cy - y1))
  const farthest = Math.hypot(Math.max(cx - x0, x1 - cx), Math.max(cy - y0, y1 - cy))
  return nearest <= ring.radius && ring.radius <= farthest
}

function boxesOverlap(left: Box, right: Box) {
  return (
    left[0] < right[2] + CALLOUT_GAP_MM &&
    right[0] < left[2] + CALLOUT_GAP_MM &&
    left[1] < right[3] + CALLOUT_GAP_MM &&
    right[1] < left[3] + CALLOUT_GAP_MM
  )
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

function byCenter(left: Circle, right: Circle) {
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
