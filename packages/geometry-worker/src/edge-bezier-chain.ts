import { type Edge, getOC } from "replicad"
import {
  bezierCurvePiece,
  type FittedBezierChain,
  fitRationalBezierChain,
  nurbsBezierPieces,
  type RationalBezierPiece,
  trimPieces,
} from "./rational-bezier-chain"

type Point = [number, number, number]
type OcctPoint = Readonly<{ X(): number; Y(): number; Z(): number; delete(): void }>
type OcctPoles = Readonly<{
  NbPoles(): number
  Pole(index: number): OcctPoint
  Weight(index: number): number
}>

function readPoint(point: OcctPoint): Point {
  try {
    return [point.X(), point.Y(), point.Z()]
  } finally {
    point.delete()
  }
}

function readPoles(curve: OcctPoles) {
  const count = curve.NbPoles()
  const indices = Array.from({ length: count }, (_, index) => index + 1)
  return {
    poles: indices.map((index) => readPoint(curve.Pole(index))),
    weights: indices.map((index) => curve.Weight(index)),
  }
}

type OcctBSpline = OcctPoles &
  Readonly<{
    Degree(): number
    IsPeriodic(): boolean
    SetNotPeriodic(): void
    NbKnots(): number
    Knot(index: number): number
    Multiplicity(index: number): number
  }>

function bsplinePieces(curve: OcctBSpline) {
  // The adaptor returns a transformed copy, so opening a periodic curve leaves the edge intact.
  if (curve.IsPeriodic()) curve.SetNotPeriodic()
  const knots = Array.from({ length: curve.NbKnots() }, (_, index) =>
    Array.from({ length: curve.Multiplicity(index + 1) }, () => curve.Knot(index + 1)),
  ).flat()
  return nurbsBezierPieces({ degree: curve.Degree(), knots, ...readPoles(curve) })
}

/**
 * Reads the exact rational Bezier pieces of a B-spline or Bezier edge in world coordinates.
 * Other non-analytical classes have no exact polynomial or rational form here and publish no chain.
 */
function edgeBezierPieces(edge: Edge): RationalBezierPiece[] | undefined {
  const oc = getOC()
  const adaptor = new oc.BRepAdaptor_Curve_2(edge.wrapped)
  try {
    const first = adaptor.FirstParameter()
    const last = adaptor.LastParameter()
    if (!Number.isFinite(first) || !Number.isFinite(last) || !(last > first)) return undefined
    if (edge.geomType === "BEZIER_CURVE") {
      const handle = adaptor.Bezier()
      try {
        const { poles, weights } = readPoles(handle.get())
        return [bezierCurvePiece(poles, weights, first, last)]
      } finally {
        handle.delete()
      }
    }
    if (edge.geomType !== "BSPLINE_CURVE") return undefined
    const handle = adaptor.BSpline()
    try {
      const pieces = bsplinePieces(handle.get() as unknown as OcctBSpline)
      return pieces ? trimPieces(pieces, first, last) : undefined
    } finally {
      handle.delete()
    }
  } finally {
    adaptor.delete()
  }
}

/** Fits a non-analytical OCCT edge; the native edge stays the geometric authority. */
export function fitEdgeBezierChain(edge: Edge): FittedBezierChain | undefined {
  try {
    const pieces = edgeBezierPieces(edge)
    return pieces ? fitRationalBezierChain(pieces) : undefined
  } catch {
    return undefined
  }
}
