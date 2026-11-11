import { beforeAll, describe, expect, it } from "bun:test"
import { type Face, type Shape3D, setOC } from "replicad"
import initializeOpenCascade, { type OpenCascadeInstance } from "replicad-opencascadejs"
import { inspectOcctBody } from "./occt-body-validation"
import { DraftError, draftOcctShape } from "./occt-draft"
import { occtBoundingBoxCenter, ScaleError, scaleOcctShape } from "./occt-scale"
import { createOcctBox, createOcctCylinder } from "./occt-shapes"

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

const SIZE = 20
const HEIGHT = 10
const box = () => createOcctBox(occt, [SIZE, SIZE, HEIGHT])

function faceKeys(body: Shape3D, matches: (face: Face) => boolean) {
  const faces = body.faces
  try {
    return faces.filter(matches).map((face) => face.hashCode)
  } finally {
    for (const face of faces) face.delete()
  }
}

function normalOf(face: Face) {
  const vector = face.normalAt()
  try {
    return vector.toTuple()
  } finally {
    vector.delete()
  }
}

const sideFaces = (body: Shape3D) => faceKeys(body, (face) => Math.abs(normalOf(face)[2]) < 1e-9)

function frustumVolume(topSide: number) {
  const bottom = SIZE * SIZE
  const top = topSide * topSide
  return (HEIGHT / 3) * (bottom + top + Math.sqrt(bottom * top))
}

function topFaceWidth(body: Shape3D) {
  const faces = body.faces
  try {
    const top = faces.find((face) => normalOf(face)[2] > 0.999)
    if (!top) throw new Error("The drafted body has no top face.")
    const box = top.boundingBox
    return box.width
  } finally {
    for (const face of faces) face.delete()
  }
}

const angle = (5 * Math.PI) / 180
const bottomPlane = {
  planeOrigin: [0, 0, 0] as const,
  planeNormal: [0, 0, 1] as const,
}

describe("OCCT Draft", () => {
  it("drafts four box sides about the base into the analytic frustum", () => {
    const source = box()
    try {
      const result = draftOcctShape(occt, source, sideFaces(source), {
        ...bottomPlane,
        pullDirection: [0, 0, 1],
        angle,
      })
      try {
        const metrics = inspectOcctBody(occt, result)
        expect(metrics.valid).toBe(true)
        expect(metrics.solidCount).toBe(1)
        const top = SIZE - 2 * HEIGHT * Math.tan(angle)
        expect(metrics.volume).toBeCloseTo(frustumVolume(top), 4)
        expect(topFaceWidth(result)).toBeCloseTo(top, 6)
      } finally {
        result.delete()
      }
      expect(inspectOcctBody(occt, source).volume).toBeCloseTo(SIZE * SIZE * HEIGHT, 6)
    } finally {
      source.delete()
    }
  })

  it("inverts the taper when the pull direction is flipped", () => {
    const source = box()
    try {
      const result = draftOcctShape(occt, source, sideFaces(source), {
        ...bottomPlane,
        pullDirection: [0, 0, -1],
        angle,
      })
      try {
        const top = SIZE + 2 * HEIGHT * Math.tan(angle)
        expect(inspectOcctBody(occt, result).volume).toBeCloseTo(frustumVolume(top), 4)
        expect(topFaceWidth(result)).toBeCloseTo(top, 6)
      } finally {
        result.delete()
      }
    } finally {
      source.delete()
    }
  })

  it("fails with an actionable diagnostic instead of skipping an undraftable face", () => {
    const source = box()
    try {
      const top = faceKeys(source, (face) => normalOf(face)[2] > 0.999)
      const keys = [...sideFaces(source).slice(0, 1), ...top]
      let failure: unknown
      try {
        draftOcctShape(occt, source, keys, { ...bottomPlane, pullDirection: [0, 0, 1], angle })
      } catch (error) {
        failure = error
      }
      expect(failure).toBeInstanceOf(DraftError)
      expect((failure as Error).message).toContain("Draft cannot tilt selected face 2")
    } finally {
      source.delete()
    }
  })

  it("drafts a cylindrical wall into a cone frustum", () => {
    const source = createOcctCylinder(occt, 10, HEIGHT, [0, 0, 0])
    try {
      const wall = faceKeys(source, (face) => face.geomType === "CYLINDRE")
      const result = draftOcctShape(occt, source, wall, {
        ...bottomPlane,
        pullDirection: [0, 0, 1],
        angle,
      })
      try {
        const top = 10 - HEIGHT * Math.tan(angle)
        const expected = (Math.PI * HEIGHT * (100 + top * top + 10 * top)) / 3
        expect(inspectOcctBody(occt, result).volume).toBeCloseTo(expected, 3)
      } finally {
        result.delete()
      }
    } finally {
      source.delete()
    }
  })

  it("rejects out-of-range angles and unknown faces before calling OCCT", () => {
    const source = box()
    try {
      const keys = sideFaces(source)
      const draft = (overrides: object) =>
        draftOcctShape(occt, source, keys, {
          ...bottomPlane,
          pullDirection: [0, 0, 1],
          angle,
          ...overrides,
        })
      expect(() => draft({ angle: 0 })).toThrow(DraftError)
      expect(() => draft({ angle: (89 * Math.PI) / 180 })).toThrow(DraftError)
      expect(() =>
        draftOcctShape(occt, source, [-1], { ...bottomPlane, pullDirection: [0, 0, 1], angle }),
      ).toThrow("missing")
    } finally {
      source.delete()
    }
  })
})

describe("OCCT Scale", () => {
  it("multiplies volume by eight for factor two and keeps one valid solid", () => {
    const source = box()
    try {
      const result = scaleOcctShape(occt, source, { factor: 2, center: { kind: "origin" } })
      try {
        const metrics = inspectOcctBody(occt, result)
        expect(metrics.valid).toBe(true)
        expect(metrics.solidCount).toBe(1)
        expect(metrics.volume).toBeCloseTo(8 * SIZE * SIZE * HEIGHT, 6)
      } finally {
        result.delete()
      }
      expect(inspectOcctBody(occt, source).volume).toBeCloseTo(SIZE * SIZE * HEIGHT, 6)
    } finally {
      source.delete()
    }
  })

  it.each([
    ["origin", { kind: "origin" } as const, [0, 0, 0]],
    ["bounding-box centre", { kind: "bounding-box-center" } as const, [0, 0, HEIGHT / 2]],
    ["explicit point", { kind: "point", point: [3, -4, 5] } as const, [3, -4, 5]],
  ])("keeps the %s fixed", (_name, center, fixed) => {
    const source = box()
    try {
      const result = scaleOcctShape(occt, source, { factor: 0.5, center })
      try {
        const before = occtBoundingBoxCenter(occt, source)
        const after = occtBoundingBoxCenter(occt, result)
        // A fixed point p maps the source centre c to p + 0.5 (c - p).
        for (const axis of [0, 1, 2] as const) {
          const point = fixed[axis] ?? 0
          expect(after[axis]).toBeCloseTo(point + 0.5 * (before[axis] - point), 6)
        }
      } finally {
        result.delete()
      }
    } finally {
      source.delete()
    }
  })

  it("rejects factors outside 0.001 to 1000", () => {
    const source = box()
    try {
      for (const factor of [0, 0.0005, 1001, Number.NaN]) {
        const scale = () => scaleOcctShape(occt, source, { factor, center: { kind: "origin" } })
        expect(scale).toThrow(ScaleError)
        expect(scale).toThrow("Scale factor must be between 0.001 and 1000.")
      }
    } finally {
      source.delete()
    }
  })

  it("asks for a body repair when the source has no measurable bounding box", () => {
    // An empty compound has a void bounding box; the message must still name a fix.
    const compound = new occt.TopoDS_Compound()
    const builder = new occt.TopoDS_Builder()
    try {
      builder.MakeCompound(compound)
      const empty = { wrapped: compound } as unknown as Shape3D
      const measure = () => occtBoundingBoxCenter(occt, empty)
      expect(measure).toThrow(ScaleError)
      expect(measure).toThrow(
        "Scale cannot measure the body bounding box. Repair or rebuild the target body, then try again.",
      )
    } finally {
      builder.delete()
      compound.delete()
    }
  })

  it("fails with a typed, actionable error when the result leaves the world workspace", () => {
    const source = box()
    try {
      // About x = -100 000 mm, factor two maps the box to x >= 100 000 mm.
      const scale = () =>
        scaleOcctShape(occt, source, {
          factor: 2,
          center: { kind: "point", point: [-100_000, 0, 0] },
        })
      expect(scale).toThrow(ScaleError)
      expect(scale).toThrow("Reduce the factor or move the scale center closer to the body.")
      expect(inspectOcctBody(occt, source).volume).toBeCloseTo(SIZE * SIZE * HEIGHT, 6)
    } finally {
      source.delete()
    }
  })
})
