import { expect, it } from "bun:test"
import type { Shape3D } from "replicad"
import type { OpenCascadeInstance } from "replicad-opencascadejs"
import { vi } from "../../../tests/unit/support/bun-test"
import { compareFilletEndpoints, filletOcctShapeV3 } from "./occt-fillet-v3"

type Failure = "add" | "contour" | "build" | "done" | "chain" | "points" | "pnt"

function fixture(failure: Failure) {
  const wrappers: Array<{ delete: ReturnType<typeof vi.fn> }> = []
  const deletable = () => {
    const value = { delete: vi.fn() }
    wrappers.push(value)
    return value
  }
  const edge = { ...deletable(), hashCode: 7, wrapped: {} }
  const face = {
    ...deletable(),
    hashCode: 8,
    wrapped: {},
    get edges() {
      return [{ ...deletable(), hashCode: 7 }]
    },
  }
  const clone = { ...deletable(), wrapped: {}, edges: [edge], faces: [face] }
  const source = { clone: () => clone, delete: vi.fn() }
  let added = false
  const add = () => {
    if (failure === "add") throw new Error("Native add failed")
    added = failure !== "contour"
  }
  const builder = {
    ...deletable(),
    Contour: () => (added ? 1 : 0),
    Add_1: add,
    Add_2: add,
    NbContours: () => (added ? 1 : 0),
    NbEdges: () => (failure === "chain" ? 2 : 1),
    Closed: () => false,
    FirstVertex: () => deletable(),
    LastVertex: () => deletable(),
    SetRadius_2: vi.fn(),
    Build: () => {
      if (failure === "build") throw new Error("Native build failed")
    },
    IsDone: () => false,
  }
  const occt = {
    BRepFilletAPI_MakeFillet: function Builder() {
      return builder
    },
    ChFi3d_FilletShape: { ChFi3d_Rational: 0 },
    BRep_Tool: {
      Pnt: () => {
        if (failure === "pnt") throw new Error("Native point read failed")
        return { ...deletable(), X: () => 0, Y: () => 0, Z: () => 0 }
      },
    },
    Message_ProgressRange_1: function Progress() {
      return deletable()
    },
  }
  return { source, occt, wrappers, builder }
}

it.each(["add", "contour", "build", "done", "chain", "points", "pnt"] as const)(
  "releases every V3 Fillet native temporary when %s fails",
  (failure) => {
    const value = fixture(failure)
    const variable = failure === "chain" || failure === "points" || failure === "pnt"
    expect(() =>
      filletOcctShapeV3(
        value.occt as unknown as OpenCascadeInstance,
        value.source as unknown as Shape3D,
        2,
        [
          {
            kind: "edge",
            edgeKey: 7,
            ...(variable
              ? { variableRadius: { startRadius: 1, endRadius: 2, reverse: false } }
              : {}),
          },
          { kind: "face", faceKey: 8 },
        ].slice(0, variable ? 1 : 2) as Parameters<typeof filletOcctShapeV3>[3],
      ),
    ).toThrow("Fillet")
    for (const wrapper of value.wrappers) expect(wrapper.delete).toHaveBeenCalledTimes(1)
    expect(value.source.delete).not.toHaveBeenCalled()
    expect(value.builder.SetRadius_2).not.toHaveBeenCalled()
  },
)

it("orders endpoints by x, then y, then z with a bounded tolerance", () => {
  expect(compareFilletEndpoints([0, 5, 9], [1, 0, 0])).toBeLessThan(0)
  expect(compareFilletEndpoints([1e-7, 5, 0], [0, 4, 0])).toBeGreaterThan(0)
  expect(compareFilletEndpoints([0, 0, 2], [0, 0, 1])).toBeGreaterThan(0)
  expect(compareFilletEndpoints([0, 0, 1], [1e-7, -1e-7, 1])).toBe(0)
})
