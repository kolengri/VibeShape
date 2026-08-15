import { describe, expect, it } from "vitest"
import {
  angleQuantitySchema,
  angleToRadians,
  createAngleQuantity,
  createLengthQuantity,
  createScalarQuantity,
  lengthQuantitySchema,
  lengthToMillimeters,
  millimetersToLength,
  quantitySchema,
  radiansToAngle,
  scalarQuantitySchema,
  squareMillimetersToArea,
} from "./units"

describe("canonical quantities", () => {
  it.each([
    [1, "um", 0.001],
    [1, "mm", 1],
    [1, "cm", 10],
    [1, "m", 1_000],
    [1, "in", 25.4],
    [1, "ft", 304.8],
  ] as const)("normalizes %s %s to millimeters", (value, unit, expected) => {
    expect(lengthToMillimeters(value, unit)).toBe(expected)
    expect(createLengthQuantity(value, unit)).toEqual({
      schemaVersion: 0,
      dimension: "length",
      value: expected,
      unit: "mm",
      source: { value, unit, expression: null },
    })
  })

  it("normalizes degrees to radians while retaining normalized input metadata", () => {
    const quantity = createAngleQuantity(90, "deg", "90 deg")

    expect(quantity.value).toBe(angleToRadians(90, "deg"))
    expect(quantity.value).toBeCloseTo(Math.PI / 2)
    expect(quantity.source).toEqual({ value: 90, unit: "deg", expression: "90 deg" })
  })

  it.each([
    ["um", 0.001],
    ["mm", 1],
    ["cm", 10],
    ["m", 1_000],
    ["in", 25.4],
    ["ft", 304.8],
  ] as const)("converts canonical length and area into %s", (unit, millimeters) => {
    expect(millimetersToLength(millimeters, unit)).toBe(1)
    expect(squareMillimetersToArea(millimeters * millimeters, unit)).toBe(1)
  })

  it.each([
    ["deg", Math.PI, 180],
    ["rad", Math.PI, Math.PI],
  ] as const)("converts canonical angles into %s", (unit, radians, expected) => {
    expect(radiansToAngle(radians, unit)).toBe(expected)
  })

  it("normalizes negative zero for stable serialization", () => {
    expect(createLengthQuantity(-0)).toMatchObject({ value: 0, source: { value: 0 } })
    expect(createAngleQuantity(-0)).toMatchObject({ value: 0, source: { value: 0 } })
    expect(createScalarQuantity(-0)).toMatchObject({ value: 0, source: { value: 0 } })
    const parsed = lengthQuantitySchema.parse({
      schemaVersion: 0,
      dimension: "length",
      value: -0,
      unit: "mm",
      source: { value: -0, unit: "mm", expression: null },
    })
    expect(Object.is(parsed.value, -0)).toBe(false)
    expect(Object.is(parsed.source.value, -0)).toBe(false)
  })

  it("rejects canonical values that disagree with their retained source", () => {
    expect(
      lengthQuantitySchema.safeParse({
        schemaVersion: 0,
        dimension: "length",
        value: 25,
        unit: "mm",
        source: { value: 1, unit: "in", expression: null },
      }).success,
    ).toBe(false)
    expect(
      angleQuantitySchema.safeParse({
        schemaVersion: 0,
        dimension: "angle",
        value: 90,
        unit: "rad",
        source: { value: 90, unit: "deg", expression: null },
      }).success,
    ).toBe(false)
    expect(
      scalarQuantitySchema.safeParse({
        schemaVersion: 0,
        dimension: "scalar",
        value: 2,
        unit: "1",
        source: { value: 1, unit: "1", expression: null },
      }).success,
    ).toBe(false)
  })

  it("rejects non-finite values, unknown units, unnormalized expressions, and fields", () => {
    const valid = createLengthQuantity(10)

    expect(quantitySchema.safeParse({ ...valid, value: Number.POSITIVE_INFINITY }).success).toBe(
      false,
    )
    expect(
      quantitySchema.safeParse({ ...valid, source: { ...valid.source, unit: "px" } }).success,
    ).toBe(false)
    expect(
      quantitySchema.safeParse({
        ...valid,
        source: { ...valid.source, expression: " 10 mm " },
      }).success,
    ).toBe(false)
    expect(quantitySchema.safeParse({ ...valid, locale: "en" }).success).toBe(false)
  })

  it("round-trips canonical quantity JSON without changing identity", () => {
    const quantity = createLengthQuantity(2.5, "in", "2.5 in")

    expect(quantitySchema.parse(JSON.parse(JSON.stringify(quantity)))).toEqual(quantity)
  })
})
