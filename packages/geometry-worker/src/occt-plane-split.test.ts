// @vitest-environment node
import { type Shape3D, setOC } from "replicad"
import initializeOpenCascade, {
  type OpenCascadeInstance,
  type TopAbs_ShapeEnum,
} from "replicad-opencascadejs"
import { beforeAll, describe, expect, it, vi } from "vitest"
import { placeOcctShape } from "./occt-placement"
import {
  createOcctPlaneSplitOperations,
  type OwnedPlaneSplit,
  type PlaneSplitParameters,
  splitOcctShape,
} from "./occt-plane-split"
import { createOcctBox, createOcctCylinder, fuseOcctShapes } from "./occt-shapes"

type Point = [number, number, number]
type Bounds = { min: Point; max: Point }
function harness() {
  const shape = (bounds: Bounds) => ({ wrapped: {}, bounds, delete: vi.fn() })
  const source = shape({ min: [-2, -3, -5], max: [2, 3, 5] })
  const copies: ReturnType<typeof shape>[] = []
  const boxes: ReturnType<typeof shape>[] = []
  const outputs: ReturnType<typeof shape>[] = []
  const bounds = vi.fn(
    (_occt: OpenCascadeInstance, s: Shape3D) => (s as unknown as typeof source).bounds,
  )
  const inspect = vi.fn((_occt: OpenCascadeInstance, s: Shape3D) => {
    const b = (s as unknown as typeof source).bounds
    return {
      valid: true,
      solidCount: 1,
      volume: (b.max[0] - b.min[0]) * (b.max[1] - b.min[1]) * (b.max[2] - b.min[2]),
    }
  })
  const copy = vi.fn((_occt: OpenCascadeInstance, s: Shape3D) => {
    const copied = shape((s as unknown as typeof source).bounds)
    copies.push(copied)
    return copied as unknown as Shape3D
  })
  const box = vi.fn((_occt: OpenCascadeInstance, b: Bounds) => {
    const tool = shape(b)
    boxes.push(tool)
    return tool as unknown as Shape3D
  })
  const common = vi.fn((_occt: OpenCascadeInstance, s: Shape3D, t: Shape3D) => {
    const body = (s as unknown as typeof source).bounds
    const tool = (t as unknown as typeof source).bounds
    const result = shape({
      min: [
        Math.max(body.min[0], tool.min[0]),
        Math.max(body.min[1], tool.min[1]),
        Math.max(body.min[2], tool.min[2]),
      ],
      max: [
        Math.min(body.max[0], tool.max[0]),
        Math.min(body.max[1], tool.max[1]),
        Math.min(body.max[2], tool.max[2]),
      ],
    })
    outputs.push(result)
    return result as unknown as Shape3D
  })
  const confusion = vi.fn(() => 1e-7)
  const operations = createOcctPlaneSplitOperations({
    bounds,
    inspect,
    copy,
    box,
    common,
    confusion,
  })
  return {
    source,
    copies,
    boxes,
    outputs,
    bounds,
    inspect,
    copy,
    box,
    common,
    confusion,
    operations,
    occt: {} as OpenCascadeInstance,
  }
}

function failNative(): never {
  throw new Error("Native fixture failure")
}

const failureCases: { stage: string; inject: (fixture: ReturnType<typeof harness>) => void }[] = [
  { stage: "copy", inject: (f) => f.copy.mockImplementation(failNative) },
  { stage: "negative-box", inject: (f) => f.box.mockImplementation(failNative) },
  { stage: "negative-common", inject: (f) => f.common.mockImplementation(failNative) },
  {
    stage: "positive-box",
    inject: (f) => {
      const original = f.box.getMockImplementation()
      if (!original) throw new Error("Missing box fixture")
      f.box.mockImplementationOnce(original).mockImplementationOnce(failNative)
    },
  },
  {
    stage: "positive-common",
    inject: (f) => {
      const original = f.common.getMockImplementation()
      if (!original) throw new Error("Missing common fixture")
      f.common.mockImplementationOnce(original).mockImplementationOnce(failNative)
    },
  },
  {
    stage: "inspection",
    inject: (f) =>
      f.inspect
        .mockReturnValueOnce({ valid: true, solidCount: 1, volume: 240 })
        .mockImplementationOnce(failNative),
  },
  {
    stage: "bounds",
    inject: (f) => f.bounds.mockReturnValueOnce(f.source.bounds).mockImplementationOnce(failNative),
  },
]

describe("owned exact origin-plane split", () => {
  it.each(["XY", "XZ", "YZ"] as const)(
    "returns stable negative and positive sides for %s",
    (plane) => {
      const f = harness()
      const result = f.operations.splitShape(f.occt, f.source as unknown as Shape3D, {
        plane,
        offset: 1,
      })
      const axis = plane === "XY" ? 2 : plane === "XZ" ? 1 : 0
      expect(result.negative).toBe(f.outputs[0])
      expect(result.positive).toBe(f.outputs[1])
      expect(f.outputs[0]?.bounds.max[axis]).toBe(1)
      expect(f.outputs[1]?.bounds.min[axis]).toBe(1)
      expect(f.copy).toHaveBeenCalledWith(f.occt, f.source)
      for (const temporary of [...f.copies, ...f.boxes])
        expect(temporary.delete).toHaveBeenCalledOnce()
      for (const output of f.outputs) expect(output.delete).not.toHaveBeenCalled()
      expect(f.source.delete).not.toHaveBeenCalled()
      result.negative.delete()
      result.positive.delete()
      for (const output of f.outputs) expect(output.delete).toHaveBeenCalledOnce()
    },
  )

  it("derives finite clip bounds from large source bounds rather than using a fixed tool extent", () => {
    const f = harness()
    f.source.bounds = { min: [-99_990, -60_000, -70_000], max: [-99_980, 40_000, 30_000] }
    f.operations.splitShape(f.occt, f.source as unknown as Shape3D, {
      plane: "YZ",
      offset: -99_985,
    })
    const lower = f.boxes[0]?.bounds
    const upper = f.boxes[1]?.bounds
    expect(lower?.min[0]).toBeLessThan(f.source.bounds.min[0])
    expect(upper?.max[0]).toBeGreaterThan(f.source.bounds.max[0])
    expect(lower?.max[0]).toBe(-99_985)
    expect(upper?.min[0]).toBe(-99_985)
    for (const axis of [1, 2] as const) {
      expect(lower?.min[axis]).toBeLessThan(f.source.bounds.min[axis])
      expect(lower?.max[axis]).toBeGreaterThan(f.source.bounds.max[axis])
      expect(upper?.min[axis]).toBe(lower?.min[axis])
      expect(upper?.max[axis]).toBe(lower?.max[axis])
    }
  })

  it.each(failureCases)(
    "releases every acquired shape after $stage failure without deleting the source",
    ({ inject }) => {
      const f = harness()
      inject(f)
      expect(() =>
        f.operations.splitShape(f.occt, f.source as unknown as Shape3D, { plane: "XY", offset: 1 }),
      ).toThrow("Native fixture failure")
      for (const owned of [...f.copies, ...f.boxes, ...f.outputs])
        expect(owned.delete).toHaveBeenCalledOnce()
      expect(f.source.delete).not.toHaveBeenCalled()
    },
  )

  it.each([
    { valid: false, solidCount: 1, volume: 240 },
    { valid: true, solidCount: 2, volume: 240 },
    { valid: true, solidCount: 1, volume: 0 },
    { valid: true, solidCount: 1, volume: -1 },
    { valid: true, solidCount: 1, volume: Infinity },
  ])("rejects invalid or multiple source solids before copying %j", (metrics) => {
    const f = harness()
    f.inspect.mockReturnValue(metrics)
    expect(() =>
      f.operations.splitShape(f.occt, f.source as unknown as Shape3D, { plane: "XY", offset: 1 }),
    ).toThrow()
    expect(f.copy).not.toHaveBeenCalled()
    expect(f.source.delete).not.toHaveBeenCalled()
  })

  it.each([
    { valid: false, solidCount: 1, volume: 144 },
    { valid: true, solidCount: 2, volume: 144 },
    { valid: true, solidCount: 0, volume: 0 },
    { valid: true, solidCount: 1, volume: Number.NaN },
  ])("rejects an invalid or disconnected half and releases both acquired outputs %j", (metrics) => {
    const f = harness()
    f.inspect
      .mockImplementationOnce(() => ({ valid: true, solidCount: 1, volume: 240 }))
      .mockImplementationOnce(() => metrics)
    expect(() =>
      f.operations.splitShape(f.occt, f.source as unknown as Shape3D, { plane: "XY", offset: 1 }),
    ).toThrow()
    for (const owned of [...f.copies, ...f.boxes, ...f.outputs])
      expect(owned.delete).toHaveBeenCalledOnce()
    expect(f.source.delete).not.toHaveBeenCalled()
  })

  it("rejects volume loss and disposes the untransferred output bundle", () => {
    const f = harness()
    f.inspect
      .mockReturnValueOnce({ valid: true, solidCount: 1, volume: 240 })
      .mockReturnValueOnce({ valid: true, solidCount: 1, volume: 100 })
      .mockReturnValueOnce({ valid: true, solidCount: 1, volume: 100 })
    expect(() =>
      f.operations.splitShape(f.occt, f.source as unknown as Shape3D, { plane: "XY", offset: 1 }),
    ).toThrow("conserve")
    for (const owned of [...f.copies, ...f.boxes, ...f.outputs])
      expect(owned.delete).toHaveBeenCalledOnce()
  })

  it("discards outputs and attempts every release after a temporary deletion failure", () => {
    const f = harness()
    const original = f.copy.getMockImplementation()
    if (!original) throw new Error("Missing copy fixture")
    f.copy.mockImplementation((occt, source) => {
      const copied = original(occt, source)
      f.copies[0]?.delete.mockImplementation(() => {
        throw new Error("Deletion failed")
      })
      return copied
    })
    expect(() =>
      f.operations.splitShape(f.occt, f.source as unknown as Shape3D, { plane: "XY", offset: 1 }),
    ).toThrow("release every")
    for (const owned of [...f.copies, ...f.boxes, ...f.outputs])
      expect(owned.delete).toHaveBeenCalledOnce()
    expect(f.source.delete).not.toHaveBeenCalled()
  })

  it.each([-6, -5, 5, 6])(
    "rejects a missed or tangent plane at offset %s before copying",
    (offset) => {
      const f = harness()
      expect(() =>
        f.operations.splitShape(f.occt, f.source as unknown as Shape3D, { plane: "XY", offset }),
      ).toThrow()
      expect(f.copy).not.toHaveBeenCalled()
    },
  )

  it.each([Number.NaN, Infinity, -Infinity, -100_001, 100_001])(
    "rejects invalid offset %s before native inspection",
    (offset) => {
      const f = harness()
      expect(() =>
        f.operations.splitShape(f.occt, f.source as unknown as Shape3D, { plane: "XY", offset }),
      ).toThrow()
      expect(f.inspect).not.toHaveBeenCalled()
      expect(f.copy).not.toHaveBeenCalled()
    },
  )

  it("rejects an unsupported plane and non-finite or out-of-range source bounds", () => {
    const f = harness()
    const unsupported = { plane: "custom", offset: 0 }
    const source = f.source as unknown as Shape3D
    expect(() => {
      // @ts-expect-error Deliberately exercise an untrusted plane discriminator.
      f.operations.splitShape(f.occt, source, unsupported)
    }).toThrow()
    expect(f.inspect).not.toHaveBeenCalled()
    for (const x of [Number.NaN, -Infinity, -100_001]) {
      f.source.bounds = { min: [x, -3, -5], max: [2, 3, 5] }
      expect(() =>
        f.operations.splitShape(f.occt, f.source as unknown as Shape3D, { plane: "XY", offset: 0 }),
      ).toThrow()
    }
    expect(f.copy).not.toHaveBeenCalled()
  })

  it("enforces volume conservation relative to small source volumes", () => {
    const f = harness()
    f.source.bounds = { min: [-0.0005, -0.0005, -0.0005], max: [0.0005, 0.0005, 0.0005] }
    f.inspect
      .mockReturnValueOnce({ valid: true, solidCount: 1, volume: 1e-9 })
      .mockReturnValueOnce({ valid: true, solidCount: 1, volume: 4e-10 })
      .mockReturnValueOnce({ valid: true, solidCount: 1, volume: 5e-10 })
    expect(() =>
      f.operations.splitShape(f.occt, f.source as unknown as Shape3D, { plane: "XY", offset: 0 }),
    ).toThrow("conserve")
    for (const output of f.outputs) expect(output.delete).toHaveBeenCalledOnce()
  })
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
    occt.BRepBndLib.AddOptimal(shape.wrapped, box, false, true)
    const values = Array.from({ length: 6 }, () => ({ current: 0 }))
    Reflect.apply(box.Get, box, values)
    return {
      valid: analyzer.IsValid_2(),
      volume: properties.Mass(),
      bounds: values.map(({ current }) => current),
      rootIsSolid:
        shape.wrapped.ShapeType() === (occt.TopAbs_ShapeEnum.TopAbs_SOLID as TopAbs_ShapeEnum),
    }
  } finally {
    box.delete()
    properties.delete()
    analyzer.delete()
  }
}

function dispose(split: OwnedPlaneSplit | null) {
  try {
    split?.negative.delete()
  } finally {
    split?.positive.delete()
  }
}

function assertSides(source: Shape3D, split: OwnedPlaneSplit, parameters: PlaneSplitParameters) {
  const before = measure(source)
  const negative = measure(split.negative)
  const positive = measure(split.positive)
  const axis = parameters.plane === "XY" ? 2 : parameters.plane === "XZ" ? 1 : 0
  expect(negative.valid).toBe(true)
  expect(positive.valid).toBe(true)
  expect(negative.rootIsSolid).toBe(true)
  expect(positive.rootIsSolid).toBe(true)
  expect(negative.volume).toBeGreaterThan(0)
  expect(positive.volume).toBeGreaterThan(0)
  expect((negative.volume + positive.volume) / before.volume).toBeCloseTo(1, 10)
  expect(negative.bounds[axis + 3]).toBeCloseTo(parameters.offset, 5)
  expect(positive.bounds[axis]).toBeCloseTo(parameters.offset, 5)
}

describe("origin-plane split with pinned real OCCT", () => {
  it.each([
    { plane: "XY", offset: 4, axis: 2, min: -3, max: 14 },
    { plane: "XZ", offset: -4, axis: 1, min: -6, max: 0 },
    { plane: "YZ", offset: 3, axis: 0, min: 1, max: 5 },
  ] as const)(
    "splits an asymmetric box at $plane/$offset and preserves its exact source",
    ({ plane, offset, axis, min, max }) => {
      const source = createOcctBox(occt, [4, 6, 17], false, [3, -3, -3])
      const before = measure(source)
      const sourceDelete = vi.spyOn(source, "delete")
      let result: OwnedPlaneSplit | null = null
      try {
        result = splitOcctShape(occt, source, { plane, offset })
        assertSides(source, result, { plane, offset })
        expect(measure(result.negative).volume / before.volume).toBeCloseTo(
          (offset - min) / (max - min),
          10,
        )
        expect(measure(source)).toEqual(before)
        expect(sourceDelete).not.toHaveBeenCalled()
        expect(measure(result.negative).bounds[axis]).toBeCloseTo(min, 5)
        expect(measure(result.positive).bounds[axis + 3]).toBeCloseTo(max, 5)
      } finally {
        dispose(result)
        source.delete()
      }
    },
  )

  it.each([
    { plane: "XY", offset: 5 },
    { plane: "XZ", offset: -5 },
    { plane: "YZ", offset: 4 },
    { plane: "YZ", offset: 5 },
  ] as const)(
    "splits curved cylinder geometry at $plane/$offset without tessellation",
    (parameters) => {
      const source = createOcctCylinder(occt, 3, 17, [4, -5, -3])
      const before = measure(source)
      let result: OwnedPlaneSplit | null = null
      try {
        result = splitOcctShape(occt, source, parameters)
        assertSides(source, result, parameters)
        const fraction =
          parameters.plane === "XY"
            ? 8 / 17
            : parameters.offset === 5
              ? 1 - (9 * Math.acos(1 / 3) - Math.sqrt(8)) / (9 * Math.PI)
              : 0.5
        expect(measure(result.negative).volume / before.volume).toBeCloseTo(fraction, 8)
        expect(measure(source)).toEqual(before)
      } finally {
        dispose(result)
        source.delete()
      }
    },
  )

  it.each(["XY", "XZ", "YZ"] as const)("covers large bounded coordinates across %s", (plane) => {
    const source = createOcctBox(occt, [90_000, 80_000, 70_000], true, [-40_000, 35_000, -30_000])
    const offset = plane === "XY" ? -30_000 : plane === "XZ" ? 35_000 : -40_000
    const before = measure(source)
    let result: OwnedPlaneSplit | null = null
    try {
      result = splitOcctShape(occt, source, { plane, offset })
      assertSides(source, result, { plane, offset })
      expect(measure(result.negative).volume / before.volume).toBeCloseTo(0.5, 10)
      expect(measure(source)).toEqual(before)
    } finally {
      dispose(result)
      source.delete()
    }
  })

  it.each([-3, 14, -4, 15])(
    "rejects a missed or tangent box plane at %s without deleting the source",
    (offset) => {
      const source = createOcctBox(occt, [4, 6, 17], false, [3, -3, -3])
      const before = measure(source)
      const sourceDelete = vi.spyOn(source, "delete")
      try {
        expect(() => splitOcctShape(occt, source, { plane: "XY", offset })).toThrow()
        expect(measure(source)).toEqual(before)
        expect(sourceDelete).not.toHaveBeenCalled()
      } finally {
        source.delete()
      }
    },
  )

  it.each([0, 16])(
    "rejects disconnected output halves of a connected source with bridge at Z=%s",
    (z) => {
      const left = createOcctBox(occt, [4, 4, 20], false, [-6, 0, 0])
      const right = createOcctBox(occt, [4, 4, 20], false, [6, 0, 0])
      const bridge = createOcctBox(occt, [16, 4, 4], false, [0, 0, z])
      let intermediate: Shape3D | null = null
      let source: Shape3D | null = null
      try {
        intermediate = fuseOcctShapes(occt, left, bridge)
        source = fuseOcctShapes(occt, intermediate, right)
        const before = measure(source)
        expect(before.valid).toBe(true)
        expect(() => splitOcctShape(occt, source as Shape3D, { plane: "XY", offset: 10 })).toThrow(
          "exactly one solid",
        )
        expect(measure(source)).toEqual(before)
      } finally {
        source?.delete()
        intermediate?.delete()
        bridge.delete()
        right.delete()
        left.delete()
      }
    },
  )

  it("releases the exact native source copy on success and on tangent failure", () => {
    const source = createOcctBox(occt, [4, 6, 17], false, [3, -3, -3])
    const copies: { shape: Shape3D; deletion: ReturnType<typeof vi.spyOn> }[] = []
    const operations = createOcctPlaneSplitOperations({
      copy: (kernel, original) => {
        const shape = placeOcctShape(kernel, original, {
          translation: [0, 0, 0],
          rotation: [0, 0, 0],
        })
        copies.push({ shape, deletion: vi.spyOn(shape, "delete") })
        return shape
      },
    })
    let result: OwnedPlaneSplit | null = null
    try {
      result = operations.splitShape(occt, source, { plane: "XY", offset: 5 })
      expect(() => operations.splitShape(occt, source, { plane: "XY", offset: -3 })).toThrow()
      expect(copies).toHaveLength(2)
      for (const copy of copies) expect(copy.deletion).toHaveBeenCalledOnce()
      expect(measure(source).valid).toBe(true)
    } finally {
      dispose(result)
      source.delete()
    }
  })
})
