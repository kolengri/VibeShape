import type { Face, Shape3D, Wire } from "replicad"
import type { OpenCascadeInstance } from "replicad-opencascadejs"
import { describe, expect, it, vi } from "vitest"
import type { OcctShapeCaster } from "./occt-cast"
import { type AnalyticalProfile, createOcctLoftOperations } from "./occt-loft"

const id = (value: number) => `018f0000-0000-7000-8000-${String(value).padStart(12, "0")}`
const section = (z: number): AnalyticalProfile => ({
  frame: { origin: [0, 0, z], xAxis: [1, 0, 0], yAxis: [0, 1, 0], normal: [0, 0, 1] },
  outer: {
    sourceEntityIds: [id(1)],
    segments: [{ type: "circle", entityId: id(1) as never, center: [0, 0], radius: 2 }],
  },
  holes: [],
})

function fixture() {
  const wires = [
    { wrapped: {}, delete: vi.fn() },
    { wrapped: {}, delete: vi.fn() },
  ] as const
  const faces = [{ delete: vi.fn() }, { delete: vi.fn() }] as const
  const progress = { delete: vi.fn() }
  const raw = { delete: vi.fn() }
  const result = { delete: vi.fn() }
  const builder = {
    CheckCompatibility: vi.fn(),
    AddWire: vi.fn(),
    Build: vi.fn(),
    IsDone: vi.fn(() => true),
    Shape: vi.fn(() => raw),
    delete: vi.fn(),
  }
  const constructors = {
    BRepOffsetAPI_ThruSections: vi.fn(function Constructor() {
      return builder
    }),
    Message_ProgressRange_1: vi.fn(function Constructor() {
      return progress
    }),
  }
  const makeWire = vi.fn().mockReturnValueOnce(wires[0]).mockReturnValueOnce(wires[1])
  const makeFace = vi.fn().mockReturnValueOnce(faces[0]).mockReturnValueOnce(faces[1])
  const cast = vi.fn(() => result)
  const validate = vi.fn()
  const operations = createOcctLoftOperations(
    cast as unknown as OcctShapeCaster,
    makeWire as unknown as () => Wire,
    validate,
    makeFace as unknown as () => Face,
  )
  const run = () =>
    operations.loftShape(
      constructors as unknown as OpenCascadeInstance,
      [section(0), section(10)],
      { ruled: false },
    )
  return {
    wires,
    faces,
    progress,
    raw,
    result,
    builder,
    constructors,
    cast,
    validate,
    makeWire,
    makeFace,
    run,
  }
}

describe("owned exact OCCT Loft", () => {
  it("rejects more than twenty-four sections before allocating native bindings", () => {
    const f = fixture()
    const operations = createOcctLoftOperations(f.cast as unknown as OcctShapeCaster)
    expect(() =>
      operations.loftShape(
        f.constructors as unknown as OpenCascadeInstance,
        Array.from({ length: 25 }, (_, index) => section(index)),
        { ruled: false },
      ),
    ).toThrow("two to twenty-four")
    expect(f.constructors.BRepOffsetAPI_ThruSections).not.toHaveBeenCalled()
    expect(f.constructors.Message_ProgressRange_1).not.toHaveBeenCalled()
  })
  it("adds ordered fresh sections and releases every temporary while transferring one result", () => {
    const f = fixture()
    expect(f.run()).toBe(f.result as unknown as Shape3D)
    expect(f.constructors.BRepOffsetAPI_ThruSections).toHaveBeenCalledWith(true, false, 1e-6)
    expect(f.builder.CheckCompatibility).toHaveBeenCalledWith(true)
    expect(f.builder.AddWire.mock.calls).toEqual(f.wires.map((wire) => [wire.wrapped]))
    for (const temporary of [...f.wires, ...f.faces, f.progress, f.builder, f.raw])
      expect(temporary.delete).toHaveBeenCalledOnce()
    expect(f.result.delete).not.toHaveBeenCalled()
  })
  it.each([
    "compatibility",
    "add",
    "progress",
    "build",
    "incomplete",
    "shape",
    "cast",
    "validation",
  ])("releases acquired bindings after %s failure", (stage) => {
    const f = fixture()
    function fail(): never {
      throw new Error(`Native Loft ${stage} fixture failure`)
    }
    const failAt: Record<string, () => void> = {
      compatibility: () => f.builder.CheckCompatibility.mockImplementation(fail),
      add: () => f.builder.AddWire.mockImplementation(fail),
      progress: () => f.constructors.Message_ProgressRange_1.mockImplementation(fail),
      build: () => f.builder.Build.mockImplementation(fail),
      incomplete: () => f.builder.IsDone.mockReturnValue(false),
      shape: () => f.builder.Shape.mockImplementation(fail),
      cast: () => f.cast.mockImplementation(fail),
      validation: () => f.validate.mockImplementation(fail),
    }
    failAt[stage]?.()
    expect(f.run).toThrow(
      stage === "incomplete"
        ? "OCCT Loft did not complete."
        : `Native Loft ${stage} fixture failure`,
    )
    for (const temporary of [...f.wires, ...f.faces, f.builder])
      expect(temporary.delete).toHaveBeenCalledOnce()
    expect(f.progress.delete).toHaveBeenCalledTimes(
      ["compatibility", "add", "progress"].includes(stage) ? 0 : 1,
    )
    expect(f.raw.delete).toHaveBeenCalledTimes(["cast", "validation"].includes(stage) ? 1 : 0)
    expect(f.result.delete).toHaveBeenCalledTimes(stage === "validation" ? 1 : 0)
  })
  it("rejects zero separation and unsupported holes before native allocation", () => {
    const f = fixture()
    const operations = createOcctLoftOperations(f.cast as unknown as OcctShapeCaster)
    expect(() =>
      operations.loftShape(
        f.constructors as unknown as OpenCascadeInstance,
        [section(0), section(0)],
        { ruled: true },
      ),
    ).toThrow("same plane")
    expect(() =>
      operations.loftShape(
        f.constructors as unknown as OpenCascadeInstance,
        [
          section(0),
          {
            ...section(10),
            holes: [
              {
                sourceEntityIds: [id(2)],
                segments: [{ type: "circle", entityId: id(2) as never, center: [0, 0], radius: 1 }],
              },
            ],
          },
        ],
        { ruled: true },
      ),
    ).toThrow("hole-free")
    expect(f.constructors.BRepOffsetAPI_ThruSections).not.toHaveBeenCalled()
  })
  it.each(["second-face", "second-wire", "builder"])(
    "releases earlier analytical inputs after %s failure",
    (stage) => {
      const f = fixture()
      function fail(): never {
        throw new Error(`Loft ${stage} fixture failure`)
      }
      if (stage === "second-face")
        f.makeFace.mockReset().mockReturnValueOnce(f.faces[0]).mockImplementationOnce(fail)
      if (stage === "second-wire")
        f.makeWire.mockReset().mockReturnValueOnce(f.wires[0]).mockImplementationOnce(fail)
      if (stage === "builder") f.constructors.BRepOffsetAPI_ThruSections.mockImplementation(fail)
      expect(f.run).toThrow(`Loft ${stage} fixture failure`)
      expect(f.wires[0].delete).toHaveBeenCalledOnce()
      expect(f.wires[1].delete).toHaveBeenCalledTimes(stage === "builder" ? 1 : 0)
      expect(f.faces[0].delete).toHaveBeenCalledOnce()
      expect(f.faces[1].delete).toHaveBeenCalledTimes(stage === "second-face" ? 0 : 1)
      expect(f.builder.delete).not.toHaveBeenCalled()
    },
  )
})
