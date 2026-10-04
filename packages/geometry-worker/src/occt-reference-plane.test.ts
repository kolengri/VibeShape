// @vitest-environment node
import { type Shape3D, setOC } from "replicad"
import initializeOpenCascade, { type OpenCascadeInstance } from "replicad-opencascadejs"
import { beforeAll, describe, expect, it, vi } from "vitest"
import { inspectOcctBody } from "./occt-body-validation"
import { mirrorOcctShape } from "./occt-mirror"
import {
  createOcctReferencePlaneSplitOperations,
  splitOcctShapeByReferencePlane,
} from "./occt-reference-plane"
import { createOcctBox } from "./occt-shapes"

const parameters = {
  planeOrigin: [0, 0, 0] as [number, number, number],
  planeNormal: [0.6, 0.8, 0] as [number, number, number],
  offset: 0,
}
function ownershipFixture() {
  const shape = () => ({ delete: vi.fn() }) as unknown as Shape3D
  const source = shape(),
    local = shape(),
    negative = shape(),
    positive = shape(),
    a = shape(),
    b = shape()
  const transform = vi.fn().mockReturnValueOnce(local).mockReturnValueOnce(a).mockReturnValueOnce(b)
  const split = vi.fn(() => ({ negative, positive }))
  return {
    source,
    local,
    negative,
    positive,
    a,
    b,
    transform,
    split,
    operations: createOcctReferencePlaneSplitOperations({ transform, split }),
  }
}
describe("reference-plane split ownership", () => {
  it("releases every temporary and preserves source and successful outputs", () => {
    const f = ownershipFixture()
    expect(f.operations.splitShape({} as OpenCascadeInstance, f.source, parameters)).toEqual({
      negative: f.a,
      positive: f.b,
    })
    for (const temporary of [f.local, f.negative, f.positive])
      expect(temporary.delete).toHaveBeenCalledOnce()
    for (const output of [f.source, f.a, f.b]) expect(output.delete).not.toHaveBeenCalled()
  })
  it("releases the first world output when the second transform fails", () => {
    const f = ownershipFixture()
    f.transform
      .mockReset()
      .mockReturnValueOnce(f.local)
      .mockReturnValueOnce(f.a)
      .mockImplementationOnce(() => {
        throw new Error("Transform failed")
      })
    expect(() => f.operations.splitShape({} as OpenCascadeInstance, f.source, parameters)).toThrow(
      "Transform failed",
    )
    for (const temporary of [f.local, f.negative, f.positive, f.a])
      expect(temporary.delete).toHaveBeenCalledOnce()
    expect(f.source.delete).not.toHaveBeenCalled()
  })
  it("releases outputs and exposes failed temporary cleanup", () => {
    const f = ownershipFixture()
    vi.mocked(f.local.delete).mockImplementationOnce(() => {
      throw new Error("Cleanup failed")
    })
    expect(() => f.operations.splitShape({} as OpenCascadeInstance, f.source, parameters)).toThrow(
      "cleanup failed",
    )
    expect(f.a.delete).toHaveBeenCalledOnce()
    expect(f.b.delete).toHaveBeenCalledOnce()
    expect(f.source.delete).not.toHaveBeenCalled()
  })
  it("rejects a borrowed source returned by the local split and releases owned sides", () => {
    const f = ownershipFixture()
    f.split.mockReturnValueOnce({ negative: f.source, positive: f.positive })
    expect(() => f.operations.splitShape({} as OpenCascadeInstance, f.source, parameters)).toThrow(
      "separately owned",
    )
    expect(f.local.delete).toHaveBeenCalledOnce()
    expect(f.positive.delete).toHaveBeenCalledOnce()
    expect(f.source.delete).not.toHaveBeenCalled()
  })
  it("preserves a null native failure after releasing temporary ownership", () => {
    const f = ownershipFixture()
    f.split.mockImplementationOnce(() => {
      throw null
    })
    let caught: unknown = "not thrown"
    try {
      f.operations.splitShape({} as OpenCascadeInstance, f.source, parameters)
    } catch (error) {
      caught = error
    }
    expect(caught).toBeNull()
    expect(f.local.delete).toHaveBeenCalledOnce()
    expect(f.source.delete).not.toHaveBeenCalled()
  })
  it("rejects a degenerate normal before native allocation", () => {
    const f = ownershipFixture()
    expect(() =>
      f.operations.splitShape({} as OpenCascadeInstance, f.source, {
        ...parameters,
        planeNormal: [0, 0, 0],
      }),
    ).toThrow()
    expect(f.transform).not.toHaveBeenCalled()
  })
})
let occt: OpenCascadeInstance
beforeAll(async () => {
  occt = await Reflect.apply(initializeOpenCascade, undefined, [
    {
      locateFile: () =>
        new URL("../node_modules/replicad-opencascadejs/src/replicad_single.wasm", import.meta.url)
          .pathname,
    },
  ])
  setOC(occt)
}, 60_000)
describe("reference-plane split with pinned OCCT", () => {
  it.each([
    { normal: [0.6, 0.8, 0] },
    { normal: [1 / Math.sqrt(3), 1 / Math.sqrt(3), 1 / Math.sqrt(3)] },
  ] as const)("splits a solid across an oblique unit normal $normal", ({ normal }) => {
    const source = createOcctBox(occt, [20, 20, 20], true)
    const deleted = vi.spyOn(source, "delete")
    const outputs = splitOcctShapeByReferencePlane(occt, source, {
      ...parameters,
      planeNormal: [...normal],
    })
    try {
      for (const shape of [outputs.negative, outputs.positive]) {
        expect(inspectOcctBody(occt, shape)).toMatchObject({ valid: true, solidCount: 1 })
        expect(inspectOcctBody(occt, shape).volume).toBeCloseTo(4_000, 6)
        expect(shape.wrapped.IsPartner(source.wrapped)).toBe(false)
      }
      expect(deleted).not.toHaveBeenCalled()
      expect(inspectOcctBody(occt, source).volume).toBeCloseTo(8_000, 6)
    } finally {
      outputs.negative.delete()
      outputs.positive.delete()
      source.delete()
    }
  })
  it("ignores tangential plane-origin displacement and rejects a missed plane", () => {
    const source = createOcctBox(occt, [20, 20, 20], true)
    const outputs = splitOcctShapeByReferencePlane(occt, source, {
      planeOrigin: [100_000, 100_000, 0],
      planeNormal: [0, 0, 1],
      offset: 0,
    })
    try {
      expect(inspectOcctBody(occt, outputs.negative).volume).toBeCloseTo(4_000, 6)
      expect(() =>
        splitOcctShapeByReferencePlane(occt, source, { ...parameters, offset: 100 }),
      ).toThrow()
      expect(inspectOcctBody(occt, source).volume).toBeCloseTo(8_000, 6)
    } finally {
      outputs.negative.delete()
      outputs.positive.delete()
      source.delete()
    }
  })
})

describe("reference-plane Mirror with pinned OCCT", () => {
  it.each([-2, 2])(
    "reflects across an oblique plane with signed offset %s and retains the source",
    (offset) => {
      const source = createOcctBox(occt, [20, 10, 6], true, [8, -2, 4])
      const deleted = vi.spyOn(source, "delete")
      const reflected = mirrorOcctShape(occt, source, {
        planeOrigin: [3, 4, 5],
        planeNormal: [0.6, 0.8, 0],
        offset,
        preserveSource: true,
      })
      try {
        expect(inspectOcctBody(occt, reflected)).toMatchObject({ valid: true, solidCount: 1 })
        expect(inspectOcctBody(occt, reflected).volume).toBeCloseTo(1200, 6)
        expect(reflected.wrapped.IsPartner(source.wrapped)).toBe(false)
        const corners = [-2, 18].flatMap((x) =>
          [-7, 3].flatMap((y) =>
            [1, 7].map((z) => {
              const distance = (x - 3) * 0.6 + (y - 4) * 0.8 - offset
              return [x - 2 * distance * 0.6, y - 2 * distance * 0.8, z]
            }),
          ),
        )
        const bounds = reflected.boundingBox
        try {
          const [minimum, maximum] = bounds.bounds
          for (const axis of [0, 1, 2]) {
            expect(minimum[axis]).toBeCloseTo(
              Math.min(...corners.map((point) => point[axis] ?? 0)),
              5,
            )
            expect(maximum[axis]).toBeCloseTo(
              Math.max(...corners.map((point) => point[axis] ?? 0)),
              5,
            )
          }
        } finally {
          bounds.delete()
        }
        expect(deleted).not.toHaveBeenCalled()
        expect(inspectOcctBody(occt, source).volume).toBeCloseTo(1200, 6)
      } finally {
        reflected.delete()
        source.delete()
      }
    },
  )
})
