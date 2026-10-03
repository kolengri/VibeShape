import type { Shape3D } from "replicad"
import type { OpenCascadeInstance } from "replicad-opencascadejs"
import { describe, expect, it, vi } from "vitest"
import {
  createOcctBodyCombinationOperations,
  disposeBodyCombination,
} from "./occt-body-combination"

function harness() {
  const sources = Array.from({ length: 3 }, (_, index) => ({
    wrapped: { id: index },
    delete: vi.fn(),
  }))
  const copies: { wrapped: { source: unknown }; delete: ReturnType<typeof vi.fn> }[] = []
  const root = { wrapped: {}, delete: vi.fn() }
  const fused: (typeof root)[] = []
  const copy = vi.fn((_occt: OpenCascadeInstance, source: Shape3D) => {
    const shape = { wrapped: { source }, delete: vi.fn() }
    copies.push(shape)
    return shape as unknown as Shape3D
  })
  const compound = vi.fn(() => root as unknown as Shape3D)
  const fuse = vi.fn(() => {
    const shape = { wrapped: {}, delete: vi.fn() }
    fused.push(shape)
    return shape as unknown as Shape3D
  })
  const operations = createOcctBodyCombinationOperations({ copy, compound, fuse })
  return {
    sources,
    copies,
    root,
    fused,
    copy,
    compound,
    fuse,
    operations,
    occt: {} as OpenCascadeInstance,
  }
}

describe("owned exact body combinations", () => {
  it("copies every Compound body into its own authored role and disposes the aggregate and copies once", () => {
    const f = harness()
    const roles = ["body.first", "body.second", "body.third"]
    const bundle = f.operations.compoundBodies(f.occt, f.sources as unknown as Shape3D[], roles)
    expect(bundle.shape).toBe(f.root)
    expect(bundle.outputs.map(({ role }) => role)).toEqual(roles)
    expect(f.compound).toHaveBeenCalledWith(f.occt, f.copies)
    expect(f.copies.every((copy) => copy.delete.mock.calls.length === 0)).toBe(true)
    expect(disposeBodyCombination(bundle)).toBe(true)
    expect(f.root.delete).toHaveBeenCalledOnce()
    for (const copy of f.copies) expect(copy.delete).toHaveBeenCalledOnce()
    for (const source of f.sources) expect(source.delete).not.toHaveBeenCalled()
  })
  it.each(["copy", "compound"])("releases every acquired copy on Compound %s failure", (stage) => {
    const f = harness()
    if (stage === "compound")
      f.compound.mockImplementation(() => {
        throw new Error("compound failure")
      })
    if (stage === "copy") {
      const first = { wrapped: { source: null }, delete: vi.fn() }
      f.copy
        .mockImplementationOnce(() => {
          f.copies.push(first)
          return first as unknown as Shape3D
        })
        .mockImplementationOnce(() => {
          throw new Error("copy failure")
        })
    }
    expect(() =>
      f.operations.compoundBodies(f.occt, f.sources as unknown as Shape3D[], [
        "body.first",
        "body.second",
        "body.third",
      ]),
    ).toThrow()
    for (const copy of f.copies) expect(copy.delete).toHaveBeenCalledOnce()
    for (const source of f.sources) expect(source.delete).not.toHaveBeenCalled()
  })
  it("copies every Union tool before fusing and releases intermediates without mutating sources", () => {
    const f = harness()
    const result = f.operations.unionBodies(f.occt, f.sources as unknown as Shape3D[])
    expect(result).toBe(f.fused[1])
    expect(f.copy).toHaveBeenCalledTimes(3)
    expect(f.fuse).toHaveBeenCalledTimes(2)
    for (const copy of f.copies) expect(copy.delete).toHaveBeenCalledOnce()
    expect(f.fused[0]?.delete).toHaveBeenCalledOnce()
    expect(f.fused[1]?.delete).not.toHaveBeenCalled()
    for (const source of f.sources) expect(source.delete).not.toHaveBeenCalled()
    result.delete()
    expect(f.fused[1]?.delete).toHaveBeenCalledOnce()
  })
  it.each(["copy-tool", "fuse"])("releases acquired Union inputs after %s failure", (stage) => {
    const f = harness()
    if (stage === "copy-tool") {
      f.copy
        .mockImplementationOnce((_occt, source) => {
          const first = { wrapped: { source }, delete: vi.fn() }
          f.copies.push(first)
          return first as unknown as Shape3D
        })
        .mockImplementationOnce(() => {
          throw new Error("tool copy failure")
        })
    } else
      f.fuse.mockImplementation(() => {
        throw new Error("fuse failure")
      })
    expect(() => f.operations.unionBodies(f.occt, f.sources as unknown as Shape3D[])).toThrow()
    for (const copy of f.copies) expect(copy.delete).toHaveBeenCalledOnce()
    for (const source of f.sources) expect(source.delete).not.toHaveBeenCalled()
  })
  it("rejects bounded selection and output-role mismatches before allocating copies", () => {
    const f = harness()
    expect(() => f.operations.unionBodies(f.occt, [])).toThrow()
    expect(() =>
      f.operations.unionBodies(
        f.occt,
        Array.from({ length: 9 }, () => f.sources[0]) as unknown as Shape3D[],
      ),
    ).toThrow()
    expect(() =>
      f.operations.compoundBodies(f.occt, f.sources as unknown as Shape3D[], [
        "body.first",
        "body.first",
        "body.third",
      ]),
    ).toThrow()
    expect(f.copy).not.toHaveBeenCalled()
  })
  it("attempts every bundle release and reports a physical deletion failure", () => {
    const f = harness()
    const bundle = f.operations.compoundBodies(f.occt, f.sources as unknown as Shape3D[], [
      "body.first",
      "body.second",
      "body.third",
    ])
    f.copies[0]?.delete.mockImplementation(() => {
      throw new Error("native release failure")
    })
    expect(disposeBodyCombination(bundle)).toBe(false)
    expect(f.root.delete).toHaveBeenCalledOnce()
    for (const copy of f.copies) expect(copy.delete).toHaveBeenCalledOnce()
  })
})
