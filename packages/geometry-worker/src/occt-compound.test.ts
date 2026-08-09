import { describe, expect, it, vi } from "vitest"
import { createOcctCompound } from "./occt-compound"

function harness() {
  const compound = { delete: vi.fn() }
  const builder = {
    MakeCompound: vi.fn(),
    Add: vi.fn(),
    delete: vi.fn(),
  }
  const opencascade = {
    TopoDS_Compound: vi.fn(function TopoDSCompound() {
      return compound
    }),
    TopoDS_Builder: vi.fn(function TopoDSBuilder() {
      return builder
    }),
  }
  const shapes = [{ wrapped: { id: "first" } }, { wrapped: { id: "second" } }]
  return { builder, compound, opencascade, shapes }
}

describe("createOcctCompound", () => {
  it("adopts an ordered native compound and releases temporary wrappers", () => {
    const state = harness()
    const adopted = { delete: vi.fn() }
    const castShape = vi.fn(() => adopted)

    expect(
      createOcctCompound(state.opencascade as never, state.shapes as never, castShape as never),
    ).toBe(adopted)
    expect(state.builder.MakeCompound).toHaveBeenCalledWith(state.compound)
    expect(state.builder.Add.mock.calls).toEqual([
      [state.compound, state.shapes[0]?.wrapped],
      [state.compound, state.shapes[1]?.wrapped],
    ])
    expect(state.compound.delete).toHaveBeenCalledOnce()
    expect(state.builder.delete).toHaveBeenCalledOnce()
  })

  it("rejects a non-compound input before allocating native wrappers", () => {
    const state = harness()

    expect(() => createOcctCompound(state.opencascade as never, [] as never)).toThrow(
      "at least two",
    )
    expect(state.opencascade.TopoDS_Compound).not.toHaveBeenCalled()
    expect(state.opencascade.TopoDS_Builder).not.toHaveBeenCalled()
  })

  it("releases both native wrappers when adoption fails", () => {
    const state = harness()

    expect(() =>
      createOcctCompound(state.opencascade as never, state.shapes as never, () => {
        throw new Error("Synthetic cast failure")
      }),
    ).toThrow("Synthetic cast failure")
    expect(state.compound.delete).toHaveBeenCalledOnce()
    expect(state.builder.delete).toHaveBeenCalledOnce()
  })
})
