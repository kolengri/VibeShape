// @vitest-environment node
import { makeBox, measureVolume, type Shape3D, setOC } from "replicad"
import initializeOpenCascade, {
  type OpenCascadeInstance,
  type TopoDS_Shape,
} from "replicad-opencascadejs"
import { beforeAll, describe, expect, it, vi } from "vitest"
import { exportOcctAssemblyStep } from "./occt-assembly-export"
import { inspectOcctBody } from "./occt-body-validation"
import { importOcctStep } from "./occt-exchange"

let occt: OpenCascadeInstance
beforeAll(async () => {
  const path = new URL(
    "../node_modules/replicad-opencascadejs/src/replicad_single.wasm",
    import.meta.url,
  )
  occt = await Reflect.apply(initializeOpenCascade, undefined, [
    { locateFile: () => path.pathname },
  ])
  setOC(occt)
}, 60_000)
const pose = (x = 0) => ({
  translation: [x, 0, 0] as [number, number, number],
  quaternion: [0, 0, 0, 1] as [number, number, number, number],
})
function bounds(shape: Shape3D) {
  const box = shape.boundingBox
  try {
    return box.bounds.map((point) => [...point])
  } finally {
    box.delete()
  }
}
function ownedCopies() {
  const copies: { shape: TopoDS_Shape; dispose: ReturnType<typeof vi.spyOn> }[] = []
  const original = occt.BRepBuilderAPI_Transform_2.prototype.Shape
  vi.spyOn(occt.BRepBuilderAPI_Transform_2.prototype, "Shape").mockImplementation(function (
    this: unknown,
  ) {
    const shape: TopoDS_Shape = Reflect.apply(original, this, [])
    copies.push({ shape, dispose: vi.spyOn(shape, "delete") })
    return shape
  })
  return copies
}
function assertDisposed(copies: ReturnType<typeof ownedCopies>, expected: number) {
  expect(copies).toHaveLength(expected)
  for (const copy of copies) {
    expect(copy.dispose).toHaveBeenCalledOnce()
  }
}

describe("placed independent assembly STEP solids", () => {
  it("round trips rotated and translated disconnected bodies without changing native sources", () => {
    const first = makeBox([0, 0, 0], [2, 3, 4]),
      second = makeBox([0, 0, 0], [1, 2, 3])
    const copies = ownedCopies()
    let imported: Shape3D | undefined
    try {
      const q = Math.SQRT1_2
      const file = exportOcctAssemblyStep(occt, [
        { shape: first, pose: { translation: [10, 20, 30], quaternion: [0, 0, q, q] } },
        { shape: second, pose: pose(-10) },
      ])
      assertDisposed(copies, 2)
      imported = importOcctStep(occt, file)
      expect(inspectOcctBody(occt, imported)).toMatchObject({ valid: true, solidCount: 2 })
      expect(measureVolume(imported)).toBeCloseTo(30, 7)
      const actual = bounds(imported)
      for (const [index, expected] of [
        [0, [-10, 0, 0]],
        [1, [10, 22, 34]],
      ] as const)
        for (let axis = 0; axis < 3; axis++)
          expect(actual[index]?.[axis]).toBeCloseTo(expected[axis] ?? NaN, 5)
      expect(measureVolume(first)).toBeCloseTo(24, 7)
      expect(measureVolume(second)).toBeCloseTo(6, 7)
      const sourceBounds = bounds(first)
      for (let axis = 0; axis < 3; axis++) {
        expect(sourceBounds[0]?.[axis]).toBeCloseTo(0, 5)
        expect(sourceBounds[1]?.[axis]).toBeCloseTo([2, 3, 4][axis] ?? NaN, 5)
      }
    } finally {
      imported?.delete()
      vi.restoreAllMocks()
      second.delete()
      first.delete()
    }
  })
  it("keeps overlapping source solids independent instead of fusing their material", () => {
    const source = makeBox([0, 0, 0], [2, 3, 4])
    let imported: Shape3D | undefined
    try {
      imported = importOcctStep(
        occt,
        exportOcctAssemblyStep(occt, [
          { shape: source, pose: pose() },
          { shape: source, pose: pose() },
        ]),
      )
      expect(inspectOcctBody(occt, imported).solidCount).toBe(2)
      expect(measureVolume(imported)).toBeCloseTo(48, 7)
      expect(measureVolume(source)).toBeCloseTo(24, 7)
    } finally {
      imported?.delete()
      source.delete()
    }
  })
  it("releases each acquired copy exactly once after a later placement or writer failure", () => {
    const source = makeBox([0, 0, 0], [2, 3, 4])
    try {
      const invalidCopies = ownedCopies()
      expect(() =>
        exportOcctAssemblyStep(occt, [
          { shape: source, pose: pose() },
          { shape: source, pose: pose(100_000) },
        ]),
      ).toThrow("world bounds")
      assertDisposed(invalidCopies, 2)
      vi.restoreAllMocks()
      const writerCopies = ownedCopies()
      vi.spyOn(occt.STEPControl_Writer_1.prototype, "Write").mockImplementation(() => {
        throw new Error("Injected STEP writer failure")
      })
      expect(() =>
        exportOcctAssemblyStep(occt, [
          { shape: source, pose: pose() },
          { shape: source, pose: pose(5) },
        ]),
      ).toThrow("Injected STEP writer failure")
      assertDisposed(writerCopies, 2)
      expect(measureVolume(source)).toBeCloseTo(24, 7)
    } finally {
      vi.restoreAllMocks()
      source.delete()
    }
  })
  it("rejects missing, oversized and invalid-pose selections before output publication", () => {
    const source = makeBox([0, 0, 0], [2, 3, 4])
    const copies = ownedCopies()
    try {
      expect(() => exportOcctAssemblyStep(occt, [])).toThrow("between one and 4096")
      expect(() =>
        exportOcctAssemblyStep(
          occt,
          Array.from({ length: 4097 }, () => ({ shape: source, pose: pose() })),
        ),
      ).toThrow("between one and 4096")
      expect(() =>
        exportOcctAssemblyStep(occt, [
          { shape: source, pose: { ...pose(), quaternion: [0, 0, 0, 2] } },
        ]),
      ).toThrow()
      assertDisposed(copies, 0)
    } finally {
      vi.restoreAllMocks()
      source.delete()
    }
  })
})
