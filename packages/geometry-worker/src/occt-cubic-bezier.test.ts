import { beforeAll, describe, expect, it } from "bun:test"
import { extrusionProfileSegmentSchema } from "@vibeshape/protocol"
import { cast, makeFace, type Shape3D, setOC } from "replicad"
import initializeOpenCascade, { type OpenCascadeInstance } from "replicad-opencascadejs"
import { vi } from "../../../tests/unit/support/bun-test"
import { cubicBezierProjectionBounds } from "./extrusion-curve-geometry"
import { inspectOcctBody } from "./occt-body-validation"
import { type CubicBezierControlPoints, makeOcctCubicBezierEdge } from "./occt-cubic-bezier"
import { type AnalyticalProfile, createAnalyticalWire } from "./occt-loft"

const controls: CubicBezierControlPoints = {
  start: [0, 0, 0],
  control1: [0, 4, 0],
  control2: [4, 4, 0],
  end: [4, 0, 0],
}
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

function heapCapacityBytes() {
  const heap = Reflect.get(occt, "HEAPU8")
  if (!(heap instanceof Uint8Array))
    throw new Error("The native fixture requires the actual WASM heap view.")
  return heap.buffer.byteLength
}
function bounds(shape: Shape3D) {
  const box = new occt.Bnd_Box_1()
  try {
    occt.BRepBndLib.AddOptimal(shape.wrapped, box, false, false)
    const values = Array.from({ length: 6 }, () => ({ current: 0 }))
    Reflect.apply(box.Get, box, values)
    return values.map(({ current }) => current)
  } finally {
    box.delete()
  }
}
function withFace(offsetX: number, inspect: (face: ReturnType<typeof makeFace>) => void) {
  const id = (n: number) => `01900000-0000-7000-8000-${n.toString(16).padStart(12, "0")}`
  const segments = [
    extrusionProfileSegmentSchema.parse({
      entityId: id(6),
      type: "line",
      startPointId: id(1),
      endPointId: id(4),
      start: [0, 0],
      end: [4, 0],
    }),
    extrusionProfileSegmentSchema.parse({
      entityId: id(5),
      type: "cubic-bezier",
      startPointId: id(4),
      control1PointId: id(3),
      control2PointId: id(2),
      endPointId: id(1),
      start: [4, 0],
      control1: [4, 4],
      control2: [0, 4],
      end: [0, 0],
    }),
  ]
  const frame: AnalyticalProfile["frame"] = {
    origin: [offsetX, 0, 0],
    xAxis: [1, 0, 0],
    yAxis: [0, 1, 0],
    normal: [0, 0, 1],
  }
  const wire = createAnalyticalWire(occt, frame, segments)
  try {
    const face = makeFace(wire)
    try {
      inspect(face)
    } finally {
      face.delete()
    }
  } finally {
    wire.delete()
  }
}

function extrusion(face: ReturnType<typeof makeFace>) {
  const vector = new occt.gp_Vec_4(0, 0, 10)
  try {
    const builder = new occt.BRepPrimAPI_MakePrism_1(face.wrapped, vector, false, true)
    try {
      return cast(builder.Shape()).asShape3D()
    } finally {
      builder.delete()
    }
  } finally {
    vector.delete()
  }
}
function revolution(face: ReturnType<typeof makeFace>) {
  const origin = new occt.gp_Pnt_3(0, 0, 0)
  const direction = new occt.gp_Dir_4(0, 1, 0)
  try {
    const axis = new occt.gp_Ax1_2(origin, direction)
    try {
      const builder = new occt.BRepPrimAPI_MakeRevol_1(face.wrapped, axis, Math.PI * 2, false)
      try {
        return cast(builder.Shape()).asShape3D()
      } finally {
        builder.delete()
      }
    } finally {
      axis.delete()
    }
  } finally {
    direction.delete()
    origin.delete()
  }
}
describe("exact native cubic Bezier geometry", () => {
  it("creates an exact cubic with reversible poles and unchanged source coordinates", () => {
    const original = structuredClone(controls)
    for (const reverse of [false, true]) {
      const edge = makeOcctCubicBezierEdge(occt, controls, reverse)
      try {
        expect(edge.geomType).toBe("BEZIER_CURVE")
        const adaptor = new occt.BRepAdaptor_Curve_2(edge.wrapped)
        try {
          const first = adaptor.Value(adaptor.FirstParameter())
          const middle = adaptor.Value((adaptor.FirstParameter() + adaptor.LastParameter()) / 2)
          try {
            expect(first.X()).toBe(reverse ? 4 : 0)
            expect([middle.X(), middle.Y(), middle.Z()]).toEqual([2, 3, 0])
          } finally {
            middle.delete()
            first.delete()
          }
        } finally {
          adaptor.delete()
        }
      } finally {
        edge.delete()
      }
    }
    expect(controls).toEqual(original)
  })
  it("extrudes the closed cubic profile with analytical bounds and conserved polynomial area", () => {
    withFace(0, (face) => {
      const shape = extrusion(face)
      try {
        expect(inspectOcctBody(occt, shape)).toMatchObject({ valid: true, solidCount: 1 })
        expect(inspectOcctBody(occt, shape).volume).toBeCloseTo(96, 8)
        bounds(shape).forEach((value, index) => {
          expect(value).toBeCloseTo([0, 0, 0, 4, 3, 10][index] ?? NaN, 6)
        })
      } finally {
        shape.delete()
      }
    })
  })
  it("revolves the exact cubic profile around a disjoint axis", () => {
    withFace(3, (face) => {
      const shape = revolution(face)
      try {
        const measured = inspectOcctBody(occt, shape)
        expect(measured).toMatchObject({ valid: true, solidCount: 1 })
        expect(measured.volume).toBeCloseTo(96 * Math.PI, 6)
        bounds(shape).forEach((value, index) => {
          expect(value).toBeCloseTo([-7, 0, -7, 7, 3, 7][index] ?? NaN, 6)
        })
      } finally {
        shape.delete()
      }
    })
  })
  it("keeps WASM heap capacity bounded across repeated exact curve creation and disposal", () => {
    for (let i = 0; i < 32; i += 1) makeOcctCubicBezierEdge(occt, controls).delete()
    const baseline = heapCapacityBytes()
    for (let i = 0; i < 512; i += 1) {
      const edge = makeOcctCubicBezierEdge(occt, controls)
      try {
        expect(edge.geomType).toBe("BEZIER_CURVE")
      } finally {
        edge.delete()
      }
    }
    expect(heapCapacityBytes()).toBe(baseline)
  })
  it("finds interior scalar extrema instead of using the control hull as the curve bounds", () => {
    const points = [
      [0, 0],
      [0, 4],
      [4, 4],
      [4, 0],
    ] as const
    expect(cubicBezierProjectionBounds(points, [0, 1])).toEqual({ min: 0, max: 3 })
    expect(cubicBezierProjectionBounds(points, [1, 0])).toEqual({ min: 0, max: 4 })
    expect(cubicBezierProjectionBounds(points, [0, -1])).toEqual({ min: -3, max: 0 })
  })
  it("rejects nonfinite, out-of-budget and collapsed control inputs before native allocation", () => {
    expect(() => makeOcctCubicBezierEdge(occt, { ...controls, control1: [NaN, 0, 0] })).toThrow(
      /finite/,
    )
    expect(() => makeOcctCubicBezierEdge(occt, { ...controls, control1: [100001, 0, 0] })).toThrow(
      /100000/,
    )
    expect(() =>
      makeOcctCubicBezierEdge(occt, {
        start: [0, 0, 0],
        control1: [0, 0, 0],
        control2: [0, 0, 0],
        end: [0, 0, 0],
      }),
    ).toThrow(/nonzero/)
  })
})

function failureFixture(stage: string) {
  const acquired: { name: string; delete: ReturnType<typeof vi.fn> }[] = []
  const owned = (name: string) => {
    if (name === stage) throw new Error(`Injected ${name} failure`)
    const resource = { name, delete: vi.fn() }
    acquired.push(resource)
    return resource
  }
  const Constructor = (name: string, fields: Record<string, unknown> = {}) =>
    vi.fn(function NativeFixture() {
      return { ...owned(name), ...fields }
    })
  const api = {
    TColgp_Array1OfPnt_2: Constructor("poles", {
      SetValue: vi.fn(() => {
        if (stage === "set") throw new Error("Injected set failure")
      }),
    }),
    gp_Pnt_3: Constructor("point"),
    Geom_BezierCurve_1: Constructor("curve"),
    Handle_Geom_Curve_2: Constructor("handle"),
    BRepBuilderAPI_MakeEdge_24: Constructor("builder", { IsDone: () => false }),
  } as unknown as OpenCascadeInstance
  return { api, acquired }
}
it.each(["poles", "point", "set", "curve", "handle", "builder", "not-done"])(
  "disposes every acquired native temporary on %s failure",
  (stage) => {
    const fixture = failureFixture(stage)
    expect(() => makeOcctCubicBezierEdge(fixture.api, controls)).toThrow()
    for (const resource of fixture.acquired) {
      if (resource.name === "curve" && fixture.acquired.some(({ name }) => name === "handle"))
        expect(resource.delete).not.toHaveBeenCalled()
      else expect(resource.delete).toHaveBeenCalledTimes(1)
    }
  },
)
