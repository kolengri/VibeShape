import { describe, expect, it } from "bun:test"
import { placementFeatureContentParametersSchema } from "./geometry-worker"

const valid = { translation: [-5, 20, 0], rotation: [Math.PI / 2, 0, -Math.PI] }
describe("placement numeric worker parameters", () => {
  it("accepts signed bounded rigid placement values and requires exactly three axes", () => {
    expect(placementFeatureContentParametersSchema.parse(valid)).toEqual<unknown>(valid)
    expect(
      placementFeatureContentParametersSchema.safeParse({
        translation: [0, 0, 0],
        rotation: [-2 * Math.PI, 2 * Math.PI, 0],
      }).success,
    ).toBe(true)
  })
  it.each([
    { translation: [0, 0] },
    { translation: [0, 0, 0, 0] },
    { translation: [100_001, 0, 0] },
    { translation: [Number.NaN, 0, 0] },
    { rotation: [0, Number.POSITIVE_INFINITY, 0] },
    { rotation: [0, 7, 0] },
    { rotation: ["90 deg", 0, 0] },
    { matrix: [1, 0, 0, 0] },
    { scale: 2 },
  ])("rejects unbounded or non-rigid worker intent %j", (changes) => {
    expect(
      placementFeatureContentParametersSchema.safeParse({ ...valid, ...changes }).success,
    ).toBe(false)
  })
})
