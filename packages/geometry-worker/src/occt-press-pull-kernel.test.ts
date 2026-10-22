import { beforeAll, describe, expect, it } from "bun:test"
import { type Face, type Shape3D, setOC } from "replicad"
import initializeOpenCascade, { type OpenCascadeInstance } from "replicad-opencascadejs"
import { inspectOcctBody } from "./occt-body-validation"
import { placeOcctShape } from "./occt-placement"
import { pressPullOcctShape } from "./occt-press-pull"
import { createOcctBox, createOcctCylinder, cutOcctShapes, fuseOcctShapes } from "./occt-shapes"

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
function takeFace(body: Shape3D, axis: number, coordinate: number): Face {
  const faces = body.faces
  let found: Face | undefined
  try {
    const matches = faces.filter((face) => {
      if (face.geomType !== "PLANE") return false
      const center = face.center
      try {
        return Math.abs((center.toTuple()[axis] ?? Infinity) - coordinate) < 1e-6
      } finally {
        center.delete()
      }
    })
    if (matches.length !== 1 || !matches[0]) throw new Error("Fixture needs one planar face.")
    found = matches[0]
    return found
  } finally {
    for (const face of faces) if (face !== found) face.delete()
  }
}
describe("exact planar Press Pull", () => {
  it.each([2, -2])(
    "changes top-face volume by signed distance %s and preserves the source",
    (distance) => {
      const source = createOcctBox(occt, [20, 12, 10])
      const face = takeFace(source, 2, 10)
      try {
        const result = pressPullOcctShape(occt, source, face, distance)
        try {
          expect(inspectOcctBody(occt, result)).toMatchObject({ valid: true, solidCount: 1 })
          expect(inspectOcctBody(occt, result).volume).toBeCloseTo(240 * (10 + distance), 6)
        } finally {
          result.delete()
        }
        expect(inspectOcctBody(occt, source).volume).toBeCloseTo(2400, 6)
      } finally {
        face.delete()
        source.delete()
      }
    },
  )
  it.each([2, -2])("uses outward orientation on the bottom face for %s", (distance) => {
    const source = createOcctBox(occt, [20, 12, 10])
    const face = takeFace(source, 2, 0)
    try {
      const result = pressPullOcctShape(occt, source, face, distance)
      try {
        expect(inspectOcctBody(occt, result).volume).toBeCloseTo(240 * (10 + distance), 6)
      } finally {
        result.delete()
      }
    } finally {
      face.delete()
      source.delete()
    }
  })
  it.each([2, -2])("preserves a through-hole in the complete trimmed face for %s", (distance) => {
    const block = createOcctBox(occt, [20, 12, 10])
    const drill = createOcctCylinder(occt, 2, 12, [0, 0, -1])
    const source = cutOcctShapes(occt, block, drill)
    const face = takeFace(source, 2, 10)
    try {
      const result = pressPullOcctShape(occt, source, face, distance)
      try {
        expect(inspectOcctBody(occt, result)).toMatchObject({ valid: true, solidCount: 1 })
        expect(inspectOcctBody(occt, result).volume).toBeCloseTo(
          (240 - 4 * Math.PI) * (10 + distance),
          6,
        )
      } finally {
        result.delete()
      }
    } finally {
      face.delete()
      source.delete()
      drill.delete()
      block.delete()
    }
  })
  it.each([2, -2])(
    "accepts planar cylinder caps adjacent to curved side faces for %s",
    (distance) => {
      const source = createOcctCylinder(occt, 5, 10, [0, 0, 0]),
        face = takeFace(source, 2, 10)
      try {
        const result = pressPullOcctShape(occt, source, face, distance)
        try {
          expect(inspectOcctBody(occt, result).volume).toBeCloseTo(
            25 * Math.PI * (10 + distance),
            6,
          )
        } finally {
          result.delete()
        }
      } finally {
        face.delete()
        source.delete()
      }
    },
  )
  it("rejects curved selections and faces borrowed from another solid", () => {
    const source = createOcctCylinder(occt, 5, 10, [0, 0, 0]),
      other = createOcctBox(occt, [20, 12, 10])
    const faces = source.faces,
      foreign = takeFace(other, 2, 10)
    try {
      const curved =
        faces.find((face) => face.geomType === "CYLINDRE") ??
        faces.find((face) => face.geomType !== "PLANE")
      if (!curved) throw new Error("Fixture requires one curved wall.")
      expect(() => pressPullOcctShape(occt, source, curved, 2)).toThrow("planar")
      expect(() => pressPullOcctShape(occt, source, foreign, 2)).toThrow("belong")
    } finally {
      for (const face of faces) face.delete()
      foreign.delete()
      source.delete()
      other.delete()
    }
  })
  it.each([2, -2])(
    "uses the world-space oriented normal on a rotated planar face for %s",
    (distance) => {
      const original = createOcctBox(occt, [20, 12, 10])
      const source = placeOcctShape(occt, original, {
        translation: [4, 5, 6],
        rotation: [Math.PI / 4, 0, 0],
      })
      const face = takeFace(source, 2, 6 + Math.sqrt(50))
      try {
        const result = pressPullOcctShape(occt, source, face, distance)
        try {
          expect(inspectOcctBody(occt, result).volume).toBeCloseTo(240 * (10 + distance), 6)
        } finally {
          result.delete()
        }
      } finally {
        face.delete()
        source.delete()
        original.delete()
      }
    },
  )
  it("rejects an inward operation that severs a connecting bridge into two solids", () => {
    const left = createOcctBox(occt, [4, 6, 10], false, [-6, 0, 0]),
      right = createOcctBox(occt, [4, 6, 10], false, [6, 0, 0]),
      bridge = createOcctBox(occt, [12, 2, 2], false, [0, 0, 4])
    const joined = fuseOcctShapes(occt, left, bridge),
      source = fuseOcctShapes(occt, joined, right),
      face = takeFace(source, 2, 6)
    try {
      expect(inspectOcctBody(occt, source)).toMatchObject({ valid: true, solidCount: 1 })
      expect(() => pressPullOcctShape(occt, source, face, -2)).toThrow("one valid solid")
      expect(inspectOcctBody(occt, source).solidCount).toBe(1)
    } finally {
      face.delete()
      source.delete()
      joined.delete()
      bridge.delete()
      right.delete()
      left.delete()
    }
  })
  it.each([0, NaN, Infinity, -Infinity, 0.0001, 100001, -10, -20])(
    "rejects invalid or collapsing distance %s",
    (distance) => {
      const source = createOcctBox(occt, [20, 12, 10]),
        face = takeFace(source, 2, 10)
      try {
        expect(() => pressPullOcctShape(occt, source, face, distance)).toThrow()
        expect(inspectOcctBody(occt, source).volume).toBeCloseTo(2400, 6)
      } finally {
        face.delete()
        source.delete()
      }
    },
  )
})
