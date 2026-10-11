import { describe, expect, it } from "bun:test"
import { generativeDesignSettingsSchema } from "./generative-design"

const material = {
  id: "steel",
  name: "Steel",
  material: {
    youngModulusMpa: 200_000,
    poissonRatio: 0.3,
    yieldStrengthMpa: 250,
    densityKgM3: 7850,
  },
}
const valid = { materials: [material], retainedMassFractions: [0.1, 0.5, 1] }

describe("bounded generative design settings", () => {
  it("accepts nine scenarios and inclusive retained-mass limits", () => {
    const settings = {
      ...valid,
      materials: [material, { ...material, id: "aluminum" }, { ...material, id: "titanium" }],
    }
    expect(generativeDesignSettingsSchema.parse(settings)).toEqual(settings)
  })

  it.each(
    [[], [0.5, 0.5], [0.1, 0.2, 0.3, 0.4], [0.099], [1.001], [NaN], [Infinity], ["0.5"]].map(
      (retainedMassFractions) => ({ retainedMassFractions }),
    ),
  )("rejects empty, excessive, duplicate, or invalid targets %j", ({ retainedMassFractions }) => {
    expect(
      generativeDesignSettingsSchema.safeParse({ ...valid, retainedMassFractions }).success,
    ).toBe(false)
  })

  it.each(
    [
      [],
      [material, material],
      [material, { ...material, id: " steel " }],
      [material, { ...material, id: "a" }, { ...material, id: "b" }, { ...material, id: "c" }],
      [{ ...material, id: " " }],
      [{ ...material, name: "" }],
      [{ ...material, material: { ...material.material, densityKgM3: Infinity } }],
      [{ ...material, unexpected: true }],
    ].map((materials) => ({ materials })),
  )("rejects invalid material descriptors %j", ({ materials }) => {
    expect(generativeDesignSettingsSchema.safeParse({ ...valid, materials }).success).toBe(false)
  })
})
