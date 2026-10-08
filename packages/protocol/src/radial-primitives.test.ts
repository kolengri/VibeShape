import { describe, expect, it } from "bun:test"
import {
  coneFeatureContentParametersSchema,
  pyramidFeatureContentParametersSchema,
  sphereFeatureContentParametersSchema,
  torusFeatureContentParametersSchema,
} from "./geometry-worker"

const cases = [
  {
    kind: "sphere",
    schema: sphereFeatureContentParametersSchema,
    parameters: { radius: 20 },
    extent: 20,
  },
  {
    kind: "cone",
    schema: coneFeatureContentParametersSchema,
    parameters: { radius: 20, height: 30, centered: true },
    extent: 20,
  },
  {
    kind: "torus",
    schema: torusFeatureContentParametersSchema,
    parameters: { majorRadius: 20, minorRadius: 5 },
    extent: 25,
  },
  {
    kind: "pyramid",
    schema: pyramidFeatureContentParametersSchema,
    parameters: { sides: 6, radius: 20, height: 30, centered: true },
    extent: 20,
  },
] as const

describe("radial primitive worker content schemas", () => {
  it.each([...cases])(
    "defaults a $kind placement and enforces complete horizontal workspace extents",
    ({ schema, parameters, extent }) => {
      expect(schema.parse(parameters)).toEqual({ ...parameters, origin: [0, 0, 0] })
      expect(schema.safeParse({ ...parameters, origin: [100_000 - extent, 0, 0] }).success).toBe(
        true,
      )
      expect(
        schema.safeParse({ ...parameters, origin: [-100_000 + extent - 1, 0, 0] }).success,
      ).toBe(false)
    },
  )
  it.each([...cases])(
    "rejects unsupported dimensions and malformed placement for $kind",
    ({ kind, schema, parameters }) => {
      const key = kind === "torus" ? "minorRadius" : "radius"
      for (const value of [0, -1, 0.0005, 100_001, Number.NaN, Number.POSITIVE_INFINITY])
        expect(schema.safeParse({ ...parameters, [key]: value }).success).toBe(false)
      for (const origin of [[0, 0], [0, 0, Number.NaN], [100_001, 0, 0], "origin", null])
        expect(schema.safeParse({ ...parameters, origin }).success).toBe(false)
      expect(schema.safeParse({ ...parameters, extra: true }).success).toBe(false)
    },
  )
  it("checks centered cone Z bounds and rejects horn and spindle tori", () => {
    expect(
      coneFeatureContentParametersSchema.safeParse({
        radius: 4,
        height: 20,
        centered: true,
        origin: [0, 0, 99_990],
      }).success,
    ).toBe(true)
    expect(
      coneFeatureContentParametersSchema.safeParse({
        radius: 4,
        height: 20,
        centered: false,
        origin: [0, 0, 99_990],
      }).success,
    ).toBe(false)
    for (const minorRadius of [20, 21])
      expect(
        torusFeatureContentParametersSchema.safeParse({ majorRadius: 20, minorRadius }).success,
      ).toBe(false)
  })
})

it("keeps pyramid sides literal, integral, and bounded", () => {
  const parameters = { sides: 3, radius: 0.001, height: 0.001, centered: false }
  for (const sides of [3, 4, 6, 64])
    expect(pyramidFeatureContentParametersSchema.safeParse({ ...parameters, sides }).success).toBe(
      true,
    )
  for (const sides of [2, 65, 3.5, "6", Number.NaN])
    expect(pyramidFeatureContentParametersSchema.safeParse({ ...parameters, sides }).success).toBe(
      false,
    )
  expect(
    pyramidFeatureContentParametersSchema.safeParse({ ...parameters, origin: [0, 0, 100_000] })
      .success,
  ).toBe(false)
})
