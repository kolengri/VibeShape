import type { Shape3D } from "replicad"
import type { OpenCascadeInstance } from "replicad-opencascadejs"
import { describe, expect, it, vi } from "vitest"
import type { OcctShapeCaster } from "./occt-cast"
import { createOcctShellOperations } from "./occt-shell"

function fixture() {
  const binding = () => ({ delete: vi.fn() })
  const face = { ...binding(), hashCode: 7, wrapped: {} }
  const source = { ...binding(), wrapped: {}, faces: [face] }
  const copied = binding(),
    mapped = { ...binding(), IsNull: vi.fn(() => false) },
    appended = binding(),
    raw = binding(),
    result = binding()
  const transform = binding()
  const copier = {
    ...binding(),
    IsDone: vi.fn(() => true),
    Shape: vi.fn(() => copied),
    ModifiedShape: vi.fn(() => mapped),
  }
  const list = { ...binding(), Append_1: vi.fn(() => appended) }
  const progress = binding()
  const builder = {
    ...binding(),
    MakeThickSolidByJoin: vi.fn(),
    IsDone: vi.fn(() => true),
    Shape: vi.fn(() => raw),
  }
  const constructors = {
    gp_Trsf_1: vi.fn(function Constructor() {
      return transform
    }),
    BRepBuilderAPI_Transform_2: vi.fn(function Constructor() {
      return copier
    }),
    TopTools_ListOfShape_1: vi.fn(function Constructor() {
      return list
    }),
    Message_ProgressRange_1: vi.fn(function Constructor() {
      return progress
    }),
    BRepOffsetAPI_MakeThickSolid: vi.fn(function Constructor() {
      return builder
    }),
    BRepOffset_Mode: { BRepOffset_Skin: {} },
    GeomAbs_JoinType: { GeomAbs_Intersection: {} },
  }
  const cast = vi.fn(() => result)
  return {
    source,
    face,
    copied,
    mapped,
    appended,
    raw,
    result,
    transform,
    copier,
    list,
    progress,
    builder,
    constructors,
    cast,
    operations: createOcctShellOperations(cast as unknown as OcctShapeCaster),
  }
}
function run(f: ReturnType<typeof fixture>, direction: "inward" | "outward" = "inward") {
  return f.operations.shellShape(
    f.constructors as unknown as OpenCascadeInstance,
    f.source as unknown as Shape3D,
    [7],
    2,
    direction,
  )
}
describe("OCCT shell ownership", () => {
  it.each(["inward", "outward"] as const)(
    "deep-copies the source, maps selected faces and releases every wrapper for %s",
    (direction) => {
      const f = fixture()
      expect(run(f, direction)).toBe(f.result)
      expect(f.constructors.BRepBuilderAPI_Transform_2).toHaveBeenCalledWith(
        f.source.wrapped,
        f.transform,
        true,
      )
      expect(f.copier.ModifiedShape).toHaveBeenCalledWith(f.face.wrapped)
      expect(f.list.Append_1).toHaveBeenCalledWith(f.mapped)
      expect(f.builder.MakeThickSolidByJoin).toHaveBeenCalledWith(
        f.copied,
        f.list,
        direction === "inward" ? -2 : 2,
        1e-7,
        f.constructors.BRepOffset_Mode.BRepOffset_Skin,
        false,
        false,
        f.constructors.GeomAbs_JoinType.GeomAbs_Intersection,
        false,
        f.progress,
      )
      for (const temporary of [
        f.face,
        f.transform,
        f.copier,
        f.copied,
        f.list,
        f.mapped,
        f.appended,
        f.progress,
        f.builder,
        f.raw,
      ])
        expect(temporary.delete).toHaveBeenCalledOnce()
      expect(f.source.delete).not.toHaveBeenCalled()
      expect(f.result.delete).not.toHaveBeenCalled()
    },
  )
  it.each(["mapping", "native-build", "incomplete", "cast"] as const)(
    "releases acquired native wrappers after %s failure",
    (stage) => {
      const f = fixture()
      const fail = () => {
        throw new Error("Native shell failure")
      }
      const mutations = {
        mapping: () => f.copier.ModifiedShape.mockImplementation(fail),
        "native-build": () => f.builder.MakeThickSolidByJoin.mockImplementation(fail),
        incomplete: () => f.builder.IsDone.mockReturnValue(false),
        cast: () => f.cast.mockImplementation(fail),
      }
      mutations[stage]()
      expect(() => run(f)).toThrow()
      for (const temporary of [f.face, f.transform, f.copier, f.copied, f.list])
        expect(temporary.delete).toHaveBeenCalledOnce()
      expect(f.source.delete).not.toHaveBeenCalled()
      if (stage !== "mapping")
        for (const temporary of [f.mapped, f.appended, f.progress, f.builder])
          expect(temporary.delete).toHaveBeenCalledOnce()
      expect(f.raw.delete).toHaveBeenCalledTimes(stage === "cast" ? 1 : 0)
    },
  )
})
