import type { DrawingSettings } from "@vibeshape/domain/drawing"
import type { DrawingCurve } from "@vibeshape/protocol"
import { type SheetSegment, segmentCrossesBox, viewObstacles } from "./callout-obstacles"
import type { ViewPlacement } from "./layout"
import { type SheetPoint, type SheetPrimitive, sheetNumber } from "./sheet"
import { primitiveBox, textWidthMm } from "./text-metrics"

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
      ...linearDimension("horizontal", left, right, y, formatLength(max[0] - min[0], units)),
    )
  }
  if (max[1] - min[1] > 1e-6) {
    const x = left - DIMENSION_OFFSET_MM
    result.push(
      line([left - EXTENSION_GAP_MM, bottom], [x - EXTENSION_OVERSHOOT_MM, bottom]),
      line([left - EXTENSION_GAP_MM, top], [x - EXTENSION_OVERSHOOT_MM, top]),
      ...linearDimension("vertical", bottom, top, x, formatLength(max[1] - min[1], units)),
    )
  }
  return result
}

/** Clearance between a dimension value and the extension lines beside it. */
const VALUE_CLEARANCE_MM = 1

/**
 * Dimension line, arrows and value between `from` and `to` along one sheet axis, at `at` across
 * it. Horizontal values sit above the line; vertical values read upward left of it. A value too
 * long for the space between the extension lines goes outside, beyond the far one, on an extended
 * dimension line, with both arrows outside pointing in (ISO 129-1).
 */
function linearDimension(
  axis: "horizontal" | "vertical",
  from: number,
  to: number,
  at: number,
  value: string,
): SheetPrimitive[] {
  const point = (along: number): SheetPoint => (axis === "horizontal" ? [along, at] : [at, along])
  const label = (along: number, align: "start" | "middle") =>
    axis === "horizontal"
      ? text([along, at + 1], value, align, 0)
      : text([at - 1, along], value, align, 90)
  const length = textWidthMm(value, TEXT_HEIGHT_MM)
  if (length + 2 * VALUE_CLEARANCE_MM <= to - from)
    return [
      line(point(from), point(to)),
      arrowhead(point(from), point(to)),
      arrowhead(point(to), point(from)),
      label((from + to) / 2, "middle"),
    ]
  const start = to + ARROW_LENGTH_MM + VALUE_CLEARANCE_MM
  return [
    line(point(from - ARROW_LENGTH_MM - VALUE_CLEARANCE_MM), point(start + length)),
    arrowhead(point(from), point(from - ARROW_LENGTH_MM)),
    arrowhead(point(to), point(to + ARROW_LENGTH_MM)),
    label(start, "start"),
  ]
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
 * turn): each tries the leader shelves and directions in order and takes the first that stays
 * readable. Its label and shoulder must clear every box placed so far, including `obstacles`; its
 * label must clear earlier leaders and the view's drawn circles and line pieces (hidden ones too
 * when hidden lines are drawn); and its leader must not pass through any placed text. A callout
 * that fits nowhere, or beyond the first eight diameters, is omitted and counted rather than drawn
 * over other text or lines.
 */
export function diameterCallouts(
  placement: ViewPlacement,
  settings: Pick<DrawingSettings, "units" | "hiddenLines">,
  factor: number,
  obstacles: readonly SheetPrimitive[],
): PlacedCallouts {
  const { units, hiddenLines } = settings
  const ranked = diameterGroups(placement.projection)
  const chosen = ranked
    .slice(0, MAX_DIAMETER_CALLOUTS)
    .sort((left, right) => compareAnchors(left[0], right[0]))
  const drawn = viewObstacles(placement.projection, hiddenLines)
  const avoid: Avoid = {
    boxes: obstacles.map(primitiveBox),
    texts: obstacles.filter(({ kind }) => kind === "text").map(primitiveBox),
    leaders: [],
    curves: (box) => {
      const [x, y] = placement.origin
      return drawn.crosses([
        (box[0] - x) / factor,
        (box[1] - y) / factor,
        (box[2] - x) / factor,
        (box[3] - y) / factor,
      ])
    },
  }
  const primitives: SheetPrimitive[] = []
  let omitted = ranked.length - chosen.length
  for (const members of chosen) {
    const callout = placeCallout(members, placement, units, factor, avoid)
    if (!callout) {
      omitted += 1
      continue
    }
    primitives.push(...callout.primitives)
    avoid.boxes.push(...callout.boxes)
    avoid.texts.push(callout.textBox)
    avoid.leaders.push(...callout.leaders)
  }
  return { primitives, omitted }
}

const diameterGroupCache = new WeakMap<ViewPlacement["projection"], Circle[][]>()

/**
 * Distinct visible full circles of a view grouped by diameter, largest first, members by centre.
 * The grouping depends on the projection only, so scale attempts reuse it.
 */
function diameterGroups(view: ViewPlacement["projection"]): Circle[][] {
  const cached = diameterGroupCache.get(view)
  if (cached) return cached
  const circles = view.edges.flatMap((edge) =>
    edge.visibility === "visible" && edge.curve.kind === "circle" ? [edge.curve] : [],
  )
  const groups = new Map<string, Circle[]>()
  for (const circle of uniqueCircles(circles)) {
    const key = sheetNumber(circle.radius, 6)
    const members = groups.get(key)
    if (members) members.push(circle)
    else groups.set(key, [circle])
  }
  const ranked = [...groups.values()]
    .map((members) => members.sort(byCenter))
    .sort((left, right) => (right[0]?.radius ?? 0) - (left[0]?.radius ?? 0))
  diameterGroupCache.set(view, ranked)
  return ranked
}

function toSheet(placement: ViewPlacement, factor: number, point: SheetPoint): SheetPoint {
  return [placement.origin[0] + point[0] * factor, placement.origin[1] + point[1] * factor]
}

function compareAnchors(left: Circle | undefined, right: Circle | undefined) {
  if (!left || !right) return 0
  return byCenter(left, right) || left.radius - right.radius
}

/** What a callout must keep clear of; the arrays grow as callouts are placed. */
type Avoid = Readonly<{
  boxes: Box[]
  texts: Box[]
  leaders: SheetSegment[]
  /** True when a drawn curve of the view (circle or line piece) touches the sheet box. */
  curves: (box: Box) => boolean
}>
type Callout = ReturnType<typeof calloutAt>

function placeCallout(
  members: readonly Circle[],
  placement: ViewPlacement,
  units: DrawingSettings["units"],
  factor: number,
  avoid: Avoid,
) {
  const circle = members[0]
  if (!circle) return null
  const center = toSheet(placement, factor, circle.center)
  const label = `${members.length > 1 ? `${members.length}× ` : ""}Ø${formatLength(circle.radius * 2, units)}`
  for (const length of LEADER_LENGTHS_MM)
    for (const angle of LEADER_ANGLES) {
      const candidate = calloutAt(center, circle.radius * factor, angle, length, label)
      if (readable(candidate, avoid)) return candidate
    }
  return null
}

function readable(candidate: Callout, avoid: Avoid) {
  const clearance = grow(candidate.textBox, CALLOUT_GAP_MM)
  return (
    candidate.boxes.every((box) => avoid.boxes.every((other) => !boxesOverlap(box, other))) &&
    avoid.leaders.every(([start, end]) => !segmentCrossesBox(start, end, clearance)) &&
    candidate.leaders.every(([start, end]) =>
      avoid.texts.every((box) => !segmentCrossesBox(start, end, grow(box, CALLOUT_GAP_MM))),
    ) &&
    !avoid.curves(clearance)
  )
}

function grow(box: Box, margin: number): Box {
  return [box[0] - margin, box[1] - margin, box[2] + margin, box[3] + margin]
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
  const textBox = primitiveBox(value)
  return {
    primitives: [line(elbow, tip), line(elbow, end), arrowhead(tip, elbow), value],
    textBox,
    boxes: [textBox, primitiveBox(line(elbow, end))],
    leaders: [
      [elbow, tip],
      [elbow, end],
    ] as SheetSegment[],
  }
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
