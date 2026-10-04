import { describe, expect, it } from "vitest"
import { featureIdSchema } from "./identifiers"
import {
  referenceAxisSchema,
  referenceFrameDependencyIds,
  referencePlaneSchema,
} from "./reference-frame"

describe("reference frames", () => {
  it("requires finite bounded origins and unit directions", () => {
    expect(
      referenceAxisSchema.safeParse({
        kind: "explicit-axis",
        origin: [0, 0, 0],
        direction: [0, 0, 2],
      }).success,
    ).toBe(false)
    expect(
      referencePlaneSchema.safeParse({
        kind: "explicit-plane",
        origin: [100_001, 0, 0],
        normal: [0, 0, 1],
      }).success,
    ).toBe(false)
    expect(
      referenceAxisSchema.parse({
        kind: "explicit-axis",
        origin: [5, 2, 0],
        direction: [0.6, 0.8, 0],
      }),
    ).toMatchObject({ direction: [0.6, 0.8, 0] })
  })
  it("deduplicates target and support owners without reordering", () => {
    const target = featureIdSchema.parse("0195b5ac-b220-7a2c-8c33-000000003301")
    const datum = featureIdSchema.parse("0195b5ac-b220-7a2c-8c33-000000003302")
    expect(
      referenceFrameDependencyIds(target, { kind: "datum-axis", featureId: datum, axis: "normal" }),
    ).toEqual([target, datum])
    expect(referenceFrameDependencyIds(target, { kind: "datum-plane", featureId: target })).toEqual(
      [target],
    )
  })
})
