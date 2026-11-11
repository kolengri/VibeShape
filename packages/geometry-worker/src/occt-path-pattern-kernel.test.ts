import { beforeAll, describe, expect, it } from "bun:test"
import type { PatternFeatureContentParametersV3 } from "@vibeshape/protocol"
import { measureShapeVolumeProperties, type Shape3D, setOC } from "replicad"
import initializeOpenCascade, { type OpenCascadeInstance } from "replicad-opencascadejs"
import { inspectOcctBody } from "./occt-body-validation"
import { samplePathPatternPlacements } from "./occt-path-sampling"
import { createOcctPatternOperations, patternOcctShape } from "./occt-pattern"
import { placeOcctShape } from "./occt-placement"
import { createOcctBox } from "./occt-shapes"

let occt: OpenCascadeInstance
beforeAll(async () => {
  const { readFileSync } = await import("node:fs")
  occt = await Reflect.apply(initializeOpenCascade, undefined, [
    {
      wasmBinary: new Uint8Array(
        readFileSync(
          new URL(
            "../node_modules/replicad-opencascadejs/src/replicad_single.wasm",
            import.meta.url,
          ),
        ),
      ),
    },
  ])
  setOC(occt)
})

type Path = PatternFeatureContentParametersV3["path"]
type Geometry = Path["geometry"]
type Point2 = [number, number]
type Point3 = [number, number, number]
const id = (value: number) => `018f0000-0000-7000-8000-${String(value).padStart(12, "0")}`
const frame = {
  origin: [0, 0, 0] as Point3,
  xAxis: [1, 0, 0] as Point3,
  yAxis: [0, 1, 0] as Point3,
  normal: [0, 0, 1] as Point3,
}
const TOLERANCE = 1e-6

function line(entity: number, start: Point2, end: Point2) {
  return {
    entityId: id(entity),
    type: "line" as const,
    startPointId: id(entity + 100),
    endPointId: id(entity + 200),
    start,
    end,
  }
}

function arc(entity: number, start: Point2, middle: Point2, end: Point2) {
  return {
    entityId: id(entity),
    type: "arc" as const,
    startPointId: id(entity + 100),
    endPointId: id(entity + 200),
    start,
    middle,
    end,
  }
}

function chain(segments: Extract<Geometry, { kind: "chain" }>["segments"], closed = false): Path {
  return {
    sketchId: id(900),
    frame,
    sourceEntityIds: segments.map(({ entityId }) => entityId).sort(),
    startPointId: segments[0]?.startPointId ?? id(0),
    geometry: { kind: "chain", closed, segments },
  }
}

function circle(radius: number, startAngle = 0): Path {
  return {
    sketchId: id(900),
    frame,
    sourceEntityIds: [id(1)],
    startPointId: id(2),
    geometry: {
      kind: "circle",
      circle: { entityId: id(1), type: "circle", center: [0, 0], radius },
      startAngle,
    },
  }
}

function parameters(
  path: Path,
  overrides: Partial<PatternFeatureContentParametersV3> = {},
): PatternFeatureContentParametersV3 {
  return {
    kind: "path",
    count: 3,
    path,
    spacing: { mode: "equal" },
    startOffset: 0,
    orientation: "translate",
    reverse: false,
    ...overrides,
  }
}

/** A 2 mm cube centered on `center`; its centroid is the tracked analytic point. */
function cube(center: Point3) {
  return createOcctBox(occt, [2, 2, 2], true, center)
}

function centroid(shape: Shape3D): Point3 {
  const properties = measureShapeVolumeProperties(shape)
  try {
    return [...properties.centerOfMass] as Point3
  } finally {
    properties.delete()
  }
}

function patternCentroids(seed: Shape3D, content: PatternFeatureContentParametersV3) {
  const outputs = patternOcctShape(occt, seed, {
    kind: "placements",
    count: content.count,
    placements: samplePathPatternPlacements(occt, content),
  })
  try {
    return {
      roles: outputs.map(({ role }) => role),
      centroids: outputs.map(({ shape }) => centroid(shape)),
      valid: outputs.map(({ shape }) => {
        const metrics = inspectOcctBody(occt, shape)
        return metrics.valid && metrics.solidCount === 1 && Math.abs(metrics.volume - 8) < 1e-9
      }),
    }
  } finally {
    for (const { shape } of outputs) shape.delete()
  }
}

function expectPoints(
  actual: readonly Point3[],
  expected: readonly Point3[],
  tolerance = TOLERANCE,
) {
  expect(actual).toHaveLength(expected.length)
  for (const [index, point] of expected.entries())
    for (const axis of [0, 1, 2]) {
      const value = actual[index]?.[axis] ?? Number.NaN
      expect(Math.abs(value - (point[axis] ?? 0))).toBeLessThanOrEqual(tolerance)
    }
}

function polar(radius: number, angle: number): Point3 {
  return [radius * Math.cos(angle), radius * Math.sin(angle), 0]
}

describe("path pattern on a straight line", () => {
  const straight = chain([line(1, [0, 0], [100, 0])])

  it("distributes valid named instances over the whole open path", () => {
    const seed = cube([0, 0, 0])
    try {
      const result = patternCentroids(seed, parameters(straight, { count: 5 }))
      expect(result.roles).toEqual([0, 1, 2, 3, 4].map((index) => `pattern.instance.${index}`))
      expect(result.valid).toEqual([true, true, true, true, true])
      expectPoints(
        result.centroids,
        [0, 25, 50, 75, 100].map((x) => [x, 0, 0]),
      )
    } finally {
      seed.delete()
    }
  })

  it("measures fixed spacing from the start offset and keeps the seed in place", () => {
    const seed = cube([5, 5, 0])
    try {
      const result = patternCentroids(
        seed,
        parameters(straight, {
          spacing: { mode: "fixed", distance: 30 },
          startOffset: 20,
        }),
      )
      expectPoints(result.centroids, [
        [5, 5, 0],
        [35, 5, 0],
        [65, 5, 0],
      ])
    } finally {
      seed.delete()
    }
  })

  it("reverses an open path from its far end", () => {
    const seed = cube([0, 0, 0])
    try {
      const result = patternCentroids(seed, parameters(straight, { reverse: true }))
      expectPoints(result.centroids, [
        [0, 0, 0],
        [-50, 0, 0],
        [-100, 0, 0],
      ])
    } finally {
      seed.delete()
    }
  })

  it("fails clearly when fixed spacing overruns the path", () => {
    expect(() =>
      samplePathPatternPlacements(
        occt,
        parameters(straight, { count: 4, spacing: { mode: "fixed", distance: 40 } }),
      ),
    ).toThrow("Fixed spacing overruns the path: 4 instances need 120 mm but the path is 100 mm.")
    expect(() =>
      samplePathPatternPlacements(occt, parameters(straight, { startOffset: 100 })),
    ).toThrow("must be shorter than the path length")
  })
})

describe("path pattern on a circular arc", () => {
  const radius = 50
  const quarter = chain([
    arc(1, [radius, 0], [radius * Math.SQRT1_2, radius * Math.SQRT1_2], [0, radius]),
  ])
  const angles = [0, 1, 2, 3].map((index) => (index * Math.PI) / 6)

  it("places translated copies at analytic arc-length stations", () => {
    // The seed sits 10 mm outside the path start, so translation keeps that offset fixed in X.
    const seed = cube([radius + 10, 0, 0])
    try {
      const result = patternCentroids(seed, parameters(quarter, { count: 4 }))
      expectPoints(
        result.centroids,
        angles.map((angle) => {
          const station = polar(radius, angle)
          return [station[0] + 10, station[1], 0]
        }),
      )
    } finally {
      seed.delete()
    }
  })

  it("rotates followed copies by the analytic tangent angle", () => {
    // Rotating with the tangent keeps the seed's radial 10 mm offset radial at every station.
    const seed = cube([radius + 10, 0, 0])
    try {
      const result = patternCentroids(
        seed,
        parameters(quarter, { count: 4, orientation: "follow" }),
      )
      expectPoints(
        result.centroids,
        angles.map((angle) => polar(radius + 10, angle)),
      )
      const placements = samplePathPatternPlacements(
        occt,
        parameters(quarter, { count: 4, orientation: "follow" }),
      )
      for (const [index, placement] of placements.entries())
        expect(
          Math.abs((placement.rotation?.angle ?? Number.NaN) - (angles[index] ?? 0)),
        ).toBeLessThan(1e-9)
    } finally {
      seed.delete()
    }
  })

  it("starts at an arc-length offset", () => {
    const seed = cube([radius, 0, 0])
    const offset = (radius * Math.PI) / 6
    try {
      const result = patternCentroids(
        seed,
        parameters(quarter, {
          count: 3,
          startOffset: offset,
          spacing: { mode: "fixed", distance: offset },
          orientation: "follow",
        }),
      )
      // The reference station is 30 degrees along; followed copies turn about the arc center.
      const reference = polar(radius, Math.PI / 6)
      expectPoints(
        result.centroids,
        [0, 1, 2].map((index) => {
          const turn = (index * Math.PI) / 6
          const relative: Point3 = [radius - reference[0], -reference[1], 0]
          const station = polar(radius, Math.PI / 6 + turn)
          return [
            station[0] + relative[0] * Math.cos(turn) - relative[1] * Math.sin(turn),
            station[1] + relative[0] * Math.sin(turn) + relative[1] * Math.cos(turn),
            0,
          ]
        }),
      )
    } finally {
      seed.delete()
    }
  })
})

describe("path pattern on closed paths", () => {
  const radius = 40

  it("divides a closed circle by the count without duplicating the seed", () => {
    const seed = cube([radius, 0, 0])
    try {
      const result = patternCentroids(seed, parameters(circle(radius), { count: 6 }))
      expectPoints(
        result.centroids,
        [0, 1, 2, 3, 4, 5].map((index) => polar(radius, (index * Math.PI) / 3)),
      )
    } finally {
      seed.delete()
    }
  })

  it("honours the circle start angle and reverses clockwise", () => {
    const start = Math.PI / 2
    const seed = cube([0, radius, 0])
    try {
      const result = patternCentroids(
        seed,
        parameters(circle(radius, start), { count: 4, reverse: true }),
      )
      expectPoints(
        result.centroids,
        [0, 1, 2, 3].map((index) => polar(radius, start - (index * Math.PI) / 2)),
      )
    } finally {
      seed.delete()
    }
  })

  it("traverses a clockwise-authored loop counterclockwise about the sketch normal", () => {
    const loop = chain(
      [
        arc(1, [radius, 0], [0, -radius], [-radius, 0]),
        {
          ...arc(2, [-radius, 0], [0, radius], [radius, 0]),
          startPointId: id(201),
          endPointId: id(101),
        },
      ],
      true,
    )
    const seed = cube([radius, 0, 0])
    try {
      const result = patternCentroids(seed, parameters(loop, { count: 4 }))
      expectPoints(
        result.centroids,
        [0, 1, 2, 3].map((index) => polar(radius, (index * Math.PI) / 2)),
      )
    } finally {
      seed.delete()
    }
  })

  it("rejects a symmetric figure eight whose enclosed area cancels", () => {
    // Two G1 Beziers cross at the origin: one lobe runs counterclockwise, the other clockwise.
    const cubic = (entity: number, from: Point2, c1: Point2, c2: Point2, to: Point2) => ({
      entityId: id(entity),
      type: "cubic-bezier" as const,
      startPointId: id(entity + 100),
      control1PointId: id(entity + 200),
      control2PointId: id(entity + 300),
      endPointId: id(entity + 400),
      start: from,
      control1: c1,
      control2: c2,
      end: to,
    })
    const eight = chain(
      [
        cubic(1, [40, 0], [40, 40], [-40, -40], [-40, 0]),
        {
          ...cubic(2, [-40, 0], [-40, 40], [40, -40], [40, 0]),
          startPointId: id(501),
          endPointId: id(101),
        },
      ],
      true,
    )
    expect(() => samplePathPatternPlacements(occt, parameters(eight, { count: 4 }))).toThrow(
      "A closed pattern path must enclose a nonzero net area",
    )
  })

  it("rejects fixed spacing that would wrap onto the seed", () => {
    expect(() =>
      samplePathPatternPlacements(
        occt,
        parameters(circle(10), { count: 3, spacing: { mode: "fixed", distance: 10 * Math.PI } }),
      ),
    ).toThrow("wraps a closed path")
  })
})

describe("path pattern arc length on a cubic Bezier", () => {
  const start: Point2 = [0, 0]
  const control1: Point2 = [30, 60]
  const control2: Point2 = [70, -60]
  const end: Point2 = [100, 0]
  const bezier = chain([
    {
      entityId: id(1),
      type: "cubic-bezier",
      startPointId: id(101),
      control1PointId: id(102),
      control2PointId: id(103),
      endPointId: id(104),
      start,
      control1,
      control2,
      end,
    },
  ])

  function at(t: number): Point2 {
    const u = 1 - t
    return [0, 1].map(
      (axis) =>
        u * u * u * (start[axis] ?? 0) +
        3 * u * u * t * (control1[axis] ?? 0) +
        3 * u * t * t * (control2[axis] ?? 0) +
        t * t * t * (end[axis] ?? 0),
    ) as Point2
  }
  function speed(t: number) {
    const u = 1 - t
    return Math.hypot(
      ...[0, 1].map(
        (axis) =>
          3 * u * u * ((control1[axis] ?? 0) - (start[axis] ?? 0)) +
          6 * u * t * ((control2[axis] ?? 0) - (control1[axis] ?? 0)) +
          3 * t * t * ((end[axis] ?? 0) - (control2[axis] ?? 0)),
      ),
    )
  }
  /** Composite Simpson on [0, t]; with 20,000 intervals its error is far below 1e-9 mm. */
  function simpsonLength(t: number) {
    const intervals = 20_000
    const h = t / intervals
    let total = speed(0) + speed(t)
    for (let index = 1; index < intervals; index += 1)
      total += (index % 2 === 1 ? 4 : 2) * speed(index * h)
    return (total * h) / 3
  }
  /** Independent Simpson-and-bisection arc-length station for the analytic Bezier. */
  function referenceStation(fraction: number): Point3 {
    const target = simpsonLength(1) * fraction
    let low = 0
    let high = 1
    for (let iteration = 0; iteration < 60; iteration += 1) {
      const middle = (low + high) / 2
      if (simpsonLength(middle) < target) low = middle
      else high = middle
    }
    const point = at((low + high) / 2)
    return [point[0], point[1], 0]
  }

  it("matches an independent arc-length measurement", () => {
    // Four stations: the symmetric curve's midpoint alone cannot tell arc length from parameter.
    const placements = samplePathPatternPlacements(occt, parameters(bezier, { count: 4 }))
    expectPoints(
      placements.map(({ translation }) => translation as Point3),
      [[0, 0, 0], referenceStation(1 / 3), referenceStation(2 / 3), [100, 0, 0]],
      1e-7,
    )
  })
})

describe("path pattern native ownership", () => {
  it("releases every sampling temporary when the path is rejected", () => {
    const live = new Set<object>()
    const tracked = ["BRepAdaptor_Curve_2", "gp_Pnt_1", "gp_Vec_1"] as const
    const tracking = new Proxy(occt, {
      get(target, property, receiver) {
        const value = Reflect.get(target, property, receiver)
        if (!tracked.some((name) => name === property)) return value
        return new Proxy(value, {
          construct(nativeClass, args) {
            const instance: { delete: () => void } = Reflect.construct(nativeClass, args)
            const release = instance.delete.bind(instance)
            live.add(instance)
            instance.delete = () => {
              live.delete(instance)
              release()
            }
            return instance
          },
        })
      },
    })
    expect(() =>
      samplePathPatternPlacements(
        tracking,
        parameters(chain([line(1, [0, 0], [10, 0])]), {
          count: 3,
          spacing: { mode: "fixed", distance: 6 },
        }),
      ),
    ).toThrow("overruns")
    expect(live.size).toBe(0)
  })

  it("releases earlier copies when a later placement fails", () => {
    const seed = cube([0, 0, 0])
    const created: { shape: Shape3D; released: boolean }[] = []
    const operations = createOcctPatternOperations({
      place: (native, source, placement) => {
        if (created.length === 2) throw new Error("placement failed")
        const shape = placeOcctShape(native, source, {
          translation: [...placement.translation],
          rotation: [0, 0, 0],
        })
        const entry = { shape, released: false }
        const release = shape.delete.bind(shape)
        shape.delete = () => {
          entry.released = true
          release()
        }
        created.push(entry)
        return shape
      },
    })
    try {
      expect(() =>
        operations.patternShape(occt, seed, {
          kind: "placements",
          count: 3,
          placements: samplePathPatternPlacements(
            occt,
            parameters(chain([line(1, [0, 0], [100, 0])])),
          ),
        }),
      ).toThrow("placement failed")
      expect(created.map(({ released }) => released)).toEqual([true, true])
    } finally {
      seed.delete()
    }
  })
})
