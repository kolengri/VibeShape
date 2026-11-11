import {
  MAX_TOPOLOGY_BEZIER_CHAIN_SEGMENTS as MAX_BEZIER_CHAIN_SEGMENTS,
  TOPOLOGY_BEZIER_CHAIN_TOLERANCE_MM as BEZIER_CHAIN_FIT_TOLERANCE_MM,
} from "@vibeshape/protocol"
import { type Edge, getOC } from "replicad"
import type { GeomAbs_Shape } from "replicad-opencascadejs"

type Point = [number, number, number]

const VERIFICATION_SAMPLES_PER_SEGMENT = 16

export type FittedBezierChain = Readonly<{
  /** `3 * segmentCount + 1` world-space poles; consecutive segments share their joint pole. */
  poles: Point[]
  /** Largest sampled distance between matching parameters of the edge and the chain. */
  maxDeviation: number
}>

type CurveSampler = Readonly<{
  /** Increasing parameters bounding pieces where the edge is at least C3. */
  breakpoints: readonly number[]
  point(parameter: number): Point
  derivative(parameter: number): Readonly<{ point: Point; tangent: Point }>
}>

function bernstein(poles: readonly Point[], offset: number, t: number): Point {
  const s = 1 - t
  const weights = [s * s * s, 3 * s * s * t, 3 * s * t * t, t * t * t] as const
  const point: Point = [0, 0, 0]
  for (const [index, weight] of weights.entries()) {
    const pole = poles[offset + index] as Point
    point[0] += pole[0] * weight
    point[1] += pole[1] * weight
    point[2] += pole[2] * weight
  }
  return point
}

/** Splits every smooth piece into `subdivisions` equal parameter spans. */
function chainParameters(breakpoints: readonly number[], subdivisions: number) {
  const parameters = [breakpoints[0] as number]
  for (let piece = 1; piece < breakpoints.length; piece += 1) {
    const from = breakpoints[piece - 1] as number
    const to = breakpoints[piece] as number
    for (let step = 1; step <= subdivisions; step += 1) {
      parameters.push(step === subdivisions ? to : from + ((to - from) * step) / subdivisions)
    }
  }
  return parameters
}

/**
 * Cubic Hermite interpolation: each segment matches the edge position and first derivative at both
 * ends, so joints are C1 in the edge parameter. Within a C3 piece the error falls with the fourth
 * power of the segment length; polynomial pieces of degree three or less are reproduced exactly.
 */
function hermiteChain(sampler: CurveSampler, parameters: readonly number[]): Point[] {
  const nodes = parameters.map((parameter) => sampler.derivative(parameter))
  const poles: Point[] = [nodes[0]?.point as Point]
  for (let index = 0; index + 1 < nodes.length; index += 1) {
    const start = nodes[index] as (typeof nodes)[number]
    const end = nodes[index + 1] as (typeof nodes)[number]
    const scale = ((parameters[index + 1] as number) - (parameters[index] as number)) / 3
    poles.push(
      start.point.map((value, axis) => value + (start.tangent[axis] as number) * scale) as Point,
      end.point.map((value, axis) => value - (end.tangent[axis] as number) * scale) as Point,
      end.point,
    )
  }
  return poles
}

function chainDeviation(
  sampler: CurveSampler,
  poles: readonly Point[],
  parameters: readonly number[],
) {
  let deviation = 0
  for (let segment = 0; segment + 1 < parameters.length; segment += 1) {
    const from = parameters[segment] as number
    const to = parameters[segment + 1] as number
    for (let sample = 1; sample < VERIFICATION_SAMPLES_PER_SEGMENT; sample += 1) {
      const t = sample / VERIFICATION_SAMPLES_PER_SEGMENT
      const expected = sampler.point(from + (to - from) * t)
      const actual = bernstein(poles, segment * 3, t)
      deviation = Math.max(
        deviation,
        Math.hypot(actual[0] - expected[0], actual[1] - expected[1], actual[2] - expected[2]),
      )
    }
  }
  return deviation
}

function validBreakpoints(breakpoints: readonly number[]) {
  return (
    breakpoints.length >= 2 &&
    breakpoints.length - 1 <= MAX_BEZIER_CHAIN_SEGMENTS &&
    breakpoints.every(Number.isFinite) &&
    breakpoints.every((value, index) => index === 0 || value > (breakpoints[index - 1] as number))
  )
}

/**
 * Fits the coarsest uniform refinement of the edge's smooth pieces whose dense verification samples
 * stay within `BEZIER_CHAIN_FIT_TOLERANCE_MM`, using at most `MAX_BEZIER_CHAIN_SEGMENTS` segments.
 */
function fitBezierChain(sampler: CurveSampler): FittedBezierChain | undefined {
  if (!validBreakpoints(sampler.breakpoints)) return undefined
  const pieces = sampler.breakpoints.length - 1
  for (
    let subdivisions = 1;
    pieces * subdivisions <= MAX_BEZIER_CHAIN_SEGMENTS;
    subdivisions *= 2
  ) {
    const parameters = chainParameters(sampler.breakpoints, subdivisions)
    const poles = hermiteChain(sampler, parameters)
    if (!poles.every((pole) => pole.every(Number.isFinite))) return undefined
    const maxDeviation = chainDeviation(sampler, poles, parameters)
    if (maxDeviation <= BEZIER_CHAIN_FIT_TOLERANCE_MM) return { poles, maxDeviation }
  }
  return undefined
}

function readPoint(point: { X(): number; Y(): number; Z(): number }): Point {
  return [point.X(), point.Y(), point.Z()]
}

function continuityBreakpoints(
  adaptor: InstanceType<ReturnType<typeof getOC>["BRepAdaptor_Curve_2"]>,
) {
  const oc = getOC()
  const continuity = oc.GeomAbs_Shape.GeomAbs_C3 as GeomAbs_Shape
  const count = adaptor.NbIntervals(continuity)
  if (!Number.isInteger(count) || count < 1 || count > MAX_BEZIER_CHAIN_SEGMENTS) return []
  const intervals = new oc.TColStd_Array1OfReal_2(1, count + 1)
  try {
    Reflect.apply(adaptor.Intervals, adaptor, [intervals, continuity])
    return Array.from({ length: count + 1 }, (_, index) => intervals.Value(index + 1))
  } finally {
    intervals.delete()
  }
}

/** Fits a non-analytical OCCT edge; the native edge stays the geometric authority. */
export function fitEdgeBezierChain(edge: Edge): FittedBezierChain | undefined {
  const oc = getOC()
  const adaptor = new oc.BRepAdaptor_Curve_2(edge.wrapped)
  const point = new oc.gp_Pnt_1()
  const vector = new oc.gp_Vec_1()
  try {
    return fitBezierChain({
      breakpoints: continuityBreakpoints(adaptor),
      point(parameter) {
        adaptor.D0(parameter, point)
        return readPoint(point)
      },
      derivative(parameter) {
        adaptor.D1(parameter, point, vector)
        return { point: readPoint(point), tangent: readPoint(vector) }
      },
    })
  } catch {
    return undefined
  } finally {
    vector.delete()
    point.delete()
    adaptor.delete()
  }
}
