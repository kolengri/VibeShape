import { describe, expect, it } from "vitest"
import { revolveProfileCrossesAxis } from "./revolve-profile"

const entityId = "0195b5ac-b220-7a2c-8c33-67a36a7f3211"
const pointId = (suffix: string) => `0195b5ac-b220-7a2c-8c33-${suffix.padStart(12, "0")}`

function rectangle(minX: number, minY: number, maxX: number, maxY: number) {
  const points: [number, number][] = [
    [minX, minY],
    [maxX, minY],
    [maxX, maxY],
    [minX, maxY],
  ]
  return {
    sourceEntityIds: [entityId],
    segments: points.map((start, index) => ({
      entityId,
      type: "line" as const,
      startPointId: pointId(String(index + 1)),
      endPointId: pointId(String(((index + 1) % points.length) + 1)),
      start,
      end: points[(index + 1) % points.length] as [number, number],
    })),
  }
}

describe("revolve profile axis crossing", () => {
  it("rejects a region spanning the selected axis but permits a touching boundary", () => {
    expect(revolveProfileCrossesAxis({ axis: "y", outer: rectangle(-5, 2, 5, 8) })).toBe(true)
    expect(revolveProfileCrossesAxis({ axis: "y", outer: rectangle(0, 2, 5, 8) })).toBe(false)
    expect(revolveProfileCrossesAxis({ axis: "x", outer: rectangle(2, -5, 8, 5) })).toBe(true)
    expect(revolveProfileCrossesAxis({ axis: "x", outer: rectangle(2, 0, 8, 5) })).toBe(false)
  })

  it("uses exact full-ellipse bounds instead of endpoint-only checks", () => {
    expect(
      revolveProfileCrossesAxis({
        axis: "y",
        outer: {
          sourceEntityIds: [entityId],
          segments: [
            {
              entityId,
              type: "ellipse",
              center: [1, 4],
              primaryAxisPoint: [1, 7],
              secondaryAxisPoint: [-1, 4],
            },
          ],
        },
      }),
    ).toBe(true)
  })
})
