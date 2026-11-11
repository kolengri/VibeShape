import { afterEach, beforeAll, describe, expect, it } from "bun:test"
import {
  type CoilFeatureContentParameters,
  type HelixContent,
  helixLength,
  helixPoint,
  helixStart,
  minimumCoilPitch,
} from "@vibeshape/protocol"
import { cast, makeBox, type Shape3D, setOC } from "replicad"
import initializeOpenCascade, {
  type OpenCascadeInstance,
  type TopoDS_Shape,
} from "replicad-opencascadejs"
import { inspectOcctBody } from "./occt-body-validation"
import { createOcctCoil, createOcctHelicalSweep, createOcctHelixSpine } from "./occt-helix"
import type { AnalyticalProfile } from "./occt-loft"
import { cutOcctShapes, fuseOcctShapes, intersectOcctShapes } from "./occt-shapes"

let occt: OpenCascadeInstance
const owned: { delete(): void }[] = []
function keep<T extends { delete(): void }>(value: T) {
  owned.push(value)
  return value
}
beforeAll(async () => {
  const wasmPath = new URL(
    "../node_modules/replicad-opencascadejs/src/replicad_single.wasm",
    import.meta.url,
  )
  occt = await Reflect.apply(initializeOpenCascade, undefined, [
    { locateFile: () => wasmPath.pathname },
  ])
  setOC(occt)
}, 60_000)
afterEach(() => {
  for (const value of owned.splice(0).reverse()) value.delete()
})

type Vector = readonly [number, number, number]
const zHelix: HelixContent = {
  origin: [0, 0, 0],
  direction: [0, 0, 1],
  handedness: "right",
  radius: 10,
  pitch: 5,
  turns: 3,
  startAngle: 0,
}
function coil(
  helix: Partial<HelixContent> = {},
  section: CoilFeatureContentParameters["section"] = { kind: "circular", diameter: 2 },
): CoilFeatureContentParameters {
  return { helix: { ...zHelix, ...helix }, section, operation: "new" }
}
function metrics(shape: Shape3D) {
  return inspectOcctBody(occt, shape)
}
/** Planar faces of the swept solid are its two end caps. */
function planarCaps(shape: Shape3D) {
  const caps: { centroid: Vector; area: number; normal: Vector; vertices: Vector[] }[] = []
  for (const face of shape.faces) {
    if (face.geomType !== "PLANE") continue
    const properties = new occt.GProp_GProps_1()
    try {
      occt.BRepGProp.SurfaceProperties_1(face.wrapped, properties, false, false)
      const center = properties.CentreOfMass()
      const normal = face.normalAt()
      caps.push({
        centroid: [center.X(), center.Y(), center.Z()],
        area: properties.Mass(),
        normal: [normal.x, normal.y, normal.z],
        vertices: face.edges.map((edge) => {
          const value = edge.startPoint
          return [value.x, value.y, value.z] as Vector
        }),
      })
      center.delete()
    } finally {
      properties.delete()
    }
  }
  return caps
}
function distanceToShape(shape: TopoDS_Shape, value: Vector) {
  const point = new occt.gp_Pnt_3(value[0], value[1], value[2])
  const builder = new occt.BRepBuilderAPI_MakeVertex(point)
  const vertex = builder.Vertex()
  const extrema = new occt.BRepExtrema_DistShapeShape_1()
  const progress = new occt.Message_ProgressRange_1()
  try {
    extrema.LoadS1(vertex)
    extrema.LoadS2(shape)
    if (!extrema.Perform(progress)) throw new Error("Distance query failed.")
    return extrema.Value()
  } finally {
    for (const value of [progress, extrema, vertex, builder, point]) value.delete()
  }
}
function distance(a: Vector, b: Vector) {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])
}
/** Applies the helix screw motion of `turns` to a world point. */
function screw(helix: HelixContent, value: Vector, turns: number): Vector {
  const angle = (helix.handedness === "right" ? 1 : -1) * 2 * Math.PI * turns
  const [x, y, z] = value
  return [
    x * Math.cos(angle) - y * Math.sin(angle),
    x * Math.sin(angle) + y * Math.cos(angle),
    z + helix.pitch * turns,
  ]
}

type Segment = readonly [Vector, Vector]
function edgeSegments(shape: Shape3D): Segment[] {
  return shape.edges.map((edge) => {
    const [a, b] = [edge.startPoint, edge.endPoint]
    return [
      [a.x, a.y, a.z],
      [b.x, b.y, b.z],
    ]
  })
}
const touches = (segment: Segment, point: Vector) =>
  distance(segment[0], point) < 1e-6 || distance(segment[1], point) < 1e-6
const nearAny = (point: Vector, corners: readonly Vector[]) =>
  corners.some((corner) => distance(corner, point) < 1e-6)

/** Lateral edges are split where spine edges join, which also adds short section loops there. */
function longestUnusedEdge(segments: readonly Segment[], used: ReadonlySet<number>, point: Vector) {
  let next = -1
  let length = -1
  for (const [index, segment] of segments.entries()) {
    const candidate = distance(segment[0], segment[1])
    if (used.has(index) || !touches(segment, point) || candidate <= length) continue
    next = index
    length = candidate
  }
  return next
}

/** Follows a start corner along its lateral edge chain to the end cap. */
function traceCorner(segments: readonly Segment[], corner: Vector, end: readonly Vector[]) {
  const used = new Set<number>()
  let point = corner
  while (!nearAny(point, end)) {
    const index = longestUnusedEdge(segments, used, point)
    const segment = segments[index]
    if (!segment) throw new Error("A lateral edge chain is broken.")
    used.add(index)
    point = distance(segment[0], point) < 1e-6 ? segment[1] : segment[0]
  }
  return point
}

/**
 * Each start-cap corner reaches the screw image of that same corner. Matching corners in order
 * (rather than to the nearest image) also detects twists that coincide with a section symmetry.
 */
function expectUntwisted(shape: Shape3D, helix: HelixContent) {
  const start = helixStart(helix)
  const [first, last] = [...planarCaps(shape)].sort(
    (left, right) => distance(left.centroid, start.point) - distance(right.centroid, start.point),
  )
  if (!first || !last) throw new Error("Expected two caps.")
  expect(last.area).toBeCloseTo(first.area, 6)
  const segments = edgeSegments(shape)
  for (const corner of first.vertices)
    expect(
      distance(traceCorner(segments, corner, last.vertices), screw(helix, corner, helix.turns)),
    ).toBeLessThan(1e-3)
}

describe("exact helix and Coil with installed OCCT 0.23.0", () => {
  it("matches the circular-section coil volume to pi r^2 L", () => {
    const shape = keep(createOcctCoil(occt, coil()))
    const result = metrics(shape)
    const expected = Math.PI * 1 ** 2 * helixLength(zHelix)
    expect(result.valid).toBe(true)
    expect(result.solidCount).toBe(1)
    expect(Math.abs(result.volume - expected) / expected).toBeLessThan(2e-3)
  })

  it("flips the helix direction with handedness at a sampled quarter turn", () => {
    for (const handedness of ["right", "left"] as const) {
      const helix = { ...zHelix, handedness }
      const wire = keep(createOcctHelixSpine(occt, helix))
      const sample = helixPoint(helix, 0.25)
      expect(sample[1]).toBeCloseTo(handedness === "right" ? 10 : -10, 9)
      expect(distanceToShape(wire, sample)).toBeLessThan(1e-4)
      expect(distanceToShape(wire, [sample[0], -sample[1], sample[2]])).toBeGreaterThan(1)
    }
  })

  it.each(["right", "left"] as const)(
    "keeps a %s-handed rectangular section untwisted, corner by corner",
    (handedness) => {
      const helix = { ...zHelix, handedness, turns: 6.25, startAngle: 0.4 }
      const shape = keep(
        createOcctCoil(occt, coil(helix, { kind: "rectangular", width: 3, height: 1.5 })),
      )
      expect(metrics(shape)).toMatchObject({ valid: true, solidCount: 1 })
      expect(planarCaps(shape)[0]?.area).toBeCloseTo(4.5, 6)
      expectUntwisted(shape, helix)
    },
  )

  it("orients arbitrary datum axes and both handednesses with exact volume", () => {
    const tilted = Math.SQRT1_2
    for (const handedness of ["right", "left"] as const) {
      const helix = {
        ...zHelix,
        origin: [5, -3, 2] as [number, number, number],
        direction: [tilted, 0, tilted] as [number, number, number],
        handedness,
        turns: 1.5,
      }
      const shape = keep(createOcctCoil(occt, coil(helix)))
      const result = metrics(shape)
      const expected = Math.PI * helixLength(helix)
      expect(result.valid).toBe(true)
      expect(Math.abs(result.volume - expected) / expected).toBeLessThan(2e-3)
    }
  })

  it("adds to and removes from a target body", () => {
    const target = keep(makeBox([-12, -12, -2], [12, 12, 0.5]))
    const tool = keep(createOcctCoil(occt, coil()))
    const targetVolume = metrics(target).volume
    const toolVolume = metrics(tool).volume
    const added = keep(fuseOcctShapes(occt, target, tool))
    const removed = keep(cutOcctShapes(occt, target, tool))
    const addedMetrics = metrics(added)
    const removedMetrics = metrics(removed)
    expect(addedMetrics).toMatchObject({ valid: true, solidCount: 1 })
    expect(removedMetrics).toMatchObject({ valid: true, solidCount: 1 })
    expect(addedMetrics.volume).toBeGreaterThan(targetVolume)
    expect(addedMetrics.volume).toBeLessThan(targetVolume + toolVolume)
    expect(removedMetrics.volume).toBeLessThan(targetVolume)
    expect(removedMetrics.volume).toBeGreaterThan(0)
  })

  it("builds the 50-turn resource bound with exact volume", () => {
    const helix = { ...zHelix, turns: 50, pitch: 3 }
    const shape = keep(createOcctCoil(occt, coil(helix, { kind: "circular", diameter: 1.5 })))
    const result = metrics(shape)
    const expected = Math.PI * 0.75 ** 2 * helixLength(helix)
    expect(result).toMatchObject({ valid: true, solidCount: 1 })
    expect(Math.abs(result.volume - expected) / expected).toBeLessThan(2e-3)
  })

  it("rejects invalid sections and self-intersecting pitches with clear messages", () => {
    expect(() =>
      createOcctCoil(occt, coil({ pitch: 2 }, { kind: "circular", diameter: 2 })),
    ).toThrow("Adjacent coil turns would intersect")
    expect(() =>
      createOcctCoil(occt, coil({ radius: 1 }, { kind: "circular", diameter: 2 })),
    ).toThrow("must not reach the helix axis")
    // Sections near the axis climb faster than s / cos(lead angle): exact meridian reproductions.
    const wide = { kind: "rectangular", width: 8, height: 2 } as const
    expect(() => createOcctCoil(occt, coil({ radius: 5, pitch: 2.02 }, wide))).toThrow(
      "Adjacent coil turns would intersect",
    )
    expect(
      metrics(keep(createOcctCoil(occt, coil({ radius: 5, pitch: 2.05 }, wide)))),
    ).toMatchObject({ valid: true, solidCount: 1 })
    expect(() =>
      createOcctCoil(
        occt,
        coil({ radius: 1, pitch: 1.994, turns: 2 }, { kind: "circular", diameter: 1.9 }),
      ),
    ).toThrow("Adjacent coil turns would intersect")
  })
})

const segmentId = (value: number) => `018f0000-0000-7000-8000-${String(value).padStart(12, "0")}`
/** A circle profile of radius `r` whose plane contains the helix start normal to its tangent. */
function startProfile(
  helix: HelixContent,
  shape: "circle" | "square" | "triangle" | "wide",
  size: number,
) {
  const start = helixStart(helix)
  const normal = start.tangent
  const xAxis: Vector = [-start.frame.radial[0], -start.frame.radial[1], -start.frame.radial[2]]
  const yAxis: Vector = [
    normal[1] * xAxis[2] - normal[2] * xAxis[1],
    normal[2] * xAxis[0] - normal[0] * xAxis[2],
    normal[0] * xAxis[1] - normal[1] * xAxis[0],
  ]
  const frame = { origin: start.point, xAxis, yAxis, normal }
  if (shape === "circle")
    return {
      sketchId: segmentId(99),
      frame,
      outer: {
        sourceEntityIds: [segmentId(1)],
        segments: [
          {
            entityId: segmentId(1),
            type: "circle",
            center: [0, 0],
            radius: size,
          },
        ],
      },
      holes: [],
    } as unknown as AnalyticalProfile
  // Profile x is the inward principal normal and y the binormal; "wide" is 8 × 2 (x × y).
  const points: [number, number][] =
    shape === "triangle"
      ? [
          [-size, -size],
          [size, -size],
          [-size, size],
        ]
      : shape === "wide"
        ? [
            [-4, -1],
            [4, -1],
            [4, 1],
            [-4, 1],
          ]
        : [
            [-size, -size],
            [size, -size],
            [size, size],
            [-size, size],
          ]
  const segments = points.map((first, index) => ({
    entityId: segmentId(index + 1),
    type: "line" as const,
    startPointId: segmentId(index + 10),
    endPointId: segmentId(((index + 1) % points.length) + 10),
    start: first,
    end: points[(index + 1) % points.length] as [number, number],
  }))
  return {
    sketchId: segmentId(99),
    frame,
    outer: { sourceEntityIds: segments.map(({ entityId }) => entityId), segments },
    holes: [],
  } as unknown as AnalyticalProfile
}

describe("helical Sweep v2 with installed OCCT 0.23.0", () => {
  it("matches the equivalent coil volume", () => {
    const helix = { ...zHelix, turns: 2.5 }
    const sweep = keep(
      createOcctHelicalSweep(occt, {
        profile: startProfile(helix, "circle", 1) as never,
        helix,
      }),
    )
    const reference = keep(createOcctCoil(occt, coil(helix)))
    const sweepMetrics = metrics(sweep)
    expect(sweepMetrics).toMatchObject({ valid: true, solidCount: 1 })
    expect(Math.abs(sweepMetrics.volume - metrics(reference).volume)).toBeLessThan(
      1e-4 * sweepMetrics.volume,
    )
  })

  it.each(["right", "left"] as const)(
    "keeps an asymmetric triangle untwisted along a %s-handed helix",
    (handedness) => {
      const helix = { ...zHelix, handedness, turns: 6.25, startAngle: 0.4 }
      const triangle = keep(
        createOcctHelicalSweep(occt, {
          profile: startProfile(helix, "triangle", 1) as never,
          helix,
        }),
      )
      expect(metrics(triangle)).toMatchObject({ valid: true, solidCount: 1 })
      expectUntwisted(triangle, helix)
    },
  )

  it("fails closed for misplaced, tilted or self-intersecting profiles", () => {
    const helix = { ...zHelix }
    const misplaced = startProfile(helix, "circle", 1) as unknown as {
      frame: { origin: Vector }
    }
    expect(() =>
      createOcctHelicalSweep(occt, {
        profile: { ...misplaced, frame: { ...misplaced.frame, origin: [10, 0, 1] } } as never,
        helix,
      }),
    ).toThrow("helix start")
    const tilted = startProfile({ ...helix, pitch: 8 }, "circle", 1)
    expect(() => createOcctHelicalSweep(occt, { profile: tilted as never, helix })).toThrow(
      "normal to its tangent",
    )
    const tight = { ...helix, pitch: 1.9 }
    expect(() =>
      createOcctHelicalSweep(occt, {
        profile: startProfile(tight, "circle", 1) as never,
        helix: tight,
      }),
    ).toThrow("Adjacent helical Sweep turns would intersect")
    for (const [pitch, accepted] of [
      [2.02, false],
      [2.05, true],
    ] as const) {
      const wide = { ...helix, radius: 5, pitch }
      const build = () =>
        createOcctHelicalSweep(occt, {
          profile: startProfile(wide, "wide", 1) as never,
          helix: wide,
        })
      if (accepted) expect(metrics(keep(build()))).toMatchObject({ valid: true, solidCount: 1 })
      else expect(build).toThrow("Adjacent helical Sweep turns would intersect")
    }
  })
})

type Deletable = { delete(): void }
/**
 * Tracks every native wrapper the module acquires: objects built with `new`, and wrappers
 * returned by instance or static methods (`Face()`, `Edge()`, `Wire()`, `Shape()`, `Value()`,
 * `BRep_Tool.Surface_2`, `TopoDS.Edge_1`, ...). `Handle.get()` is borrowed and excluded.
 * `failOn` injects a constructor failure to exercise the unwinding path.
 */
function trackedKernel(failOn?: string) {
  const created: { deleted: number; name: string }[] = []
  const targets = new WeakMap<object, object>()
  const unwrap = (value: unknown) =>
    (typeof value === "object" && value !== null && targets.get(value)) || value
  const isWrapper = (value: unknown): value is Deletable =>
    typeof value === "object" &&
    value !== null &&
    typeof (value as Partial<Deletable>).delete === "function"
  const track = (value: unknown, name: string): unknown => {
    if (!isWrapper(value) || targets.has(value)) return value
    const record = { deleted: 0, name }
    created.push(record)
    const release = value.delete.bind(value)
    value.delete = () => {
      record.deleted += 1
      release()
    }
    const proxy = new Proxy(value, {
      get(target, key) {
        const member = Reflect.get(target, key)
        if (typeof member !== "function" || key === "delete") return member
        return (...args: unknown[]) => {
          const result = Reflect.apply(member, target, args.map(unwrap))
          return key === "get" ? result : track(result, `${name}.${String(key)}`)
        }
      },
    })
    targets.set(proxy, value)
    return proxy
  }
  const kernel = new Proxy(occt, {
    get(target, key) {
      const value = Reflect.get(target, key)
      if (typeof value !== "function" || typeof key !== "string" || !/^[A-Z]/.test(key))
        return value
      return new Proxy(value, {
        construct(native, args): object {
          if (key === failOn) throw new Error(`Injected ${key} failure.`)
          return track(Reflect.construct(native, args.map(unwrap)), key) as object
        },
        get(owner, member) {
          const value = Reflect.get(owner, member)
          if (typeof value !== "function" || member === "prototype") return value
          return (...args: unknown[]) =>
            track(Reflect.apply(value, owner, args.map(unwrap)), `${key}.${String(member)}`)
        },
      })
    },
  })
  return { kernel, created }
}
function expectAllReleased(created: readonly { deleted: number; name: string }[]) {
  expect(created.filter(({ deleted }) => deleted !== 1)).toEqual([])
}

describe("helix native temporary disposal", () => {
  it("releases every acquired wrapper exactly once on success and failure", () => {
    const success = trackedKernel()
    createOcctCoil(success.kernel, coil({ turns: 9 })).delete()
    const names = success.created.map(({ name }) => name)
    for (const method of ["Face", "Edge", "Wire", "Shape", "Value", "BRep_Tool.Surface_2"])
      expect(names.some((name) => name.endsWith(method))).toBe(true)
    expectAllReleased(success.created)

    const sweep = trackedKernel()
    createOcctHelicalSweep(sweep.kernel, {
      profile: startProfile(zHelix, "triangle", 1) as never,
      helix: zHelix,
    }).delete()
    expect(sweep.created.some(({ name }) => name === "TopoDS.Edge_1")).toBe(true)
    expectAllReleased(sweep.created)

    const rejected = trackedKernel()
    const tight = { ...zHelix, pitch: 1.9 }
    expect(() =>
      createOcctHelicalSweep(rejected.kernel, {
        profile: startProfile(tight, "circle", 1) as never,
        helix: tight,
      }),
    ).toThrow("Adjacent helical Sweep turns would intersect")
    expectAllReleased(rejected.created)

    // BRepCheck_Analyzer runs only after the pipe solid exists.
    const injected = trackedKernel("BRepCheck_Analyzer")
    expect(() => createOcctCoil(injected.kernel, coil())).toThrow(
      "Injected BRepCheck_Analyzer failure.",
    )
    expect(injected.created.some(({ name }) => name.endsWith("BRepOffsetAPI_MakePipeShell"))).toBe(
      true,
    )
    expectAllReleased(injected.created)
  })
})

describe("exact helix spine accuracy", () => {
  it("keeps a 50-turn spine on the exact helix with G1 edge joins", () => {
    const helix = { ...zHelix, turns: 50, pitch: 3 }
    const wire = keep(createOcctHelixSpine(occt, helix))
    const properties = keep(new occt.GProp_GProps_1())
    occt.BRepGProp.LinearProperties(wire, properties, false, false)
    expect(Math.abs(properties.Mass() / helixLength(helix) - 1)).toBeLessThan(1e-7)
    let deviation = 0
    const ends: { start: Vector; end: Vector; first: Vector; last: Vector }[] = []
    const explorer = keep(
      new occt.TopExp_Explorer_2(
        wire,
        occt.TopAbs_ShapeEnum.TopAbs_EDGE as never,
        occt.TopAbs_ShapeEnum.TopAbs_SHAPE as never,
      ),
    )
    for (; explorer.More(); explorer.Next()) {
      const current = explorer.Current()
      const edge = occt.TopoDS.Edge_1(current)
      const curve = new occt.BRepAdaptor_Curve_2(edge)
      const point = new occt.gp_Pnt_1()
      const tangent = new occt.gp_Vec_1()
      const sample = (parameter: number) => {
        curve.D1(parameter, point, tangent)
        const length = Math.hypot(tangent.X(), tangent.Y(), tangent.Z())
        return {
          at: [point.X(), point.Y(), point.Z()] as Vector,
          direction: [tangent.X() / length, tangent.Y() / length, tangent.Z() / length] as Vector,
        }
      }
      const [first, last] = [curve.FirstParameter(), curve.LastParameter()]
      for (let index = 0; index <= 400; index += 1) {
        const { at } = sample(first + ((last - first) * index) / 400)
        const angle = (2 * Math.PI * at[2]) / helix.pitch
        deviation = Math.max(
          deviation,
          distance(at, [helix.radius * Math.cos(angle), helix.radius * Math.sin(angle), at[2]]),
        )
      }
      const head = sample(first)
      const tail = sample(last)
      ends.push({ start: head.at, end: tail.at, first: head.direction, last: tail.direction })
      for (const value of [tangent, point, curve, edge, current]) value.delete()
    }
    expect(ends.length).toBeGreaterThan(10)
    expect(deviation).toBeLessThan(1e-5)
    let joins = 0
    for (const edge of ends) {
      const next = ends.find(({ start }) => distance(start, edge.end) < 1e-7)
      if (!next) continue
      joins += 1
      const cosine =
        edge.last[0] * next.first[0] + edge.last[1] * next.first[1] + edge.last[2] * next.first[2]
      expect(cosine).toBeGreaterThan(1 - 1e-12)
    }
    expect(joins).toBe(ends.length - 1)
  })
})

/** Independent tube built in the test (no clearance validation) for overlap oracles. */
function rawCircularCoil(helix: HelixContent, diameter: number): Shape3D {
  const spine = createOcctHelixSpine(occt, helix)
  const start = helixStart(helix)
  const native: Deletable[] = []
  const own = <T extends Deletable>(value: T) => {
    native.push(value)
    return value
  }
  try {
    const point = own(new occt.gp_Pnt_3(...start.point))
    const axis = own(
      new occt.gp_Ax2_2(
        point,
        own(new occt.gp_Dir_4(...start.tangent)),
        own(
          new occt.gp_Dir_4(-start.frame.radial[0], -start.frame.radial[1], -start.frame.radial[2]),
        ),
      ),
    )
    const circle = own(new occt.gp_Circ_2(axis, diameter / 2))
    const edge = own(own(new occt.BRepBuilderAPI_MakeEdge_8(circle)).Edge())
    const section = own(own(new occt.BRepBuilderAPI_MakeWire_2(edge)).Wire())
    const builder = own(new occt.BRepOffsetAPI_MakePipeShell(spine))
    builder.SetMode_1(true)
    builder.Add_1(section, false, false)
    builder.Build(own(new occt.Message_ProgressRange_1()))
    if (!builder.MakeSolid()) throw new Error("Expected a raw coil solid.")
    const shape = own(builder.Shape())
    return cast(shape).asShape3D()
  } finally {
    for (const value of native.reverse()) value.delete()
    spine.delete()
  }
}

/**
 * Splits two turns into quarter-turn chunks (each a screw image of the same section) and sums
 * the common volume of every non-adjacent pair; an overlap between any two turns shows up here.
 */
function chunkOverlap(build: (helix: HelixContent) => Shape3D, helix: HelixContent) {
  const chunks = Array.from({ length: 8 }, (_, index) =>
    keep(
      build({
        ...helix,
        turns: 0.25,
        startAngle: (((helix.handedness === "right" ? 1 : -1) * index) % 4) * (Math.PI / 2),
        origin: [helix.origin[0], helix.origin[1], helix.origin[2] + (helix.pitch * index) / 4],
      }),
    ),
  )
  let overlap = 0
  for (const [i, a] of chunks.entries())
    for (const [j, b] of chunks.entries()) {
      if (j < i + 2) continue
      const common = intersectOcctShapes(occt, a, b)
      try {
        overlap += metrics(common).volume
      } finally {
        common.delete()
      }
    }
  return overlap
}

describe("exact meridian clearance against an independent overlap oracle", () => {
  const thin = { ...zHelix, radius: 1, turns: 2 }
  it("rejects the reported ⌀1.9 near-axis coil and finds no overlap just above the bound", () => {
    const section = { kind: "circular", diameter: 1.9 } as const
    const minimum = minimumCoilPitch(1, section)
    expect(minimum).toBeGreaterThan(1.994)
    // Exact tube tangency: the closest far centerline points are one section diameter apart.
    const helix = { ...thin, pitch: minimum }
    let closest = Number.POSITIVE_INFINITY
    for (let index = 0; index <= 200_000; index += 1) {
      const turns = 0.5 + index / 200_000
      closest = Math.min(closest, distance(helixPoint(helix, 0), helixPoint(helix, turns)))
    }
    expect(Math.abs(closest - 1.9)).toBeLessThan(1e-5)
    expect(() => createOcctCoil(occt, coil({ ...thin, pitch: 1.994 }, section))).toThrow(
      "Adjacent coil turns would intersect",
    )
    const accepted = { ...thin, pitch: minimum * 1.002 }
    expect(metrics(keep(createOcctCoil(occt, coil(accepted, section))))).toMatchObject({
      valid: true,
      solidCount: 1,
    })
    expect(chunkOverlap((part) => rawCircularCoil(part, 1.9), accepted)).toBeLessThan(1e-9)
    expect(
      chunkOverlap((part) => rawCircularCoil(part, 1.9), { ...thin, pitch: 1.97 }),
    ).toBeGreaterThan(1e-6)
  }, 120_000)

  it("finds no overlap for an accepted near-bound 8 × 2 rectangular coil", () => {
    const section = { kind: "rectangular", width: 8, height: 2 } as const
    const minimum = minimumCoilPitch(5, section)
    expect(minimum).toBeGreaterThan(2.03)
    expect(minimum).toBeLessThan(2.04)
    const helix = { ...zHelix, radius: 5, turns: 2, pitch: minimum * 1.002 }
    expect(chunkOverlap((part) => createOcctCoil(occt, coil(part, section)), helix)).toBeLessThan(
      1e-9,
    )
  }, 120_000)
})
