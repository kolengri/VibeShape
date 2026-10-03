import type { Shape3D } from "replicad"
import type { OpenCascadeInstance } from "replicad-opencascadejs"
import { describe, expect, it, vi } from "vitest"
import type { OcctShapeCaster } from "./occt-cast"
import { createOcctMirrorOperations } from "./occt-mirror"

function fixture() {
  const source = { wrapped: { delete: vi.fn() }, delete: vi.fn() }
  const origin = { delete: vi.fn() }
  const direction = { delete: vi.fn() }
  const axis = { delete: vi.fn() }
  const transform = { SetMirror_3: vi.fn(), delete: vi.fn() }
  const raw = { delete: vi.fn() }
  const result = { delete: vi.fn() }
  const builder = { IsDone: vi.fn(() => true), Shape: vi.fn(() => raw), delete: vi.fn() }
  const constructors = {
    gp_Pnt_3: vi.fn(function Constructor() {
      return origin
    }),
    gp_Dir_4: vi.fn(function Constructor() {
      return direction
    }),
    gp_Ax2_3: vi.fn(function Constructor() {
      return axis
    }),
    gp_Trsf_1: vi.fn(function Constructor() {
      return transform
    }),
    BRepBuilderAPI_Transform_2: vi.fn(function Constructor() {
      return builder
    }),
  }
  const cast = vi.fn(() => result)
  const operations = createOcctMirrorOperations(cast as unknown as OcctShapeCaster)
  return {
    source,
    origin,
    direction,
    axis,
    transform,
    raw,
    result,
    builder,
    constructors,
    cast,
    operations,
  }
}
describe("owned exact OCCT reflection", () => {
  it.each([
    ["XY", [0, 0, 1]],
    ["XZ", [0, 1, 0]],
    ["YZ", [1, 0, 0]],
  ] as const)(
    "copies the source across %s and releases all temporary bindings",
    (plane, normal) => {
      const f = fixture()
      expect(
        f.operations.mirrorShape(
          f.constructors as unknown as OpenCascadeInstance,
          f.source as unknown as Shape3D,
          { plane },
        ),
      ).toBe(f.result)
      expect(f.constructors.gp_Pnt_3).toHaveBeenCalledWith(0, 0, 0)
      expect(f.constructors.gp_Dir_4).toHaveBeenCalledWith(...normal)
      expect(f.constructors.gp_Ax2_3).toHaveBeenCalledWith(f.origin, f.direction)
      expect(f.transform.SetMirror_3).toHaveBeenCalledWith(f.axis)
      expect(f.constructors.BRepBuilderAPI_Transform_2).toHaveBeenCalledWith(
        f.source.wrapped,
        f.transform,
        true,
      )
      for (const temporary of [f.origin, f.direction, f.axis, f.transform, f.builder, f.raw])
        expect(temporary.delete).toHaveBeenCalledOnce()
      expect(f.source.delete).not.toHaveBeenCalled()
      expect(f.source.wrapped.delete).not.toHaveBeenCalled()
      expect(f.result.delete).not.toHaveBeenCalled()
    },
  )
  it.each([
    "direction",
    "axis",
    "transform",
    "set-mirror",
    "builder",
    "incomplete",
    "shape",
    "cast",
  ])("releases every acquired wrapper after %s failure", (stage) => {
    const f = fixture()
    const fail = () => {
      throw new Error("Native mirror fixture failure")
    }
    const failureStages: Record<string, () => void> = {
      direction: () => f.constructors.gp_Dir_4.mockImplementation(fail),
      axis: () => f.constructors.gp_Ax2_3.mockImplementation(fail),
      transform: () => f.constructors.gp_Trsf_1.mockImplementation(fail),
      "set-mirror": () => f.transform.SetMirror_3.mockImplementation(fail),
      builder: () => f.constructors.BRepBuilderAPI_Transform_2.mockImplementation(fail),
      incomplete: () => f.builder.IsDone.mockReturnValue(false),
      shape: () => f.builder.Shape.mockImplementation(fail),
      cast: () => f.cast.mockImplementation(fail),
    }
    failureStages[stage]?.()
    expect(() =>
      f.operations.mirrorShape(
        f.constructors as unknown as OpenCascadeInstance,
        f.source as unknown as Shape3D,
        { plane: "XY" },
      ),
    ).toThrow()
    const stages = [
      "direction",
      "axis",
      "transform",
      "set-mirror",
      "builder",
      "incomplete",
      "shape",
      "cast",
    ]
    const index = stages.indexOf(stage)
    for (const [temporary, acquired] of [
      [f.origin, true],
      [f.direction, index > 0],
      [f.axis, index > 1],
      [f.transform, index > 2],
      [f.builder, index > 4],
      [f.raw, stage === "cast"],
    ] as const)
      expect(temporary.delete).toHaveBeenCalledTimes(acquired ? 1 : 0)
    expect(f.source.delete).not.toHaveBeenCalled()
    expect(f.source.wrapped.delete).not.toHaveBeenCalled()
  })
  it("rejects unsupported parameters before allocating native objects", () => {
    const f = fixture()
    expect(() =>
      f.operations.mirrorShape(
        f.constructors as unknown as OpenCascadeInstance,
        f.source as unknown as Shape3D,
        { plane: "custom" } as never,
      ),
    ).toThrow()
    expect(f.constructors.gp_Pnt_3).not.toHaveBeenCalled()
  })
})
