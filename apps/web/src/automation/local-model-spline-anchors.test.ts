import { describe, expect, it } from "bun:test"
import { commandActorSchema } from "@vibeshape/domain/commands"
import { documentSnapshotSchema } from "@vibeshape/domain/document"
import { type SketchRecordInput, sketchRecordInputSchema } from "@vibeshape/domain/sketch"
import { DOCUMENT_PROTOCOL_VERSION } from "@vibeshape/protocol"
import { vi } from "../../../../tests/unit/support/bun-test"
import type { FaceAlignmentPreparationPort } from "./local-face-alignment-command"
import { anchorSketchModelSplines } from "./local-model-spline-anchors"

const id = (n: number) => `0195b5ac-b260-7a2c-8c33-${String(n).padStart(12, "0")}`
const actor = commandActorSchema.parse({
  type: "mcp",
  clientId: "org.example.client",
  sessionId: id(99),
})
const documentId = id(1)
const featureId = id(2)
const hash = "b".repeat(64)
const signature = {
  kind: "edge" as const,
  geometryClass: "BSPLINE_CURVE",
  measure: 24,
  centroid: [10, 2, 5] as [number, number, number],
  bounds: { min: [0, 0, 5], max: [20, 4, 5] } as {
    min: [number, number, number]
    max: [number, number, number]
  },
  boundaryCount: 2,
  adjacentGeometryClasses: [],
}
// The published chain runs from (20, 0) to (0, 0); omitted anchors follow the published order.
const poles = [
  [20, 0, 5],
  [17, 4, 5],
  [13, 4, 5],
  [10, 0, 5],
  [7, -4, 5],
  [3, -4, 5],
  [0, 0, 5],
]
const snapshot = documentSnapshotSchema.parse({
  schemaVersion: 0,
  id: documentId,
  revision: 4,
  name: "Spline anchors",
  createdAt: "2026-11-11T00:00:00.000Z",
  updatedAt: "2026-11-11T00:00:00.000Z",
  features: [
    {
      schemaVersion: 0,
      id: featureId,
      type: {
        moduleId: "org.vibeshape.test",
        moduleVersion: "0.1.0",
        typeId: "org.vibeshape.test.fixture",
        schemaVersion: 1,
      },
      parameters: {},
      dependencies: [],
      references: [],
      suppressed: false,
    },
  ],
})
const shape = {
  valid: true,
  volume: 1,
  surfaceArea: 1,
  bounds: { min: [0, -4, 0], max: [20, 4, 5] },
  faceCount: 1,
  edgeCount: 1,
  solidCount: 1,
}
const response = {
  protocolVersion: DOCUMENT_PROTOCOL_VERSION,
  requestId: id(50),
  documentId,
  revision: 4,
  generation: 7,
  type: "documentRebuilt",
  evaluation: {
    records: [{ featureId, status: "succeeded", contentHash: hash }],
    dirtyFeatureIds: [],
    evaluatedFeatureIds: [],
    reusedFeatureIds: [],
  },
  geometry: [
    {
      featureId,
      contentHash: hash,
      meshPolicy: { chordTolerance: 0.01, angularTolerance: 0.1 },
      geometry: {
        engine: {
          adapter: "replicad",
          adapterVersion: "test-build",
          replicadVersion: "0.23.1",
          opencascadePackageVersion: "0.23.0",
          opencascadeSourceRevision: null,
          wasmBytes: 1,
          initializedInMs: 1,
          featureContentEnvironment: {
            schemaVersion: 0,
            hostApiVersion: "0.1.0",
            geometry: {
              adapterId: "org.vibeshape.geometry.replicad",
              adapterVersion: "test-build",
              kernelId: "org.opencascade.occt",
              kernelVersion: "7.9.2",
              kernelSourceRevision: null,
            },
            modelingTolerancePolicyVersion: 1,
            provider: { kind: "built-in" },
          },
        },
        shape,
        mesh: {
          positions: new Float32Array([0, 0, 0]),
          normals: new Float32Array([0, 0, 1]),
          indices: new Uint32Array([0, 0, 0]),
          triangleFaceIds: new Uint32Array([0]),
        },
        topologyCandidates: [
          {
            candidateId: "edge:spline-0",
            kind: "edge",
            semanticRole: "edge.spline",
            lineageTokens: [],
            signature,
            referenceGeometry: { kind: "bezier-chain-edge", poles, maxDeviation: 2e-5 },
          },
        ],
        cache: { brepHit: false },
        timings: { evaluationMs: 1, tessellationMs: 1, totalMs: 2 },
      },
    },
  ],
  sketches: [],
  modelReferenceEvidence: [],
}

function sketch(anchors?: [[number, number], [number, number]]): SketchRecordInput {
  return sketchRecordInputSchema.parse({
    schemaVersion: 0,
    id: id(300),
    label: "Spline reference",
    plane: "xy",
    entities: [],
    constraints: [],
    externalReferences: [
      {
        schemaVersion: 0,
        id: id(301),
        kind: "model-spline",
        reference: {
          schemaVersion: 0,
          featureId,
          kind: "edge",
          semanticRole: "edge.spline",
          signature,
        },
        ...(anchors ? { endpointAnchors: anchors } : {}),
        projectedCurveIds: [id(310), id(311)],
        projectedPointIds: Array.from({ length: 7 }, (_, index) => id(320 + index)),
      },
    ],
  })
}

function preparation(): FaceAlignmentPreparationPort & {
  rebuild: ReturnType<typeof vi.fn<FaceAlignmentPreparationPort["rebuild"]>>
} {
  return {
    readOwnedDraftSnapshot: vi.fn(async () => ({ ok: true as const, value: snapshot })),
    rebuild: vi.fn<FaceAlignmentPreparationPort["rebuild"]>(async () => ({
      ok: true,
      response,
    })),
  }
}

const input = (target: SketchRecordInput) => ({ draftId: id(10), baseRevision: 4, sketch: target })

describe("model spline anchors for automation sketches", () => {
  it("fills omitted anchors from the rebuilt draft edge before the sketch becomes a command", async () => {
    const port = preparation()
    const result = await anchorSketchModelSplines(actor, documentId, input(sketch()), port)
    if (!result.ok) throw new Error(result.diagnostic.message)
    expect(result.sketch.externalReferences?.[0]).toMatchObject({
      endpointAnchors: [
        [20, 0],
        [0, 0],
      ],
    })
    expect(port.rebuild).toHaveBeenCalledTimes(1)
  })

  it("keeps supplied anchors without rebuilding the draft", async () => {
    const port = preparation()
    const anchored = sketch([
      [0, 0],
      [20, 0],
    ])
    const result = await anchorSketchModelSplines(actor, documentId, input(anchored), port)
    expect(result).toEqual({ ok: true, sketch: anchored })
    expect(port.rebuild).not.toHaveBeenCalled()
  })

  it("fails with an actionable diagnostic when anchors cannot be filled", async () => {
    expect(
      await anchorSketchModelSplines(actor, documentId, input(sketch()), undefined),
    ).toMatchObject({ ok: false, diagnostic: { code: "model-spline-anchors-unavailable" } })
    const tilted = { ...sketch(), plane: "xz" as const }
    expect(
      await anchorSketchModelSplines(actor, documentId, input(tilted), preparation()),
    ).toMatchObject({
      ok: false,
      diagnostic: {
        code: "invalid-model-spline-reference",
        message: expect.stringMatching(/plane parallel to the sketch/),
      },
    })
    const stale = { ...input(sketch()), baseRevision: 3 }
    expect(await anchorSketchModelSplines(actor, documentId, stale, preparation())).toMatchObject({
      ok: false,
      diagnostic: { code: "stale-query-revision" },
    })
  })
})
