import { describe, expect, it, vi } from "vitest"
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
        curves: [
          {
            id: arcId,
            centerPointId: firstPointId,
            type: "circle",
            center: { x: 0, y: 0 },
            radius: 10,
          },
        ],
        point: { x: 7.4, y: 7.4 },
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
        curves: [
          {
            id: arcId,
            centerPointId: firstPointId,
            type: "circle",
            center: { x: 0, y: 0 },
            radius: 10,
          },
        ],
        point: { x: 10.4, y: 0 },
        points: [],
        tolerance: 1,
      }),
    ).toMatchObject({
      kind: "quadrant",
      point: { x: 10, y: 0 },
      relations: [
        { type: "point-on-curve", curveId: arcId },
        { type: "horizontal-points", pointId: firstPointId },
      ],
    })

    const arc = {
      id: arcId,
      centerPointId: firstPointId,
      type: "arc" as const,
      center: { x: 0, y: 0 },
      start: { x: 10, y: 0 },
      end: { x: 0, y: 10 },
    }
    const onArc = inferSketchPoint({
      curves: [arc],
      point: { x: 9, y: 5.4 },
      points: [],
      tolerance: 1,
    })
    expect(onArc.kind).toBe("point-on-curve")
    expect(Math.hypot(onArc.point.x, onArc.point.y)).toBeCloseTo(10)
    expect(
      inferSketchPoint({
        curves: [arc],
        point: { x: -10, y: 0.2 },
        points: [],
        tolerance: 1,
      }).kind,
    ).toBe("none")
  })

  it("infers the arc-length midpoint across minor, major, and wrapped positive sweeps", () => {
    const inferMidpoint = (start: { x: number; y: number }, end: { x: number; y: number }) =>
      inferSketchPoint({
        curves: [
          {
            id: arcId,
            centerPointId: firstPointId,
            type: "arc",
            center: { x: 0, y: 0 },
            start,
            end,
          },
        ],
        point: { x: 0, y: 10 },
        points: [],
        tolerance: 25,
      })

    const minor = inferMidpoint({ x: 10, y: 0 }, { x: 0, y: 10 })
    expect(minor).toMatchObject({
      kind: "midpoint",
      relations: [{ type: "arc-midpoint", arcId }],
    })
    expect(minor.point.x).toBeCloseTo(Math.SQRT1_2 * 10)
    expect(minor.point.y).toBeCloseTo(Math.SQRT1_2 * 10)

    const major = inferMidpoint({ x: 0, y: 10 }, { x: 10, y: 0 })
    expect(major.point.x).toBeCloseTo(-Math.SQRT1_2 * 10)
    expect(major.point.y).toBeCloseTo(-Math.SQRT1_2 * 10)

    const wrapped = inferMidpoint({ x: 0, y: -10 }, { x: 0, y: 10 })
    expect(wrapped.point).toEqual({ x: 10, y: 0 })
  })

  it("prefers an arc midpoint over a coincident quadrant and generic curve projection", () => {
    const inference = inferSketchPoint({
      curves: [
        {
          id: arcId,
          centerPointId: firstPointId,
          type: "arc",
          center: { x: 0, y: 0 },
          start: { x: 0, y: -10 },
          end: { x: 0, y: 10 },
        },
      ],
      point: { x: 10.2, y: 0.1 },
      points: [],
      tolerance: 1,
    })

    expect(inference).toMatchObject({
      kind: "midpoint",
      point: { x: 10, y: 0 },
      relations: [{ type: "arc-midpoint", arcId }],
    })
  })

  it("preserves line inference priority over a nearby arc midpoint", () => {
    const inference = inferSketchPoint({
      curves: [
        {
          id: arcId,
          centerPointId: firstPointId,
          type: "arc",
          center: { x: 0, y: 0 },
          start: { x: 10, y: 0 },
          end: { x: 0, y: 10 },
        },
      ],
      lines: [
        {
          ...horizontalLine,
          start: { x: 0, y: 7 },
          end: { x: 20, y: 7 },
        },
      ],
      point: { x: 7.1, y: 7 },
      points: [],
      tolerance: 0.2,
    })

    expect(inference).toMatchObject({
      kind: "point-on-line",
      point: { x: 7.1, y: 7 },
      relations: [{ type: "point-on-line", lineId: firstLineId }],
    })
  })

  it("infers all four exact circle quadrants with center alignment intent", () => {
    const curve = {
      id: arcId,
      centerPointId: firstPointId,
      type: "circle" as const,
      center: { x: 2, y: 3 },
      radius: 10,
    }
    const cases = [
      { point: { x: 12.2, y: 3.1 }, relation: "horizontal-points" },
      { point: { x: 2.1, y: 13.2 }, relation: "vertical-points" },
      { point: { x: -8.2, y: 2.9 }, relation: "horizontal-points" },
      { point: { x: 1.9, y: -7.2 }, relation: "vertical-points" },
    ] as const

    for (const expected of cases) {
      expect(
        inferSketchPoint({ curves: [curve], point: expected.point, points: [], tolerance: 1 }),
      ).toMatchObject({
        alignmentGuide: curve.center,
        kind: "quadrant",
        relations: [
          { type: "point-on-curve", curveId: arcId },
          { type: expected.relation, pointId: firstPointId },
        ],
      })
    }
  })

  it("infers all four exact rotated ellipse quadrants with stable axis intent", () => {
    const curve = {
      id: arcId,
      centerPointId: firstPointId,
      type: "ellipse" as const,
      center: { x: 2, y: 3 },
      primaryAxisPoint: { x: 8, y: 9 },
      secondaryAxisPoint: { x: -1, y: 6 },
    }
    const cases = [
      { axis: "primary", side: "positive", point: { x: 8.1, y: 8.9 }, expected: { x: 8, y: 9 } },
      {
        axis: "primary",
        side: "negative",
        point: { x: -4.1, y: -2.9 },
        expected: { x: -4, y: -3 },
      },
      {
        axis: "secondary",
        side: "positive",
        point: { x: -0.9, y: 6.1 },
        expected: { x: -1, y: 6 },
      },
      { axis: "secondary", side: "negative", point: { x: 5.1, y: -0.1 }, expected: { x: 5, y: 0 } },
    ] as const

    for (const expected of cases) {
      expect(
        inferSketchPoint({ curves: [curve], point: expected.point, points: [], tolerance: 0.5 }),
      ).toMatchObject({
        kind: "quadrant",
        point: expected.expected,
        relations: [
          {
            type: "ellipse-quadrant",
            ellipseId: arcId,
            axis: expected.axis,
            side: expected.side,
          },
        ],
      })
    }
  })

  it("fails closed for degenerate ellipse quadrant inference", () => {
    expect(
      inferSketchPoint({
        curves: [
          {
            id: arcId,
            centerPointId: firstPointId,
            type: "ellipse",
            center: { x: 2, y: 3 },
            primaryAxisPoint: { x: 2, y: 3 },
            secondaryAxisPoint: { x: -1, y: 6 },
          },
        ],
        point: { x: -1, y: 6 },
        points: [],
        tolerance: 1,
      }).kind,
    ).toBe("none")
  })

  it("limits arc quadrant inference to its positive bounded sweep", () => {
    const quarterArc = {
      id: arcId,
      centerPointId: firstPointId,
      type: "arc" as const,
      center: { x: 0, y: 0 },
      start: { x: 10, y: 0 },
      end: { x: 0, y: 10 },
    }
    expect(
      inferSketchPoint({
        curves: [quarterArc],
        point: { x: 0.2, y: 10.2 },
        points: [],
        tolerance: 1,
      }).kind,
    ).toBe("quadrant")
    expect(
      inferSketchPoint({
        curves: [quarterArc],
        point: { x: -10.2, y: 0 },
        points: [],
        tolerance: 1,
      }).kind,
    ).toBe("none")

    const wraparoundArc = {
      ...quarterArc,
      start: { x: 0, y: -10 },
      end: { x: 0, y: 10 },
    }
    expect(
      inferSketchPoint({
        curves: [wraparoundArc],
        point: { x: 10.2, y: 0 },
        points: [],
        tolerance: 1,
      }).kind,
    ).toBe("midpoint")
    expect(
      inferSketchPoint({
        curves: [wraparoundArc],
        point: { x: -10.2, y: 0 },
        points: [],
        tolerance: 1,
      }).kind,
    ).toBe("none")
  })

  it("preserves existing line priority when a line and curve overlap", () => {
    expect(
      inferSketchPoint({
        curves: [
          {
            id: arcId,
            centerPointId: firstPointId,
            type: "circle",
            center: { x: 0, y: 0 },
            radius: 10,
          },
        ],
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
          {
            id: secondLineId,
            centerPointId: thirdPointId,
            type: "circle",
            center: { x: 0, y: 0 },
            radius: 10,
          },
          {
            id: firstLineId,
            centerPointId: fourthPointId,
            type: "circle",
            center: { x: 0, y: 0 },
            radius: 10,
          },
        ],
        point: { x: 10.5, y: 0 },
        points: [],
        tolerance: 1,
      }).relations[0],
    ).toEqual({ type: "point-on-curve", curveId: firstLineId })
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

  it("selects a stable quadrant from dense coincident curves without sorting candidates", () => {
    const curves = Array.from({ length: 2_500 }, (_, index) => {
      const suffix = (index + 100).toString(16).padStart(12, "0")
      return {
        id: `018f0000-0000-7000-9000-${suffix}` as SketchEntityId,
        centerPointId: `018f0000-0000-7001-9000-${suffix}` as SketchEntityId,
        type: "circle" as const,
        center: { x: 0, y: 0 },
        radius: 10,
      }
    })
    const sort = vi.spyOn(Array.prototype, "sort")
    try {
      const inference = inferSketchPoint({
        curves,
        point: { x: 10.1, y: 0.1 },
        points: [],
        tolerance: 1,
      })

      expect(inference).toMatchObject({
        kind: "quadrant",
        point: { x: 10, y: 0 },
      })
      expect(inference.relations[0]).toEqual({
        type: "point-on-curve",
        curveId: curves[0]?.id,
      })
      expect(sort).not.toHaveBeenCalled()
    } finally {
      sort.mockRestore()
    }
  })

  it("selects a stable arc midpoint from dense coincident arcs without sorting candidates", () => {
    const curves = Array.from({ length: 2_500 }, (_, index) => {
      const suffix = (index + 100).toString(16).padStart(12, "0")
      return {
        id: `018f0000-0000-7000-9000-${suffix}` as SketchEntityId,
        centerPointId: `018f0000-0000-7001-9000-${suffix}` as SketchEntityId,
        type: "arc" as const,
        center: { x: 0, y: 0 },
        start: { x: 10, y: 0 },
        end: { x: 0, y: 10 },
      }
    })
    const sort = vi.spyOn(Array.prototype, "sort")
    try {
      const inference = inferSketchPoint({
        curves,
        point: { x: 7.1, y: 7.1 },
        points: [],
        tolerance: 1,
      })

      expect(inference).toMatchObject({ kind: "midpoint" })
      expect(inference.relations).toEqual([{ type: "arc-midpoint", arcId: curves[0]?.id }])
      expect(sort).not.toHaveBeenCalled()
    } finally {
      sort.mockRestore()
    }
  })

  it("selects a stable ellipse quadrant from dense coincident curves without sorting", () => {
    const curves = Array.from({ length: 2_500 }, (_, index) => {
      const suffix = (index + 100).toString(16).padStart(12, "0")
      return {
        id: `018f0000-0000-7000-9000-${suffix}` as SketchEntityId,
        centerPointId: `018f0000-0000-7001-9000-${suffix}` as SketchEntityId,
        type: "ellipse" as const,
        center: { x: 0, y: 0 },
        primaryAxisPoint: { x: 10, y: 0 },
        secondaryAxisPoint: { x: 0, y: 5 },
      }
    })
    const sort = vi.spyOn(Array.prototype, "sort")
    try {
      const inference = inferSketchPoint({
        curves,
        point: { x: -10.1, y: 0.1 },
        points: [],
        tolerance: 1,
      })

      expect(inference).toMatchObject({ kind: "quadrant", point: { x: -10, y: 0 } })
      expect(inference.relations).toEqual([
        {
          type: "ellipse-quadrant",
          ellipseId: curves[0]?.id,
          axis: "primary",
          side: "negative",
        },
      ])
      expect(sort).not.toHaveBeenCalled()
    } finally {
      sort.mockRestore()
    }
  })

  it("projects to the nearest point on a rotated ellipse with a distinct relation", () => {
    const angle = Math.PI / 6
    const primary = { x: Math.cos(angle) * 10, y: Math.sin(angle) * 10 }
    const secondary = { x: -Math.sin(angle) * 5, y: Math.cos(angle) * 5 }
    const parameter = Math.PI / 3
    const point = {
      x: primary.x * Math.cos(parameter) + secondary.x * Math.sin(parameter) + 0.05,
      y: primary.y * Math.cos(parameter) + secondary.y * Math.sin(parameter) + 0.05,
    }
    const ellipseId = "018f0000-0000-7000-9000-000000000099" as SketchEntityId
    const inference = inferSketchPoint({
      curves: [
        {
          id: ellipseId,
          centerPointId: firstPointId,
          type: "ellipse",
          center: { x: 0, y: 0 },
          primaryAxisPoint: primary,
          secondaryAxisPoint: secondary,
        },
      ],
      point,
      points: [],
      tolerance: 0.2,
    })
    expect(inference.kind).toBe("point-on-curve")
    expect(inference.relations).toEqual([{ type: "point-on-ellipse", ellipseId }])
    expect(Math.hypot(inference.point.x - point.x, inference.point.y - point.y)).toBeLessThan(0.2)
    const primaryCoordinate = (inference.point.x * primary.x + inference.point.y * primary.y) / 10
    const secondaryCoordinate =
      (inference.point.x * secondary.x + inference.point.y * secondary.y) / 5
    expect((primaryCoordinate / 10) ** 2 + (secondaryCoordinate / 5) ** 2).toBeCloseTo(1, 10)
  })

  it("keeps ellipse inference within tolerance and breaks equal ties by curve ID", () => {
    const makeEllipse = (id: SketchEntityId) => ({
      id,
      centerPointId: firstPointId,
      type: "ellipse" as const,
      center: { x: 0, y: 0 },
      primaryAxisPoint: { x: 10, y: 0 },
      secondaryAxisPoint: { x: 0, y: 5 },
    })
    const curves = [makeEllipse(secondPointId), makeEllipse(firstPointId)]
    expect(
      inferSketchPoint({ curves, point: { x: 7.3, y: 3.7 }, points: [], tolerance: 0.1 }).kind,
    ).toBe("none")
    expect(
      inferSketchPoint({ curves, point: { x: 7.12, y: 3.58 }, points: [], tolerance: 0.2 })
        .relations,
    ).toEqual([{ type: "point-on-ellipse", ellipseId: firstPointId }])
  })

  it("selects a stable ellipse perimeter from dense coincident curves without sorting", () => {
    const curves = Array.from({ length: 2_500 }, (_, index) => {
      const suffix = (index + 100).toString(16).padStart(12, "0")
      return {
        id: `018f0000-0000-7000-9000-${suffix}` as SketchEntityId,
        centerPointId: `018f0000-0000-7001-9000-${suffix}` as SketchEntityId,
        type: "ellipse" as const,
        center: { x: 0, y: 0 },
        primaryAxisPoint: { x: 10, y: 0 },
        secondaryAxisPoint: { x: 0, y: 5 },
      }
    })
    const sort = vi.spyOn(Array.prototype, "sort")
    try {
      const inference = inferSketchPoint({
        curves,
        point: { x: 7.12, y: 3.58 },
        points: [],
        tolerance: 0.2,
      })

      expect(inference).toMatchObject({ kind: "point-on-curve" })
      expect(inference.relations).toEqual([{ type: "point-on-ellipse", ellipseId: curves[0]?.id }])
      expect(sort).not.toHaveBeenCalled()
    } finally {
      sort.mockRestore()
    }
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
