import { describe, expect, it } from "vitest"
import {
  compoundFeatureContentParametersSchema,
  unionFeatureContentParametersSchema,
} from "./geometry-worker"

const role = (index: number) => `body.0195b5ac-b220-7a2c-8c33-${String(index).padStart(12, "0")}`
describe("body combination worker parameters", () => {
  it("accepts ordered authored slot roles without native solid indices", () => {
    const outputRoles = [role(1), role(2)]
    expect(compoundFeatureContentParametersSchema.parse({ outputRoles })).toEqual({ outputRoles })
    expect(unionFeatureContentParametersSchema.parse({})).toEqual({})
  })
  it.each([
    [],
    [role(1)],
    Array.from({ length: 9 }, (_, index) => role(index)),
    [role(1), role(1)],
    ["result", role(1)],
    ["body.0", role(1)],
    ["body.Unknown", role(1)],
  ])("rejects ambiguous, unbounded or nonauthored catalog roles %j", (outputRoles) => {
    expect(compoundFeatureContentParametersSchema.safeParse({ outputRoles }).success).toBe(false)
  })
  it("accepts eight authored slots and rejects arbitrary executable or transform parameters", () => {
    expect(
      compoundFeatureContentParametersSchema.safeParse({
        outputRoles: Array.from({ length: 8 }, (_, index) => role(index)),
      }).success,
    ).toBe(true)
    for (const changes of [
      { scale: 2 },
      { matrix: [] },
      { code: "execute" },
      { operation: "compound" },
    ]) {
      expect(unionFeatureContentParametersSchema.safeParse(changes).success).toBe(false)
      expect(
        compoundFeatureContentParametersSchema.safeParse({
          outputRoles: [role(1), role(2)],
          ...changes,
        }).success,
      ).toBe(false)
    }
  })
})
