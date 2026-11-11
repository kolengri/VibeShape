import { afterEach, beforeAll, describe, expect, it } from "bun:test"
import {
  type CoilFeatureContentParameters,
  type HelixContent,
  helixLength,
  helixPoint,
  helixStart,
} from "@vibeshape/protocol"
import { makeBox, type Shape3D, setOC } from "replicad"
import initializeOpenCascade, {
  type OpenCascadeInstance,
  type TopoDS_Shape,
} from "replicad-opencascadejs"
import { inspectOcctBody } from "./occt-body-validation"
import { createOcctCoil, createOcctHelicalSweep, createOcctHelixSpine } from "./occt-helix"
import type { AnalyticalProfile } from "./occt-loft"
import { cutOcctShapes, fuseOcctShapes } from "./occt-shapes"

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

  it("keeps a rectangular section untwisted along the whole helix", () => {
    const turns = 6.25
    const helix = { ...zHelix, turns, startAngle: 0.4 }
    const shape = keep(
      createOcctCoil(occt, coil(helix, { kind: "rectangular", width: 3, height: 1.5 })),
    )
    expect(metrics(shape)).toMatchObject({ valid: true, solidCount: 1 })
    const caps = planarCaps(shape)
    expect(caps).toHaveLength(2)
    const start = helixStart({ ...zHelix, ...helix })
    const [first, last] = [...caps].sort(
      (left, right) => distance(left.centroid, start.point) - distance(right.centroid, start.point),
    )
    if (!first || !last) throw new Error("Expected two caps.")
    expect(first.area).toBeCloseTo(4.5, 6)
    expect(last.area).toBeCloseTo(4.5, 6)
    expect(distance(first.centroid, start.point)).toBeLessThan(1e-6)
    expect(
      distance(last.centroid, screw({ ...zHelix, ...helix }, start.point, turns)),
    ).toBeLessThan(1e-3)
    // Each end vertex is the screw image of one start vertex: no section twist.
    for (const vertex of first.vertices) {
      const image = screw({ ...zHelix, ...helix }, vertex, turns)
      const nearest = Math.min(...last.vertices.map((candidate) => distance(candidate, image)))
      expect(nearest).toBeLessThan(1e-3)
    }
  })

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
  })
})

const segmentId = (value: number) => `018f0000-0000-7000-8000-${String(value).padStart(12, "0")}`
/** A circle profile of radius `r` whose plane contains the helix start normal to its tangent. */
function startProfile(helix: HelixContent, shape: "circle" | "square", size: number) {
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
  const points: [number, number][] = [
    [-size, -size],
    [size, -size],
    [size, size],
    [-size, size],
  ]
  const segments = points.map((first, index) => ({
    entityId: segmentId(index + 1),
    type: "line" as const,
    startPointId: segmentId(index + 10),
    endPointId: segmentId(((index + 1) % 4) + 10),
    start: first,
    end: points[(index + 1) % 4] as [number, number],
  }))
  return {
    sketchId: segmentId(99),
    frame,
    outer: { sourceEntityIds: segments.map(({ entityId }) => entityId), segments },
    holes: [],
  } as unknown as AnalyticalProfile
}

describe("helical Sweep v2 with installed OCCT 0.23.0", () => {
  it("matches the equivalent coil volume and keeps the section untwisted", () => {
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
    const square = keep(
      createOcctHelicalSweep(occt, { profile: startProfile(helix, "square", 1) as never, helix }),
    )
    const caps = planarCaps(square)
    expect(caps).toHaveLength(2)
    const start = helixStart(helix)
    const [first, last] = [...caps].sort(
      (left, right) => distance(left.centroid, start.point) - distance(right.centroid, start.point),
    )
    if (!first || !last) throw new Error("Expected two caps.")
    expect(last.area).toBeCloseTo(first.area, 6)
    for (const vertex of first.vertices) {
      const image = screw(helix, vertex, helix.turns)
      expect(
        Math.min(...last.vertices.map((candidate) => distance(candidate, image))),
      ).toBeLessThan(1e-3)
    }
  })

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
  })
})

/** Tracks every native wrapper constructed through `new`, including those created on failure. */
function trackedKernel() {
  const created: { deleted: number; name: string }[] = []
  const kernel = new Proxy(occt, {
    get(target, key) {
      const value = Reflect.get(target, key)
      if (typeof value !== "function" || typeof key !== "string" || !/^[A-Z]/.test(key))
        return value
      return new Proxy(value, {
        construct(constructor, args) {
          const instance = Reflect.construct(constructor, args)
          const record = { deleted: 0, name: key }
          created.push(record)
          const release = instance.delete.bind(instance)
          instance.delete = () => {
            record.deleted += 1
            return release()
          }
          return instance
        },
      })
    },
  })
  return { kernel, created }
}

describe("helix native temporary disposal", () => {
  it("releases every constructed wrapper exactly once on success and failure", () => {
    const success = trackedKernel()
    const shape = createOcctCoil(success.kernel, coil({ turns: 9 }))
    shape.delete()
    expect(success.created.length).toBeGreaterThan(10)
    expect(success.created.filter(({ deleted }) => deleted !== 1)).toEqual([])

    const failure = trackedKernel()
    const tight = { ...zHelix, pitch: 1.9 }
    expect(() =>
      createOcctHelicalSweep(failure.kernel, {
        profile: startProfile(tight, "circle", 1) as never,
        helix: tight,
      }),
    ).toThrow("Adjacent helical Sweep turns would intersect")
    expect(failure.created.length).toBeGreaterThan(3)
    expect(failure.created.filter(({ deleted }) => deleted !== 1)).toEqual([])
  })
})
