import { describe, expect, it } from "vitest"
import {
  extrusionMultiProfileFeatureContentParametersSchema,
  extrusionMultiProfileModifyingFeatureContentParametersSchema,
  revolveMultiProfileFeatureContentParametersSchema,
} from "./geometry-worker"

const sketchId = "018f2f4a-7b6c-7def-8abc-1234567890ab"
const entityId = "018f2f4a-7b6c-7def-8abc-1234567890ac"

function profile(offset = 0) {
  const points = [
    [offset, 0],
    [offset + 10, 0],
    [offset + 10, 10],
    [offset, 10],
  ] as const
  return {
    outer: {
      sourceEntityIds: [entityId],
      segments: [
        {
          entityId,
          type: "line" as const,
          startPointId: entityId,
          endPointId: entityId,
          start: points[0],
          end: points[1],
        },
      ],
    },
    holes: [],
  }
}

const frame = {
  origin: [0, 0, 0] as [number, number, number],
  xAxis: [1, 0, 0] as [number, number, number],
  yAxis: [0, 1, 0] as [number, number, number],
  normal: [0, 0, 1] as [number, number, number],
}

describe("multi-profile geometry content", () => {
  it("accepts bounded new-body analytical profile arrays", () => {
    const result = extrusionMultiProfileFeatureContentParametersSchema.safeParse({
      sketchId,
      frame,
      profiles: [profile(), profile(20)],
      distance: 5,
      symmetric: false,
      operation: "new",
    })
    expect(result.success).toBe(true)
  })

  it("rejects modifying operations and aggregate segment overflow", () => {
    const base = {
      sketchId,
      frame,
      profiles: [profile()],
      distance: 5,
      symmetric: false,
    }
    expect(
      extrusionMultiProfileFeatureContentParametersSchema.safeParse({
        ...base,
        operation: "add",
      }).success,
    ).toBe(false)
    expect(
      extrusionMultiProfileFeatureContentParametersSchema.safeParse({
        ...base,
        profiles: Array.from({ length: 65 }, () => profile()),
        operation: "new",
      }).success,
    ).toBe(false)
  })

  it("accepts the corresponding new-body revolve shape", () => {
    const result = revolveMultiProfileFeatureContentParametersSchema.safeParse({
      sketchId,
      frame,
      profiles: [profile()],
      axis: { kind: "origin-axis", axis: "x" },
      axisOrigin: [0, 0, 0],
      axisDirection: [1, 0, 0],
      angleRadians: Math.PI,
      operation: "new",
    })
    expect(result.success).toBe(true)
  })

  it.each(["add", "remove", "intersect"] as const)(
    "accepts %s multi-profile modifying extrusion content",
    (operation) => {
      const result = extrusionMultiProfileModifyingFeatureContentParametersSchema.safeParse({
        sketchId,
        frame,
        profiles: [profile()],
        distance: 5,
        symmetric: false,
        operation,
      })
      expect(result.success).toBe(true)
    },
  )

  it("keeps the modifying content version distinct from multi-profile New", () => {
    expect(
      extrusionMultiProfileModifyingFeatureContentParametersSchema.safeParse({
        sketchId,
        frame,
        profiles: [profile()],
        distance: 5,
        symmetric: false,
        operation: "new",
      }).success,
    ).toBe(false)
  })
})
