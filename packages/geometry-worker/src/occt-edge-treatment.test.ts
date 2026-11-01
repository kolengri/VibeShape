import { beforeEach, describe, expect, it, mock } from "bun:test"
import type { OpenCascadeInstance } from "replicad-opencascadejs"
import { vi } from "../../../tests/unit/support/bun-test"

const { castShape } = (() => ({ castShape: vi.fn() }))()
const originalModule1 = { ...(await import("./occt-cast")) }
mock.module("./occt-cast", () => ({
  ...originalModule1,
  castOcctShape: castShape,
}))

const { FilletBuildError, treatAllOcctEdges, treatSelectedOcctEdges } = await import(
  "./occt-edge-treatment"
)

function deletable() {
  return { delete: vi.fn() }
}

function fixture(
  options: {
    addError?: Error
    buildError?: Error
    done?: boolean
    workingRadius?: number
    contours?: number
    validResult?: boolean
  } = {},
) {
  let radius = 0
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
    Add_2: vi.fn((size: number, _edge: unknown) => {
      radius = size
      if (options.addError) throw options.addError
    }),
    Build: vi.fn(() => {
      if (options.buildError) throw options.buildError
    }),
    IsDone: vi.fn(() => options.done ?? radius <= (options.workingRadius ?? Infinity)),
    NbContours: vi.fn(() => options.contours ?? 1),
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
    BRepCheck_Analyzer: vi.fn(function Analyzer() {
      return { ...deletable(), IsValid_2: () => options.validResult ?? true }
    }),
    GProp_GProps_1: vi.fn(function Properties() {
      return { ...deletable(), Mass: () => 100 }
    }),
    BRepGProp: { VolumeProperties_1: vi.fn() },
    TopAbs_ShapeEnum: { TopAbs_SOLID: {}, TopAbs_SHAPE: {} },
    TopExp_Explorer_2: vi.fn(function Explorer() {
      let visited = false
      return {
        ...deletable(),
        More: () => !visited,
        Next: () => {
          visited = true
        },
      }
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

      expect(result).toBe<unknown>(value.result)
      expect(value.builder.Add_2).toHaveBeenCalledWith(1, value.edge.wrapped)
      expect(value.builder.Build).toHaveBeenCalledWith(value.progress)
      expect(value.rawResult.delete).toHaveBeenCalledTimes(1)
      expect(value.edge.delete).toHaveBeenCalledTimes(1)
      expect(value.clone.delete).toHaveBeenCalledTimes(1)
      expect(value.progress.delete).toHaveBeenCalledTimes(1)
      expect(value.builder.delete).toHaveBeenCalledTimes(1)
      expect(value.source.wrapped.delete).not.toHaveBeenCalled()
    },
  )

  it("cleans the edge and builder when Add_2 throws", () => {
    const value = fixture({ addError: new Error("add failed") })
    expect(() => treatAllOcctEdges(value.opencascade, value.source as never, "fillet", 1)).toThrow(
      "add failed",
    )
    expect(value.edge.delete).toHaveBeenCalledTimes(1)
    expect(value.clone.delete).toHaveBeenCalledTimes(1)
    expect(value.builder.delete).toHaveBeenCalledTimes(1)
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
    expect(value.edge.delete).toHaveBeenCalledTimes(1)
    expect(value.progress.delete).toHaveBeenCalledTimes(1)
    expect(value.clone.delete).toHaveBeenCalledTimes(1)
    expect(value.builder.delete).toHaveBeenCalledTimes(1)
  })
})

describe("bounded fillet failure diagnostics", () => {
  it("suggests only the first validated smaller radius and disposes its geometry", () => {
    const value = fixture({ workingRadius: 2 })
    let error: unknown
    try {
      treatSelectedOcctEdges(value.opencascade, value.source as never, "fillet", 16, [7])
    } catch (caught) {
      error = caught
    }
    expect(error).toBeInstanceOf(FilletBuildError)
    expect(error).toMatchObject({ suggestedRadius: 2 })
    expect((error as Error).message).toContain("not a maximum")
    expect(value.builder.Add_2.mock.calls.map(([radius]) => radius)).toEqual([16, 8, 4, 2])
    for (const [, edge] of value.builder.Add_2.mock.calls) expect(edge).toBe(value.edge.wrapped)
    expect(value.result.delete).toHaveBeenCalledTimes(1)
    expect(value.clone.delete).toHaveBeenCalledTimes(4)
    expect(value.builder.delete).toHaveBeenCalledTimes(4)
    expect(value.progress.delete).toHaveBeenCalledTimes(4)
    expect(value.source.wrapped.delete).not.toHaveBeenCalled()
  })

  it("bounds a complex kernel failure to four diagnostic retries", () => {
    const value = fixture({ buildError: new Error("intersection failed") })
    expect(() => treatAllOcctEdges(value.opencascade, value.source as never, "fillet", 16)).toThrow(
      "Inspect adjacent faces",
    )
    expect(value.builder.Build).toHaveBeenCalledTimes(5)
    expect(value.builder.delete).toHaveBeenCalledTimes(5)
    expect(value.progress.delete).toHaveBeenCalledTimes(5)
    expect(value.clone.delete).toHaveBeenCalledTimes(5)
    expect(value.result.delete).not.toHaveBeenCalled()
  })

  it("does not suggest a radius for an invalid result", () => {
    const value = fixture({ validResult: false })
    expect(() => treatAllOcctEdges(value.opencascade, value.source as never, "fillet", 16)).toThrow(
      "found no valid single solid",
    )
    expect(value.result.delete).toHaveBeenCalledTimes(5)
    expect(value.clone.delete).toHaveBeenCalledTimes(5)
  })

  it("rejects an ineligible contour without probing unrelated radii", () => {
    const value = fixture({ contours: 0 })
    expect(() => treatAllOcctEdges(value.opencascade, value.source as never, "fillet", 1)).toThrow(
      "no eligible sharp edge contours",
    )
    expect(value.builder.Build).not.toHaveBeenCalled()
    expect(value.clone.delete).toHaveBeenCalledTimes(1)
  })

  it("does not retry invalid native selection intent", () => {
    const value = fixture()
    expect(() =>
      treatSelectedOcctEdges(value.opencascade, value.source as never, "fillet", 1, [99]),
    ).toThrow("unavailable")
    expect(value.builder.Build).not.toHaveBeenCalled()
    expect(value.clone.delete).toHaveBeenCalledTimes(1)
  })

  it("never suggests a radius below the public fillet parameter boundary", () => {
    const value = fixture({ workingRadius: 0.0005 })
    expect(() =>
      treatAllOcctEdges(value.opencascade, value.source as never, "fillet", 0.001),
    ).toThrow("found no valid single solid")
    expect(value.builder.Build).toHaveBeenCalledTimes(1)
    expect(value.clone.delete).toHaveBeenCalledTimes(1)
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

    expect(result).toBe<unknown>(value.result)
    expect(value.builder.Add_2).toHaveBeenCalledWith(1, value.edge.wrapped)
    expect(value.clone.delete).toHaveBeenCalledTimes(1)
    expect(value.edge.delete).toHaveBeenCalledTimes(1)
  })

  it("rejects a native edge key absent from the clone", () => {
    const value = fixture()
    expect(() =>
      treatSelectedOcctEdges(value.opencascade, value.source as never, "chamfer", 1, [99]),
    ).toThrow("unavailable")
    expect(value.clone.delete).toHaveBeenCalledTimes(1)
    expect(value.edge.delete).toHaveBeenCalledTimes(1)
    expect(value.builder.delete).toHaveBeenCalledTimes(1)
  })
})
