import { expect, it } from "bun:test"
import type { Shape3D } from "replicad"
import type { OpenCascadeInstance } from "replicad-opencascadejs"
import { vi } from "../../../tests/unit/support/bun-test"
import { chamferOcctShapeV3 } from "./occt-chamfer-v3"

function fixture(failure: "add" | "build" | "done", circular: boolean) {
  const wrappers: Array<{ delete: ReturnType<typeof vi.fn> }> = []
  const deletable = () => {
    const value = { delete: vi.fn() }
    wrappers.push(value)
    return value
  }
  const edge = { ...deletable(), hashCode: 7, wrapped: {}, geomType: "CIRCLE", isClosed: true }
  const face = (hashCode: number) => ({
    ...deletable(),
    hashCode,
    wrapped: {},
    geomType: circular && hashCode === 9 ? "CYLINDRE" : "PLANE",
    get edges() {
      return [{ ...deletable(), hashCode: 7 }]
    },
    normalAt() {
      return { ...deletable(), toTuple: () => [0, 0, 1] }
    },
  })
  const clone = { ...deletable(), wrapped: {}, edges: [edge], faces: [face(8), face(9)] }
  const source = { clone: () => clone, delete: vi.fn() }
  let added = false
  const add = () => {
    if (failure === "add") throw new Error("Native add failed")
    added = true
  }
  const builder = {
    ...deletable(),
    Contour: () => (added ? 1 : 0),
    Add_2: add,
    Add_3: add,
    NbEdges: () => 1,
    Edge: () => ({ ...deletable(), HashCode: () => 7 }),
    Build: () => {
      if (failure === "build") throw new Error("Native build failed")
    },
    IsDone: () => false,
  }
  const occt = {
    BRepFilletAPI_MakeChamfer: function Builder() {
      return builder
    },
    Message_ProgressRange_1: function Progress() {
      return deletable()
    },
  }
  return { source, occt, wrappers }
}

it.each(
  (["add", "build", "done"] as const).flatMap((failure) =>
    [false, true].map((circular) => ({ failure, circular })),
  ),
)(
  "releases every V3 native temporary when $failure fails, circular=$circular",
  ({ failure, circular }) => {
    const value = fixture(failure, circular)
    expect(() =>
      chamferOcctShapeV3(
        value.occt as unknown as OpenCascadeInstance,
        value.source as unknown as Shape3D,
        {
          mode: circular ? "equal-distance" : "two-distances",
          distance: 2,
          secondDistance: 3,
          measurement: "offset",
          flip: false,
          tangentPropagation: false,
        },
        [{ kind: "edge", edgeKey: 7, sideFaceKey: 8 }],
        [],
      ),
    ).toThrow("Chamfer")
    for (const wrapper of value.wrappers) expect(wrapper.delete).toHaveBeenCalledTimes(1)
    expect(value.source.delete).not.toHaveBeenCalled()
  },
)
