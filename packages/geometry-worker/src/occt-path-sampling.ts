import {
  type PatternFeatureContentParametersV3,
  patternFeatureContentParametersV3Schema,
} from "@vibeshape/protocol"
import type { Edge } from "replicad"
import type { BRepAdaptor_Curve, OpenCascadeInstance } from "replicad-opencascadejs"
import { createAnalyticalEdge } from "./occt-loft"

type Vector3 = readonly [number, number, number]
export type PatternPlacement = Readonly<{
  /** Applied after the rotation, which pivots about the reference station. */
  translation: Vector3
  rotation: Readonly<{ origin: Vector3; axis: Vector3; angle: number }> | null
}>
type Station = Readonly<{ position: Vector3; tangent: Vector3 }>
type Path = PatternFeatureContentParametersV3["path"]
type CurveSample = Readonly<{ point: Vector3; derivative: Vector3 }>
type Panel = Readonly<{ curve: number; a: number; b: number; start: number; length: number }>
type MeasuredPath = Readonly<{
  panels: readonly Panel[]
  length: number
  /** Arc-length position of the authored start on a closed loop's parameter seam. */
  startShift: number
  /** +1 when increasing parameter is counterclockwise about the sketch normal. */
  winding: 1 | -1
  closed: boolean
}>

// Ten-point Gauss-Legendre rule on [-1, 1].
const GAUSS_NODES = [
  -0.9739065285171717, -0.8650633666889845, -0.6794095682990244, -0.4333953941292472,
  -0.1488743389816312, 0.1488743389816312, 0.4333953941292472, 0.6794095682990244,
  0.8650633666889845, 0.9739065285171717,
] as const
const GAUSS_WEIGHTS = [
  0.0666713443086881, 0.1494513491505806, 0.219086362515982, 0.2692667193099963, 0.2955242247147529,
  0.2955242247147529, 0.2692667193099963, 0.219086362515982, 0.1494513491505806, 0.0666713443086881,
] as const
const PANEL_RELATIVE_TOLERANCE = 1e-12
const MAX_PANELS = 16_384
const MAX_PANEL_DEPTH = 40
const LENGTH_TOLERANCE = 1e-6
const INVERSION_TOLERANCE = 1e-10

function gauss(evaluate: (u: number) => number, a: number, b: number) {
  const half = (b - a) / 2
  const middle = (a + b) / 2
  let total = 0
  for (const [index, node] of GAUSS_NODES.entries())
    total += (GAUSS_WEIGHTS[index] ?? 0) * evaluate(middle + half * node)
  return total * half
}

function norm(vector: Vector3) {
  return Math.hypot(vector[0], vector[1], vector[2])
}

function dot(left: Vector3, right: Vector3) {
  return left[0] * right[0] + left[1] * right[1] + left[2] * right[2]
}

function cross(left: Vector3, right: Vector3): Vector3 {
  return [
    left[1] * right[2] - left[2] * right[1],
    left[2] * right[0] - left[0] * right[2],
    left[0] * right[1] - left[1] * right[0],
  ]
}

function subtract(left: Vector3, right: Vector3): Vector3 {
  return [left[0] - right[0], left[1] - right[1], left[2] - right[2]]
}

/** Owns every native temporary for one adaptor; `release` is idempotent-safe for the caller. */
function sampledCurve(opencascade: OpenCascadeInstance, edge: Edge) {
  const adaptor: BRepAdaptor_Curve = new opencascade.BRepAdaptor_Curve_2(edge.wrapped)
  let point: InstanceType<OpenCascadeInstance["gp_Pnt_1"]> | null = null
  let derivative: InstanceType<OpenCascadeInstance["gp_Vec_1"]>
  try {
    point = new opencascade.gp_Pnt_1()
    derivative = new opencascade.gp_Vec_1()
  } catch (error) {
    point?.delete()
    adaptor.delete()
    throw error
  }
  const ownedPoint = point
  return {
    first: adaptor.FirstParameter(),
    last: adaptor.LastParameter(),
    sample(u: number): CurveSample {
      adaptor.D1(u, ownedPoint, derivative)
      return {
        point: [ownedPoint.X(), ownedPoint.Y(), ownedPoint.Z()],
        derivative: [derivative.X(), derivative.Y(), derivative.Z()],
      }
    },
    release() {
      derivative.delete()
      ownedPoint.delete()
      adaptor.delete()
    },
  }
}
type SampledCurve = ReturnType<typeof sampledCurve>

function speed(curve: SampledCurve, u: number) {
  return norm(curve.sample(u).derivative)
}

/** Adaptive bisection until each panel's Gauss estimate agrees with its two halves. */
function measurePanels(curve: SampledCurve, curveIndex: number, panels: Panel[], start: number) {
  const pending: [number, number, number][] = [[curve.first, curve.last, 0]]
  const accepted: Omit<Panel, "start">[] = []
  while (pending.length) {
    const [a, b, depth] = pending.pop() as [number, number, number]
    const whole = gauss((u) => speed(curve, u), a, b)
    const middle = (a + b) / 2
    const left = gauss((u) => speed(curve, u), a, middle)
    const right = gauss((u) => speed(curve, u), middle, b)
    if (Math.abs(whole - left - right) <= PANEL_RELATIVE_TOLERANCE * Math.max(1, whole)) {
      accepted.push({ curve: curveIndex, a, b, length: left + right })
      continue
    }
    if (depth >= MAX_PANEL_DEPTH || accepted.length + pending.length >= MAX_PANELS)
      throw new Error("Pattern path arc length did not converge.")
    pending.push([middle, b, depth + 1], [a, middle, depth + 1])
  }
  let abscissa = start
  for (const panel of accepted) {
    panels.push({ ...panel, start: abscissa })
    abscissa += panel.length
  }
  return abscissa - start
}

/** Twice the signed area enclosed by the loop, measured in the sketch frame. */
function loopArea(curves: readonly SampledCurve[], panels: readonly Panel[], path: Path) {
  const local = (vector: Vector3) => [dot(vector, path.frame.xAxis), dot(vector, path.frame.yAxis)]
  let total = 0
  for (const panel of panels) {
    const curve = curves[panel.curve] as SampledCurve
    total += gauss(
      (u) => {
        const sample = curve.sample(u)
        const [x = 0, y = 0] = local(subtract(sample.point, path.frame.origin))
        const [dx = 0, dy = 0] = local(sample.derivative)
        return x * dy - y * dx
      },
      panel.a,
      panel.b,
    )
  }
  return total
}

function pathEdges(opencascade: OpenCascadeInstance, path: Path, edges: Edge[]) {
  const segments = path.geometry.kind === "circle" ? [path.geometry.circle] : path.geometry.segments
  for (const segment of segments)
    edges.push(createAnalyticalEdge(opencascade, path.frame, segment, false))
}

function measurePath(path: Path, curves: readonly SampledCurve[]): MeasuredPath {
  const panels: Panel[] = []
  let length = 0
  for (const [index, curve] of curves.entries()) {
    const edgeLength = measurePanels(curve, index, panels, length)
    if (!Number.isFinite(edgeLength)) throw new Error("Pattern path arc length is not finite.")
    length += edgeLength
  }
  if (!(length > LENGTH_TOLERANCE)) throw new Error("Pattern path length must be positive.")
  if (path.geometry.kind === "circle")
    return {
      panels,
      length,
      startShift: path.geometry.circle.radius * path.geometry.startAngle,
      winding: 1,
      closed: true,
    }
  const closed = path.geometry.closed
  return {
    panels,
    length,
    startShift: 0,
    winding: closed && loopArea(curves, panels, path) < 0 ? -1 : 1,
    closed,
  }
}

function findPanel(panels: readonly Panel[], abscissa: number) {
  let low = 0
  let high = panels.length - 1
  while (low < high) {
    const middle = Math.ceil((low + high) / 2)
    if ((panels[middle] as Panel).start <= abscissa) low = middle
    else high = middle - 1
  }
  return panels[low] as Panel
}

/** Newton iteration on the panel's arc-length function, safeguarded by its bracket. */
function invertPanel(curve: SampledCurve, panel: Panel, target: number) {
  let low = panel.a
  let high = panel.b
  let u = panel.a + (panel.b - panel.a) * Math.min(1, Math.max(0, target / panel.length))
  for (let iteration = 0; iteration < 60; iteration += 1) {
    const residual = gauss((value) => speed(curve, value), panel.a, u) - target
    if (Math.abs(residual) <= INVERSION_TOLERANCE) return u
    if (residual > 0) high = u
    else low = u
    const derivative = speed(curve, u)
    const newton = derivative > 0 ? u - residual / derivative : Number.NaN
    u = newton > low && newton < high ? newton : (low + high) / 2
  }
  return u
}

function station(
  measured: MeasuredPath,
  curves: readonly SampledCurve[],
  abscissa: number,
  direction: 1 | -1,
): Station {
  const clamped = Math.min(measured.length, Math.max(0, abscissa))
  const panel = findPanel(measured.panels, clamped)
  const curve = curves[panel.curve] as SampledCurve
  const u = invertPanel(curve, panel, Math.min(panel.length, Math.max(0, clamped - panel.start)))
  const sample = curve.sample(u)
  const magnitude = norm(sample.derivative)
  if (!(magnitude > 0)) throw new Error("Pattern path tangent is undefined.")
  return {
    position: sample.point,
    tangent: sample.derivative.map((value) => (direction * value) / magnitude) as [
      number,
      number,
      number,
    ],
  }
}

function formatMillimeters(value: number) {
  return `${Number(value.toFixed(4))} mm`
}

/** Distances from the reference station along the path, already bounded by its length. */
export function pathPatternDistances(
  parameters: Pick<PatternFeatureContentParametersV3, "count" | "spacing" | "startOffset">,
  length: number,
  closed: boolean,
): readonly number[] {
  const { count, spacing, startOffset } = parameters
  if (startOffset >= length - LENGTH_TOLERANCE)
    throw new Error(
      `Pattern start offset ${formatMillimeters(startOffset)} must be shorter than the path length ${formatMillimeters(length)}.`,
    )
  const interval =
    spacing.mode === "fixed"
      ? spacing.distance
      : closed
        ? length / count
        : (length - startOffset) / (count - 1)
  const travel = (count - 1) * interval
  if (spacing.mode === "fixed" && closed && travel >= length - LENGTH_TOLERANCE)
    throw new Error(
      `Fixed spacing ${formatMillimeters(interval)} wraps a closed path of ${formatMillimeters(length)}; the last instance would reach the seed.`,
    )
  if (spacing.mode === "fixed" && !closed && startOffset + travel > length + LENGTH_TOLERANCE)
    throw new Error(
      `Fixed spacing overruns the path: ${count} instances need ${formatMillimeters(startOffset + travel)} but the path is ${formatMillimeters(length)}.`,
    )
  return Array.from({ length: count }, (_, index) =>
    index === count - 1 && spacing.mode === "equal" && !closed
      ? length
      : startOffset + interval * index,
  )
}

function placement(reference: Station, target: Station, follow: boolean, normal: Vector3) {
  const translation = subtract(target.position, reference.position)
  if (!follow) return { translation, rotation: null }
  const angle = Math.atan2(
    dot(normal, cross(reference.tangent, target.tangent)),
    dot(reference.tangent, target.tangent),
  )
  return { translation, rotation: { origin: reference.position, axis: normal, angle } }
}

function stationsFor(
  parameters: PatternFeatureContentParametersV3,
  measured: MeasuredPath,
  curves: readonly SampledCurve[],
) {
  const distances = pathPatternDistances(parameters, measured.length, measured.closed)
  if (!measured.closed) {
    const direction = parameters.reverse ? -1 : 1
    return distances.map((distance) =>
      station(
        measured,
        curves,
        parameters.reverse ? measured.length - distance : distance,
        direction,
      ),
    )
  }
  const direction = (measured.winding * (parameters.reverse ? -1 : 1)) as 1 | -1
  return distances.map((distance) => {
    const raw = (measured.startShift + direction * distance) % measured.length
    return station(measured, curves, raw < 0 ? raw + measured.length : raw, direction)
  })
}

/**
 * Converts a planar sketch path into rigid placements relative to the seed. Instance zero is the
 * identity; `follow` rotates about the sketch normal by the signed tangent turn from the reference
 * station, which is the rotation-minimizing frame of a planar curve. All native temporaries are
 * released on success and failure.
 */
export function samplePathPatternPlacements(
  opencascade: OpenCascadeInstance,
  parameters: PatternFeatureContentParametersV3,
): readonly PatternPlacement[] {
  const parsed = patternFeatureContentParametersV3Schema.parse(parameters)
  const edges: Edge[] = []
  const curves: SampledCurve[] = []
  try {
    pathEdges(opencascade, parsed.path, edges)
    for (const edge of edges) curves.push(sampledCurve(opencascade, edge))
    const measured = measurePath(parsed.path, curves)
    const stations = stationsFor(parsed, measured, curves)
    const reference = stations[0] as Station
    const follow = parsed.orientation === "follow"
    return stations.map((target) => placement(reference, target, follow, parsed.path.frame.normal))
  } finally {
    for (const curve of curves.reverse()) curve.release()
    for (const edge of edges.reverse()) edge.delete()
  }
}
