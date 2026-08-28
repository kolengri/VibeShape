import { describe, expect, it } from "vitest"
import type { SketchEntityId } from "./identifiers"
import { createSketchInferenceCandidateQuery, inferSketchPoint } from "./sketch-inference"

const firstPointId = "018f0000-0000-7000-9000-000000000001" as SketchEntityId
const secondPointId = "018f0000-0000-7000-9000-000000000002" as SketchEntityId
const thirdPointId = "018f0000-0000-7000-9000-000000000003" as SketchEntityId
const fourthPointId = "018f0000-0000-7000-9000-000000000004" as SketchEntityId
const firstLineId = "018f0000-0000-7000-9000-000000000011" as SketchEntityId
const secondLineId = "018f0000-0000-7000-9000-000000000012" as SketchEntityId
const arcId = "018f0000-0000-7000-9000-000000000021" as SketchEntityId

const horizontalLine = {
  id: firstLineId,
  startPointId: firstPointId,
  endPointId: secondPointId,
  start: { x: 0, y: 0 },
  end: { x: 10, y: 0 },
} as const

describe("sketch inference", () => {
  it("snaps to the nearest authored point with stable identity tie-breaking", () => {
    const inference = inferSketchPoint({
      point: { x: 0, y: 0 },
      points: [
        { id: secondPointId, x: 1, y: 0 },
        { id: firstPointId, x: -1, y: 0 },
      ],
      tolerance: 2,
    })

    expect(inference).toEqual({
      direction: null,
      kind: "coincident",
      point: { x: -1, y: 0 },
      relations: [],
      target: { kind: "existing", pointId: firstPointId },
    })
  })

  it("creates a coincident relation instead of reusing a read-only reference point", () => {
    expect(
      inferSketchPoint({
        point: { x: 10.25, y: 20.25 },
        points: [{ id: firstPointId, reusable: false, x: 10, y: 20 }],
        tolerance: 1,
      }),
    ).toEqual({
      direction: null,
      kind: "coincident",
      point: { x: 10, y: 20 },
      relations: [{ type: "coincident", pointId: firstPointId }],
      target: { kind: "new", point: { x: 10, y: 20 } },
    })
  })

  it("infers the closest horizontal or vertical axis from an anchor", () => {
    expect(
      inferSketchPoint({
        anchor: { x: 10, y: 20 },
        point: { x: 40, y: 20.5 },
        points: [],
        tolerance: 1,
      }),
    ).toEqual({
      direction: { type: "horizontal" },
      kind: "none",
      point: { x: 40, y: 20 },
      relations: [],
      target: { kind: "new", point: { x: 40, y: 20 } },
    })
    expect(
      inferSketchPoint({
        anchor: { x: 10, y: 20 },
        point: { x: 10.25, y: 50 },
        points: [],
        tolerance: 1,
      }).direction,
    ).toEqual({ type: "vertical" })
  })

  it("prefers a point snap and rejects invalid tolerances", () => {
    const inference = inferSketchPoint({
      anchor: { x: 0, y: 0 },
      point: { x: 10, y: 0.2 },
      points: [{ id: firstPointId, x: 10, y: 0.5 }],
      tolerance: 1,
    })

    expect(inference.direction).toBeNull()
    expect(inference.kind).toBe("coincident")
    expect(inference.target).toEqual({ kind: "existing", pointId: firstPointId })
    expect(() =>
      inferSketchPoint({ point: { x: 0, y: 0 }, points: [], tolerance: Number.NaN }),
    ).toThrow("finite non-negative")
    expect(() =>
      createSketchInferenceCandidateQuery({ cellSize: 1, lines: [], points: [] })(
        { x: 0, y: 0 },
        Number.NaN,
      ),
    ).toThrow("finite non-negative")
  })

  it("infers persistent horizontal and vertical alignment to authored points", () => {
    expect(
      inferSketchPoint({
        point: { x: 20, y: 10.4 },
        points: [{ id: firstPointId, x: 5, y: 10 }],
        tolerance: 1,
      }),
    ).toEqual({
      alignmentGuide: { x: 5, y: 10 },
      direction: null,
      kind: "horizontal-alignment",
      point: { x: 20, y: 10 },
      relations: [{ type: "horizontal-points", pointId: firstPointId }],
      target: { kind: "new", point: { x: 20, y: 10 } },
    })
    expect(
      inferSketchPoint({
        point: { x: 5.25, y: 30 },
        points: [{ id: firstPointId, x: 5, y: 10 }],
        tolerance: 1,
      }),
    ).toMatchObject({
      kind: "vertical-alignment",
      point: { x: 5, y: 30 },
      relations: [{ type: "vertical-points", pointId: firstPointId }],
    })
  })

  it("prefers the closest alignment source along a shared guide", () => {
    expect(
      inferSketchPoint({
        point: { x: 20, y: 10.2 },
        points: [
          { id: firstPointId, x: -100, y: 10 },
          { id: secondPointId, x: 15, y: 10 },
        ],
        tolerance: 1,
      }).relations,
    ).toEqual([{ type: "horizontal-points", pointId: secondPointId }])
  })

  it("keeps direct point and curve relations ahead of point alignment", () => {
    expect(
      inferSketchPoint({
        point: { x: 10.25, y: 0.25 },
        points: [{ id: firstPointId, x: 10, y: 0 }],
        tolerance: 1,
      }).kind,
    ).toBe("coincident")
    expect(
      inferSketchPoint({
        curves: [{ id: arcId, type: "circle", center: { x: 0, y: 0 }, radius: 10 }],
        point: { x: 10.25, y: 0.25 },
        points: [{ id: firstPointId, x: 0, y: 0 }],
        tolerance: 1,
      }).kind,
    ).toBe("point-on-curve")
  })

  it("does not turn the active line anchor into a point-pair alignment relation", () => {
    expect(
      inferSketchPoint({
        anchor: { x: 10, y: 20 },
        point: { x: 40, y: 20.5 },
        points: [{ id: firstPointId, x: 10, y: 20 }],
        tolerance: 1,
      }),
    ).toMatchObject({
      direction: { type: "horizontal" },
      kind: "none",
      relations: [],
    })
  })

  it("infers persistent midpoint and point-on-line relations", () => {
    expect(
      inferSketchPoint({
        lines: [horizontalLine],
        point: { x: 5, y: 0.4 },
        points: [],
        tolerance: 1,
      }),
    ).toMatchObject({
      kind: "midpoint",
      point: { x: 5, y: 0 },
      relations: [{ type: "midpoint", lineId: firstLineId }],
    })
    expect(
      inferSketchPoint({
        lines: [horizontalLine],
        point: { x: 2, y: 0.4 },
        points: [],
        tolerance: 1,
      }),
    ).toMatchObject({
      kind: "point-on-line",
      point: { x: 2, y: 0 },
      relations: [{ type: "point-on-line", lineId: firstLineId }],
    })
  })

  it("infers exact point-on-curve relations for circles and bounded arcs", () => {
    expect(
      inferSketchPoint({
        curves: [{ id: arcId, type: "circle", center: { x: 0, y: 0 }, radius: 10 }],
        point: { x: 10.4, y: 0 },
        points: [],
        tolerance: 1,
      }),
    ).toMatchObject({
      kind: "point-on-curve",
      point: { x: 10, y: 0 },
      relations: [{ type: "point-on-curve", curveId: arcId }],
    })

    const arc = {
      id: arcId,
      type: "arc" as const,
      center: { x: 0, y: 0 },
      start: { x: 10, y: 0 },
      end: { x: 0, y: 10 },
    }
    const onArc = inferSketchPoint({
      curves: [arc],
      point: { x: 7.4, y: 7.4 },
      points: [],
      tolerance: 1,
    })
    expect(onArc.kind).toBe("point-on-curve")
    expect(onArc.point.x).toBeCloseTo(Math.SQRT1_2 * 10)
    expect(onArc.point.y).toBeCloseTo(Math.SQRT1_2 * 10)
    expect(
      inferSketchPoint({
        curves: [arc],
        point: { x: -10, y: 0.2 },
        points: [],
        tolerance: 1,
      }).kind,
    ).toBe("none")
  })

  it("preserves existing line priority when a line and curve overlap", () => {
    expect(
      inferSketchPoint({
        curves: [{ id: arcId, type: "circle", center: { x: 0, y: 0 }, radius: 10 }],
        lines: [{ ...horizontalLine, start: { x: 8, y: 0 }, end: { x: 12, y: 0 } }],
        point: { x: 10.2, y: 0.2 },
        points: [],
        tolerance: 1,
      }).kind,
    ).toBe("midpoint")
  })

  it("breaks equal-distance curve candidates by stable identity", () => {
    expect(
      inferSketchPoint({
        curves: [
          { id: secondLineId, type: "circle", center: { x: 0, y: 0 }, radius: 10 },
          { id: firstLineId, type: "circle", center: { x: 0, y: 0 }, radius: 10 },
        ],
        point: { x: 10.5, y: 0 },
        points: [],
        tolerance: 1,
      }).relations,
    ).toEqual([{ type: "point-on-curve", curveId: firstLineId }])
  })

  it("infers a segment intersection with both stable line relations", () => {
    const verticalLine = {
      id: secondLineId,
      startPointId: thirdPointId,
      endPointId: fourthPointId,
      start: { x: 5, y: -5 },
      end: { x: 5, y: 5 },
    } as const

    expect(
      inferSketchPoint({
        lines: [horizontalLine, verticalLine],
        point: { x: 5.2, y: 0.1 },
        points: [],
        tolerance: 1,
      }),
    ).toMatchObject({
      kind: "intersection",
      point: { x: 5, y: 0 },
      relations: [
        { type: "point-on-line", lineId: firstLineId },
        { type: "point-on-line", lineId: secondLineId },
      ],
    })
  })

  it("queries only nearby candidates without changing dense-sketch inference", () => {
    const verticalLine = {
      id: secondLineId,
      startPointId: thirdPointId,
      endPointId: fourthPointId,
      start: { x: 5, y: -5 },
      end: { x: 5, y: 5 },
    } as const
    const farPoints = Array.from({ length: 1_000 }, (_, index) => ({
      id: `018f0000-0000-7000-9001-${index.toString().padStart(12, "0")}` as SketchEntityId,
      x: 1_000 + index * 10,
      y: 1_000,
    }))
    const farLines = Array.from({ length: 1_000 }, (_, index) => ({
      id: `018f0000-0000-7000-9002-${index.toString().padStart(12, "0")}` as SketchEntityId,
      startPointId: firstPointId,
      endPointId: secondPointId,
      start: { x: 1_000 + index * 10, y: 999 },
      end: { x: 1_000 + index * 10, y: 1_001 },
    }))
    const lines = [horizontalLine, verticalLine, ...farLines]
    const query = createSketchInferenceCandidateQuery({
      cellSize: 1,
      lines,
      points: farPoints,
    })
    const point = { x: 5.2, y: 0.1 }
    const candidates = query(point, 1)

    expect(candidates.lines).toHaveLength(2)
    expect(candidates.points).toHaveLength(0)
    expect(inferSketchPoint({ ...candidates, point, tolerance: 1 })).toEqual(
      inferSketchPoint({ lines, point, points: farPoints, tolerance: 1 }),
    )
  })

  it("keeps axis-aligned point candidates queryable across the sketch", () => {
    const query = createSketchInferenceCandidateQuery({
      cellSize: 1,
      lines: [],
      points: [
        { id: firstPointId, x: -100, y: 5 },
        { id: secondPointId, x: 7, y: 100 },
        { id: thirdPointId, x: 100, y: 100 },
      ],
    })

    expect(
      query({ x: 7.2, y: 5.25 }, 0.5)
        .points.map(({ id }) => id)
        .sort(),
    ).toEqual([firstPointId, secondPointId])
  })

  it("keeps exceptionally long lines locally queryable through coarser index levels", () => {
    const longLine = {
      ...horizontalLine,
      start: { x: -1_000, y: 0 },
      end: { x: 1_000, y: 0 },
    }
    const farLines = Array.from({ length: 1_000 }, (_, index) => ({
      id: `018f0000-0000-7000-9003-${index.toString().padStart(12, "0")}` as SketchEntityId,
      startPointId: firstPointId,
      endPointId: secondPointId,
      start: { x: 2_000 + index * 10, y: -1_000 },
      end: { x: 2_000 + index * 10, y: 1_000 },
    }))
    const candidates = createSketchInferenceCandidateQuery({
      cellSize: 1,
      lines: [longLine, ...farLines],
      points: [],
    })({ x: 400, y: 0.25 }, 1)

    expect(candidates.lines).toEqual([longLine])
    expect(
      inferSketchPoint({ ...candidates, point: { x: 400, y: 0.25 }, tolerance: 1 }),
    ).toMatchObject({ kind: "point-on-line", point: { x: 400, y: 0 } })
  })

  it("infers parallel and perpendicular direction from a connected non-axis line", () => {
    const diagonalLine = {
      ...horizontalLine,
      end: { x: 10, y: 10 },
    }
    const parallel = inferSketchPoint({
      anchor: { x: 0, y: 0 },
      anchorPointId: firstPointId,
      lines: [diagonalLine],
      point: { x: 16, y: 16.3 },
      points: [],
      tolerance: 0.5,
    })
    const perpendicular = inferSketchPoint({
      anchor: { x: 0, y: 0 },
      anchorPointId: firstPointId,
      lines: [diagonalLine],
      point: { x: 6, y: -6.2 },
      points: [],
      tolerance: 0.5,
    })

    expect(parallel.direction).toEqual({ type: "parallel", lineId: firstLineId })
    expect(parallel.point.x).toBeCloseTo(16.15)
    expect(parallel.point.y).toBeCloseTo(16.15)
    expect(perpendicular.direction).toEqual({ type: "perpendicular", lineId: firstLineId })
  })

  it("keeps connected direction inference separate from locally queried relation lines", () => {
    const diagonalLine = {
      ...horizontalLine,
      end: { x: 10, y: 10 },
    }
    const inference = inferSketchPoint({
      anchor: { x: 0, y: 0 },
      anchorPointId: firstPointId,
      directionLines: [diagonalLine],
      lines: [],
      point: { x: 6, y: -6.2 },
      points: [],
      tolerance: 0.5,
    })

    expect(inference.direction).toEqual({ type: "perpendicular", lineId: firstLineId })
  })

  it("prefers a tangent direction when a line starts at an arc endpoint", () => {
    const inference = inferSketchPoint({
      anchor: { x: 10, y: 0 },
      anchorPointId: firstPointId,
      arcs: [
        {
          id: arcId,
          center: { x: 0, y: 0 },
          startPointId: firstPointId,
          endPointId: secondPointId,
        },
      ],
      point: { x: 10.2, y: 5 },
      points: [],
      tolerance: 0.5,
    })

    expect(inference.direction).toEqual({ type: "tangent", arcId })
    expect(inference.point).toEqual({ x: 10, y: 5 })
  })
})
