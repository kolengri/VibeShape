import svgpath from "svgpath"
import { z } from "zod"
import { scaledPoint2 } from "./affine"
import { type ImportedCurve, type ImportLimits, requireImport } from "./contracts"

type Point = readonly [number, number]
function signedArcSweep(u: Point, v: Point, clockwise: number) {
  let sweep = Math.atan2(u[0] * v[1] - u[1] * v[0], u[0] * v[0] + u[1] * v[1])
  if (clockwise && sweep < 0) sweep += Math.PI * 2
  if (!clockwise && sweep > 0) sweep -= Math.PI * 2
  return sweep
}
function svgArc(
  start: Point,
  end: Point,
  radiusX: number,
  radiusY: number,
  degrees: number,
  large: number,
  clockwise: number,
  scale: number,
): ImportedCurve | null {
  if (start[0] === end[0] && start[1] === end[1]) return null
  let rx = Math.abs(radiusX)
  let ry = Math.abs(radiusY)
  if (rx === 0 || ry === 0)
    return { type: "line", start: scaledPoint2(...start, scale), end: scaledPoint2(...end, scale) }
  requireImport(
    [0, 1].includes(large) && [0, 1].includes(clockwise),
    "invalid-format",
    "SVG arc flags must be zero or one.",
  )
  const phi = (degrees * Math.PI) / 180
  const cosine = Math.cos(phi)
  const sine = Math.sin(phi)
  const dx = (start[0] - end[0]) / 2
  const dy = (start[1] - end[1]) / 2
  const x = cosine * dx + sine * dy
  const y = -sine * dx + cosine * dy
  const expansion = (x * x) / (rx * rx) + (y * y) / (ry * ry)
  if (expansion > 1) {
    rx *= Math.sqrt(expansion)
    ry *= Math.sqrt(expansion)
  }
  const numerator = Math.max(0, rx * rx * ry * ry - rx * rx * y * y - ry * ry * x * x)
  const denominator = rx * rx * y * y + ry * ry * x * x
  const factor = (large === clockwise ? -1 : 1) * Math.sqrt(numerator / denominator)
  const cx = (factor * rx * y) / ry
  const cy = (-factor * ry * x) / rx
  const center = scaledPoint2(
    cosine * cx - sine * cy + (start[0] + end[0]) / 2,
    sine * cx + cosine * cy + (start[1] + end[1]) / 2,
    scale,
  )
  const u: Point = [(x - cx) / rx, (y - cy) / ry]
  const v: Point = [(-x - cx) / rx, (-y - cy) / ry]
  const startAngle = Math.atan2(u[1], u[0])
  const sweep = signedArcSweep(u, v, clockwise)
  return {
    type: "elliptical-arc",
    center,
    xAxis: scaledPoint2(rx * cosine, rx * sine, scale),
    yAxis: scaledPoint2(-ry * sine, ry * cosine, scale),
    startAngle,
    sweep,
  }
}
const parserStateSchema = z.object({ err: z.string() })
type SvgSegment = Parameters<Parameters<ReturnType<typeof svgpath>["iterate"]>[0]>[0]
function segmentCurve(
  segment: SvgSegment,
  sourceStart: Point,
  scale: number,
): ImportedCurve | null {
  const [x, y] = sourceStart
  const point = scaledPoint2(x, y, scale)
  switch (segment[0]) {
    case "L":
      return { type: "line", start: point, end: scaledPoint2(segment[1], segment[2], scale) }
    case "H":
      return { type: "line", start: point, end: scaledPoint2(segment[1], y, scale) }
    case "V":
      return { type: "line", start: point, end: scaledPoint2(x, segment[1], scale) }
    case "Q":
      return {
        type: "quadratic-bezier",
        start: point,
        control: scaledPoint2(segment[1], segment[2], scale),
        end: scaledPoint2(segment[3], segment[4], scale),
      }
    case "C":
      return {
        type: "cubic-bezier",
        start: point,
        control1: scaledPoint2(segment[1], segment[2], scale),
        control2: scaledPoint2(segment[3], segment[4], scale),
        end: scaledPoint2(segment[5], segment[6], scale),
      }
    case "A":
      return svgArc(
        sourceStart,
        [segment[6], segment[7]],
        segment[1],
        segment[2],
        segment[3],
        segment[4],
        segment[5],
        scale,
      )
    default:
      requireImport(false, "invalid-format", "Unsupported normalized SVG path command.", segment[0])
  }
}
export function svgPathCurves(data: string, scale: number, limits: ImportLimits) {
  let commands = 0
  for (const _command of data.matchAll(/[MmLlHhVvCcSsQqTtAaZz]/g))
    requireImport(
      ++commands <= limits.pathSegments * 3 + 1,
      "resource-limit",
      "SVG path data exceeds its command budget.",
    )
  let tokens = 0
  for (const token of data.matchAll(/[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/g)) {
    requireImport(
      ++tokens <= limits.pathSegments * 8 && token[0].length <= 64,
      "resource-limit",
      "SVG path data exceeds its token budget.",
    )
    requireImport(
      Number.isFinite(Number(token[0])),
      "invalid-geometry",
      "SVG path coordinates must be finite.",
    )
  }
  const parsed = svgpath(data)
  requireImport(
    parserStateSchema.parse(parsed).err === "",
    "invalid-format",
    "SVG path syntax is malformed.",
  )
  const paths: Array<{ closed: boolean; segments: ImportedCurve[] }> = []
  let current: { closed: boolean; segments: ImportedCurve[] } | null = null
  let start: Point = [0, 0]
  let count = 0
  const add = (curve: ImportedCurve | null) => {
    if (!curve) return
    requireImport(
      ++count <= limits.pathSegments,
      "resource-limit",
      "SVG path exceeds its analytical segment budget.",
    )
    current?.segments.push(curve)
  }
  parsed
    .abs()
    .unshort()
    .iterate((segment, _index, x, y) => {
      const sourceStart: Point = [x, y]
      const point = scaledPoint2(x, y, scale)
      const command = segment[0]
      if (command === "M") {
        current = { closed: false, segments: [] }
        paths.push(current)
        start = [segment[1], segment[2]]
        return
      }
      requireImport(
        current !== null,
        "invalid-format",
        "An SVG path must begin with a move command.",
      )
      if (command === "Z" || command === "z") {
        if (x !== start[0] || y !== start[1])
          add({ type: "line", start: point, end: scaledPoint2(...start, scale) })
        current.closed = true
        return
      }
      if (current.closed) {
        current = { closed: false, segments: [] }
        paths.push(current)
        start = sourceStart
      }
      add(segmentCurve(segment, sourceStart, scale))
    })
  return paths.filter(({ segments }) => segments.length > 0)
}
