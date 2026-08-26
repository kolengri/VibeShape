import { featureIdSchema, topologyCandidateSchema } from "@vibeshape/domain"
import { describe, expect, it } from "vitest"
import { selectedPlanarFaceReference, selectedSketchSupport } from "./sketch-support"

const featureId = featureIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f2602")

function candidate(overrides: Record<string, unknown> = {}) {
  return topologyCandidateSchema.parse({
    candidateId: "face:0",
    kind: "face",
    meshFaceId: 42,
    semanticRole: "extrusion.cap.end",
    lineageTokens: [],
    signature: {
      kind: "face",
      geometryClass: "PLANE",
      measure: 400,
      centroid: [0, 0, 10],
      bounds: { min: [-10, -10, 10], max: [10, 10, 10] },
      direction: [0, 0, 1],
      directionMode: "oriented",
      boundaryCount: 4,
      adjacentGeometryClasses: ["PLANE", "PLANE", "PLANE", "PLANE"],
    },
    ...overrides,
  })
}

describe("selectedSketchSupport", () => {
  it("creates a stable semantic support from a selected extrusion cap", () => {
    expect(selectedSketchSupport(featureId, 42, [candidate()])).toMatchObject({
      plane: "xy",
      support: {
        kind: "feature-face",
        reference: { featureId, semanticRole: "extrusion.cap.end" },
      },
    })
  })

  it("rejects curved, unmapped, and transient-only faces", () => {
    expect(
      selectedSketchSupport(featureId, 42, [
        candidate({ semanticRole: "primitive.cylinder.wall" }),
      ]),
    ).toBeNull()
    expect(selectedSketchSupport(featureId, 7, [candidate()])).toBeNull()
    expect(
      selectedSketchSupport(featureId, 42, [candidate({ semanticRole: undefined })]),
    ).toBeNull()
  })
})

describe("selectedPlanarFaceReference", () => {
  it("creates stable face intent without retaining the mesh face identity", () => {
    const reference = selectedPlanarFaceReference(featureId, 42, [
      candidate({ semanticRole: "extrusion.side.source-line" }),
    ])

    expect(reference).toMatchObject({
      featureId,
      kind: "face",
      semanticRole: "extrusion.side.source-line",
      intent: { nearPoint: [0, 0, 10], expectedDirection: [0, 0, 1] },
    })
    expect(reference).not.toHaveProperty("meshFaceId")
    expect(reference).not.toHaveProperty("candidateId")
  })

  it("rejects curved faces and unknown mesh hits", () => {
    expect(
      selectedPlanarFaceReference(featureId, 42, [
        candidate({ signature: { ...candidate().signature, geometryClass: "CYLINDRE" } }),
      ]),
    ).toBeNull()
    expect(selectedPlanarFaceReference(featureId, 7, [candidate()])).toBeNull()
  })
})
