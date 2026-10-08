import { beforeAll, describe, expect, it } from "bun:test"
import { type Shape3D, setOC } from "replicad"
import initializeOpenCascade, {
  type OpenCascadeInstance,
  type TopAbs_ShapeEnum,
} from "replicad-opencascadejs"
import { vi } from "../../../tests/unit/support/bun-test"
import {
  createOcctPatternOperations,
  type OwnedBodyPattern,
  type PatternKernelParameters,
  patternOcctShape,
} from "./occt-pattern"
import { createOcctBox, createOcctCylinder } from "./occt-shapes"

type Point = [number, number, number]
type Bounds = { min: Point; max: Point }
const linear: PatternKernelParameters = { kind: "linear", count: 4, axis: "X", spacing: 10 }
const circular: PatternKernelParameters = {
  kind: "circular",
  count: 4,
  axis: "Z",
  angle: 2 * Math.PI,
  center: [0, 0, 0],
}
function harness() {
  const shape = (bounds: Bounds) => ({
    wrapped: { IsPartner: vi.fn(() => false) },
    bounds,
    delete: vi.fn(),
  })
  const source = shape({ min: [-2, -3, -4], max: [2, 3, 4] })
  const copies: ReturnType<typeof shape>[] = []
  const makeCopy = (translation: readonly number[]) => {
    const result = shape({
      min: source.bounds.min.map((value, axis) => value + (translation[axis] ?? 0)) as Point,
      max: source.bounds.max.map((value, axis) => value + (translation[axis] ?? 0)) as Point,
    })
    copies.push(result)
    return result as unknown as Shape3D
  }
  const copy = vi.fn(
    (_occt: OpenCascadeInstance, _source: Shape3D, translation: readonly number[]) =>
      makeCopy(translation),
  )
  const rotate = vi.fn(
    (
      _occt: OpenCascadeInstance,
      _source: Shape3D,
      _center: readonly number[],
      _axis: string | readonly [number, number, number],
      _angle: number,
    ) => makeCopy([0, 0, 0]),
  )
  const bounds = vi.fn(
    (_occt: OpenCascadeInstance, body: Shape3D) => (body as unknown as typeof source).bounds,
  )
  const inspect = vi.fn(() => ({ valid: true, solidCount: 1, volume: 192 }))
  const operations = createOcctPatternOperations({ copy, rotate, bounds, inspect })
  return {
    source,
    copies,
    copy,
    rotate,
    bounds,
    inspect,
    operations,
    occt: {} as OpenCascadeInstance,
  }
}
function invoke(f: ReturnType<typeof harness>, parameters: PatternKernelParameters = linear) {
  return f.operations.patternShape(f.occt, f.source as unknown as Shape3D, parameters)
}
function failNative(): never {
  throw new Error("Native pattern fixture failure")
}
function expectReleased(f: ReturnType<typeof harness>) {
  for (const copy of f.copies) expect(copy.delete).toHaveBeenCalledTimes(1)
  expect(f.source.delete).not.toHaveBeenCalled()
}

describe("owned body pattern failure boundary", () => {
  it("copies the seed and preserves each output until caller disposal", () => {
    const f = harness()
    const outputs = invoke(f)
    expect(outputs.map(({ role }) => role)).toEqual([
      "pattern.instance.0",
      "pattern.instance.1",
      "pattern.instance.2",
      "pattern.instance.3",
    ])
    expect(
      f.copy.mock.calls.map(([, source, translation]) => [
        source === (f.source as unknown as Shape3D),
        translation,
      ]),
    ).toEqual([
      [true, [0, 0, 0]],
      [true, [10, 0, 0]],
      [true, [20, 0, 0]],
      [true, [30, 0, 0]],
    ])
    for (const copy of f.copies) expect(copy.delete).not.toHaveBeenCalled()
    for (const output of outputs) output.shape.delete()
    expectReleased(f)
  })

  it.each([
    { angle: 2 * Math.PI, angles: [Math.PI / 2, Math.PI, (3 * Math.PI) / 2] },
    { angle: -2 * Math.PI, angles: [-Math.PI / 2, -Math.PI, (-3 * Math.PI) / 2] },
    { angle: Math.PI, angles: [Math.PI / 3, (2 * Math.PI) / 3, Math.PI] },
    {
      angle: 2 * Math.PI - 1e-12,
      angles: [(2 * Math.PI - 1e-12) / 3, ((2 * Math.PI - 1e-12) * 2) / 3, 2 * Math.PI - 1e-12],
    },
  ])(
    "uses the explicit circular span $angle without a tolerance-based full-circle branch",
    ({ angle, angles }) => {
      const f = harness()
      const outputs = invoke(f, { ...circular, angle })
      expect(f.copy).toHaveBeenCalledTimes(1)
      expect(f.rotate.mock.calls.map(([, , , , value]) => value)).toEqual<unknown>(angles)
      for (const output of outputs) output.shape.delete()
    },
  )

  it.each(["copy", "bounds", "inspect", "rotate"] as const)(
    "releases every acquired instance after %s failure",
    (stage) => {
      const f = harness()
      if (stage === "copy") {
        const original = f.copy.getMockImplementation()
        if (!original) throw new Error("Missing copy fixture")
        f.copy
          .mockImplementationOnce(original)
          .mockImplementationOnce(original)
          .mockImplementationOnce(failNative)
      } else if (stage === "bounds") {
        f.bounds.mockReturnValueOnce(f.source.bounds).mockImplementationOnce(failNative)
      } else if (stage === "inspect") {
        f.inspect
          .mockReturnValueOnce({ valid: true, solidCount: 1, volume: 192 })
          .mockImplementationOnce(failNative)
      } else {
        f.rotate.mockImplementation(failNative)
      }
      expect(() => invoke(f, stage === "rotate" ? circular : linear)).toThrow(
        "Native pattern fixture failure",
      )
      expectReleased(f)
    },
  )

  it.each([
    { valid: false, solidCount: 1, volume: 192 },
    { valid: true, solidCount: 0, volume: 192 },
    { valid: true, solidCount: 2, volume: 192 },
    { valid: true, solidCount: 1, volume: 0 },
    { valid: true, solidCount: 1, volume: Number.NaN },
    { valid: true, solidCount: 1, volume: 193 },
  ])("rejects invalid copied solid metrics %j and releases the failed copy", (metrics) => {
    const f = harness()
    f.inspect
      .mockReturnValueOnce({ valid: true, solidCount: 1, volume: 192 })
      .mockReturnValueOnce(metrics)
    expect(() => invoke(f)).toThrow()
    expectReleased(f)
  })

  it("preserves relative volume checks for very small valid solids", () => {
    const f = harness()
    f.inspect
      .mockReturnValueOnce({ valid: true, solidCount: 1, volume: 1e-12 })
      .mockReturnValueOnce({ valid: true, solidCount: 1, volume: 2e-12 })
    expect(() => invoke(f)).toThrow("preserve source volume")
    expectReleased(f)
  })

  it("never deletes a returned source alias or twice deletes a repeated output", () => {
    const f = harness()
    f.copy.mockReturnValueOnce(f.source as unknown as Shape3D)
    expect(() => invoke(f)).toThrow("separate ownership")
    expect(f.source.delete).not.toHaveBeenCalled()
    const second = harness()
    const original = second.copy.getMockImplementation()
    if (!original) throw new Error("Missing copy fixture")
    second.copy
      .mockImplementationOnce(original)
      .mockImplementationOnce(() => second.copies[0] as unknown as Shape3D)
    expect(() => invoke(second)).toThrow("separate ownership")
    expectReleased(second)
  })

  it("rejects separate wrappers that still share the cached source native shape", () => {
    const f = harness()
    const original = f.copy.getMockImplementation()
    if (!original) throw new Error("Missing copy fixture")
    f.copy.mockImplementationOnce((...args) => {
      const result = original(...args)
      f.copies[0]?.wrapped.IsPartner.mockReturnValue(true)
      return result
    })
    expect(() => invoke(f)).toThrow("independent copied geometry")
    expectReleased(f)
  })

  it("continues releasing later copies when an owned destructor itself fails", () => {
    const f = harness()
    const original = f.copy.getMockImplementation()
    if (!original) throw new Error("Missing copy fixture")
    f.copy
      .mockImplementationOnce((...args) => {
        const result = original(...args)
        f.copies[0]?.delete.mockImplementation(failNative)
        return result
      })
      .mockImplementationOnce(original)
      .mockImplementationOnce(failNative)
    expect(() => invoke(f)).toThrow("could not release every owned copy")
    expectReleased(f)
  })

  it("rejects distinct wrappers sharing an earlier output native shape", () => {
    const f = harness()
    const original = f.copy.getMockImplementation()
    if (!original) throw new Error("Missing copy fixture")
    f.copy.mockImplementationOnce(original).mockImplementationOnce((...args) => {
      const result = original(...args)
      f.copies[1]?.wrapped.IsPartner.mockReturnValueOnce(false).mockReturnValueOnce(true)
      return result
    })
    expect(() => invoke(f)).toThrow("distinct native copies")
    expectReleased(f)
  })

  it.each([
    { ...linear, count: 1 },
    { ...linear, count: 257 },
    { ...linear, count: 2.5 },
    { ...linear, spacing: 0 },
    { ...linear, spacing: Infinity },
    { ...linear, spacing: 40_000 },
    { ...circular, angle: 0 },
    { ...circular, angle: 2 * Math.PI + 0.01 },
    { ...circular, angle: Number.NaN },
    { ...circular, center: [100_001, 0, 0] as Point },
    { ...circular, center: [0, NaN, 0] as Point },
  ])("rejects bounded parameter violations before native work %j", (parameters) => {
    const f = harness()
    expect(() => invoke(f, parameters)).toThrow()
    expect(f.bounds).not.toHaveBeenCalled()
    expect(f.copy).not.toHaveBeenCalled()
    expect(f.rotate).not.toHaveBeenCalled()
  })

  it("rejects final linear extent before copying and releases out-of-range rotated copies", () => {
    const f = harness()
    f.source.bounds = { min: [99_980, -3, -4], max: [99_990, 3, 4] }
    expect(() => invoke(f)).toThrow("workspace")
    expect(f.copy).not.toHaveBeenCalled()
    const rotated = harness()
    rotated.bounds
      .mockReturnValueOnce(rotated.source.bounds)
      .mockReturnValueOnce(rotated.source.bounds)
      .mockReturnValueOnce({ min: [100_001, 0, 0], max: [100_005, 6, 8] })
    expect(() => invoke(rotated, circular)).toThrow("workspace")
    expectReleased(rotated)
  })

  it.each(["constructor", "incomplete"])(
    "releases rotation temporaries after native $s failure",
    (failure) => {
      const f = harness()
      const acquired: { delete: ReturnType<typeof vi.fn> }[] = []
      class Temporary {
        delete = vi.fn()
        SetRotation_1 = vi.fn()
        constructor() {
          acquired.push(this)
        }
      }
      class Builder extends Temporary {
        constructor() {
          if (failure === "constructor") failNative()
          super()
        }
        IsDone() {
          return false
        }
      }
      const fakeOcct = {
        gp_Pnt_3: Temporary,
        gp_Dir_4: Temporary,
        gp_Ax1_2: Temporary,
        gp_Trsf_1: Temporary,
        BRepBuilderAPI_Transform_2: Builder,
      } as unknown as OpenCascadeInstance
      const operations = createOcctPatternOperations({
        copy: f.copy,
        bounds: f.bounds,
        inspect: f.inspect,
      })
      expect(() =>
        operations.patternShape(fakeOcct, f.source as unknown as Shape3D, circular),
      ).toThrow()
      for (const temporary of acquired) expect(temporary.delete).toHaveBeenCalledTimes(1)
      expectReleased(f)
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
  const analyzer = new occt.BRepCheck_Analyzer(shape.wrapped, true, false)
  const properties = new occt.GProp_GProps_1()
  const box = new occt.Bnd_Box_1()
  try {
    occt.BRepGProp.VolumeProperties_1(shape.wrapped, properties, false, false, false)
    occt.BRepBndLib.AddOptimal(shape.wrapped, box, false, false)
    const coordinates = Array.from({ length: 6 }, () => ({ current: 0 }))
    Reflect.apply(box.Get, box, coordinates)
    const center = properties.CentreOfMass()
    try {
      return {
        valid: analyzer.IsValid_2(),
        volume: properties.Mass(),
        bounds: coordinates.map(({ current }) => current),
        center: [center.X(), center.Y(), center.Z()],
        solid:
          shape.wrapped.ShapeType() === (occt.TopAbs_ShapeEnum.TopAbs_SOLID as TopAbs_ShapeEnum),
      }
    } finally {
      center.delete()
    }
  } finally {
    box.delete()
    properties.delete()
    analyzer.delete()
  }
}
function dispose(outputs: OwnedBodyPattern | null) {
  for (const output of outputs ?? []) output.shape.delete()
}
function expectIndependent(outputs: OwnedBodyPattern, source: Shape3D) {
  const sourceVolume = measure(source).volume
  for (const [index, output] of outputs.entries()) {
    const metrics = measure(output.shape)
    expect(output.role).toBe(`pattern.instance.${index}`)
    expect(metrics.valid).toBe(true)
    expect(metrics.solid).toBe(true)
    expect(metrics.volume / sourceVolume).toBeCloseTo(1, 10)
    expect(output.shape.wrapped.IsPartner(source.wrapped)).toBe(false)
    for (const previous of outputs.slice(0, index))
      expect(output.shape.wrapped.IsPartner(previous.shape.wrapped)).toBe(false)
  }
}
function expectPoint(actual: readonly number[], expected: readonly number[]) {
  expect(actual).toHaveLength(expected.length)
  expected.forEach((value, axis) => {
    expect(actual[axis]).toBeCloseTo(value, 6)
  })
}

describe("body patterns with pinned real OCCT", () => {
  it("uses an arbitrary line direction for linear and circular copies", () => {
    const source = createOcctBox(occt, [4, 6, 8], true, [10, 0, 0])
    let linearOutputs: OwnedBodyPattern | null = null
    let circularOutputs: OwnedBodyPattern | null = null
    try {
      linearOutputs = patternOcctShape(occt, source, {
        kind: "linear",
        count: 3,
        axis: [0.6, 0.8, 0],
        spacing: -10,
      })
      expectPoint(measure(linearOutputs[2]?.shape ?? source).center, [-2, -16, 0])
      expectIndependent(linearOutputs, source)
      circularOutputs = patternOcctShape(occt, source, {
        kind: "circular",
        count: 3,
        axis: [0, 0.6, 0.8],
        center: [0, 0, 0],
        angle: Math.PI,
      })
      expectPoint(measure(circularOutputs[2]?.shape ?? source).center, [-10, 0, 0])
      expectIndependent(circularOutputs, source)
      expectPoint(measure(source).center, [10, 0, 0])
    } finally {
      dispose(linearOutputs)
      dispose(circularOutputs)
      source.delete()
    }
  })

  it.each([
    { axis: "X", spacing: 10, component: 0 },
    { axis: "Y", spacing: -12, component: 1 },
    { axis: "Z", spacing: 14, component: 2 },
  ] as const)(
    "creates independent asymmetric boxes along $axis with signed spacing $spacing",
    ({ axis, spacing, component }) => {
      const source = createOcctBox(occt, [4, 6, 8], true, [3, -5, 7])
      const before = measure(source)
      const sourceDelete = vi.spyOn(source, "delete")
      let outputs: OwnedBodyPattern | null = null
      try {
        outputs = patternOcctShape(occt, source, { kind: "linear", count: 4, axis, spacing })
        expectIndependent(outputs, source)
        for (const [index, output] of outputs.entries()) {
          const expected = before.bounds.map(
            (value, coordinate) => value + (coordinate % 3 === component ? spacing * index : 0),
          )
          expectPoint(measure(output.shape).bounds, expected)
        }
        expect(measure(source)).toEqual(before)
        expect(sourceDelete).not.toHaveBeenCalled()
      } finally {
        dispose(outputs)
        source.delete()
      }
    },
  )

  it.each([
    { axis: "X", endpoint: [21, -11, 8] },
    { axis: "Y", endpoint: [15, -4, -5] },
    { axis: "Z", endpoint: [8, 3, 9] },
  ] as const)(
    "rotates about explicit nonzero center along $axis and includes a partial-span endpoint",
    ({ axis, endpoint }) => {
      const source = createOcctBox(occt, [4, 6, 8], true, [21, -4, 9])
      const before = measure(source)
      let outputs: OwnedBodyPattern | null = null
      try {
        outputs = patternOcctShape(occt, source, {
          kind: "circular",
          count: 3,
          axis,
          angle: Math.PI / 2,
          center: [11, -7, 5],
        })
        expectIndependent(outputs, source)
        expectPoint(measure(outputs[0]?.shape ?? source).center, [21, -4, 9])
        expectPoint(measure(outputs[2]?.shape ?? source).center, endpoint)
        expect(measure(source)).toEqual(before)
      } finally {
        dispose(outputs)
        source.delete()
      }
    },
  )

  it.each([1, -1])("keeps radius and unique positions for a full circle with sign %s", (sign) => {
    const source = createOcctCylinder(occt, 2, 8, [21, -7, 1])
    const before = measure(source)
    let outputs: OwnedBodyPattern | null = null
    try {
      outputs = patternOcctShape(occt, source, {
        ...circular,
        angle: sign * 2 * Math.PI,
        center: [11, -7, 5],
      })
      expectIndependent(outputs, source)
      const centers = outputs.map(({ shape }) => measure(shape).center)
      const expected = [
        [21, -7, 5],
        [11, -7 + sign * 10, 5],
        [1, -7, 5],
        [11, -7 - sign * 10, 5],
      ]
      centers.forEach((center, index) => {
        expectPoint(center, expected[index] ?? [])
        expect(Math.hypot((center[0] ?? 0) - 11, (center[1] ?? 0) + 7)).toBeCloseTo(10, 6)
      })
      expect(measure(source)).toEqual(before)
    } finally {
      dispose(outputs)
      source.delete()
    }
  })

  it("allows intersecting copies without fusing them and supports the maximum count", () => {
    const source = createOcctBox(occt, [4, 6, 8], true)
    let outputs: OwnedBodyPattern | null = null
    try {
      outputs = patternOcctShape(occt, source, {
        kind: "linear",
        count: 256,
        axis: "X",
        spacing: 0.1,
      })
      expect(outputs).toHaveLength(256)
      expectIndependent(outputs, source)
      expectPoint(measure(outputs[255]?.shape ?? source).center, [25.5, 0, 0])
      expect(outputs.reduce((volume, { shape }) => volume + measure(shape).volume, 0)).toBeCloseTo(
        256 * 192,
        6,
      )
    } finally {
      dispose(outputs)
      source.delete()
    }
  })

  it("rotates at large bounded centers even when the equivalent matrix translation exceeds the workspace cap", () => {
    const source = createOcctBox(occt, [4, 6, 8], true, [80_010, 0, 0])
    const before = measure(source)
    let outputs: OwnedBodyPattern | null = null
    try {
      outputs = patternOcctShape(occt, source, {
        kind: "circular",
        count: 2,
        axis: "Z",
        angle: Math.PI,
        center: [80_000, 0, 0],
      })
      expectIndependent(outputs, source)
      expectPoint(measure(outputs[1]?.shape ?? source).center, [79_990, 0, 0])
      expect(measure(source)).toEqual(before)
    } finally {
      dispose(outputs)
      source.delete()
    }
  })

  it("rejects a rotation leaving the workspace while preserving its exact source", () => {
    const source = createOcctBox(occt, [4, 6, 8], true, [0, 0, 0])
    const before = measure(source)
    const sourceDelete = vi.spyOn(source, "delete")
    try {
      expect(() =>
        patternOcctShape(occt, source, {
          kind: "circular",
          count: 2,
          axis: "Z",
          angle: Math.PI,
          center: [80_000, 0, 0],
        }),
      ).toThrow("workspace")
      expect(measure(source)).toEqual(before)
      expect(sourceDelete).not.toHaveBeenCalled()
    } finally {
      source.delete()
    }
  })
})
