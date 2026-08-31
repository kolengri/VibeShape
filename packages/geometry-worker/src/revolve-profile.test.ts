import { revolveFeatureContentParametersSchema } from "@vibeshape/protocol"
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

  it("checks a selected sketch-line axis in the sketch frame", () => {
    const base = {
      sketchId: "0195b5ac-b220-7a2c-8c33-67a36a7f3201",
      frame: {
        origin: [0, 0, 0],
        xAxis: [1, 0, 0],
        yAxis: [0, 1, 0],
        normal: [0, 0, 1],
      },
      outer: rectangle(0, 0, 10, 5),
      holes: [],
      axis: {
        kind: "sketch-line",
        sketchId: "0195b5ac-b220-7a2c-8c33-67a36a7f3201",
        entityId,
      },
      angleRadians: Math.PI,
      operation: "new",
    } as const
    const crossing = revolveFeatureContentParametersSchema.parse({
      ...base,
      axisOrigin: [0, 0, 0],
      axisDirection: [Math.SQRT1_2, Math.SQRT1_2, 0],
    })
    const touching = revolveFeatureContentParametersSchema.parse({
      ...base,
      axisOrigin: [0, 0, 0],
      axisDirection: [1, 0, 0],
    })

    expect(revolveProfileCrossesAxis(crossing)).toBe(true)
    expect(revolveProfileCrossesAxis(touching)).toBe(false)
  })

  it.each([
    [
      "circle",
      {
        entityId,
        type: "circle" as const,
        center: [1, 0] as [number, number],
        radius: 2,
      },
    ],
    [
      "arc",
      {
        entityId,
        type: "arc" as const,
        startPointId: pointId("21"),
        endPointId: pointId("22"),
        start: [3, 0] as [number, number],
        middle: [1, 2] as [number, number],
        end: [-1, 0] as [number, number],
      },
    ],
    [
      "ellipse",
      {
        entityId,
        type: "ellipse" as const,
        center: [1, 0] as [number, number],
        primaryAxisPoint: [3, 0] as [number, number],
        secondaryAxisPoint: [1, 1] as [number, number],
      },
    ],
    [
      "elliptical arc",
      {
        entityId,
        type: "elliptical-arc" as const,
        startPointId: pointId("23"),
        endPointId: pointId("24"),
        center: [1, 0] as [number, number],
        primaryAxisPoint: [3, 0] as [number, number],
        secondaryAxisPoint: [1, 1] as [number, number],
        start: [3, 0] as [number, number],
        end: [-1, 0] as [number, number],
      },
    ],
  ])("uses exact %s bounds against a selected line axis", (_label, segment) => {
    const parameters = revolveFeatureContentParametersSchema.parse({
      sketchId: "0195b5ac-b220-7a2c-8c33-67a36a7f3201",
      frame: {
        origin: [0, 0, 0],
        xAxis: [1, 0, 0],
        yAxis: [0, 1, 0],
        normal: [0, 0, 1],
      },
      outer: { sourceEntityIds: [entityId], segments: [segment] },
      holes: [],
      axis: {
        kind: "sketch-line",
        sketchId: "0195b5ac-b220-7a2c-8c33-67a36a7f3201",
        entityId,
      },
      axisOrigin: [0, 0, 0],
      axisDirection: [0, 1, 0],
      angleRadians: Math.PI,
      operation: "new",
    })

    expect(revolveProfileCrossesAxis(parameters)).toBe(true)
  })
})
