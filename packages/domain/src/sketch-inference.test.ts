import { describe, expect, it } from "vitest"
import type { SketchEntityId } from "./identifiers"
import { inferSketchPoint } from "./sketch-inference"

const firstPointId = "018f0000-0000-7000-9000-000000000001" as SketchEntityId
const secondPointId = "018f0000-0000-7000-9000-000000000002" as SketchEntityId

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
      axis: null,
      point: { x: -1, y: 0 },
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
      axis: "horizontal",
      point: { x: 40, y: 20 },
      target: { kind: "new", point: { x: 40, y: 20 } },
    })
    expect(
      inferSketchPoint({
        anchor: { x: 10, y: 20 },
        point: { x: 10.25, y: 50 },
        points: [],
        tolerance: 1,
      }).axis,
    ).toBe("vertical")
  })

  it("prefers a point snap and rejects invalid tolerances", () => {
    const inference = inferSketchPoint({
      anchor: { x: 0, y: 0 },
      point: { x: 10, y: 0.2 },
      points: [{ id: firstPointId, x: 10, y: 0.5 }],
      tolerance: 1,
    })

    expect(inference.axis).toBeNull()
    expect(inference.target).toEqual({ kind: "existing", pointId: firstPointId })
    expect(() =>
      inferSketchPoint({ point: { x: 0, y: 0 }, points: [], tolerance: Number.NaN }),
    ).toThrow("finite non-negative")
  })
})
