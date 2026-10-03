// @vitest-environment node
import { makeCylinder, measureVolume, type Shape3D, setOC } from "replicad"
import initializeOpenCascade, { type OpenCascadeInstance } from "replicad-opencascadejs"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import {
  type AnalyticalProfile,
  createAnalyticalFace,
  createOcctLoft,
  validateOcctProfileSolid,
} from "./occt-loft"
import { type AnalyticalSweepPath, createOcctSweep } from "./occt-sweep"

const id = (value: number) => `018f0000-0000-7000-8000-${String(value).padStart(12, "0")}`
const xyFrame = {
  origin: [0, 0, 0],
  xAxis: [1, 0, 0],
  yAxis: [0, 1, 0],
  normal: [0, 0, 1],
} as const
function rectangle(width: number, depth: number, z: number): AnalyticalProfile {
  const points: [number, number][] = [
    [-width / 2, -depth / 2],
    [width / 2, -depth / 2],
    [width / 2, depth / 2],
    [-width / 2, depth / 2],
  ]
  const segments = points.map((start, index) => ({
    entityId: id(index + 1) as never,
    type: "line" as const,
    startPointId: id(index + 10) as never,
    endPointId: id(((index + 1) % 4) + 10) as never,
    start,
    end: points[(index + 1) % 4] as [number, number],
  }))
  return {
    frame: { ...xyFrame, origin: [0, 0, z], xAxis: [1, 0, 0], yAxis: [0, 1, 0], normal: [0, 0, 1] },
    outer: { sourceEntityIds: segments.map(({ entityId }) => entityId), segments },
    holes: [],
  }
}
const profile: AnalyticalProfile = {
  frame: { origin: [0, 0, 0], xAxis: [1, 0, 0], yAxis: [0, 0, -1], normal: [0, 1, 0] },
  outer: {
    sourceEntityIds: [id(1)],
    segments: [{ entityId: id(1) as never, type: "circle", center: [0, 0], radius: 2 }],
  },
  holes: [
    {
      sourceEntityIds: [id(2)],
      segments: [{ entityId: id(2) as never, type: "circle", center: [0, 0], radius: 1 }],
    },
  ],
}
function straightPath(): AnalyticalSweepPath {
  return {
    frame: { ...xyFrame, origin: [0, 0, 0], xAxis: [1, 0, 0], yAxis: [0, 1, 0], normal: [0, 0, 1] },
    sourceEntityIds: [id(20)],
    segments: [
      {
        entityId: id(20) as never,
        type: "line",
        startPointId: id(30) as never,
        endPointId: id(31) as never,
        start: [0, 0],
        end: [0, 10],
      },
    ],
  }
}
function curvedPath(): AnalyticalSweepPath {
  const path = straightPath()
  return {
    ...path,
    sourceEntityIds: [id(20), id(21)],
    segments: [
      { ...path.segments[0], end: [0, 5] } as AnalyticalSweepPath["segments"][number],
      {
        entityId: id(21) as never,
        type: "arc",
        startPointId: id(31) as never,
        endPointId: id(32) as never,
        start: [0, 5],
        middle: [5 - 5 / Math.SQRT2, 5 + 5 / Math.SQRT2],
        end: [5, 10],
      },
    ],
  }
}
function expectBounds(shape: Shape3D, expected: readonly (readonly number[])[]) {
  const box = new occt.Bnd_Box_1()
  try {
    occt.BRepBndLib.AddOptimal(shape.wrapped, box, false, true)
    const coordinates = Array.from({ length: 6 }, () => ({ current: 0 }))
    Reflect.apply(box.Get, box, coordinates)
    const bounds = [coordinates.slice(0, 3), coordinates.slice(3)]
    for (const side of [0, 1] as const)
      for (const axis of [0, 1, 2] as const)
        expect(bounds[side]?.[axis]?.current).toBeCloseTo(expected[side]?.[axis] ?? 0, 4)
  } finally {
    box.delete()
  }
}

let occt: OpenCascadeInstance
let cachedSource: Shape3D
beforeAll(async () => {
  const wasmPath = new URL(
    "../node_modules/replicad-opencascadejs/src/replicad_single.wasm",
    import.meta.url,
  )
  occt = await Reflect.apply(initializeOpenCascade, undefined, [
    { locateFile: () => wasmPath.pathname },
  ])
  setOC(occt)
  cachedSource = makeCylinder(3, 7, [10, 20, 30])
}, 60_000)
afterAll(() => cachedSource?.delete())

describe("Sweep and Loft with installed Replicad 0.23.1 / OCCT package 0.23.0", () => {
  it.each([19, 24])(
    "builds %i exact ordered Loft sections with unchanged source geometry",
    (count) => {
      const sections = Array.from({ length: count }, (_, index) => rectangle(2, 4, index))
      const before = structuredClone(sections)
      const shape = createOcctLoft(occt, sections, { ruled: false })
      try {
        validateOcctProfileSolid(occt, shape)
        expect(measureVolume(shape)).toBeCloseTo(8 * (count - 1), 6)
        expectBounds(shape, [
          [-1, -2, 0],
          [1, 2, count - 1],
        ])
        expect(sections).toEqual(before)
        expect(measureVolume(cachedSource)).toBeCloseTo(63 * Math.PI, 6)
      } finally {
        shape.delete()
      }
    },
  )
  it.each([true, false])(
    "builds exact differing rectangle sections with ruled=%s and preserves analytical/native sources",
    (ruled) => {
      const sections = [rectangle(2, 4, 0), rectangle(4, 6, 10)]
      const before = structuredClone(sections)
      const shape = createOcctLoft(occt, sections, { ruled })
      try {
        validateOcctProfileSolid(occt, shape)
        expect(measureVolume(shape)).toBeCloseTo(460 / 3, 6)
        expectBounds(shape, [
          [-2, -3, 0],
          [2, 3, 10],
        ])
        expect(sections).toEqual(before)
        expect(measureVolume(cachedSource)).toBeCloseTo(63 * Math.PI, 6)
        expectBounds(cachedSource, [
          [7, 17, 30],
          [13, 23, 37],
        ])
      } finally {
        shape.delete()
      }
    },
  )
  it.each([true, false])("builds three nonuniform ordered sections with ruled=%s", (ruled) => {
    const shape = createOcctLoft(
      occt,
      [rectangle(2, 4, 0), rectangle(5, 3, 5), rectangle(4, 6, 10)],
      { ruled },
    )
    try {
      validateOcctProfileSolid(occt, shape)
      expect(measureVolume(shape)).toBeGreaterThan(80)
      expect(measureVolume(shape)).toBeLessThan(300)
    } finally {
      shape.delete()
    }
  })
  it("fails closed for coplanar and self-intersecting sections", () => {
    expect(() =>
      createOcctLoft(occt, [rectangle(2, 4, 0), rectangle(4, 6, 0)], { ruled: true }),
    ).toThrow("same plane")
    const bad = rectangle(4, 4, 10)
    const points: [number, number][] = [
      [-2, -2],
      [2, 2],
      [-2, 2],
      [2, -2],
    ]
    for (const [index, segment] of bad.outer.segments.entries()) {
      if (segment.type !== "line") throw new Error("Expected line fixture.")
      segment.start = points[index] as [number, number]
      segment.end = points[(index + 1) % 4] as [number, number]
    }
    expect(() => createOcctLoft(occt, [rectangle(2, 4, 0), bad], { ruled: false })).toThrow(
      "The analytical profile face is invalid.",
    )
  })
  it.each([false, true])("sweeps an exact holed profile through a %s curved G1 path", (curved) => {
    const path = curved ? curvedPath() : straightPath()
    const before = structuredClone({ profile, path })
    const shape = createOcctSweep(occt, { profile, path })
    try {
      validateOcctProfileSolid(occt, shape)
      expect(measureVolume(shape)).toBeCloseTo(3 * Math.PI * (curved ? 5 + 2.5 * Math.PI : 10), 5)
      expectBounds(
        shape,
        curved
          ? [
              [-2, 0, -2],
              [5, 12, 2],
            ]
          : [
              [-2, 0, -2],
              [2, 10, 2],
            ],
      )
      expect({ profile, path }).toEqual(before)
      expect(measureVolume(cachedSource)).toBeCloseTo(63 * Math.PI, 6)
    } finally {
      shape.delete()
    }
  })
  it("keeps cached input wrappers live through repeated success and native failure cleanup", () => {
    const face = createAnalyticalFace(occt, profile)
    try {
      for (let index = 0; index < 12; index += 1) {
        const loft = createOcctLoft(occt, [rectangle(2, 4, 0), rectangle(4, 6, 10)], {
          ruled: index % 2 === 0,
        })
        loft.delete()
        const sweep = createOcctSweep(occt, { profile, path: curvedPath() })
        sweep.delete()
      }
      expect(face.wrapped.IsNull()).toBe(false)
      expect(measureVolume(cachedSource)).toBeCloseTo(63 * Math.PI, 6)
      const analyzer = new occt.BRepCheck_Analyzer(face.wrapped, true, false)
      try {
        expect(analyzer.IsValid_2()).toBe(true)
      } finally {
        analyzer.delete()
      }
    } finally {
      face.delete()
    }
  })
})
