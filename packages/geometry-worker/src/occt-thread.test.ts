import { beforeAll, describe, expect, it } from "bun:test"
import type { ThreadContentParameters } from "@vibeshape/protocol"
import { type Shape3D, setOC } from "replicad"
import initializeOpenCascade, {
  type OpenCascadeInstance,
  type TopAbs_ShapeEnum,
} from "replicad-opencascadejs"
import { vi } from "../../../tests/unit/support/bun-test"
import { createOcctBox, createOcctCylinder, cutOcctShapes, fuseOcctShapes } from "./occt-shapes"
import { createOcctThreadOperations, threadOcctShape } from "./occt-thread"

type Point = [number, number, number]
const parameters: ThreadContentParameters = {
  kind: "external",
  axis: "Z",
  origin: [0, 0, 0],
  nominalDiameter: 10,
  pitch: 2,
  length: 8,
  depth: 0.8,
  clearance: 0.1,
  handedness: "right",
  starts: 1,
  phase: 0,
  runIn: 1,
  runOut: 1,
}
function harness() {
  const shape = (volume = 100, solidCount = 1, role = "source", fraction = 1) => ({
    wrapped: { IsPartner: vi.fn(() => false) },
    volume,
    solidCount,
    role,
    fraction,
    delete: vi.fn(),
  })
  const source = shape()
  const acquired: ReturnType<typeof shape>[] = []
  const fixture = (body: Shape3D) => body as unknown as typeof source
  const allocate = (volume = 100, solidCount = 1, role = "source", fraction = 1) => {
    const result = shape(volume, solidCount, role, fraction)
    acquired.push(result)
    return result as unknown as Shape3D
  }
  const copy = vi.fn(() => allocate())
  const groove = vi.fn(() => allocate(10, 1, "groove"))
  const cylinder = vi.fn(() => allocate(10, 1, "allowance"))
  const allowance = vi.fn(() => allocate(10, 1, "allowance"))
  const band = vi.fn((_occt: OpenCascadeInstance, _bounds: unknown, start: number, stop: number) =>
    allocate(10, 1, "slab", (stop - start) / 8),
  )
  const fuse = vi.fn((_occt: OpenCascadeInstance, tools: readonly Shape3D[]) =>
    allocate(
      tools.reduce((volume, tool) => volume + fixture(tool).volume, 0),
      1,
      "restored",
    ),
  )
  const cut = vi.fn((_occt: OpenCascadeInstance, body: Shape3D, tools: readonly Shape3D[]) =>
    allocate(fixture(body).volume - tools.length, 1, "threaded"),
  )
  const place = vi.fn((_occt: OpenCascadeInstance, tool: Shape3D) =>
    allocate(fixture(tool).volume, fixture(tool).solidCount, fixture(tool).role),
  )
  const boolean = vi.fn(
    (_occt: OpenCascadeInstance, body: Shape3D, tool: Shape3D, kind: "cut" | "common") => {
      if (fixture(tool).role === "slab") {
        const fraction = fixture(tool).fraction
        if (kind === "common") return allocate(fixture(body).volume * fraction, 1, "band")
        return allocate(fixture(body).volume * (1 - fraction), fraction === 1 ? 0 : 2, "outside")
      }
      if (kind === "cut") return allocate(fixture(body).volume - 1, 1, "cleared")
      return allocate(0, 0, "empty")
    },
  )
  const bounds = vi.fn(() => ({ min: [-5, -5, 0] as Point, max: [5, 5, 8] as Point }))
  const inspect = vi.fn((_occt: OpenCascadeInstance, body: Shape3D) => ({
    valid: true,
    solidCount: fixture(body).solidCount,
    volume: fixture(body).volume,
  }))
  const tolerance = vi.fn(() => 0.001)
  const operations = createOcctThreadOperations({
    copy,
    groove,
    cylinder,
    allowance,
    band,
    cut,
    fuse,
    place,
    boolean,
    bounds,
    inspect,
    tolerance,
  })
  return {
    source,
    acquired,
    allocate,
    copy,
    groove,
    cylinder,
    allowance,
    band,
    cut,
    fuse,
    place,
    boolean,
    bounds,
    inspect,
    tolerance,
    operations,
    occt: {} as OpenCascadeInstance,
  }
}
function invoke(f: ReturnType<typeof harness>, value = parameters) {
  return f.operations.threadShape(f.occt, f.source as unknown as Shape3D, value)
}
function failNative(): never {
  throw new Error("Thread native fixture failure")
}
function expectReleased(f: ReturnType<typeof harness>) {
  for (const resource of f.acquired) expect(resource.delete).toHaveBeenCalledTimes(1)
  expect(f.source.delete).not.toHaveBeenCalled()
}
describe("modeled thread ownership and failure boundary", () => {
  it("transfers only a complete result and releases all temporary shapes", () => {
    const f = harness()
    const result = invoke(f, { ...parameters, starts: 4 })
    expect(f.groove).toHaveBeenCalledTimes(4)
    expect(f.cut).toHaveBeenCalledTimes(5)
    expect(f.fuse.mock.calls[0]?.[1]).toHaveLength(2)
    expect(f.fuse.mock.calls[0]?.[1]?.[0]).toMatchObject({ solidCount: 2, volume: 25 })
    expect(f.cut.mock.calls[4]?.[2]).toHaveLength(5)
    expect((result as unknown as typeof f.source).volume).toBe(95)
    for (const resource of f.acquired)
      expect(resource.delete).toHaveBeenCalledTimes(Object.is(resource, result) ? 0 : 1)
    result.delete()
    expectReleased(f)
  })
  it.each([
    "copy",
    "band",
    "groove",
    "allowance",
    "cut",
    "fuse",
    "place",
    "boolean",
    "tolerance",
  ] as const)("releases acquired resources after %s failure", (stage) => {
    const f = harness()
    f[stage].mockImplementation(failNative)
    expect(() => invoke(f)).toThrow("Thread native fixture failure")
    expectReleased(f)
  })
  it("restores every outside solid and skips fusion only when the outside partition is empty", () => {
    const f = harness()
    const result = invoke(f, { ...parameters, runIn: 0, runOut: 0 })
    expect(f.fuse).not.toHaveBeenCalled()
    expect(f.acquired.filter(({ role }) => role === "outside")).toHaveLength(1)
    expect(f.acquired.find(({ role }) => role === "outside")).toMatchObject({
      volume: 0,
      solidCount: 0,
    })
    expect(result).toMatchObject({ volume: 98, solidCount: 1 })
    result.delete()
    expectReleased(f)
  })
  it("releases every partition when acquiring the outside body fails", () => {
    const f = harness()
    const original = f.boolean.getMockImplementation()
    if (!original) throw new Error("Missing Boolean fixture")
    f.boolean.mockImplementationOnce(original).mockImplementationOnce(failNative)
    expect(() => invoke(f)).toThrow("Thread native fixture failure")
    expect(f.acquired.find(({ role }) => role === "band")).toBeDefined()
    expectReleased(f)
  })
  it("fails closed when the combined cut retains intended groove material", () => {
    const f = harness()
    const original = f.boolean.getMockImplementation()
    if (!original) throw new Error("Missing Boolean fixture")
    f.boolean
      .mockImplementationOnce(original)
      .mockImplementationOnce(original)
      .mockImplementationOnce(original)
      .mockImplementationOnce(() => f.allocate(1))
    expect(() => invoke(f)).toThrow("retains material")
    expectReleased(f)
  })
  it("rejects numerical volume drift as ineffective helical removal", () => {
    const f = harness()
    f.cut.mockImplementationOnce(() => f.allocate(74 - 0.00001))
    expect(() => invoke(f)).toThrow("helical thread start")
    expectReleased(f)
  })
  it("rejects an individual cut that increases material", () => {
    const f = harness()
    f.cut.mockImplementationOnce(() => f.allocate(76))
    expect(() => invoke(f)).toThrow("helical thread start")
    expectReleased(f)
  })
  it("releases an internal allowance cylinder when native construction fails", () => {
    const f = harness()
    f.cylinder.mockImplementationOnce(failNative)
    expect(() => invoke(f, { ...parameters, kind: "internal" })).toThrow(
      "Thread native fixture failure",
    )
    expectReleased(f)
  })
  it("releases every raw cutter after the final combined cut fails", () => {
    const f = harness()
    const original = f.cut.getMockImplementation()
    if (!original) throw new Error("Missing cut fixture")
    f.cut
      .mockImplementationOnce(original)
      .mockImplementationOnce(original)
      .mockImplementationOnce(failNative)
    expect(() => invoke(f, { ...parameters, starts: 2 })).toThrow("Thread native fixture failure")
    expect(f.groove).toHaveBeenCalledTimes(2)
    expectReleased(f)
  })
  it("releases the empty outside partition when final world placement fails", () => {
    const f = harness()
    f.place.mockImplementationOnce(failNative)
    expect(() => invoke(f, { ...parameters, runIn: 0, runOut: 0 })).toThrow(
      "Thread native fixture failure",
    )
    expect(f.fuse).not.toHaveBeenCalled()
    expectReleased(f)
  })
  it("never acquires or deletes a cached source alias", () => {
    const f = harness()
    f.copy.mockReturnValueOnce(f.source as unknown as Shape3D)
    expect(() => invoke(f)).toThrow("independent source copy")
    expectReleased(f)
    const later = harness()
    later.boolean.mockReturnValueOnce(later.source as unknown as Shape3D)
    expect(() => invoke(later)).toThrow("cached source")
    expectReleased(later)
  })
  it("rejects borrowed native geometry despite a separate wrapper", () => {
    const f = harness()
    f.copy.mockImplementationOnce(() => {
      const copied = f.allocate()
      f.acquired[0]?.wrapped.IsPartner.mockReturnValue(true)
      return copied
    })
    expect(() => invoke(f)).toThrow("independent source copy")
    expectReleased(f)
  })
  it("does not accept radial clearance alone when a helical start misses the body", () => {
    const f = harness()
    f.cut.mockImplementationOnce(() => f.allocate(74))
    expect(() => invoke(f)).toThrow("helical thread start")
    expectReleased(f)
  })
  it("cleans up every acquired result when a later start fails", () => {
    const f = harness()
    const original = f.groove.getMockImplementation()
    if (!original) throw new Error("Missing groove fixture")
    f.groove.mockImplementationOnce(original).mockImplementationOnce(failNative)
    expect(() => invoke(f, { ...parameters, starts: 2 })).toThrow("Thread native fixture failure")
    expectReleased(f)
  })
  it("rejects a combined cut that only applies clearance and releases all acquired cutters", () => {
    const f = harness()
    const original = f.cut.getMockImplementation()
    if (!original) throw new Error("Missing cut fixture")
    f.cut
      .mockImplementationOnce(original)
      .mockImplementationOnce(original)
      .mockImplementationOnce(() => f.allocate(74))
    expect(() => invoke(f, { ...parameters, starts: 2 })).toThrow("remove effective material")
    expectReleased(f)
  })
  it("rejects disconnected restoration without discarding any outside solid", () => {
    const f = harness()
    f.fuse.mockImplementationOnce(() => f.allocate(50, 2))
    expect(() => invoke(f, { ...parameters, starts: 4 })).toThrow("one valid")
    expect(f.cut).toHaveBeenCalledTimes(5)
    expectReleased(f)
  })
  it("continues cleanup and withholds the result when a temporary destructor fails", () => {
    const f = harness()
    f.copy.mockImplementationOnce(() => {
      const result = f.allocate()
      f.acquired[0]?.delete.mockImplementation(failNative)
      return result
    })
    expect(() => invoke(f)).toThrow("every temporary native resource")
    expectReleased(f)
  })
  it.each([
    { valid: false, solidCount: 1, volume: 100 },
    { valid: true, solidCount: 2, volume: 100 },
    { valid: true, solidCount: 1, volume: 0 },
  ])("rejects invalid source metrics before copying %j", (metrics) => {
    const f = harness()
    f.inspect.mockReturnValueOnce(metrics)
    expect(() => invoke(f)).toThrow("one valid")
    expect(f.copy).not.toHaveBeenCalled()
    expectReleased(f)
  })
  it("rejects invalid band geometry atomically", () => {
    const f = harness()
    f.inspect
      .mockReturnValueOnce({ valid: true, solidCount: 1, volume: 100 })
      .mockReturnValueOnce({ valid: false, solidCount: 1, volume: 75 })
    expect(() => invoke(f)).toThrow("partitions")
    expect(f.groove).not.toHaveBeenCalled()
    expectReleased(f)
  })
  it.each([
    { ...parameters, starts: 5 },
    { ...parameters, depth: 2 },
    { ...parameters, pitch: 0.1 },
    { ...parameters, length: 131 },
    { ...parameters, origin: [100_001, 0, 0] as Point },
  ])("rejects malformed parameters before native acquisition %j", (value) => {
    const f = harness()
    expect(() => invoke(f, value)).toThrow()
    expect(f.bounds).not.toHaveBeenCalled()
    expectReleased(f)
  })
  it("rejects world-overflow tools without retaining partial geometry", () => {
    const f = harness()
    f.bounds
      .mockReturnValueOnce({ min: [-5, -5, 0], max: [5, 5, 8] })
      .mockReturnValueOnce({ min: [-5, -5, 0], max: [5, 5, 8] })
      .mockReturnValueOnce({ min: [-5, -5, 0], max: [5, 5, 8] })
      .mockReturnValueOnce({ min: [-5, -5, 0], max: [100_001, 5, 8] })
    expect(() => invoke(f)).toThrow("workspace")
    expectReleased(f)
  })
})
function bindingHarness(stage: string) {
  const acquired: { delete: ReturnType<typeof vi.fn> }[] = []
  const borrowed = { delete: vi.fn() }
  class Temporary {
    delete = vi.fn()
    constructor() {
      acquired.push(this)
    }
    get() {
      return borrowed
    }
    Face() {
      return new Temporary()
    }
    Edge() {
      return new Temporary()
    }
    Wire() {
      return new Temporary()
    }
    Value() {
      return new Temporary()
    }
    Add_1() {}
    SetMode_1() {}
    SetTolerance() {}
    IsDone() {
      return true
    }
    Build() {
      if (stage === "pipe-build") failNative()
    }
    MakeSolid() {
      return false
    }
  }
  class Edge extends Temporary {
    constructor() {
      if (stage === "helix-edge") failNative()
      super()
    }
  }
  class ProfileEdge extends Temporary {
    constructor() {
      if (stage === "profile-edge") failNative()
      super()
    }
  }
  const occt = {
    gp_Ax3_1: Temporary,
    gp_Cylinder_2: Temporary,
    BRepBuilderAPI_MakeFace_10: Temporary,
    BRep_Tool: { Surface_2: () => new Temporary() },
    gp_Pnt2d_3: Temporary,
    GCE2d_MakeSegment_1: Temporary,
    Handle_Geom2d_Curve_2: Temporary,
    BRepBuilderAPI_MakeEdge_30: Edge,
    BRepBuilderAPI_MakeWire_2: Temporary,
    BRepLib: { BuildCurves3d_2: () => stage !== "build-curves" },
    gp_Pnt_3: Temporary,
    BRepBuilderAPI_MakeWire_1: Temporary,
    BRepBuilderAPI_MakeEdge_3: ProfileEdge,
    BRepOffsetAPI_MakePipeShell: Temporary,
    Message_ProgressRange_1: Temporary,
  } as unknown as OpenCascadeInstance
  return { occt, acquired, borrowed }
}
describe("lexically owned thread bindings", () => {
  it.each(["helix-edge", "build-curves", "profile-edge", "pipe-build", "pipe-solid"])(
    "releases every acquired native wrapper after %s failure",
    (stage) => {
      const f = harness()
      const b = bindingHarness(stage)
      const operations = createOcctThreadOperations({
        copy: f.copy,
        band: f.band,
        tolerance: f.tolerance,
        cylinder: f.cylinder,
        allowance: f.allowance,
        fuse: f.fuse,
        place: f.place,
        boolean: f.boolean,
        bounds: f.bounds,
        inspect: f.inspect,
      })
      expect(() =>
        operations.threadShape(b.occt, f.source as unknown as Shape3D, parameters),
      ).toThrow()
      expectReleased(f)
      for (const wrapper of b.acquired) expect(wrapper.delete).toHaveBeenCalledTimes(1)
      expect(b.borrowed.delete).not.toHaveBeenCalled()
    },
  )
  it("releases the surface property wrapper and every partition if native tolerance acquisition fails", () => {
    const f = harness()
    const properties = { delete: vi.fn() }
    const native = {
      GProp_GProps_1: class {
        delete = properties.delete
      },
      BRepGProp: { SurfaceProperties_1: failNative },
    } as unknown as OpenCascadeInstance
    const operations = createOcctThreadOperations({
      copy: f.copy,
      band: f.band,
      boolean: f.boolean,
      bounds: f.bounds,
      inspect: f.inspect,
    })
    expect(() =>
      operations.threadShape(native, f.source as unknown as Shape3D, parameters),
    ).toThrow("Thread native fixture failure")
    expect(properties.delete).toHaveBeenCalledTimes(1)
    expectReleased(f)
  })
  it.each(["append", "builder", "build"])(
    "releases combined cut bindings after %s failure",
    (stage) => {
      const f = harness()
      const acquired: { delete: ReturnType<typeof vi.fn> }[] = []
      class Temporary {
        delete = vi.fn()
        constructor() {
          acquired.push(this)
        }
      }
      class List extends Temporary {
        Append_1() {
          if (stage === "append") failNative()
          return new Temporary()
        }
      }
      class Builder extends Temporary {
        constructor() {
          if (stage === "builder") failNative()
          super()
        }
        SetArguments() {}
        SetTools() {}
        SetNonDestructive() {}
        SetToFillHistory() {}
        Build() {
          failNative()
        }
      }
      const operations = createOcctThreadOperations({
        copy: f.copy,
        band: f.band,
        tolerance: f.tolerance,
        groove: f.groove,
        cylinder: f.cylinder,
        allowance: f.allowance,
        fuse: f.fuse,
        place: f.place,
        boolean: f.boolean,
        bounds: f.bounds,
        inspect: f.inspect,
      })
      const native = {
        TopTools_ListOfShape_1: List,
        BRepAlgoAPI_Cut_1: Builder,
        Message_ProgressRange_1: Temporary,
      } as unknown as OpenCascadeInstance
      expect(() =>
        operations.threadShape(native, f.source as unknown as Shape3D, parameters),
      ).toThrow("Thread native fixture failure")
      expectReleased(f)
      for (const wrapper of acquired) expect(wrapper.delete).toHaveBeenCalledTimes(1)
    },
  )
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
function measure(shape: Shape3D) {
  const properties = new occt.GProp_GProps_1()
  const box = new occt.Bnd_Box_1()
  const analyzer = new occt.BRepCheck_Analyzer(shape.wrapped, true, false)
  const explorer = new occt.TopExp_Explorer_2(
    shape.wrapped,
    occt.TopAbs_ShapeEnum.TopAbs_SOLID as TopAbs_ShapeEnum,
    occt.TopAbs_ShapeEnum.TopAbs_SHAPE as TopAbs_ShapeEnum,
  )
  try {
    occt.BRepGProp.VolumeProperties_1(shape.wrapped, properties, false, false, false)
    occt.BRepBndLib.AddOptimal(shape.wrapped, box, false, false)
    const values = Array.from({ length: 6 }, () => ({ current: 0 }))
    Reflect.apply(box.Get, box, values)
    let solids = 0
    while (explorer.More()) {
      solids += 1
      explorer.Next()
    }
    return {
      volume: properties.Mass(),
      bounds: values.map(({ current }) => current),
      valid: analyzer.IsValid_2(),
      solids,
    }
  } finally {
    explorer.delete()
    analyzer.delete()
    box.delete()
    properties.delete()
  }
}
function volumeInBox(shape: Shape3D, dimensions: Point, center: Point): number {
  const probe = createOcctBox(occt, dimensions, true, center)
  try {
    const argumentsList = new occt.TopTools_ListOfShape_1()
    try {
      argumentsList.Append_1(shape.wrapped).delete()
      const tools = new occt.TopTools_ListOfShape_1()
      try {
        tools.Append_1(probe.wrapped).delete()
        const builder = new occt.BRepAlgoAPI_Common_1()
        try {
          builder.SetArguments(argumentsList)
          builder.SetTools(tools)
          builder.SetNonDestructive(true)
          builder.SetToFillHistory(false)
          const progress = new occt.Message_ProgressRange_1()
          try {
            builder.Build(progress)
            const result = builder.Shape()
            const properties = new occt.GProp_GProps_1()
            try {
              occt.BRepGProp.VolumeProperties_1(result, properties, false, false, false)
              return properties.Mass()
            } finally {
              properties.delete()
              result.delete()
            }
          } finally {
            progress.delete()
          }
        } finally {
          builder.delete()
        }
      } finally {
        tools.delete()
      }
    } finally {
      argumentsList.delete()
    }
  } finally {
    probe.delete()
  }
}
function materialAt(shape: Shape3D, point: Point): number {
  return volumeInBox(shape, [0.01, 0.01, 0.01], point) / 1e-6
}
function worldPoint(local: Point, value: ThreadContentParameters): Point {
  const rotated =
    value.axis === "X"
      ? [local[2], local[0], local[1]]
      : value.axis === "Y"
        ? [local[1], local[2], local[0]]
        : local
  return rotated.map((coordinate, axis) => coordinate + (value.origin[axis] ?? 0)) as Point
}
function radialPoint(radius: number, angle: number, z: number): Point {
  return [radius * Math.cos(angle), radius * Math.sin(angle), z]
}
function assertThread(source: Shape3D, result: Shape3D, value: ThreadContentParameters) {
  const before = measure(source)
  const after = measure(result)
  expect(after.valid).toBe(true)
  expect(after.solids).toBe(1)
  expect(after.volume).toBeGreaterThan(0.7 * before.volume)
  expect(after.volume).toBeLessThan(before.volume)
  expect(result.wrapped.IsPartner(source.wrapped)).toBe(false)
  const axis = value.axis === "X" ? 0 : value.axis === "Y" ? 1 : 2
  const starts = [before.bounds[axis], value.origin[axis] + value.length - value.runOut]
  const stops = [value.origin[axis] + value.runIn, before.bounds[axis + 3]]
  for (const [index, start] of starts.entries()) {
    const stop = stops[index]
    if (start === undefined || stop === undefined) throw new Error("Missing allowance bounds")
    const dimensions = [0, 1, 2].map((component) =>
      component === axis
        ? stop - start
        : (before.bounds[component + 3] ?? 0) - (before.bounds[component] ?? 0) + 2,
    ) as Point
    const center = [0, 1, 2].map((component) =>
      component === axis
        ? (start + stop) / 2
        : ((before.bounds[component + 3] ?? 0) + (before.bounds[component] ?? 0)) / 2,
    ) as Point
    const originalVolume = volumeInBox(source, dimensions, center)
    const resultVolume = volumeInBox(result, dimensions, center)
    expect(originalVolume).toBeGreaterThan(0)
    // Two clipping planes may differ within native linear confusion; convert that to volume by area.
    const volumeTolerance = (2 * occt.Precision.Confusion() * originalVolume) / (stop - start)
    expect(Math.abs(resultVolume - originalVolume)).toBeLessThanOrEqual(volumeTolerance)
  }
}
const externalCases = [
  { axis: "Z", handedness: "right", starts: 1, phase: 0 },
  { axis: "Z", handedness: "left", starts: 1, phase: 0 },
  { axis: "X", handedness: "right", starts: 2, phase: Math.PI / 3 },
  { axis: "Z", handedness: "right", starts: 2, phase: Math.PI / 3 },
  { axis: "Y", handedness: "right", starts: 4, phase: -Math.PI / 4 },
] as const
describe("modeled threads with pinned real OCCT", () => {
  it.each(["X", "Y", "Z"] as const)(
    "preserves legacy phase when the %s axis uses v2 intent",
    (axis) => {
      const value: ThreadContentParameters = {
        ...parameters,
        axis,
        phase: Math.PI / 3,
        origin: [11, -7, 4],
      }
      const direction: Point = axis === "X" ? [1, 0, 0] : axis === "Y" ? [0, 1, 0] : [0, 0, 1]
      const source = createOcctCylinder(occt, 5, 8, value.origin, direction)
      const before = measure(source)
      let result: Shape3D | null = null
      try {
        result = threadOcctShape(occt, source, { ...value, axis: "custom", direction })
        expect(measure(result)).toMatchObject({ valid: true, solids: 1 })
        const angle = value.phase + (2 * Math.PI * 0.5) / value.pitch
        expect(materialAt(result, worldPoint(radialPoint(4.5, angle, 1.5), value))).toBeLessThan(
          1e-5,
        )
        expect(
          materialAt(result, worldPoint(radialPoint(4.5, angle + Math.PI, 1.5), value)),
        ).toBeGreaterThan(0.999)
        expect(measure(source)).toEqual(before)
      } finally {
        result?.delete()
        source.delete()
      }
    },
    60_000,
  )
  it.each([...externalCases])(
    "cuts real external $handedness thread on $axis with $starts starts and phase $phase",
    (changes) => {
      const value: ThreadContentParameters = { ...parameters, ...changes, origin: [11, -7, 4] }
      const direction: Point =
        value.axis === "X" ? [1, 0, 0] : value.axis === "Y" ? [0, 1, 0] : [0, 0, 1]
      const source = createOcctCylinder(occt, 5, 8, value.origin, direction)
      const before = measure(source)
      const sourceDelete = vi.spyOn(source, "delete")
      let result: Shape3D | null = null
      try {
        result = threadOcctShape(occt, source, value)
        assertThread(source, result, value)
        const sign = value.handedness === "right" ? 1 : -1
        const angle = value.phase + (sign * 2 * Math.PI * 0.5) / (value.pitch * value.starts)
        for (let start = 0; start < value.starts; start += 1) {
          const at = angle + (2 * Math.PI * start) / value.starts
          expect(materialAt(result, worldPoint(radialPoint(4.5, at, 1.5), value))).toBeLessThan(
            1e-5,
          )
          expect(
            materialAt(
              result,
              worldPoint(radialPoint(4.5, at + Math.PI / value.starts, 1.5), value),
            ),
          ).toBeGreaterThan(0.999)
        }
        expect(materialAt(result, worldPoint([4.95, 0, 1.5], value))).toBeLessThan(1e-5)
        expect(materialAt(result, worldPoint([4.95, 0, 0.5], value))).toBeGreaterThan(0.999)
        expect(materialAt(result, worldPoint([4.95, 0, 7.5], value))).toBeGreaterThan(0.999)
        expect(measure(source)).toEqual(before)
        expect(sourceDelete).not.toHaveBeenCalled()
      } finally {
        result?.delete()
        source.delete()
      }
    },
    // Four-start OCCT checks can exceed one minute on shared CI runners.
    120_000,
  )
  it("removes radial protrusions throughout the band while restoring all material outside it", () => {
    const cylinder = createOcctCylinder(occt, 5, 8, [0, 0, 0])
    const fin = createOcctBox(occt, [8, 1, 8], true, [6, 0, 4])
    const source = fuseOcctShapes(occt, cylinder, fin)
    const before = measure(source)
    let result: Shape3D | null = null
    try {
      result = threadOcctShape(occt, source, parameters)
      expect(measure(result)).toMatchObject({ valid: true, solids: 1 })
      expect(materialAt(result, [8, 0, 4])).toBeLessThan(1e-5)
      expect(materialAt(result, [8, 0, 0.5])).toBeGreaterThan(0.999)
      expect(materialAt(result, [8, 0, 7.5])).toBeGreaterThan(0.999)
      for (const z of [0.5, 7.5]) {
        const original = volumeInBox(source, [22, 12, 1], [0, 0, z])
        const restored = volumeInBox(result, [22, 12, 1], [0, 0, z])
        expect(Math.abs(restored - original)).toBeLessThanOrEqual(
          2 * occt.Precision.Confusion() * original,
        )
      }
      expect(measure(source)).toEqual(before)
    } finally {
      result?.delete()
      source.delete()
      fin.delete()
      cylinder.delete()
    }
  }, 60_000)
  it("threads a full axial body with no outside partition to restore", () => {
    const source = createOcctCylinder(occt, 5, 8, [0, 0, 0])
    const before = measure(source)
    const value: ThreadContentParameters = { ...parameters, runIn: 0, runOut: 0 }
    let result: Shape3D | null = null
    try {
      result = threadOcctShape(occt, source, value)
      const after = measure(result)
      expect(after).toMatchObject({ valid: true, solids: 1 })
      expect(after.volume).toBeGreaterThan(0)
      expect(after.volume).toBeLessThan(before.volume)
      expect(materialAt(result, [0, 4.5, 0.5])).toBeLessThan(1e-5)
      expect(materialAt(result, [0, -4.5, 0.5])).toBeGreaterThan(0.999)
      expect(measure(source)).toEqual(before)
    } finally {
      result?.delete()
      source.delete()
    }
  }, 60_000)
  it("cuts a true internal V groove and radial bore clearance while preserving unthreaded allowances", () => {
    const outer = createOcctCylinder(occt, 8, 8, [0, 0, 0])
    const bore = createOcctCylinder(occt, 5, 8, [0, 0, 0])
    const source = cutOcctShapes(occt, outer, bore)
    const value: ThreadContentParameters = { ...parameters, kind: "internal" }
    const before = measure(source)
    let result: Shape3D | null = null
    try {
      result = threadOcctShape(occt, source, value)
      assertThread(source, result, value)
      expect(materialAt(result, [0, 5.5, 1.5])).toBeLessThan(1e-5)
      expect(materialAt(result, [0, -5.5, 1.5])).toBeGreaterThan(0.999)
      expect(materialAt(result, [5.05, 0, 1.5])).toBeLessThan(1e-5)
      expect(materialAt(result, [5.05, 0, 0.5])).toBeGreaterThan(0.999)
      expect(materialAt(result, [5.05, 0, 7.5])).toBeGreaterThan(0.999)
      expect(measure(source)).toEqual(before)
    } finally {
      result?.delete()
      source.delete()
      bore.delete()
      outer.delete()
    }
  }, 60_000)
  it("preserves the authored 60-degree axial groove section without orthogonal profile correction", () => {
    const source = createOcctCylinder(occt, 5, 8, [0, 0, 0])
    let result: Shape3D | null = null
    try {
      result = threadOcctShape(occt, source, parameters)
      expect(materialAt(result, [0, 4.5, 1.65])).toBeLessThan(1e-5)
      expect(materialAt(result, [0, 4.5, 1.8])).toBeGreaterThan(0.999)
    } finally {
      result?.delete()
      source.delete()
    }
  }, 60_000)
  it("fails closed for a missed threaded band without changing or deleting the source", () => {
    const source = createOcctCylinder(occt, 5, 8, [0, 0, 0])
    const before = measure(source)
    const sourceDelete = vi.spyOn(source, "delete")
    try {
      expect(() => threadOcctShape(occt, source, { ...parameters, origin: [0, 0, 20] })).toThrow(
        "inside the authored band",
      )
      expect(measure(source)).toEqual(before)
      expect(sourceDelete).not.toHaveBeenCalled()
    } finally {
      source.delete()
    }
  }, 60_000)
})

function threadStressSource(
  kind: "external" | "internal",
  origin: readonly [number, number, number],
  direction: readonly [number, number, number],
) {
  const cylinder = createOcctCylinder(occt, kind === "external" ? 5 : 7, 35, origin, direction)
  if (kind === "external") return cylinder
  let core: Shape3D | undefined
  try {
    core = createOcctCylinder(occt, 4.9, 35, origin, direction)
    return cutOcctShapes(occt, cylinder, core)
  } finally {
    core?.delete()
    cylinder.delete()
  }
}

describe("bounded arbitrary-axis thread stress", () => {
  it.each(["external", "internal"] as const)(
    "models twenty %s turns on an oblique axis and releases every owned result",
    async (kind) => {
      const direction = [0.6, 0, 0.8] as const
      const origin = [12, -7, 3] as const
      const source = threadStressSource(kind, origin, direction)
      const before = measure(source)
      const sourceDelete = vi.spyOn(source, "delete")
      try {
        for (let iteration = 0; iteration < 2; iteration += 1) {
          const result = threadOcctShape(occt, source, {
            ...parameters,
            kind,
            axis: "custom",
            direction: [...direction],
            origin: [...origin],
            pitch: 1,
            length: 21,
            runIn: 0.5,
            runOut: 0.5,
            depth: 0.4,
            clearance: 0.05,
            starts: 1,
          })
          try {
            const metrics = measure(result)
            expect(metrics.valid).toBe(true)
            expect(metrics.solids).toBe(1)
            expect(metrics.volume).toBeGreaterThan(0.7 * before.volume)
            expect(metrics.volume).toBeLessThan(before.volume)
            expect(result.wrapped.IsPartner(source.wrapped)).toBe(false)
            const faces = result.faces
            try {
              for (const face of faces) {
                if (face.geomType !== "PLANE") continue
                const center = face.center,
                  normal = face.normalAt()
                try {
                  const axial = center
                    .toTuple()
                    .reduce((sum, v, i) => sum + (v - (origin[i] ?? 0)) * (direction[i] ?? 0), 0)
                  const alignment = normal
                    .toTuple()
                    .reduce((sum, v, i) => sum + v * (direction[i] ?? 0), 0)
                  // A phase discontinuity would leave an exposed planar step at the band interface.
                  if (Math.abs(alignment) > 1 - 1e-6 && Math.abs(axial - 16.5) < 1e-5) {
                    const properties = new occt.GProp_GProps_1()
                    try {
                      occt.BRepGProp.SurfaceProperties_1(face.wrapped, properties, false, false)
                      throw new Error(
                        `Thread interface face area=${properties.Mass()} orientation=${JSON.stringify(face.wrapped.Orientation_1())} center=${JSON.stringify(center.toTuple())}`,
                      )
                    } finally {
                      properties.delete()
                    }
                  }
                } finally {
                  center.delete()
                  normal.delete()
                }
              }
            } finally {
              for (const face of faces) face.delete()
            }

            expect(measure(source)).toEqual(before)
            expect(sourceDelete).not.toHaveBeenCalled()
          } finally {
            result.delete()
          }
        }
      } finally {
        source.delete()
      }
    },
    120_000,
  )

  it("rejects twenty turns with multiple starts before acquiring a native source", () => {
    const f = harness()
    expect(() =>
      invoke(f, {
        ...parameters,
        axis: "custom",
        direction: [0, 0, 1],
        pitch: 1,
        length: 21,
        runIn: 0.5,
        runOut: 0.5,
        depth: 0.4,
        starts: 4,
      } as never),
    ).toThrow("Multi-start threads retain the 16-turn")
    expect(f.copy).not.toHaveBeenCalled()
    expect(f.source.delete).not.toHaveBeenCalled()
  })
  it("rejects twenty-one turns before taking ownership of the cached source", () => {
    const f = harness()
    expect(() =>
      invoke(f, {
        ...parameters,
        axis: "custom",
        direction: [0, 0, 1],
        pitch: 1,
        length: 22,
        runIn: 0.5,
        runOut: 0.5,
        depth: 0.4,
      } as never),
    ).toThrow("20 total turns")
    expect(f.source.delete).not.toHaveBeenCalled()
  })
})
