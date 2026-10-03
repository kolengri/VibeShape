import { measureShapeVolumeProperties, type Shape3D, setOC } from "replicad"
import initializeOpenCascade, { type OpenCascadeInstance } from "replicad-opencascadejs"
import { beforeAll, describe, expect, it, vi } from "vitest"
import { createMemoryProfile } from "./memory-profile"
import { createOcctCone, createOcctPyramid, createOcctSphere, createOcctTorus } from "./occt-shapes"

let controlledBuild = false
let opencascade: OpenCascadeInstance
beforeAll(async () => {
  const filesystem = await vi.importActual<{ readFileSync(path: URL): Uint8Array }>("node:fs")
  const runtime = await vi.importActual<{ env: Record<string, string | undefined> }>("node:process")
  controlledBuild = runtime.env.VIBESHAPE_CONTROLLED_OCCT === "1"
  const buildDirectory = controlledBuild
    ? "../../../.artifacts/occt-build/package/src/"
    : "../node_modules/replicad-opencascadejs/src/"
  const wasmBinary = new Uint8Array(
    filesystem.readFileSync(new URL(`${buildDirectory}replicad_single.wasm`, import.meta.url)),
  )
  const initialize = controlledBuild
    ? (await import(new URL(`${buildDirectory}replicad_single.js`, import.meta.url).href)).default
    : initializeOpenCascade
  opencascade = await Reflect.apply(initialize, undefined, [{ wasmBinary }])
  setOC(opencascade)
})

function inspect(shape: Shape3D) {
  const analyzer = new opencascade.BRepCheck_Analyzer(shape.wrapped, true, false)
  const properties = measureShapeVolumeProperties(shape)
  const boundingBox = new opencascade.Bnd_Box_1()
  opencascade.BRepBndLib.AddOptimal(shape.wrapped, boundingBox, false, true)
  const bounds = Array.from({ length: 6 }, () => ({ current: 0 }))
  Reflect.apply(boundingBox.Get, boundingBox, bounds)
  const faces = shape.faces
  try {
    return {
      valid: analyzer.IsValid_2(),
      volume: properties.volume,
      centroid: properties.centerOfMass,
      bounds: [
        bounds.slice(0, 3).map(({ current }) => current),
        bounds.slice(3).map(({ current }) => current),
      ],
      faces: faces.map((face) => face.geomType),
    }
  } finally {
    analyzer.delete()
    properties.delete()
    boundingBox.delete()
    for (const face of faces) face.delete()
  }
}

function expectCoordinates(actual: readonly number[], expected: readonly number[]) {
  for (let axis = 0; axis < 3; axis += 1) expect(actual[axis]).toBeCloseTo(expected[axis] ?? 0, 5)
}

describe("real OCCT radial primitives", () => {
  it.each([0.01, 4, 1000])("builds a valid placed sphere with radius %s", (radius) => {
    const origin = [8, -4, 6] as const
    const shape = createOcctSphere(opencascade, radius, origin)
    try {
      const metrics = inspect(shape)
      expect(metrics.valid).toBe(true)
      expect(metrics.faces).toEqual(["SPHERE"])
      expect(metrics.volume / ((4 / 3) * Math.PI * radius ** 3)).toBeCloseTo(1, 7)
      expectCoordinates(metrics.centroid, origin)
      expectCoordinates(
        metrics.bounds[0] ?? [],
        origin.map((value) => value - radius),
      )
      expectCoordinates(
        metrics.bounds[1] ?? [],
        origin.map((value) => value + radius),
      )
    } finally {
      shape.delete()
    }
  })

  it.each([0.01, 4, 1000])("builds a pointed +Z cone with radius %s", (radius) => {
    const height = radius * 3
    const origin = [8, -4, 6] as const
    const shape = createOcctCone(opencascade, radius, height, origin)
    try {
      const metrics = inspect(shape)
      expect(metrics.valid).toBe(true)
      expect(metrics.faces.sort()).toEqual(["CONE", "PLANE"])
      expect(metrics.volume / ((Math.PI * radius ** 2 * height) / 3)).toBeCloseTo(1, 7)
      expectCoordinates(metrics.centroid, [8, -4, 6 + height / 4])
      expectCoordinates(metrics.bounds[0] ?? [], [8 - radius, -4 - radius, 6])
      expectCoordinates(metrics.bounds[1] ?? [], [8 + radius, -4 + radius, 6 + height])
    } finally {
      shape.delete()
    }
  })

  it.each([0.01, 4, 1000])(
    "builds a ring torus on the Z axis with tube radius %s",
    (minorRadius) => {
      const majorRadius = minorRadius * 3
      const origin = [8, -4, 6] as const
      const shape = createOcctTorus(opencascade, majorRadius, minorRadius, origin)
      try {
        const metrics = inspect(shape)
        expect(metrics.valid).toBe(true)
        expect(metrics.faces).toEqual(["TORUS"])
        expect(metrics.volume / (2 * Math.PI ** 2 * majorRadius * minorRadius ** 2)).toBeCloseTo(
          1,
          7,
        )
        expectCoordinates(metrics.centroid, origin)
        const outer = majorRadius + minorRadius
        expectCoordinates(metrics.bounds[0] ?? [], [8 - outer, -4 - outer, 6 - minorRadius])
        expectCoordinates(metrics.bounds[1] ?? [], [8 + outer, -4 + outer, 6 + minorRadius])
      } finally {
        shape.delete()
      }
    },
  )

  it.each([3, 4, 6, 64])("builds an exact %s-sided placed pyramid with planar faces", (sides) => {
    const radius = 12
    const height = 35
    const origin = [8, -4, -17.5] as const
    const shape = createOcctPyramid(opencascade, sides, radius, height, origin)
    try {
      const metrics = inspect(shape)
      const vertices = Array.from({ length: sides }, (_, index) => {
        const angle = (2 * Math.PI * index) / sides
        return [origin[0] + radius * Math.cos(angle), origin[1] + radius * Math.sin(angle)]
      })
      expect(metrics.valid).toBe(true)
      expect(metrics.faces).toEqual(Array(sides + 1).fill("PLANE"))
      expect(
        metrics.volume / ((sides * radius ** 2 * Math.sin((2 * Math.PI) / sides) * height) / 6),
      ).toBeCloseTo(1, 7)
      expectCoordinates(metrics.centroid, [8, -4, -17.5 + height / 4])
      expectCoordinates(metrics.bounds[0] ?? [], [
        Math.min(...vertices.map((v) => v[0] ?? 0)),
        Math.min(...vertices.map((v) => v[1] ?? 0)),
        origin[2],
      ])
      expectCoordinates(metrics.bounds[1] ?? [], [
        Math.max(...vertices.map((v) => v[0] ?? 0)),
        Math.max(...vertices.map((v) => v[1] ?? 0)),
        origin[2] + height,
      ])
    } finally {
      shape.delete()
    }
  })

  it("releases native allocations across repeated radial and pyramid cycles", () => {
    const memory = createMemoryProfile(opencascade)
    const cycle = () => {
      const shapes = [
        createOcctSphere(opencascade, 4, [0, 0, 0]),
        createOcctCone(opencascade, 4, 12, [0, 0, -6]),
        createOcctTorus(opencascade, 12, 4, [0, 0, 0]),
        createOcctPyramid(opencascade, 6, 4, 12, [0, 0, -6]),
      ]
      for (const shape of shapes) shape.delete()
    }
    for (let iteration = 0; iteration < 20; iteration += 1) cycle()
    memory.capture("initialized")
    for (let iteration = 0; iteration < 100; iteration += 1) cycle()
    memory.capture("lifecycle-completed")
    if (controlledBuild) {
      expect(memory.memory.source).toBe("allocator-instrumented")
      const before = memory.memory.snapshots[0]?.allocator?.allocatedBytes
      const after = memory.memory.snapshots[1]?.allocator?.allocatedBytes
      expect(before).toBeTypeOf("number")
      expect(after).toBe(before)
    } else {
      expect(memory.memory.source).toBe("heap-capacity-only")
      expect(memory.memory.snapshots[1]?.heapCapacityBytes).toBe(
        memory.memory.snapshots[0]?.heapCapacityBytes,
      )
    }
  })
})
