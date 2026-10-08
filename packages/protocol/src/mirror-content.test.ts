import { describe, expect, it } from "bun:test"
import {
  mirrorFeatureContentParametersSchema,
  mirrorFeatureContentParametersV2Schema,
} from "./geometry-worker"

describe("mirror worker parameters", () => {
  it.each(["XY", "XZ", "YZ"])("accepts the %s origin plane", (plane) => {
    expect(mirrorFeatureContentParametersSchema.parse({ plane })).toEqual({ plane })
  })
  it.each([
    { plane: "xy" },
    { plane: "custom" },
    { plane: "XY", targetBody: {} },
    { plane: "XY", keepSource: true },
    { plane: "XY", matrix: [] },
    {},
  ])("rejects unsupported or noncanonical worker intent %j", (parameters) => {
    expect(mirrorFeatureContentParametersSchema.safeParse(parameters).success).toBe(false)
  })
  it.each([-100_000, -25.4, 0, 25.4, 100_000])(
    "accepts signed offset %s only in the explicit v2 contract",
    (offset) => {
      const parameters = { plane: "XZ", offset, preserveSource: true }
      expect(mirrorFeatureContentParametersV2Schema.parse(parameters)).toEqual<unknown>(parameters)
      expect(mirrorFeatureContentParametersSchema.safeParse(parameters).success).toBe(false)
    },
  )
  it.each([
    { offset: 100_001 },
    { offset: -100_001 },
    { offset: Number.NaN },
    { preserveSource: "true" },
    { offset: {} },
  ])("rejects invalid v2 content %j", (changes) => {
    expect(
      mirrorFeatureContentParametersV2Schema.safeParse({
        plane: "XY",
        offset: 0,
        preserveSource: false,
        ...changes,
      }).success,
    ).toBe(false)
  })
  it("requires both enhanced fields without filling legacy defaults", () => {
    expect(mirrorFeatureContentParametersV2Schema.safeParse({ plane: "XY" }).success).toBe(false)
    expect(
      mirrorFeatureContentParametersV2Schema.safeParse({ plane: "XY", offset: 0 }).success,
    ).toBe(false)
  })
})
