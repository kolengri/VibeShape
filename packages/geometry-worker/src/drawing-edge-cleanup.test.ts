import { describe, expect, it } from "bun:test"
import { type DrawingCurve, type DrawingEdge, MAX_DRAWING_CURVE_POINTS } from "@vibeshape/protocol"
import { splitPolyline, straightenPolyline, suppressCoincidentEdges } from "./drawing-edge-cleanup"

type Point = [number, number]
const line = (start: Point, end: Point): DrawingCurve => ({ kind: "line", start, end })
const edge = (visibility: DrawingEdge["visibility"], curve: DrawingCurve): DrawingEdge => ({
  visibility,
  edgeClass: "sharp",
  curve,
})
const hiddenOf = (edges: readonly DrawingEdge[]) =>
  edges.filter(({ visibility }) => visibility === "hidden").map(({ curve }) => curve)

function roundedLine(curve: DrawingCurve) {
  if (curve.kind !== "line") throw new Error(`Expected a line, got ${curve.kind}.`)
  const round = (value: number) => Math.round(value * 1e6) / 1e6 + 0
  return [round(curve.start[0]), round(curve.start[1]), round(curve.end[0]), round(curve.end[1])]
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

  it("keeps polylines unless an identical polyline covers them", () => {
    const points: Point[] = [
      [0, 0],
      [1, 1],
      [2, 0],
    ]
    const result = suppressCoincidentEdges([
      edge("visible", { kind: "polyline", points }),
      edge("visible", line([0, 0], [1, 1])),
      edge("hidden", { kind: "polyline", points: [...points].reverse() }),
      edge("hidden", {
        kind: "polyline",
        points: [
          [0, 0],
          [1, 1],
          [3, 0],
        ],
      }),
    ])
    expect(hiddenOf(result)).toEqual([
      {
        kind: "polyline",
        points: [
          [0, 0],
          [1, 1],
          [3, 0],
        ],
      },
    ])
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
})
