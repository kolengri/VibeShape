import {
  boxFeatureType,
  createLengthQuantity,
  featureIdSchema,
  featureRecordSchema,
} from "@vibeshape/domain"
import type { DocumentWorkerResponse } from "@vibeshape/protocol"
import { describe, expect, it } from "vitest"
import { terminalModelBodies } from "./model-bodies"

const sourceId = featureIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f2901")
const consumerId = featureIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f2902")
const source = featureRecordSchema.parse({
  schemaVersion: 0,
  id: sourceId,
  type: boxFeatureType.type,
  parameters: {
    width: createLengthQuantity(20, "mm", "20 mm"),
    depth: createLengthQuantity(20, "mm", "20 mm"),
    height: createLengthQuantity(20, "mm", "20 mm"),
    centered: false,
  },
  dependencies: [],
  references: [],
  suppressed: false,
  label: "Source",
})
const consumer = { ...source, id: consumerId, label: "Consumer", dependencies: [sourceId] }
const hash = "a".repeat(64)
const mesh = {
  positions: new Float32Array([0, 0, 0]),
  normals: new Float32Array([0, 0, 1]),
  indices: new Uint32Array([0, 0, 0]),
  triangleFaceIds: new Uint32Array([1]),
}

function rebuild(
  records: readonly object[],
  geometry: readonly object[],
): Extract<DocumentWorkerResponse, { type: "documentRebuilt" }> {
  return {
    type: "documentRebuilt",
    protocolVersion: 21,
    requestId: "test",
    documentId: "0195b5ac-b220-7a2c-8c33-67a36a7f2903",
    revision: 1,
    generation: 1,
    evaluation: {
      records,
      dirtyFeatureIds: [],
      evaluatedFeatureIds: [sourceId, consumerId],
      reusedFeatureIds: [],
    },
    geometry,
    sketches: [],
    modelReferenceEvidence: [],
  } as never
}

function geometryRecord(featureId: string, bodies?: readonly object[]) {
  return {
    featureId,
    contentHash: hash,
    meshPolicy: { chordTolerance: 0.05, angularTolerance: 0.1 },
    geometry: {
      engine: {
        adapter: "replicad",
        adapterVersion: "test",
        replicadVersion: "0.23.1",
        opencascadePackageVersion: "0.23.0",
        opencascadeSourceRevision: null,
        wasmBytes: 1,
        initializedInMs: 1,
        featureContentEnvironment: {
          adapter: "replicad",
          adapterVersion: "test",
          replicadVersion: "0.23.1",
          opencascadePackageVersion: "0.23.0",
          opencascadeSourceRevision: null,
        },
      },
      shape: {
        valid: true,
        volume: 1,
        surfaceArea: 1,
        bounds: { min: [0, 0, 0], max: [1, 1, 1] },
        faceCount: 1,
        edgeCount: 1,
        solidCount: bodies?.length ?? 1,
      },
      mesh,
      topologyCandidates: [],
      cache: { brepHit: false },
      timings: { evaluationMs: 1, tessellationMs: 1, totalMs: 2 },
      ...(bodies ? { bodies } : {}),
    },
  }
}

describe("terminalModelBodies", () => {
  it("projects successful terminal bodies and keeps unnamed roots roleless", () => {
    const result = terminalModelBodies(
      [source],
      rebuild(
        [{ featureId: sourceId, status: "succeeded", contentHash: hash }],
        [geometryRecord(sourceId)],
      ),
    )

    expect(result).toHaveLength(1)
    expect(result?.[0]?.feature.id).toBe(sourceId)
    expect(result?.[0]?.geometry.outputRole).toBeUndefined()
  })

  it("preserves sibling named bodies and excludes context records consistently", () => {
    const siblingBodies = [
      {
        outputRole: "pattern.instance.0",
        shape: { solidCount: 1 },
        mesh: {},
        topologyCandidates: [],
      },
      {
        outputRole: "pattern.instance.1",
        shape: { solidCount: 1 },
        mesh: {},
        topologyCandidates: [],
      },
    ]
    const result = terminalModelBodies(
      [source, consumer],
      rebuild(
        [
          { featureId: sourceId, status: "succeeded", contentHash: hash },
          { featureId: consumerId, status: "succeeded", contentHash: hash },
        ],
        [geometryRecord(sourceId, siblingBodies), geometryRecord(consumerId)],
      ),
      [consumerId],
    )

    expect(result?.map(({ geometry }) => geometry.outputRole)).toEqual([
      "pattern.instance.0",
      "pattern.instance.1",
    ])
  })

  it("fails closed when evaluation and geometry evidence disagree", () => {
    const result = terminalModelBodies(
      [source],
      rebuild([{ featureId: sourceId, status: "succeeded", contentHash: hash }], []),
    )

    expect(result).toBeNull()
  })

  it("keeps a source body when its consumer did not succeed", () => {
    const result = terminalModelBodies(
      [source, consumer],
      rebuild(
        [
          { featureId: sourceId, status: "succeeded", contentHash: hash },
          {
            featureId: consumerId,
            status: "failed",
            diagnostics: [{ code: "test.failure", values: {} }],
          },
        ],
        [geometryRecord(sourceId)],
      ),
    )

    expect(result?.map(({ feature }) => feature.id)).toEqual([sourceId])
  })

  it("fails closed when rebuild contains an unrelated geometry record", () => {
    const unrelatedId = featureIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f2904")
    const result = terminalModelBodies(
      [source],
      rebuild(
        [{ featureId: sourceId, status: "succeeded", contentHash: hash }],
        [geometryRecord(sourceId), geometryRecord(unrelatedId)],
      ),
    )

    expect(result).toBeNull()
  })
})
