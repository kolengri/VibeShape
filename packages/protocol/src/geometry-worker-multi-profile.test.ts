import { describe, expect, it } from "vitest"
import {
  extrusionExtentBounds,
  extrusionFeatureContentParametersV5Schema,
  extrusionMultiProfileFeatureContentParametersSchema,
  extrusionMultiProfileModifyingFeatureContentParametersSchema,
  revolveMultiProfileFeatureContentParametersSchema,
  revolveMultiProfileModifyingFeatureContentParametersSchema,
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
  const extent = {
    sketchId,
    frame,
    profiles: [profile()],
    distance: 10,
    symmetric: false,
    reversed: false,
    secondDistance: 3,
    operation: "new",
  }

  it.each([
    [{}, { start: -3, end: 10 }],
    [{ reversed: true }, { start: -10, end: 3 }],
    [{ secondDistance: null }, { start: 0, end: 10 }],
    [
      { secondDistance: null, reversed: true },
      { start: -10, end: 0 },
    ],
    [
      { secondDistance: null, symmetric: true },
      { start: -5, end: 5 },
    ],
    [
      { secondDistance: null, symmetric: true, reversed: true },
      { start: -5, end: 5 },
    ],
  ])("computes reference-normal bounds for extent %j", (changes, expected) => {
    expect(
      extrusionExtentBounds(
        extrusionFeatureContentParametersV5Schema.parse({ ...extent, ...changes }),
      ),
    ).toEqual(expected)
  })

  it.each([
    { distance: Number.NaN },
    { secondDistance: Number.POSITIVE_INFINITY },
    { secondDistance: 0 },
    { secondDistance: -3 },
    { distance: 0.0005 },
    { distance: 99_999, secondDistance: 2 },
    { symmetric: true },
    { secondDistance: undefined },
    { profiles: [] },
    { offset: 1 },
  ])("rejects invalid version-5 worker content %j", (changes) => {
    expect(
      extrusionFeatureContentParametersV5Schema.safeParse({ ...extent, ...changes }).success,
    ).toBe(false)
  })

  it.each(["new", "add", "remove", "intersect"])(
    "accepts bounded v5 multi-profile %s content",
    (operation) => {
      expect(
        extrusionFeatureContentParametersV5Schema.safeParse({
          ...extent,
          profiles: [profile(), profile(20)],
          operation,
        }).success,
      ).toBe(true)
    },
  )

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

  it.each(["add", "remove", "intersect"] as const)(
    "accepts %s multi-profile modifying revolve content",
    (operation) => {
      expect(
        revolveMultiProfileModifyingFeatureContentParametersSchema.safeParse({
          sketchId,
          frame,
          profiles: [profile(), profile(20)],
          axis: { kind: "origin-axis", axis: "x" },
          axisOrigin: [0, 0, 0],
          axisDirection: [1, 0, 0],
          angleRadians: Math.PI,
          operation,
        }).success,
      ).toBe(true)
    },
  )

  it("rejects New in the modifying multi-profile revolve contract", () => {
    expect(
      revolveMultiProfileModifyingFeatureContentParametersSchema.safeParse({
        sketchId,
        frame,
        profiles: [profile()],
        axis: { kind: "origin-axis", axis: "x" },
        axisOrigin: [0, 0, 0],
        axisDirection: [1, 0, 0],
        angleRadians: Math.PI,
        operation: "new",
      }).success,
    ).toBe(false)
  })
})
