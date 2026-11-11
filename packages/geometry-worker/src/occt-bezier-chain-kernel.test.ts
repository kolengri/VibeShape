import { beforeAll, describe, expect, it } from "bun:test"
import { extrusionProfileSegmentSchema, topologyCandidatesSchema } from "@vibeshape/protocol"
import {
  assembleWire,
  cast,
  type Edge,
  makeBSplineApproximation,
  makeFace,
  measureShapeVolumeProperties,
  type Shape3D,
  setOC,
} from "replicad"
import initializeOpenCascade, { type OpenCascadeInstance } from "replicad-opencascadejs"
import { fitEdgeBezierChain } from "./edge-bezier-chain"
import { inspectOcctBody } from "./occt-body-validation"
import { type AnalyticalProfile, createAnalyticalWire } from "./occt-loft"
import { captureReplicadTopologySnapshot } from "./topology-signatures"

type Point = [number, number, number]

let occt: OpenCascadeInstance
beforeAll(async () => {
  occt = await Reflect.apply(initializeOpenCascade, undefined, [
    {
      locateFile: () =>
        new URL("../node_modules/replicad-opencascadejs/src/replicad_single.wasm", import.meta.url)
          .pathname,
    },
  ])
  setOC(occt)
}, 60_000)

function wave(scale = 1, lift: (x: number) => number = () => 5): Point[] {
  return Array.from({ length: 9 }, (_, index) => {
    const x = index * 5
    return [x, scale * 6 * Math.sin(index * 0.9) + index, lift(x)]
  })
}

function bspline(points: readonly Point[]) {
  return makeBSplineApproximation([...points], { tolerance: 1e-5, degMin: 3, degMax: 5 })
}

function chainPoint(poles: readonly Point[], segment: number, t: number): Point {
  const s = 1 - t
  const weights = [s * s * s, 3 * s * s * t, 3 * s * t * t, t * t * t]
  return [0, 1, 2].map((axis) =>
    weights.reduce(
      (sum, weight, index) => sum + weight * ((poles[segment * 3 + index] as Point)[axis] ?? 0),
      0,
    ),
  ) as Point
}

const axes = [0, 1, 2] as const

function segmentPoles(poles: readonly Point[], segment: number) {
  return [0, 1, 2, 3].map((index) => poles[segment * 3 + index] as Point) as [
    Point,
    Point,
    Point,
    Point,
  ]
}

function segmentDerivatives(poles: readonly Point[], segment: number, t: number) {
  const [p0, p1, p2, p3] = segmentPoles(poles, segment)
  const s = 1 - t
  const first = axes.map(
    (axis) =>
      3 * s * s * (p1[axis] - p0[axis]) +
      6 * s * t * (p2[axis] - p1[axis]) +
      3 * t * t * (p3[axis] - p2[axis]),
  )
  const second = axes.map(
    (axis) =>
      6 * s * (p2[axis] - 2 * p1[axis] + p0[axis]) + 6 * t * (p3[axis] - 2 * p2[axis] + p1[axis]),
  )
  return { first, second }
}

/** Distance from a point to one segment by analytic Newton projection from a starting parameter. */
function projectToSegment(poles: readonly Point[], segment: number, start: number, point: Point) {
  let t = start
  for (let step = 0; step < 20; step += 1) {
    const at = chainPoint(poles, segment, t)
    const offset = at.map((value, axis) => value - (point[axis] ?? 0))
    const { first, second } = segmentDerivatives(poles, segment, t)
    const g = offset.reduce((sum, value, axis) => sum + value * (first[axis] ?? 0), 0)
    const dg =
      first.reduce((sum, value) => sum + value * value, 0) +
      offset.reduce((sum, value, axis) => sum + value * (second[axis] ?? 0), 0)
    if (!(dg > 0)) break
    t = Math.min(1, Math.max(0, t - g / dg))
  }
  const at = chainPoint(poles, segment, t)
  return Math.hypot(...at.map((value, axis) => value - (point[axis] ?? 0)))
}

/** Distance from a point to the chain, refined around the nearest coarse samples. */
function distanceToChain(poles: readonly Point[], point: Point) {
  const segments = (poles.length - 1) / 3
  const coarse: { distance: number; segment: number; t: number }[] = []
  for (let segment = 0; segment < segments; segment += 1) {
    for (let sample = 0; sample <= 32; sample += 1) {
      const candidate = chainPoint(poles, segment, sample / 32)
      const distance = Math.hypot(...candidate.map((value, axis) => value - (point[axis] ?? 0)))
      coarse.push({ distance, segment, t: sample / 32 })
    }
  }
  coarse.sort((left, right) => left.distance - right.distance)
  return Math.min(
    ...coarse.slice(0, 4).map(({ segment, t }) => projectToSegment(poles, segment, t, point)),
  )
}

/** Independent geometric comparison at 2,049 native samples, far denser than the fit check. */
function denseDeviation(edge: Edge, poles: readonly Point[]) {
  const adaptor = new occt.BRepAdaptor_Curve_2(edge.wrapped)
  try {
    const first = adaptor.FirstParameter()
    const last = adaptor.LastParameter()
    let deviation = 0
    for (let sample = 0; sample <= 2048; sample += 1) {
      const native = adaptor.Value(first + ((last - first) * sample) / 2048)
      try {
        deviation = Math.max(
          deviation,
          distanceToChain(poles, [native.X(), native.Y(), native.Z()]),
        )
      } finally {
        native.delete()
      }
    }
    return deviation
  } finally {
    adaptor.delete()
  }
}

function cross(a: Point, b: Point): Point {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
}

function norm(vector: Point) {
  return Math.hypot(vector[0], vector[1], vector[2])
}

/** Largest distance from the plane through the first pole spanned by the extreme poles. */
function planeSpread(poles: readonly Point[]) {
  const origin = poles[0] as Point
  const relative = poles.map((pole) => axes.map((axis) => pole[axis] - origin[axis]) as Point)
  const far = relative.reduce((best, pole) => (norm(pole) > norm(best) ? pole : best))
  const side = relative.reduce((best, pole) =>
    norm(cross(far, pole)) > norm(cross(far, best)) ? pole : best,
  )
  const normal = cross(far, side)
  const length = norm(normal)
  return Math.max(
    ...relative.map(
      (pole) => Math.abs(pole[0] * normal[0] + pole[1] * normal[1] + pole[2] * normal[2]) / length,
    ),
  )
}

function shapeVolume(shape: Shape3D) {
  const properties = measureShapeVolumeProperties(shape)
  try {
    return properties.volume
  } finally {
    properties.delete()
  }
}

function prism(face: ReturnType<typeof makeFace>, height: number) {
  const vector = new occt.gp_Vec_4(0, 0, height)
  try {
    const builder = new occt.BRepPrimAPI_MakePrism_1(face.wrapped, vector, false, true)
    try {
      return cast(builder.Shape()).asShape3D()
    } finally {
      builder.delete()
    }
  } finally {
    vector.delete()
  }
}

describe("fitted Bezier chains for non-analytical OCCT edges", () => {
  it("fits a planar B-spline edge within 1e-4 mm at dense independent samples", () => {
    const edge = bspline(wave())
    try {
      expect(edge.geomType).toBe("BSPLINE_CURVE")
      const chain = fitEdgeBezierChain(edge)
      if (!chain) throw new Error("A smooth planar B-spline must fit within the segment budget.")
      const segments = (chain.poles.length - 1) / 3
      expect(segments).toBeGreaterThan(1)
      expect(segments).toBeLessThanOrEqual(64)
      expect(chain.maxDeviation).toBeLessThanOrEqual(1e-4)
      expect(denseDeviation(edge, chain.poles)).toBeLessThanOrEqual(1e-4)
      // Hermite poles of an edge in z = 5 stay in that plane exactly.
      for (const pole of chain.poles) expect(pole[2]).toBeCloseTo(5, 9)
    } finally {
      edge.delete()
    }
  })

  it("publishes chains for solid spline edges and recomputes them after the source changes", () => {
    const captured = [1, 1.5].map((scale) => {
      const points = wave(scale, () => 0)
      const closing = makeBSplineApproximation(
        [points.at(-1) as Point, [40, -30, 0], [0, -30, 0], points[0] as Point],
        { tolerance: 1e-5, degMin: 3, degMax: 3 },
      )
      const edge = bspline(points)
      const wire = assembleWire([edge, closing])
      const face = makeFace(wire)
      const solid = prism(face, 10)
      try {
        expect(inspectOcctBody(occt, solid).valid).toBe(true)
        const snapshot = captureReplicadTopologySnapshot(solid)
        const candidates = topologyCandidatesSchema.parse(snapshot.candidates)
        const chains = candidates.flatMap((candidate) =>
          candidate.referenceGeometry?.kind === "bezier-chain-edge" ? [candidate] : [],
        )
        // Two spline sides on the bottom and top faces each; the seams are straight lines.
        expect(chains).toHaveLength(4)
        for (const candidate of chains) {
          if (candidate.referenceGeometry?.kind !== "bezier-chain-edge") continue
          expect(candidate.signature.geometryClass).toBe("BSPLINE_CURVE")
          const heights = candidate.referenceGeometry.poles.map((pole) => pole[2])
          expect(Math.max(...heights) - Math.min(...heights)).toBeLessThan(1e-9)
        }
        // The wave edge on the top face; the closing spline dips to y = -30.
        const top = chains.find(
          (candidate) =>
            candidate.referenceGeometry?.kind === "bezier-chain-edge" &&
            candidate.referenceGeometry.poles[0]?.[2] === 10 &&
            candidate.referenceGeometry.poles.every((pole) => pole[1] > -10),
        )
        return top?.referenceGeometry?.kind === "bezier-chain-edge"
          ? top.referenceGeometry.poles
          : null
      } finally {
        solid.delete()
        face.delete()
        wire.delete()
        edge.delete()
        closing.delete()
      }
    })
    const [before, after] = captured
    if (!before || !after) throw new Error("Both rebuilds must publish the long top spline edge.")
    const peak = (poles: readonly Point[]) => Math.max(...poles.map((pole) => Math.abs(pole[1])))
    // The wave peak rises from about 12.7 to about 15.1 with the larger amplitude.
    expect(peak(after) - peak(before)).toBeGreaterThan(2)
  })

  it("keeps non-planar evidence so sketch projection can fail closed", () => {
    const edge = bspline(wave(1, (x) => 0.01 * x * x))
    try {
      const chain = fitEdgeBezierChain(edge)
      if (!chain) throw new Error("A smooth spatial B-spline must still fit.")
      expect(denseDeviation(edge, chain.poles)).toBeLessThanOrEqual(1e-4)
      expect(planeSpread(chain.poles)).toBeGreaterThan(1e-3)
    } finally {
      edge.delete()
    }
  })

  it("extrudes a closed interpolating spline profile to its exact Green-integral volume", () => {
    const id = (n: number) => `01900000-0000-7000-8000-${n.toString(16).padStart(12, "0")}`
    // Closed interpolating spline through (10, 0), (0, 10), (-10, 0), (0, -10): every through-point
    // tangent bisects its chords, and every handle is one third of the chord length.
    const handle = (10 * Math.SQRT2) / 3
    const through: [number, number][] = [
      [10, 0],
      [0, 10],
      [-10, 0],
      [0, -10],
    ]
    const tangents: [number, number][] = [
      [0, 1],
      [-1, 0],
      [0, -1],
      [1, 0],
    ]
    const segments = through.map((start, index) => {
      const next = (index + 1) % through.length
      const end = through[next] as [number, number]
      const startTangent = tangents[index] as [number, number]
      const endTangent = tangents[next] as [number, number]
      return {
        start,
        control1: [start[0] + startTangent[0] * handle, start[1] + startTangent[1] * handle],
        control2: [end[0] - endTangent[0] * handle, end[1] - endTangent[1] * handle],
        end,
        ids: [id(index * 3 + 1), id(index * 3 + 2), id(index * 3 + 3), id(next * 3 + 1)],
        entityId: id(100 + index),
      }
    })
    // Four-point Gauss-Legendre quadrature integrates the degree-5 Green integrand exactly.
    const nodes = [
      [-0.8611363115940526, 0.3478548451374538],
      [-0.3399810435848563, 0.6521451548625461],
      [0.3399810435848563, 0.6521451548625461],
      [0.8611363115940526, 0.3478548451374538],
    ] as const
    const area = segments.reduce((sum, segment) => {
      const poles = [segment.start, segment.control1, segment.control2, segment.end] as const
      return (
        sum +
        nodes.reduce((segmentSum, [node, weight]) => {
          const t = (node + 1) / 2
          const s = 1 - t
          const basis = [s * s * s, 3 * s * s * t, 3 * s * t * t, t * t * t]
          const derivative = [-3 * s * s, 3 * s * s - 6 * s * t, 6 * s * t - 3 * t * t, 3 * t * t]
          const at = (weights: number[], axis: 0 | 1) =>
            weights.reduce((total, w, index) => total + w * (poles[index]?.[axis] ?? 0), 0)
          const integrand = at(basis, 0) * at(derivative, 1) - at(basis, 1) * at(derivative, 0)
          return segmentSum + (weight / 2) * (integrand / 2)
        }, 0)
      )
    }, 0)
    const profile = segments.map((segment) =>
      extrusionProfileSegmentSchema.parse({
        entityId: segment.entityId,
        type: "cubic-bezier",
        startPointId: segment.ids[0],
        control1PointId: segment.ids[1],
        control2PointId: segment.ids[2],
        endPointId: segment.ids[3],
        start: segment.start,
        control1: segment.control1,
        control2: segment.control2,
        end: segment.end,
      }),
    )
    const frame: AnalyticalProfile["frame"] = {
      origin: [0, 0, 0],
      xAxis: [1, 0, 0],
      yAxis: [0, 1, 0],
      normal: [0, 0, 1],
    }
    const wire = createAnalyticalWire(occt, frame, profile)
    const face = makeFace(wire)
    const solid = prism(face, 7)
    try {
      expect(inspectOcctBody(occt, solid).valid).toBe(true)
      // The rounded diamond lies between its through-point square (200) and the circle (314).
      expect(area).toBeGreaterThan(200)
      expect(area).toBeLessThan(Math.PI * 100)
      expect(shapeVolume(solid)).toBeCloseTo(area * 7, 6)
    } finally {
      solid.delete()
      face.delete()
      wire.delete()
    }
  })
})
