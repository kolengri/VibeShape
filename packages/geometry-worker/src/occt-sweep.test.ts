import type { Face, Wire } from "replicad"
import type { OpenCascadeInstance } from "replicad-opencascadejs"
import { describe, expect, it, vi } from "vitest"
import type { OcctShapeCaster } from "./occt-cast"
import type { AnalyticalProfile } from "./occt-loft"
import { type AnalyticalSweepPath, createOcctSweepOperations } from "./occt-sweep"

const id = (value: number) => `018f0000-0000-7000-8000-${String(value).padStart(12, "0")}`
const line = (value: number, start: [number, number], end: [number, number]) => ({
  type: "line" as const,
  entityId: id(value) as never,
  startPointId: id(value + 10) as never,
  endPointId: id(value + 11) as never,
  start,
  end,
})
const profile: AnalyticalProfile = {
  frame: { origin: [0, 0, 0], xAxis: [1, 0, 0], yAxis: [0, 0, -1], normal: [0, 1, 0] },
  outer: {
    sourceEntityIds: [id(1)],
    segments: [{ type: "circle", entityId: id(1) as never, center: [0, 0], radius: 2 }],
  },
  holes: [],
}
const path: AnalyticalSweepPath = {
  frame: { origin: [0, 0, 0], xAxis: [1, 0, 0], yAxis: [0, 1, 0], normal: [0, 0, 1] },
  sourceEntityIds: [id(2)],
  segments: [line(2, [0, 0], [0, 10])],
}

function fixture() {
  const spine = { wrapped: {}, delete: vi.fn() }
  const face = { wrapped: {}, delete: vi.fn() }
  const progress = { delete: vi.fn() }
  const raw = { delete: vi.fn() }
  const result = { delete: vi.fn() }
  const builder = {
    Build: vi.fn(),
    IsDone: vi.fn(() => true),
    Shape: vi.fn(() => raw),
    delete: vi.fn(),
  }
  const constructors = {
    BRepOffsetAPI_MakePipe_1: vi.fn(function Constructor() {
      return builder
    }),
    Message_ProgressRange_1: vi.fn(function Constructor() {
      return progress
    }),
  }
  const makeWire = vi.fn(() => spine as unknown as Wire)
  const makeFace = vi.fn(
    (_opencascade: OpenCascadeInstance, _profile: AnalyticalProfile) => face as unknown as Face,
  )
  const cast = vi.fn(() => result)
  const validate = vi.fn()
  const operations = createOcctSweepOperations(
    cast as unknown as OcctShapeCaster,
    makeWire,
    makeFace,
    validate,
  )
  const run = (replacement: AnalyticalSweepPath = path, selectedProfile = profile) =>
    operations.sweepShape(constructors as unknown as OpenCascadeInstance, {
      profile: selectedProfile,
      path: replacement,
    })
  return {
    spine,
    face,
    progress,
    raw,
    result,
    builder,
    constructors,
    makeWire,
    makeFace,
    cast,
    validate,
    run,
  }
}

describe("owned exact OCCT Sweep", () => {
  it("uses a fresh spine and holed profile face without repositioning authored geometry", () => {
    const f = fixture()
    const holed = {
      ...profile,
      holes: [
        {
          sourceEntityIds: [id(3)],
          segments: [
            {
              type: "circle" as const,
              entityId: id(3) as never,
              center: [0, 0] as [number, number],
              radius: 1,
            },
          ],
        },
      ],
    }
    expect(f.run(path, holed)).toBe(f.result)
    expect(f.constructors.BRepOffsetAPI_MakePipe_1).toHaveBeenCalledWith(
      f.spine.wrapped,
      f.face.wrapped,
    )
    expect(f.makeFace.mock.calls[0]?.[1]).toEqual(holed)
    for (const temporary of [f.spine, f.face, f.progress, f.builder, f.raw])
      expect(temporary.delete).toHaveBeenCalledOnce()
    expect(f.result.delete).not.toHaveBeenCalled()
  })
  it.each(["face", "builder", "progress", "build", "incomplete", "shape", "cast", "validation"])(
    "releases acquired bindings after %s failure",
    (stage) => {
      const f = fixture()
      function fail(): never {
        throw new Error(`Native Sweep ${stage} fixture failure`)
      }
      const failAt: Record<string, () => void> = {
        face: () => f.makeFace.mockImplementation(fail),
        builder: () => f.constructors.BRepOffsetAPI_MakePipe_1.mockImplementation(fail),
        progress: () => f.constructors.Message_ProgressRange_1.mockImplementation(fail),
        build: () => f.builder.Build.mockImplementation(fail),
        incomplete: () => f.builder.IsDone.mockReturnValue(false),
        shape: () => f.builder.Shape.mockImplementation(fail),
        cast: () => f.cast.mockImplementation(fail),
        validation: () => f.validate.mockImplementation(fail),
      }
      failAt[stage]?.()
      expect(() => f.run()).toThrow(
        stage === "incomplete"
          ? "OCCT Sweep did not complete."
          : `Native Sweep ${stage} fixture failure`,
      )
      expect(f.spine.delete).toHaveBeenCalledOnce()
      expect(f.face.delete).toHaveBeenCalledTimes(stage === "face" ? 0 : 1)
      expect(f.builder.delete).toHaveBeenCalledTimes(["face", "builder"].includes(stage) ? 0 : 1)
      expect(f.progress.delete).toHaveBeenCalledTimes(
        ["face", "builder", "progress"].includes(stage) ? 0 : 1,
      )
      expect(f.raw.delete).toHaveBeenCalledTimes(["cast", "validation"].includes(stage) ? 1 : 0)
      expect(f.result.delete).toHaveBeenCalledTimes(stage === "validation" ? 1 : 0)
    },
  )
  it.each([
    ["disconnected", [line(2, [0, 0], [0, 5]), line(3, [0, 6], [0, 10])]],
    ["corner", [line(2, [0, 0], [0, 5]), line(3, [0, 5], [5, 5])]],
    ["closed", [line(2, [0, 0], [0, 5]), line(3, [0, 5], [0, 0])]],
    ["degenerate", [line(2, [0, 0], [0, 0])]],
    ["branch", [line(2, [0, 0], [0, 5]), line(3, [0, 5], [0, 10]), line(4, [0, 5], [5, 5])]],
    ["duplicate", [line(2, [0, 0], [0, 5]), line(2, [0, 5], [0, 10])]],
  ] as const)("rejects %s paths before native allocation", (_name, segments) => {
    const f = fixture()
    expect(() =>
      f.run({
        ...path,
        sourceEntityIds: [...new Set(segments.map(({ entityId }) => entityId))].sort(),
        segments,
      }),
    ).toThrow()
    expect(f.makeWire).not.toHaveBeenCalled()
  })
  it("rejects profile offsets and oblique alignment before native allocation", () => {
    const f = fixture()
    for (const frame of [{ ...profile.frame, origin: [0, 1, 0] }, path.frame])
      expect(() => f.run(path, { ...profile, frame: frame as AnalyticalProfile["frame"] })).toThrow(
        "profile plane",
      )
    expect(f.makeWire).not.toHaveBeenCalled()
  })
})
