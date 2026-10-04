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
    closedRaw = binding(),
    offset = { ...binding(), wrapped: {} },
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
    PerformByJoin: vi.fn(),
    IsDone: vi.fn(() => true),
    Shape: vi.fn(() => raw),
  }
  const cutter = {
    ...binding(),
    Build: vi.fn(),
    IsDone: vi.fn(() => true),
    Shape: vi.fn(() => closedRaw),
  }
  const explorer = {
    ...binding(),
    More: vi.fn().mockReturnValueOnce(true).mockReturnValueOnce(true).mockReturnValue(false),
    Next: vi.fn(),
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
    BRepAlgoAPI_Cut_3: vi.fn(function Constructor() {
      return cutter
    }),
    TopExp_Explorer_2: vi.fn(function Constructor() {
      return explorer
    }),
    TopAbs_ShapeEnum: { TopAbs_SHELL: {}, TopAbs_SHAPE: {} },
    BRepOffset_Mode: { BRepOffset_Skin: {} },
    GeomAbs_JoinType: { GeomAbs_Intersection: {} },
  }
  const cast = vi.fn(() => result)
  const inspect = vi
    .fn()
    .mockReturnValueOnce({ valid: true, solidCount: 1, volume: 1000 })
    .mockReturnValueOnce({ valid: true, solidCount: 1, volume: 700 })
    .mockReturnValue({ valid: true, solidCount: 1, volume: 300 })
  return {
    source,
    face,
    copied,
    mapped,
    appended,
    raw,
    closedRaw,
    offset,
    cutter,
    explorer,
    inspect,
    result,
    transform,
    copier,
    list,
    progress,
    builder,
    constructors,
    cast,
    operations: createOcctShellOperations(cast as unknown as OcctShapeCaster, inspect),
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
function injectClosedFailure(
  f: ReturnType<typeof fixture>,
  stage: "native-cut" | "incomplete-cut" | "non-nested" | "no-inner-shell",
) {
  const mutations = {
    "native-cut": () =>
      f.cutter.Build.mockImplementation(() => {
        throw new Error("Cut failed")
      }),
    "incomplete-cut": () => f.cutter.IsDone.mockReturnValue(false),
    "non-nested": () =>
      f.inspect
        .mockReset()
        .mockReturnValueOnce({ valid: true, solidCount: 1, volume: 1000 })
        .mockReturnValueOnce({ valid: true, solidCount: 1, volume: 700 })
        .mockReturnValue({ valid: true, solidCount: 1, volume: 1000 }),
    "no-inner-shell": () =>
      f.explorer.More.mockReset().mockReturnValueOnce(true).mockReturnValue(false),
  }
  mutations[stage]()
}
describe("OCCT shell ownership", () => {
  it.each(["inward", "outward"] as const)(
    "forms a nested closed cavity and releases native intermediates for %s",
    (direction) => {
      const f = fixture()
      f.cast.mockReturnValueOnce(f.offset).mockReturnValueOnce(f.result)
      if (direction === "outward")
        f.inspect
          .mockReset()
          .mockReturnValueOnce({ valid: true, solidCount: 1, volume: 1000 })
          .mockReturnValueOnce({ valid: true, solidCount: 1, volume: 1300 })
          .mockReturnValue({ valid: true, solidCount: 1, volume: 300 })
      expect(
        f.operations.shellShape(
          f.constructors as unknown as OpenCascadeInstance,
          f.source as unknown as Shape3D,
          [],
          2,
          direction,
        ),
      ).toBe(f.result)
      expect(f.builder.MakeThickSolidByJoin).not.toHaveBeenCalled()
      expect(f.builder.PerformByJoin).toHaveBeenCalled()
      expect(f.constructors.BRepAlgoAPI_Cut_3).toHaveBeenCalledWith(
        direction === "inward" ? f.copied : f.offset.wrapped,
        direction === "inward" ? f.offset.wrapped : f.copied,
        f.progress,
      )
      for (const temporary of [
        f.face,
        f.transform,
        f.copier,
        f.copied,
        f.list,
        f.progress,
        f.builder,
        f.raw,
        f.offset,
        f.cutter,
        f.closedRaw,
        f.explorer,
      ])
        expect(temporary.delete).toHaveBeenCalledOnce()
      expect(f.source.delete).not.toHaveBeenCalled()
      expect(f.result.delete).not.toHaveBeenCalled()
    },
  )
  it.each(["native-cut", "incomplete-cut", "non-nested", "no-inner-shell"] as const)(
    "releases closed-cavity results after %s failure",
    (stage) => {
      const f = fixture()
      f.cast.mockReturnValueOnce(f.offset).mockReturnValueOnce(f.result)
      injectClosedFailure(f, stage)
      expect(() =>
        f.operations.shellShape(
          f.constructors as unknown as OpenCascadeInstance,
          f.source as unknown as Shape3D,
          [],
          2,
          "inward",
        ),
      ).toThrow()
      for (const temporary of [
        f.face,
        f.transform,
        f.copier,
        f.copied,
        f.list,
        f.progress,
        f.builder,
        f.raw,
        f.offset,
        f.cutter,
      ])
        expect(temporary.delete).toHaveBeenCalledOnce()
      expect(f.source.delete).not.toHaveBeenCalled()
      const disposedResult = Number(new Set(["non-nested", "no-inner-shell"]).has(stage))
      expect(f.result.delete).toHaveBeenCalledTimes(disposedResult)
      expect(f.closedRaw.delete).toHaveBeenCalledTimes(disposedResult)
    },
  )
  it.each([
    { valid: false, solidCount: 1, volume: 700 },
    { valid: true, solidCount: 0, volume: 0 },
    { valid: true, solidCount: 2, volume: 700 },
    { valid: true, solidCount: 1, volume: NaN },
    { valid: true, solidCount: 1, volume: 1200 },
  ])("rejects collapsed or reversed closed offsets %j", (metrics) => {
    const f = fixture()
    f.cast.mockReturnValueOnce(f.offset)
    f.inspect
      .mockReset()
      .mockReturnValueOnce({ valid: true, solidCount: 1, volume: 1000 })
      .mockReturnValueOnce(metrics)
    expect(() =>
      f.operations.shellShape(
        f.constructors as unknown as OpenCascadeInstance,
        f.source as unknown as Shape3D,
        [],
        2,
        "inward",
      ),
    ).toThrow(/collapses/)
    expect(f.offset.delete).toHaveBeenCalledOnce()
    expect(f.constructors.BRepAlgoAPI_Cut_3).not.toHaveBeenCalled()
    expect(f.source.delete).not.toHaveBeenCalled()
  })
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
