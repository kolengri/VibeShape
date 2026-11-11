import { afterAll, beforeAll, describe, expect, it } from "bun:test"
import { type Face, type Shape3D, setOC } from "replicad"
import initializeOpenCascade, { type OpenCascadeInstance } from "replicad-opencascadejs"
import { inspectOcctBody } from "./occt-body-validation"
import { pressPullOcctShape } from "./occt-press-pull"
import { createOcctBox, createOcctCone, createOcctCylinder, createOcctSphere } from "./occt-shapes"
import { offsetOcctFace, ThickenError, thickenOcctShape } from "./occt-thicken"

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

const owned: Shape3D[] = []
afterAll(() => {
  for (const shape of owned) shape.delete()
})
const keep = <T extends Shape3D>(shape: T) => {
  owned.push(shape)
  return shape
}

function faceKeys(body: Shape3D, matches: (face: Face) => boolean) {
  const faces = body.faces
  try {
    return faces.filter(matches).map((face) => face.hashCode)
  } finally {
    for (const face of faces) face.delete()
  }
}

function withFace<T>(body: Shape3D, matches: (face: Face) => boolean, use: (face: Face) => T) {
  const faces = body.faces
  try {
    const face = faces.find(matches)
    if (!face) throw new Error("The fixture face is missing.")
    return use(face)
  } finally {
    for (const face of faces) face.delete()
  }
}

const isCylinder = (face: Face) => face.geomType === "CYLINDRE"
const atTop = (z: number) => (face: Face) =>
  face.geomType === "PLANE" && Math.abs(face.center.z - z) < 1e-6
const volumeOf = (shape: Shape3D) => inspectOcctBody(occt, shape).volume

function expectSolid(shape: Shape3D, volume: number, digits = 4) {
  const metrics = inspectOcctBody(occt, shape)
  expect(metrics.valid).toBe(true)
  expect(metrics.solidCount).toBe(1)
  expect(metrics.volume).toBeCloseTo(volume, digits)
}

function failure(run: () => unknown) {
  try {
    run()
  } catch (error) {
    return error
  }
  throw new Error("The operation was expected to fail.")
}

const RADIUS = 5
const HEIGHT = 10
const annulus = (inner: number, outer: number) => Math.PI * (outer ** 2 - inner ** 2) * HEIGHT

describe("OCCT Thicken", () => {
  it("thickens a planar face into a slab of area times thickness on either side", () => {
    const source = keep(createOcctBox(occt, [10, 20, 5]))
    const top = faceKeys(source, atTop(5))
    for (const side of ["outward", "inward", "symmetric"] as const) {
      const result = keep(
        thickenOcctShape(occt, source, top, { thickness: 2, side, operation: "new" }),
      )
      expectSolid(result, 10 * 20 * 2, 6)
      const bounds = result.boundingBox.bounds
      const extents: Record<typeof side, readonly [number, number]> = {
        outward: [5, 7],
        inward: [3, 5],
        symmetric: [4, 6],
      }
      const [low, high] = extents[side]
      expect(bounds[0][2]).toBeCloseTo(low, 3)
      expect(bounds[1][2]).toBeCloseTo(high, 3)
    }
    expect(volumeOf(source)).toBeCloseTo(1000, 6)
  })

  it("matches the analytic annular-sector volume of a cylindrical face", () => {
    const source = keep(createOcctCylinder(occt, RADIUS, HEIGHT, [0, 0, 0]))
    const side = faceKeys(source, isCylinder)
    const thicken = (thickness: number, mode: "outward" | "inward" | "symmetric") =>
      keep(thickenOcctShape(occt, source, side, { thickness, side: mode, operation: "new" }))
    expectSolid(thicken(2, "outward"), annulus(RADIUS, RADIUS + 2))
    expectSolid(thicken(2, "inward"), annulus(RADIUS - 2, RADIUS))
    expectSolid(thicken(2, "symmetric"), annulus(RADIUS - 1, RADIUS + 1))
  })

  it("thickens a spherical cap to the analytic shell volume", () => {
    const sphere = keep(createOcctSphere(occt, RADIUS, [0, 0, 0]))
    const lower = keep(createOcctBox(occt, [20, 20, 10], false, [0, 0, -10]))
    const dome = keep(sphere.cut(lower))
    const cap = faceKeys(dome, (face) => face.geomType === "SPHERE")
    const shell = (inner: number, outer: number) => (2 / 3) * Math.PI * (outer ** 3 - inner ** 3)
    const outward = keep(
      thickenOcctShape(occt, dome, cap, { thickness: 1, side: "outward", operation: "new" }),
    )
    expectSolid(outward, shell(RADIUS, RADIUS + 1), 2)
  })

  it("follows the body orientation of a reversed hole wall", () => {
    const plate = keep(createOcctBox(occt, [40, 40, 5]))
    const hole = keep(plate.cut(keep(createOcctCylinder(occt, RADIUS, 5, [0, 0, 0]))))
    const wall = faceKeys(hole, isCylinder)
    const into = keep(
      thickenOcctShape(occt, hole, wall, { thickness: 1, side: "outward", operation: "new" }),
    )
    // The hole wall's outward normal points at the axis, so outward fills the hole rim.
    expectSolid(into, Math.PI * (RADIUS ** 2 - (RADIUS - 1) ** 2) * 5)
    expect(into.boundingBox.bounds[1][0]).toBeCloseTo(RADIUS, 3)
  })

  it("adds and removes the thickened region from the source body", () => {
    const source = keep(createOcctCylinder(occt, RADIUS, HEIGHT, [0, 0, 0]))
    const side = faceKeys(source, isCylinder)
    const base = volumeOf(source)
    const added = keep(
      thickenOcctShape(occt, source, side, { thickness: 1, side: "outward", operation: "add" }),
    )
    expectSolid(added, base + annulus(RADIUS, RADIUS + 1))
    const removed = keep(
      thickenOcctShape(occt, source, side, { thickness: 1, side: "inward", operation: "remove" }),
    )
    expectSolid(removed, base - annulus(RADIUS - 1, RADIUS))
    const message = (
      failure(() =>
        thickenOcctShape(occt, source, side, { thickness: 1, side: "inward", operation: "add" }),
      ) as Error
    ).message
    expect(message).toContain("Thicken Add did not enlarge the body")
  })

  it("joins faces that meet at a sharp edge through the extended offset", () => {
    const source = keep(createOcctBox(occt, [10, 20, 5]))
    const keys = faceKeys(
      source,
      (face) => atTop(5)(face) || (face.geomType === "PLANE" && Math.abs(face.center.x - 5) < 1e-6),
    )
    expect(keys).toHaveLength(2)
    const result = keep(
      thickenOcctShape(occt, source, keys, { thickness: 2, side: "outward", operation: "new" }),
    )
    // Top slab 10 x 20 x 2, side slab 2 x 20 x 5 and the extended corner 2 x 20 x 2.
    expectSolid(result, 400 + 200 + 80, 4)
  })

  it("fails closed when the thickness reaches the concave curvature radius", () => {
    const source = keep(createOcctCylinder(occt, RADIUS, HEIGHT, [0, 0, 0]))
    const side = faceKeys(source, isCylinder)
    const error = failure(() =>
      thickenOcctShape(occt, source, side, { thickness: 6, side: "inward", operation: "new" }),
    )
    expect(error).toBeInstanceOf(ThickenError)
    expect((error as Error).message).toContain("5 mm curvature radius of selected face 1")
    // The convex side has no such limit.
    expectSolid(
      keep(
        thickenOcctShape(occt, source, side, { thickness: 6, side: "outward", operation: "new" }),
      ),
      annulus(RADIUS, RADIUS + 6),
    )
  })

  it("rejects disconnected faces and missing faces with their selection index", () => {
    const source = keep(createOcctBox(occt, [10, 20, 5]))
    const topAndBottom = faceKeys(source, (face) => atTop(5)(face) || atTop(0)(face))
    const disconnected = failure(() =>
      thickenOcctShape(occt, source, topAndBottom, {
        thickness: 1,
        side: "outward",
        operation: "new",
      }),
    )
    expect((disconnected as Error).message).toContain(
      "Selected face 2 does not share an edge with selected face 1",
    )
    const missing = failure(() =>
      thickenOcctShape(occt, source, [...faceKeys(source, atTop(5)), -1], {
        thickness: 1,
        side: "outward",
        operation: "new",
      }),
    )
    expect((missing as Error).message).toBe("Thicken face 2 is missing from the exact body.")
  })
})

describe("OCCT curved-face offset", () => {
  const plateWithBoss = () => {
    const plate = keep(createOcctBox(occt, [40, 40, 5]))
    const boss = keep(createOcctCylinder(occt, RADIUS, HEIGHT, [0, 0, 5]))
    return keep(plate.fuse(boss))
  }

  it.each([1, -1, -4.5])("changes a cylindrical boss radius by %s mm exactly", (distance) => {
    const source = plateWithBoss()
    const result = keep(
      withFace(source, isCylinder, (face) => offsetOcctFace(occt, source, face, distance)),
    )
    expectSolid(result, volumeOf(source) + annulus(RADIUS, RADIUS + distance), 4)
    expect(result.faces.filter(isCylinder)).toHaveLength(1)
  })

  it("moves a hole wall and a hemispherical dome along their normals", () => {
    const plate = keep(createOcctBox(occt, [40, 40, 5]))
    const hole = keep(plate.cut(keep(createOcctCylinder(occt, RADIUS, 5, [0, 0, 0]))))
    const shrunk = keep(withFace(hole, isCylinder, (face) => offsetOcctFace(occt, hole, face, 1)))
    // The hole wall normal points at the axis, so a positive distance narrows the hole.
    expectSolid(shrunk, volumeOf(hole) + Math.PI * (RADIUS ** 2 - (RADIUS - 1) ** 2) * 5)
    const sphere = keep(createOcctSphere(occt, RADIUS, [0, 0, 0]))
    const below = keep(createOcctBox(occt, [40, 40, 5], false, [0, 0, -5]))
    const domed = keep(
      below.fuse(keep(sphere.cut(keep(createOcctBox(occt, [20, 20, 10], false, [0, 0, -10]))))),
    )
    const grown = keep(
      withFace(
        domed,
        (face) => face.geomType === "SPHERE",
        (face) => offsetOcctFace(occt, domed, face, 1),
      ),
    )
    expectSolid(grown, volumeOf(domed) + (2 / 3) * Math.PI * ((RADIUS + 1) ** 3 - RADIUS ** 3), 2)
  })

  it("extends planar caps to meet an offset conical face", () => {
    const frustum = keep(createOcctCone(occt, 5, HEIGHT, [0, 0, 0], 3))
    const slant = Math.hypot(HEIGHT, 2)
    const grow = slant / HEIGHT
    const frustumVolume = (bottom: number, top: number) =>
      (Math.PI * HEIGHT * (bottom ** 2 + bottom * top + top ** 2)) / 3
    const result = keep(
      withFace(
        frustum,
        (face) => face.geomType === "CONE",
        (face) => offsetOcctFace(occt, frustum, face, 0.5),
      ),
    )
    expectSolid(result, frustumVolume(5 + 0.5 * grow, 3 + 0.5 * grow), 3)
  })

  it("fails closed when a neighbouring face cannot stay attached", () => {
    // A tangent fillet-like neighbour: a cylinder capped by a hemisphere.
    const sphere = keep(createOcctSphere(occt, RADIUS, [0, 0, HEIGHT]))
    const capsule = keep(keep(createOcctCylinder(occt, RADIUS, HEIGHT, [0, 0, 0])).fuse(sphere))
    const error = failure(() =>
      withFace(capsule, isCylinder, (face) => offsetOcctFace(occt, capsule, face, 1)),
    )
    expect(error).toBeInstanceOf(ThickenError)
    expect((error as Error).message).toContain("keeping its neighbouring faces attached")
  })

  it("matches planar Press Pull for a planar face slab", () => {
    const source = keep(createOcctBox(occt, [10, 20, 5]))
    const planar = keep(
      withFace(source, atTop(5), (face) => pressPullOcctShape(occt, source, face, 2)),
    )
    const viaOffset = keep(
      withFace(source, atTop(5), (face) => offsetOcctFace(occt, source, face, 2)),
    )
    expect(volumeOf(viaOffset)).toBeCloseTo(volumeOf(planar), 6)
    expectSolid(viaOffset, 10 * 20 * 7, 6)
  })
})
