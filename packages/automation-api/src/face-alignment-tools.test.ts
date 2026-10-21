import { describe, expect, it } from "bun:test"
import { faceAlignmentOperationSchema, faceAlignmentToolInputs } from "./face-alignment-tools"

const id = (n: number) => `0195b5ac-b250-7a2c-8c33-${String(n).padStart(12, "0")}`
function face(featureId: string, outputRole = "result") {
  return {
    schemaVersion: 1,
    featureId,
    outputRole,
    kind: "face",
    semanticRole: "cap",
    signature: {
      kind: "face",
      geometryClass: "PLANE",
      measure: 100,
      centroid: [0, 0, 0],
      bounds: { min: [-5, -5, 0], max: [5, 5, 0] },
      boundaryCount: 4,
      adjacentGeometryClasses: [],
      direction: [0, 0, 1],
      directionMode: "oriented",
    },
  }
}
const argumentsInput = {
  draftId: id(1),
  baseRevision: 4,
  commandId: id(2),
  featureId: id(3),
  label: "Aligned part",
  sourceFace: face(id(4), "split.positive"),
  targetFace: face(id(5)),
  orientation: "opposed",
  offsetMm: -5,
}

describe("face alignment tool contract", () => {
  it.each(["same", "opposed"])(
    "accepts %s alignment and a signed millimetre offset",
    (orientation) => {
      const parsed = faceAlignmentOperationSchema.parse({
        tool: "create_face_aligned_placement",
        arguments: { ...argumentsInput, orientation },
      })
      expect(parsed.arguments.offsetMm).toBe(-5)
      expect(parsed.arguments.sourceFace.outputRole).toBe("split.positive")
    },
  )

  it("accepts distinct output roles from the same multi-body feature", () => {
    expect(
      faceAlignmentToolInputs.create_face_aligned_placement.safeParse({
        ...argumentsInput,
        targetFace: face(id(4), "split.negative"),
      }).success,
    ).toBe(true)
  })

  it("rejects same bodies, curved or edge references, self-identities and raw transform authority", () => {
    for (const invalid of [
      { targetFace: argumentsInput.sourceFace },
      { targetFace: { ...argumentsInput.targetFace, kind: "edge" } },
      {
        targetFace: {
          ...argumentsInput.targetFace,
          signature: { ...argumentsInput.targetFace.signature, geometryClass: "CYLINDER" },
        },
      },
      { featureId: id(4) },
      { featureId: id(5) },
      { sourceNormal: [1, 0, 0] },
      { translation: [0, 0, 0] },
      { dependencies: [id(4), id(5)] },
      { references: [] },
      { approved: true },
      { candidateId: "face:1" },
      { offsetMm: Number.NaN },
      { offsetMm: Number.POSITIVE_INFINITY },
      { offsetMm: 100_001 },
      { orientation: "parallel" },
      { baseRevision: -1 },
    ])
      expect(
        faceAlignmentToolInputs.create_face_aligned_placement.safeParse({
          ...argumentsInput,
          ...invalid,
        }).success,
      ).toBe(false)
  })
})
