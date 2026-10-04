import { describe, expect, it } from "vitest"
import {
  extrusionEndConditionContentSchema,
  extrusionEndConditionContentV7Schema,
} from "./geometry-worker"

const id = "0195b5ac-b250-7a2c-8c33-000000000001"
const base = {
  inputIndex: 0,
  outputRole: "result",
  sourceContentHash: "a".repeat(64),
  face: {
    schemaVersion: 1,
    kind: "face",
    outputRole: "result",
    signature: {
      kind: "face",
      geometryClass: "SPHERE",
      measure: 64 * Math.PI,
      centroid: [0, 0, 8],
      bounds: { min: [-4, -4, 4], max: [4, 4, 12] },
      boundaryCount: 1,
      adjacentGeometryClasses: [],
    },
  },
}
describe("versioned finite face extent content", () => {
  it("accepts curved v7 content without invented planar fields while keeping the v6 decoder strict", () => {
    const value = { ...base, kind: "up-to-curved-face" }
    expect(extrusionEndConditionContentV7Schema.parse(value)).toEqual(value)
    expect(extrusionEndConditionContentSchema.safeParse(value).success).toBe(false)
    expect(
      extrusionEndConditionContentV7Schema.safeParse({ ...value, planeNormal: [0, 0, 1] }).success,
    ).toBe(false)
    expect(
      extrusionEndConditionContentV7Schema.safeParse({
        ...value,
        face: { ...base.face, featureId: id, nativeFaceIndex: 1 },
      }).success,
    ).toBe(false)
  })
  it("requires planar evidence and a normalized plane only for planar v7 endpoints", () => {
    const plane = { ...base, kind: "up-to-face", planeOrigin: [0, 0, 8], planeNormal: [0, 0, 1] }
    expect(extrusionEndConditionContentV7Schema.safeParse(plane).success).toBe(false)
    const planarFace = {
      ...base.face,
      signature: { ...base.face.signature, geometryClass: "PLANE" },
    }
    expect(
      extrusionEndConditionContentV7Schema.safeParse({ ...plane, face: planarFace }).success,
    ).toBe(true)
    expect(
      extrusionEndConditionContentV7Schema.safeParse({
        ...plane,
        face: planarFace,
        planeNormal: [0, 0, 2],
      }).success,
    ).toBe(false)
    expect(
      extrusionEndConditionContentV7Schema.safeParse({
        ...base,
        kind: "up-to-curved-face",
        face: planarFace,
      }).success,
    ).toBe(false)
  })
  it.each(["distance", "through-all", "up-to-body"])(
    "does not silently broaden v7 to %s",
    (kind) => {
      expect(
        extrusionEndConditionContentV7Schema.safeParse(
          kind === "distance" ? { kind } : { kind, ...base },
        ).success,
      ).toBe(false)
    },
  )
})
