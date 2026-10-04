import {
  applyDocumentCommand,
  createEmptySketch,
  type DocumentEvent,
  type DocumentSnapshot,
  documentCommandSchema,
  featureIdSchema,
  replayDocumentEvents,
  sketchIdSchema,
  sketchRecordSchema,
  topologyCandidateSchema,
} from "@vibeshape/domain"
import {
  type DocumentWorkerResponse,
  topologyCandidateSchema as workerTopologyCandidateSchema,
} from "@vibeshape/protocol"
import { describe, expect, it } from "vitest"
import { createCylindricalLoftProject } from "../../../../../tests/support/loft-v3-cylinder-fixture"
import { loftFixtureId as id } from "../../../../../tests/support/loft-v3-fixture"
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
  owner = featureId,
) {
  const record =
    status === "succeeded"
      ? { featureId: owner, status, contentHash: "a".repeat(64) }
      : status === "failed"
        ? {
            featureId: owner,
            status,
            diagnostics: [{ code: "test.failure", values: {} }],
          }
        : status === "blocked"
          ? { featureId: owner, status, blockedBy: [featureId] }
          : { featureId: owner, status }
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
        featureId: owner,
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
  it("resolves opposing Datum caps by the authored orientation and preserves duplicate or legacy ambiguity", () => {
    const front = candidate({ semanticRole: "datum.plane" }),
      back = candidate({
        candidateId: "face:back",
        meshFaceId: 43,
        semanticRole: "datum.plane",
        signature: { ...front.signature, direction: [0, 0, -1] },
      })
    const support = selectedSketchSupport(featureId, 42, [front, back])
    if (!support) throw new Error("The oriented Datum support must exist.")
    const sketch = createEmptySketch({ id: sketchId, label: "Datum sketch", ...support })
    for (const caps of [
      [front, back],
      [back, front],
    ])
      expect(inspectSketchSupportHealth(sketch, rebuiltResponse(caps))).toEqual({
        status: "resolved",
      })
    expect(
      inspectSketchSupportHealth(
        sketch,
        rebuiltResponse([front, candidate({ ...front, candidateId: "duplicate", meshFaceId: 44 })]),
      ),
    ).toEqual({ status: "ambiguous" })
    const movedFront = candidate({
        ...front,
        signature: {
          ...front.signature,
          centroid: [0, 0, 40],
          bounds: { min: [-10, -10, 40], max: [10, 10, 40] },
        },
      }),
      movedBack = candidate({
        ...back,
        signature: {
          ...back.signature,
          centroid: [0, 0, 39.99],
          bounds: { min: [-10, -10, 39.99], max: [10, 10, 39.99] },
        },
      })
    expect(inspectSketchSupportHealth(sketch, rebuiltResponse([movedBack, movedFront]))).toEqual({
      status: "resolved",
    })
    for (const signature of [
      { ...support.support.reference.signature, directionMode: "axis" },
      { ...support.support.reference.signature, direction: undefined, directionMode: undefined },
    ]) {
      const legacy = sketchRecordSchema.parse({
        ...sketch,
        support: {
          ...support.support,
          reference: {
            ...support.support.reference,
            signature,
          },
        },
      })
      expect(inspectSketchSupportHealth(legacy, rebuiltResponse([front, back]))).toEqual({
        status: "ambiguous",
      })
    }
  })

  it("keeps an edited Datum attachment unresolved through replay until its changed orientation is explicitly repaired", () => {
    const fixture = createCylindricalLoftProject(),
      upper = fixture.snapshot.sketches.find((sketch) => sketch.id === id(2000)),
      datum = fixture.snapshot.features.find((feature) => feature.id === id(870))
    if (!upper?.support || !datum) throw new Error("The authored Datum attachment must exist.")
    const front = candidate({
        semanticRole: "datum.plane",
        signature: {
          ...candidate().signature,
          direction: [0, -1, 0],
          centroid: [0, -10.005, 0],
          bounds: { min: [-10, -10.005, -10], max: [10, -10.005, 10] },
        },
      }),
      back = candidate({
        ...front,
        candidateId: "face:back",
        meshFaceId: 43,
        signature: {
          ...front.signature,
          direction: [0, 1, 0],
          centroid: [0, -9.995, 0],
          bounds: { min: [-10, -9.995, -10], max: [10, -9.995, 10] },
        },
      })
    const edited = authoredCommand(
      fixture.snapshot,
      "org.vibeshape.feature.update",
      {
        feature: {
          ...datum,
          parameters: { ...datum.parameters, support: { kind: "origin-plane", plane: "xz" } },
        },
      },
      id(9300),
    )
    const replayed = replayedSnapshot([...fixture.events, edited.event])
    expect(replayed).toEqual(edited.snapshot)
    expect(replayed.sketches.find(({ id: sketchId }) => sketchId === upper.id)).toEqual(upper)
    expect(
      inspectSketchSupportHealth(upper, rebuiltResponse([front, back], "succeeded", datum.id)),
    ).toEqual({ status: "missing" })
    const currentSupport = selectedSketchSupport(datum.id, 42, [back, front])
    if (!currentSupport) throw new Error("The current oriented Datum face must be selectable.")
    const repaired = authoredCommand(
      replayed,
      "org.vibeshape.sketch.update",
      { sketch: { ...upper, ...currentSupport } },
      id(9301),
    )
    const repairedReplay = replayedSnapshot([...fixture.events, edited.event, repaired.event])
    expect(repairedReplay).toEqual(repaired.snapshot)
    const repairedSketch = repaired.snapshot.sketches.find(
      ({ id: sketchId }) => sketchId === upper.id,
    )
    if (!repairedSketch) throw new Error("Repair must preserve the sketch identity.")
    expect(repairedSketch.entities).toEqual(upper.entities)
    expect(repairedSketch.constraints).toEqual(upper.constraints)
    expect(
      inspectSketchSupportHealth(
        repairedSketch,
        rebuiltResponse([front, back], "succeeded", datum.id),
      ),
    ).toEqual({ status: "resolved" })
  })
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

function authoredCommand(
  snapshot: DocumentSnapshot,
  kind: string,
  payload: unknown,
  commandId: string,
) {
  const result = applyDocumentCommand(
    snapshot,
    documentCommandSchema.parse({
      schemaVersion: 1,
      kind,
      commandId,
      documentId: snapshot.id,
      baseRevision: snapshot.revision,
      issuedAt: "2026-10-04T00:00:00Z",
      actor: { type: "user", userId: null },
      payload,
    }),
  )
  if (!result.ok) throw new Error(result.diagnostic.message)
  return result
}

function replayedSnapshot(events: readonly DocumentEvent[]) {
  const result = replayDocumentEvents(events)
  if (!result.ok) throw new Error(result.diagnostic.message)
  return result.snapshot
}

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
