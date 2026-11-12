import { describe, expect, it } from "bun:test"
import {
  type DrawingCurve,
  type DrawingEdge,
  MAX_DRAWING_CURVE_POINTS,
  MAX_DRAWING_VIEW_EDGES,
} from "@vibeshape/protocol"
import { DrawingBudgetError } from "./drawing-budget"
import { splitPolyline, straightenPolyline, suppressCoincidentEdges } from "./drawing-edge-cleanup"

type Point = [number, number]
const line = (start: Point, end: Point): DrawingCurve => ({ kind: "line", start, end })
const edge = (visibility: DrawingEdge["visibility"], curve: DrawingCurve): DrawingEdge => ({
  visibility,
  edgeClass: "sharp",
  curve,
})
/** Samples of the ellipse x = 60 cos t, y = 25 sin t over a fraction of a quarter turn. */
function ellipsePoint(angle: number, offset = 0): Point {
  return [(60 + offset) * Math.cos(angle), (25 + offset) * Math.sin(angle)]
}
function quarterEllipse(count: number, from = 0, to = 1, offset = 0): Point[] {
  return Array.from({ length: count }, (_, index) =>
    ellipsePoint(((from + ((to - from) * index) / (count - 1)) * Math.PI) / 2, offset),
  )
}
function polylineLength(points: readonly Point[]) {
  return points.slice(1).reduce((sum, point, index) => {
    const previous = points[index] ?? point
    return sum + Math.hypot(point[0] - previous[0], point[1] - previous[1])
  }, 0)
}
function curveLength(curve: DrawingCurve) {
  if (curve.kind === "line") return polylineLength([curve.start, curve.end])
  if (curve.kind === "polyline") return polylineLength(curve.points)
  throw new Error(`Unexpected ${curve.kind}.`)
}
const hiddenOf = (edges: readonly DrawingEdge[]) =>
  edges.filter(({ visibility }) => visibility === "hidden").map(({ curve }) => curve)

function roundedLine(curve: DrawingCurve) {
  if (curve.kind !== "line") throw new Error(`Expected a line, got ${curve.kind}.`)
  const round = (value: number) => Math.round(value * 1e6) / 1e6 + 0
  return [round(curve.start[0]), round(curve.start[1]), round(curve.end[0]), round(curve.end[1])]
}

const coverageStats = () => ({ chordBuilds: 0, scannedEntries: 0, candidates: 0 })

/** A 200 mm wavy edge sampled into 2,600 segments, so its pieces arrive in x order. */
function stripCurves(): DrawingCurve[] {
  const points = Array.from({ length: 2601 }, (_, index): Point => {
    const x = (index / 2600) * 200
    return [x, 10 + 5 * Math.sin(x / 7)]
  })
  return [{ kind: "polyline", points }]
}

/** A 300 × 60 mm plate with 25 × 5 sampled hole outlines, row by row from the bottom left. */
function plateHoles(): DrawingCurve[] {
  return Array.from({ length: 125 }, (_, index): DrawingCurve => {
    const [cx, cy] = [6 + (index % 25) * 12, 6 + Math.floor(index / 25) * 12]
    const points = Array.from({ length: 33 }, (_, step): Point => {
      const angle = (step / 32) * 2 * Math.PI
      return [cx + 4 * Math.cos(angle), cy + 3 * Math.sin(angle)]
    })
    return { kind: "polyline", points }
  })
}

describe("hidden edge coverage", () => {
  it("keeps the gaps between sparse visible segments sampled at the old probe points", () => {
    const visible = [
      [0, 1],
      [24, 26],
      [49, 51],
      [74, 76],
      [99, 100],
    ].map(([from = 0, to = 0]) => edge("visible", line([from, 0], [to, 0])))
    const result = suppressCoincidentEdges([...visible, edge("hidden", line([0, 0], [100, 0]))])
    expect(hiddenOf(result).map(roundedLine)).toEqual([
      [1, 0, 24, 0],
      [26, 0, 49, 0],
      [51, 0, 74, 0],
      [76, 0, 99, 0],
    ])
  })

  it("keeps the hidden slot floor behind a rib between two visible step edges", () => {
    const result = suppressCoincidentEdges([
      edge("visible", line([0, 20], [55, 20])),
      edge("visible", line([70, 20], [100, 20])),
      edge("hidden", line([0, 20], [100, 20])),
    ])
    expect(hiddenOf(result).map(roundedLine)).toEqual([[55, 20, 70, 20]])
  })

  it("drops fully covered and repeated hidden lines regardless of direction", () => {
    const result = suppressCoincidentEdges([
      edge("visible", line([0, 0], [60, 0])),
      edge("visible", line([60, 0], [40, 0])),
      edge("visible", line([100, 0], [55, 0])),
      edge("hidden", line([100, 0], [0, 0])),
      edge("hidden", line([0, 5], [10, 5])),
      edge("hidden", line([10, 5], [0, 5])),
      edge("hidden", line([5, 5], [20, 5])),
    ])
    expect(hiddenOf(result).map(roundedLine)).toEqual([
      [0, 5, 10, 5],
      [10, 5, 20, 5],
    ])
  })

  it("does not treat parallel or merely touching lines as coverage", () => {
    const result = suppressCoincidentEdges([
      edge("visible", line([0, 0.001], [10, 0.001])),
      edge("visible", line([10, 0], [20, 0])),
      edge("hidden", line([0, 0], [10, 0])),
    ])
    expect(hiddenOf(result).map(roundedLine)).toEqual([[0, 0, 10, 0]])
  })

  it("merges duplicate visible lines into their uncovered pieces", () => {
    const result = suppressCoincidentEdges([
      edge("visible", line([0, 0], [10, 0])),
      edge("visible", line([5, 0], [15, 0])),
      edge("visible", line([0, 0], [10, 0])),
    ])
    expect(result.map(({ curve }) => roundedLine(curve))).toEqual([
      [0, 0, 10, 0],
      [10, 0, 15, 0],
    ])
  })

  it("subtracts concentric visible arcs from hidden circles and arcs", () => {
    const center: Point = [5, 5]
    const result = suppressCoincidentEdges([
      edge("visible", { kind: "arc", center, radius: 3, startAngle: 0, endAngle: Math.PI }),
      edge("hidden", { kind: "circle", center, radius: 3 }),
      edge("hidden", { kind: "circle", center, radius: 2 }),
      edge("hidden", {
        kind: "arc",
        center,
        radius: 3,
        startAngle: Math.PI / 2,
        endAngle: (3 * Math.PI) / 2,
      }),
    ])
    const hidden = hiddenOf(result)
    expect(hidden).toHaveLength(2)
    expect(hidden[0]).toMatchObject({ kind: "arc", radius: 3 })
    if (hidden[0]?.kind !== "arc") throw new Error("Expected the uncovered half of the circle.")
    expect(hidden[0].startAngle).toBeCloseTo(Math.PI, 12)
    expect(hidden[0].endAngle).toBeCloseTo(2 * Math.PI, 12)
    expect(hidden[1]).toEqual({ kind: "circle", center, radius: 2 })
  })

  it("rejoins an uncovered circle piece that wraps through angle zero", () => {
    const center: Point = [0, 0]
    const result = suppressCoincidentEdges([
      edge("visible", { kind: "arc", center, radius: 1, startAngle: 1, endAngle: 2 }),
      edge("hidden", { kind: "circle", center, radius: 1 }),
    ])
    const [arc] = hiddenOf(result)
    if (arc?.kind !== "arc") throw new Error("Expected one wrapped arc.")
    expect(arc.startAngle).toBeCloseTo(2, 12)
    expect(arc.endAngle).toBeCloseTo(1 + 2 * Math.PI, 12)
  })

  it("drops a hidden circle behind a visible full circle and a covered arc", () => {
    const center: Point = [1, 1]
    const result = suppressCoincidentEdges([
      edge("visible", { kind: "circle", center, radius: 4 }),
      edge("hidden", { kind: "circle", center, radius: 4 }),
      edge("hidden", { kind: "arc", center, radius: 4, startAngle: -3, endAngle: 3 }),
    ])
    expect(hiddenOf(result)).toEqual([])
  })

  it("drops a differently sampled hidden twin of a visible free-form curve", () => {
    const visible = quarterEllipse(154)
    const stub = quarterEllipse(40, 0, 0.3)
    const result = suppressCoincidentEdges([
      edge("visible", { kind: "polyline", points: visible }),
      edge("visible", { kind: "polyline", points: stub }),
      edge("hidden", { kind: "polyline", points: quarterEllipse(114) }),
      edge("hidden", { kind: "polyline", points: quarterEllipse(66).reverse() }),
    ])
    expect(hiddenOf(result)).toEqual([])
    expect(result.filter(({ visibility }) => visibility === "visible")).toHaveLength(1)
  })

  it("keeps the uncovered run of a partly hidden free-form curve and offset curves", () => {
    const result = suppressCoincidentEdges([
      edge("visible", { kind: "polyline", points: quarterEllipse(90, 0, 0.5) }),
      edge("hidden", { kind: "polyline", points: quarterEllipse(120) }),
      edge("hidden", { kind: "polyline", points: quarterEllipse(60, 0, 0.5, 0.1) }),
    ])
    const hidden = hiddenOf(result)
    expect(hidden).toHaveLength(2)
    const [tail, offset] = hidden
    if (tail?.kind !== "polyline" || offset?.kind !== "polyline")
      throw new Error("Expected the uncovered tail and the offset curve as polylines.")
    const joint = ellipsePoint(Math.PI / 4)
    const first = tail.points[0] ?? [Number.NaN, Number.NaN]
    expect(Math.hypot(first[0] - joint[0], first[1] - joint[1])).toBeLessThan(0.5)
    expect(tail.points.at(-1)).toEqual(ellipsePoint(Math.PI / 2))
    expect(offset.points).toHaveLength(60)
  })

  it("keeps a hidden polyline whose sample points touch only short visible stubs", () => {
    const hidden: Point[] = [
      [0, 0],
      [100, 1],
      [200, 0],
    ]
    const stubs = [
      [0, 0],
      [50, 0.5],
      [100, 1],
      [150, 0.5],
      [200, 0],
    ].map(([x = 0, y = 0]) => edge("visible", line([x - 0.1, y], [x + 0.1, y])))
    const result = suppressCoincidentEdges([
      ...stubs,
      edge("hidden", { kind: "polyline", points: hidden }),
    ])
    const total = polylineLength(hidden)
    const remaining = hiddenOf(result).reduce((sum, curve) => sum + curveLength(curve), 0)
    // Each stub removes its 0.2 mm plus at most the capsule radius at either end.
    expect(remaining).toBeGreaterThan(total - 5 * (0.2 + 2 * 0.0201) - 1e-6)
    expect(remaining).toBeLessThan(total - 5 * 0.2 + 0.25)
    expect(hiddenOf(result).length).toBeGreaterThanOrEqual(4)
  })

  it("does not cut a hidden polyline where visible edges merely cross it", () => {
    const hidden: Point[] = [
      [0, 0],
      [10, 1],
      [20, 0],
    ]
    const crossings = [
      [0, 0],
      [5, 0.5],
      [10, 1],
      [15, 0.5],
      [20, 0],
    ].map(([x = 0, y = 0]) => edge("visible", line([x, y - 5], [x, y + 5])))
    const result = suppressCoincidentEdges([
      ...crossings,
      edge("hidden", { kind: "polyline", points: hidden }),
    ])
    const remaining = hiddenOf(result).reduce((sum, curve) => sum + curveLength(curve), 0)
    expect(remaining).toBeGreaterThan(polylineLength(hidden) - 0.0201 * 2 * 5)
  })

  it("classifies a covered stretch by angle: a 10° crossing stays, a 0.5° run is cut", () => {
    const hidden: Point[] = [
      [0, 0],
      [10, 0.001],
      [20, 0],
    ]
    const crossing = (degrees: number, reach: number) => {
      const angle = (degrees * Math.PI) / 180
      const [dx, dy] = [Math.cos(angle) * reach, Math.sin(angle) * reach]
      return edge("visible", line([5 - dx, -dy], [5 + dx, dy]))
    }
    const total = polylineLength(hidden)
    // A 10° crossing overlaps the tolerance capsule for 0.23 mm, yet nothing follows the curve.
    const steep = suppressCoincidentEdges([
      crossing(10, 5),
      edge("hidden", { kind: "polyline", points: hidden }),
    ])
    expect(hiddenOf(steep)).toHaveLength(1)
    expect(curveLength(hiddenOf(steep)[0] ?? line([0, 0], [0, 0]))).toBeCloseTo(total, 9)
    // At 0.5° the visible line stays within tolerance for about 4.6 mm and hides that stretch.
    const shallow = suppressCoincidentEdges([
      crossing(0.5, 5),
      edge("hidden", { kind: "polyline", points: hidden }),
    ])
    const remaining = hiddenOf(shallow).reduce((sum, curve) => sum + curveLength(curve), 0)
    expect(hiddenOf(shallow)).toHaveLength(2)
    expect(total - remaining).toBeGreaterThan(4.4)
    expect(total - remaining).toBeLessThan(4.8)
  })

  it("chords only the rings a hidden curve reaches and only the chords facing it", () => {
    let seed = 3
    const random = () => {
      seed = (seed * 16807) % 2147483647
      return seed / 2147483647
    }
    const rings = Array.from({ length: 10 }, (_, index) =>
      edge("visible", { kind: "circle", center: [150, 150], radius: 150 - index * 5 }),
    )
    const hidden = Array.from({ length: 2000 }, () => {
      const [x, y, angle] = [60 + random() * 180, 60 + random() * 180, random() * 2 * Math.PI]
      const points = Array.from({ length: 20 }, (_, index): Point => {
        const along = (index / 19) * 10
        const across = 2 * Math.sin((along / 10) * 2 * Math.PI)
        return [
          x + along * Math.cos(angle) - across * Math.sin(angle),
          y + along * Math.sin(angle) + across * Math.cos(angle),
        ]
      })
      return edge("hidden", { kind: "polyline", points })
    })
    const stats = coverageStats()
    const result = suppressCoincidentEdges([...rings, ...hidden], stats)
    expect(hiddenOf(result).length).toBeGreaterThanOrEqual(hidden.length)
    // One shared chord cache: a ring is chorded once, however many indexes hold it.
    expect(stats.chordBuilds).toBeLessThanOrEqual(rings.length)
    const segments = hidden.length * 19
    expect(stats.scannedEntries).toBeLessThan(segments * 32)
    // A whole ring's chords per nearby segment would hand hundreds of pieces to clipping.
    expect(stats.candidates).toBeLessThan(segments * 4)
  })

  it.each([
    ["a long sampled edge inserted left to right", stripCurves()],
    ["a plate of sampled holes inserted row by row", plateHoles()],
  ])("keeps index work near-linear for %s", (_, visible) => {
    const hidden = visible.map((curve) => edge("hidden", curve))
    const segments = visible.reduce(
      (sum, curve) => sum + (curve.kind === "polyline" ? curve.points.length - 1 : 1),
      0,
    )
    const stats = coverageStats()
    const result = suppressCoincidentEdges(
      [...visible.map((curve) => edge("visible", curve)), ...hidden],
      stats,
    )
    expect(hiddenOf(result)).toEqual([])
    // Every hidden segment scanning one unsplit leaf of all segments would be quadratic.
    expect(stats.scannedEntries).toBeLessThan(segments * 2 * 48)
    expect(stats.candidates).toBeLessThan(segments * 2 * 8)
  })

  it("never chords circles in a view without sampled curves", () => {
    const holes = Array.from({ length: 400 }, (_, index): DrawingCurve => {
      const center: Point = [5 + (index % 20) * 6, 5 + Math.floor(index / 20) * 6]
      return { kind: "circle", center, radius: 2.5 }
    })
    const stats = coverageStats()
    const result = suppressCoincidentEdges(
      [
        ...holes.map((curve) => edge("visible", curve)),
        ...holes.map((curve) => edge("hidden", curve)),
        edge("hidden", line([0, 3], [130, 3])),
      ],
      stats,
    )
    expect(hiddenOf(result)).toHaveLength(1)
    expect(stats.chordBuilds).toBe(0)
  })

  it("removes the hidden sampled twin of a sub-millimetre visible circle", () => {
    // HLR samples within the 0.05 rad angular tolerance. Circle chords must turn as little, or the
    // chord directions near their ends differ by more than the crossing angle from the samples.
    const radius = 0.1
    const count = Math.ceil((2 * Math.PI) / 0.05)
    const samples = Array.from({ length: count + 1 }, (_, index): Point => {
      const angle = (index / count) * 2 * Math.PI
      return [radius * Math.cos(angle), radius * Math.sin(angle)]
    })
    const result = suppressCoincidentEdges([
      edge("visible", { kind: "circle", center: [0, 0], radius }),
      edge("hidden", { kind: "polyline", points: samples }),
    ])
    expect(hiddenOf(result)).toEqual([])
  })

  it("removes a hidden polyline that a coarser visible sampling follows continuously", () => {
    const result = suppressCoincidentEdges([
      edge("visible", { kind: "polyline", points: quarterEllipse(60) }),
      edge("hidden", { kind: "polyline", points: quarterEllipse(200) }),
    ])
    expect(hiddenOf(result)).toEqual([])
  })

  it("removes a hidden polyline that follows a visible exact arc", () => {
    const samples = Array.from({ length: 90 }, (_, index): Point => {
      const angle = (index / 89) * Math.PI
      return [30 * Math.cos(angle), 30 * Math.sin(angle)]
    })
    const result = suppressCoincidentEdges([
      edge("visible", {
        kind: "arc",
        center: [0, 0],
        radius: 30,
        startAngle: 0,
        endAngle: Math.PI,
      }),
      edge("hidden", { kind: "polyline", points: samples }),
    ])
    expect(hiddenOf(result)).toEqual([])
  })

  it("covers a short tilted segment lying on a long visible line", () => {
    const result = suppressCoincidentEdges([
      edge("visible", line([0, 0], [1000, 0])),
      edge("hidden", line([500, 0], [500.01, 2e-8])),
    ])
    expect(hiddenOf(result)).toEqual([])
  })

  it("straightens collinear samples and keeps genuine curves", () => {
    expect(
      straightenPolyline([
        [0, 0],
        [1, 0],
        [2, 0],
      ]),
    ).toEqual({ kind: "line", start: [0, 0], end: [2, 0] })
    expect(
      straightenPolyline([
        [0, 0],
        [1, 1],
        [2, 0],
      ])?.kind,
    ).toBe("polyline")
  })

  it("splits long sampled curves into chained polylines without dropping samples", () => {
    const count = 2 * MAX_DRAWING_CURVE_POINTS + 10
    const points = Array.from({ length: count }, (_, index): Point => {
      const angle = (index / (count - 1)) * Math.PI
      return [Math.cos(angle), Math.sin(angle)]
    })
    const pieces = splitPolyline(points)
    expect(pieces).toHaveLength(3)
    const chained = pieces.flatMap((piece, index) => {
      if (piece.kind !== "polyline") throw new Error("Expected polylines.")
      expect(piece.points.length).toBeLessThanOrEqual(MAX_DRAWING_CURVE_POINTS)
      return index === 0 ? piece.points : piece.points.slice(1)
    })
    expect(chained).toEqual(points)
  })

  it("rejects a view whose cleanup splits edges beyond the view budget", () => {
    // 25,000 hidden lines, each interrupted by a visible stub: 50,000 raw edges become 75,000.
    const edges = Array.from({ length: 25_000 }, (_, index) => {
      const y = index * 0.5
      return [edge("visible", line([4, y], [6, y])), edge("hidden", line([0, y], [10, y]))]
    }).flat()
    expect(edges).toHaveLength(MAX_DRAWING_VIEW_EDGES)
    expect(() => suppressCoincidentEdges(edges)).toThrow(DrawingBudgetError)
  }, 60_000)
})
