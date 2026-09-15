import type { OpenCascadeInstance } from "replicad-opencascadejs"
import { beforeEach, describe, expect, it, vi } from "vitest"

const { castShape } = vi.hoisted(() => ({ castShape: vi.fn() }))
vi.mock("./occt-cast", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./occt-cast")>()),
  castOcctShape: castShape,
}))

import { treatAllOcctEdges, treatSelectedOcctEdges } from "./occt-edge-treatment"

function deletable() {
  return { delete: vi.fn() }
}

function fixture(options: { addError?: Error; buildError?: Error; done?: boolean } = {}) {
  const source = { wrapped: deletable(), clone: vi.fn() }
  const clone = {
    wrapped: deletable(),
    delete: vi.fn(),
    edges: [] as Array<{ wrapped: unknown; delete(): void }>,
  }
  const edge = { wrapped: deletable(), hashCode: 7, delete: vi.fn() }
  clone.edges = [edge]
  source.clone.mockReturnValue(clone)
  const rawResult = deletable()
  const progress = deletable()
  const builder = {
    Add_2: vi.fn(() => {
      if (options.addError) throw options.addError
    }),
    Build: vi.fn(() => {
      if (options.buildError) throw options.buildError
    }),
    IsDone: vi.fn(() => options.done ?? true),
    Shape: vi.fn(() => rawResult),
    delete: vi.fn(),
  }
  const opencascade = {
    BRepFilletAPI_MakeFillet: vi.fn(function Builder() {
      return builder
    }),
    BRepFilletAPI_MakeChamfer: vi.fn(function Builder() {
      return builder
    }),
    ChFi3d_FilletShape: { ChFi3d_Rational: {} },
    Message_ProgressRange_1: vi.fn(function Progress() {
      return progress
    }),
  } as unknown as OpenCascadeInstance
  const result = deletable()
  castShape.mockReturnValue(result)
  return { builder, clone, edge, opencascade, progress, rawResult, result, source }
}

beforeEach(() => vi.clearAllMocks())

describe("treatAllOcctEdges ownership", () => {
  it.each(["fillet", "chamfer"] as const)(
    "disposes all temporaries after a %s build",
    (operation) => {
      const value = fixture()
      const result = treatAllOcctEdges(value.opencascade, value.source as never, operation, 1)

      expect(result).toBe(value.result)
      expect(value.builder.Add_2).toHaveBeenCalledWith(1, value.edge.wrapped)
      expect(value.builder.Build).toHaveBeenCalledWith(value.progress)
      expect(value.rawResult.delete).toHaveBeenCalledOnce()
      expect(value.edge.delete).toHaveBeenCalledOnce()
      expect(value.clone.delete).toHaveBeenCalledOnce()
      expect(value.progress.delete).toHaveBeenCalledOnce()
      expect(value.builder.delete).toHaveBeenCalledOnce()
      expect(value.source.wrapped.delete).not.toHaveBeenCalled()
    },
  )

  it("cleans the edge and builder when Add_2 throws", () => {
    const value = fixture({ addError: new Error("add failed") })
    expect(() => treatAllOcctEdges(value.opencascade, value.source as never, "fillet", 1)).toThrow(
      "add failed",
    )
    expect(value.edge.delete).toHaveBeenCalledOnce()
    expect(value.clone.delete).toHaveBeenCalledOnce()
    expect(value.builder.delete).toHaveBeenCalledOnce()
    expect(value.progress.delete).not.toHaveBeenCalled()
  })

  it.each([
    ["Build throws", { buildError: new Error("build failed") }],
    ["builder is not done", { done: false }],
  ])("cleans progress, builder, and clone when %s", (_label, options) => {
    const value = fixture(options)
    expect(() =>
      treatAllOcctEdges(value.opencascade, value.source as never, "chamfer", 1),
    ).toThrow()
    expect(value.edge.delete).toHaveBeenCalledOnce()
    expect(value.progress.delete).toHaveBeenCalledOnce()
    expect(value.clone.delete).toHaveBeenCalledOnce()
    expect(value.builder.delete).toHaveBeenCalledOnce()
  })
})

describe("treatSelectedOcctEdges", () => {
  it("adds only the requested native edge and disposes the clone", () => {
    const value = fixture()
    const result = treatSelectedOcctEdges(
      value.opencascade,
      value.source as never,
      "fillet",
      1,
      [7],
    )

    expect(result).toBe(value.result)
    expect(value.builder.Add_2).toHaveBeenCalledWith(1, value.edge.wrapped)
    expect(value.clone.delete).toHaveBeenCalledOnce()
    expect(value.edge.delete).toHaveBeenCalledOnce()
  })

  it("rejects a native edge key absent from the clone", () => {
    const value = fixture()
    expect(() =>
      treatSelectedOcctEdges(value.opencascade, value.source as never, "chamfer", 1, [99]),
    ).toThrow("unavailable")
    expect(value.clone.delete).toHaveBeenCalledOnce()
    expect(value.edge.delete).toHaveBeenCalledOnce()
    expect(value.builder.delete).toHaveBeenCalledOnce()
  })
})
