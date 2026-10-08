import { describe, expect, it } from "bun:test"
import type { Shape3D } from "replicad"
import type { OpenCascadeInstance } from "replicad-opencascadejs"
import { vi } from "../../../tests/unit/support/bun-test"
import type { OcctShapeCaster } from "./occt-cast"
import { createOcctPlacementOperations } from "./occt-placement"

function fixture() {
  const source = { wrapped: { delete: vi.fn() }, delete: vi.fn() }
  const transform = { SetValues: vi.fn(), delete: vi.fn() }
  const rawShape = { delete: vi.fn() }
  const result = { wrapped: { delete: vi.fn() }, delete: vi.fn() }
  const builder = { IsDone: vi.fn(() => true), Shape: vi.fn(() => rawShape), delete: vi.fn() }
  const transformConstructor = vi.fn(function Constructor() {
    return transform
  })
  const builderConstructor = vi.fn(function Constructor() {
    return builder
  })
  const castShape = vi.fn(() => result)
  const occt = {
    gp_Trsf_1: transformConstructor,
    BRepBuilderAPI_Transform_2: builderConstructor,
  } as unknown as OpenCascadeInstance
  const operations = createOcctPlacementOperations(castShape as unknown as OcctShapeCaster)
  return {
    source,
    transform,
    rawShape,
    result,
    builder,
    builderConstructor,
    transformConstructor,
    castShape,
    occt,
    operations,
  }
}
const placement = {
  translation: [10, -20, 30] as [number, number, number],
  rotation: [Math.PI / 2, Math.PI / 2, 0] as [number, number, number],
}

describe("owned rigid OCCT placement", () => {
  it("applies world Rx then Ry then Rz followed by translation using the pinned copy constructor", () => {
    const f = fixture()
    expect(
      f.operations.placeShape(f.occt, f.source as unknown as Shape3D, placement),
    ).toBe<unknown>(f.result)
    const coefficients = f.transform.SetValues.mock.calls[0]
    expect(coefficients).toHaveLength(12)
    const expected = [0, 1, 0, 10, 0, 0, -1, -20, -1, 0, 0, 30]
    for (const [index, value] of expected.entries()) {
      expect(coefficients?.[index]).toBeCloseTo(value, 12)
    }
    expect(f.builderConstructor).toHaveBeenCalledWith(f.source.wrapped, f.transform, true)
    expect(f.transform.delete).toHaveBeenCalledTimes(1)
    expect(f.builder.delete).toHaveBeenCalledTimes(1)
    expect(f.rawShape.delete).toHaveBeenCalledTimes(1)
    expect(f.source.delete).not.toHaveBeenCalled()
    expect(f.source.wrapped.delete).not.toHaveBeenCalled()
    expect(f.result.delete).not.toHaveBeenCalled()
  })
  it.each(["set-values", "builder", "incomplete", "shape", "cast"])(
    "releases all acquired temporary bindings after %s failure",
    (stage) => {
      const f = fixture()
      const fail = () => {
        throw new Error("Fixture failure")
      }
      if (stage === "set-values") f.transform.SetValues.mockImplementation(fail)
      if (stage === "builder") f.builderConstructor.mockImplementation(fail)
      if (stage === "incomplete") f.builder.IsDone.mockReturnValue(false)
      if (stage === "shape") f.builder.Shape.mockImplementation(fail)
      if (stage === "cast") f.castShape.mockImplementation(fail)
      expect(() =>
        f.operations.placeShape(f.occt, f.source as unknown as Shape3D, placement),
      ).toThrow()
      expect(f.transform.delete).toHaveBeenCalledTimes(1)
      expect(f.builder.delete).toHaveBeenCalledTimes(
        stage === "set-values" || stage === "builder" ? 0 : 1,
      )
      expect(f.rawShape.delete).toHaveBeenCalledTimes(stage === "cast" ? 1 : 0)
      expect(f.source.delete).not.toHaveBeenCalled()
      expect(f.source.wrapped.delete).not.toHaveBeenCalled()
    },
  )
  it("rejects a malformed placement before allocating native objects", () => {
    const f = fixture()
    expect(() =>
      f.operations.placeShape(f.occt, f.source as unknown as Shape3D, {
        ...placement,
        rotation: [0, Infinity, 0],
      }),
    ).toThrow()
    expect(f.transformConstructor).not.toHaveBeenCalled()
    expect(f.builderConstructor).not.toHaveBeenCalled()
  })
})
