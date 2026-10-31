import { describe, expect, it } from "bun:test"
import type { Shape3D } from "replicad"
import type { OpenCascadeInstance } from "replicad-opencascadejs"
import { vi } from "../../../tests/unit/support/bun-test"
import { createConnectMountsShapeOperations } from "./occt-connect-mounts"
import type { createOcctCylinder, createOcctSphere, fuseOcctShapes } from "./occt-shapes"

function fixture() {
  const shapes: { delete: ReturnType<typeof vi.fn> }[] = []
  const shape = () => {
    const value = { delete: vi.fn() }
    shapes.push(value)
    return value as unknown as Shape3D
  }
  const operations = {
    sphere: vi.fn<typeof createOcctSphere>(shape),
    cylinder: vi.fn<typeof createOcctCylinder>(shape),
    fuse: vi.fn<typeof fuseOcctShapes>(shape),
  }
  const build = createConnectMountsShapeOperations(operations)
  return { operations, shapes, build, kernel: {} as OpenCascadeInstance }
}
const parameters = {
  points: [
    [0, 0, 0],
    [30, 0, 0],
    [0, 20, 0],
  ] as [number, number, number][],
  nodeRadius: 4,
  strutRadius: 2,
  connectionMode: "tree" as const,
}

describe("owned exact mount connector construction", () => {
  it("selects the Euclidean minimum tree rather than every pair", () => {
    const f = fixture()
    const result = f.build(f.kernel, parameters)
    expect(f.operations.cylinder.mock.calls.map((args) => args.slice(1))).toEqual([
      [2, 20, [0, 0, 0], [0, 1, 0]],
      [2, 30, [0, 0, 0], [1, 0, 0]],
    ])
    expect(f.operations.sphere).toHaveBeenCalledTimes(3)
    for (const shape of f.shapes)
      expect(shape.delete).toHaveBeenCalledTimes(shape.delete === result.delete ? 0 : 1)
    result.delete()
    for (const shape of f.shapes) expect(shape.delete).toHaveBeenCalledTimes(1)
  })

  it("uses stable coordinate tie-breaking and normalized arbitrary directions", () => {
    const a = fixture()
    const b = fixture()
    const input = {
      ...parameters,
      points: [
        [0, 0, 0],
        [3, 4, 12],
        [0, 0, 13],
      ] as [number, number, number][],
    }
    a.build(a.kernel, input).delete()
    b.build(b.kernel, { ...input, points: [...input.points].reverse() }).delete()
    expect(a.operations.cylinder.mock.calls.map((args) => args.slice(1))).toEqual(
      b.operations.cylinder.mock.calls.map((args) => args.slice(1)),
    )
    expect(a.operations.cylinder.mock.calls.map((args) => args[2])).toEqual([13, Math.sqrt(26)])
  })

  it("joins every pair in complete mode", () => {
    const f = fixture()
    f.build(f.kernel, { ...parameters, connectionMode: "complete" }).delete()
    expect(f.operations.cylinder).toHaveBeenCalledTimes(3)
  })

  it.each(["sphere", "cylinder", "fuse"] as const)(
    "releases all owned shapes if %s fails",
    (operation) => {
      const f = fixture()
      if (operation === "sphere")
        f.operations.sphere.mockImplementationOnce(() => {
          const value = { delete: vi.fn() }
          f.shapes.push(value)
          return value as unknown as Shape3D
        })
      f.operations[operation].mockImplementationOnce(() => {
        throw new Error("Injected kernel failure")
      })
      expect(() => f.build(f.kernel, parameters)).toThrow("Injected kernel failure")
      for (const shape of f.shapes) expect(shape.delete).toHaveBeenCalledTimes(1)
    },
  )

  it("rejects malformed content before allocating kernel objects", () => {
    const f = fixture()
    expect(() =>
      f.build(f.kernel, {
        ...parameters,
        points: [
          [0, 0, 0],
          [0, 0, 0],
        ],
      }),
    ).toThrow()
    expect(f.shapes).toHaveLength(0)
  })
})
