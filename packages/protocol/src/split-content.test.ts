import { describe, expect, it } from "vitest"
import { SPLIT_OUTPUT_ROLES, splitFeatureContentParametersSchema } from "./geometry-worker"

describe("split worker parameters", () => {
  it.each(["XY", "XZ", "YZ"])("accepts signed offsets on the %s plane", (plane) => {
    for (const offset of [-100000, -10, 0, 10, 100000])
      expect(splitFeatureContentParametersSchema.parse({ plane, offset })).toEqual({
        plane,
        offset,
      })
    expect(SPLIT_OUTPUT_ROLES).toEqual(["split.negative", "split.positive"])
  })
  it.each([
    {},
    { plane: "xy", offset: 0 },
    { plane: "XY" },
    { plane: "XY", offset: 100001 },
    { plane: "XY", offset: NaN },
    { plane: "XY", offset: Infinity },
    { plane: "XY", offset: { value: 10 } },
    { plane: "XY", offset: 10, targetBody: {} },
    { plane: "XY", offset: 10, outputRoles: [] },
  ])("rejects noncanonical or unsupported intent %j", (parameters) => {
    expect(splitFeatureContentParametersSchema.safeParse(parameters).success).toBe(false)
  })
})
