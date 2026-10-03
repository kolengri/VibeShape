import { describe, expect, it } from "vitest"
import { mirrorFeatureContentParametersSchema } from "./geometry-worker"

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
})
