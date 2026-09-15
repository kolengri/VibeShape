import {
  createEmptySketch,
  featureIdSchema,
  sketchIdSchema,
  sketchRecordSchema,
  topologyCandidateSchema,
} from "@vibeshape/domain"
import {
  type DocumentWorkerResponse,
  topologyCandidateSchema as workerTopologyCandidateSchema,
} from "@vibeshape/protocol"
import { describe, expect, it } from "vitest"
import type { DocumentControllerState } from "../../document/document-controller"
import {
  inspectSketchSupportHealth,
  selectedPlanarFaceReference,
  selectedPlanarFaceReferenceFromController,
  selectedSketchSupport,
  selectedSketchSupportFromController,
} from "./sketch-support"

const featureId = featureIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f2602")
const sketchId = sketchIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f2610")

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

function supportedSketch() {
  const support = selectedSketchSupport(featureId, 42, [candidate()])
  if (!support) throw new Error("The fixture must create a planar sketch support.")
  return createEmptySketch({ id: sketchId, label: "Supported sketch", ...support })
}

function rebuiltResponse(
  topologyCandidates: readonly ReturnType<typeof candidate>[],
  status: "succeeded" | "failed" | "blocked" | "suppressed" = "succeeded",
) {
  const record =
    status === "succeeded"
      ? { featureId, status, contentHash: "a".repeat(64) }
      : status === "failed"
        ? {
            featureId,
            status,
            diagnostics: [{ code: "test.failure", values: {} }],
          }
        : status === "blocked"
          ? { featureId, status, blockedBy: [featureId] }
          : { featureId, status }
  return {
    type: "documentRebuilt",
    requestId: "0195b5ac-b220-7a2c-8c33-67a36a7f2611",
    documentId: "0195b5ac-b220-7a2c-8c33-67a36a7f2612",
    revision: 0,
    evaluation: {
      records: [record],
      dirtyFeatureIds: [],
      evaluatedFeatureIds: [],
      reusedFeatureIds: [],
    },
    geometry: [
      {
        featureId,
        contentHash: "a".repeat(64),
        meshPolicy: "visible",
        geometry: { topologyCandidates },
      },
    ],
    sketches: [],
    modelReferenceEvidence: [],
  } as unknown as Extract<DocumentWorkerResponse, { type: "documentRebuilt" }>
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

  it("accepts a planar extrusion side with a stable source-entity role", () => {
    expect(
      selectedSketchSupport(featureId, 42, [
        candidate({ semanticRole: "extrusion.side.0195b5ac-b220-7a2c-8c33-67a36a7f2603" }),
      ]),
    ).toMatchObject({
      plane: "xy",
      support: {
        kind: "feature-face",
        reference: {
          featureId,
          semanticRole: "extrusion.side.0195b5ac-b220-7a2c-8c33-67a36a7f2603",
        },
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
    expect(
      selectedSketchSupport(featureId, 42, [candidate({ semanticRole: "extrusion.side." })]),
    ).toBeNull()
    expect(
      selectedSketchSupport(featureId, 42, [
        candidate({
          semanticRole: "extrusion.side.source-line",
          signature: { ...candidate().signature, geometryClass: "CYLINDRE" },
        }),
      ]),
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

describe("inspectSketchSupportHealth", () => {
  it.each(["resolved", "missing", "ambiguous"] as const)(
    "preserves %s face support with worker edge display data present",
    (status) => {
      const edge = workerTopologyCandidateSchema.parse({
        candidateId: "edge:0",
        kind: "edge",
        lineageTokens: [],
        signature: {
          kind: "edge",
          geometryClass: "LINE",
          measure: 20,
          centroid: [0, -10, 10],
          bounds: { min: [-10, -10, 10], max: [10, -10, 10] },
          boundaryCount: 2,
          adjacentGeometryClasses: ["PLANE", "PLANE"],
        },
        edgePolyline: [
          [-10, -10, 10],
          [10, -10, 10],
        ],
      })
      expect(topologyCandidateSchema.safeParse(edge).success).toBe(false)
      const faces = status === "missing" ? [] : [candidate()]
      if (status === "ambiguous") faces.push(candidate({ candidateId: "face:1", meshFaceId: 43 }))
      expect(
        inspectSketchSupportHealth(supportedSketch(), rebuiltResponse([...faces, edge])),
      ).toEqual({ status })
      expect(edge.edgePolyline).toHaveLength(2)
    },
  )

  it("distinguishes resolved, missing, and ambiguous topology without retargeting", () => {
    const sketch = supportedSketch()

    expect(inspectSketchSupportHealth(sketch, rebuiltResponse([candidate()]))).toEqual({
      status: "resolved",
    })
    expect(inspectSketchSupportHealth(sketch, rebuiltResponse([]))).toEqual({
      status: "missing",
    })
    expect(
      inspectSketchSupportHealth(
        sketch,
        rebuiltResponse([candidate(), candidate({ candidateId: "face:1", meshFaceId: 43 })]),
      ),
    ).toEqual({ status: "ambiguous" })
  })

  it("reports unavailable evaluation as unknown instead of a broken support", () => {
    const sketch = supportedSketch()

    expect(inspectSketchSupportHealth(sketch, undefined)).toEqual({ status: "unknown" })
    expect(inspectSketchSupportHealth(sketch, rebuiltResponse([], "failed"))).toEqual({
      status: "unknown",
    })
    expect(inspectSketchSupportHealth(sketch, rebuiltResponse([], "blocked"))).toEqual({
      status: "unknown",
    })
  })

  it("fails closed when a resolved candidate is no longer an oriented plane", () => {
    const sketch = supportedSketch()
    const curved = candidate({
      signature: {
        ...candidate().signature,
        geometryClass: "CYLINDRE",
      },
    })

    expect(inspectSketchSupportHealth(sketch, rebuiltResponse([curved]))).toEqual({
      status: "missing",
    })
  })

  it("rejects a schema-valid planar reference without an accepted support role", () => {
    const sketch = supportedSketch()
    const unsupported = sketchRecordSchema.parse({
      ...sketch,
      support: {
        ...sketch.support,
        reference: { ...sketch.support?.reference, semanticRole: undefined },
      },
    })

    expect(inspectSketchSupportHealth(unsupported, rebuiltResponse([candidate()]))).toEqual({
      status: "missing",
    })
  })

  it("does not assign support health to an origin-plane sketch", () => {
    expect(
      inspectSketchSupportHealth(
        createEmptySketch({ id: sketchId, label: "Origin sketch", plane: "xy" }),
        rebuiltResponse([candidate()]),
      ),
    ).toBeNull()
  })
})

it("never converts a constituent face selection into a whole-feature topology reference", () => {
  const response = rebuiltResponse([candidate()])
  const controller = {
    report: { rebuild: { ok: true, response } },
  } as unknown as DocumentControllerState
  for (const outputRole of ["pattern.instance.1", "result"]) {
    const selection = { featureId, outputRole, faceId: 42, faceOrdinal: 1 }
    expect(selectedSketchSupportFromController(controller, selection)).toBeNull()
    expect(selectedPlanarFaceReferenceFromController(controller, selection)).toBeNull()
  }
  const selection = { featureId, faceId: 42, faceOrdinal: 1 }
  expect(selectedSketchSupportFromController(controller, selection)).not.toBeNull()
})
