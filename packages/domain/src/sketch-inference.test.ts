import { describe, expect, it } from "vitest"
import type { SketchEntityId } from "./identifiers"
import { inferSketchPoint } from "./sketch-inference"

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
