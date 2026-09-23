import { datumPlaneFeatureType } from "@vibeshape/domain"
import { documentSnapshotSchema } from "@vibeshape/domain/document"
import { featureRecordSchema } from "@vibeshape/domain/feature-graph"
import { createLengthQuantity } from "@vibeshape/domain/units"
import { describe, expect, it } from "vitest"
import {
  createModelBodyMeasurementEvidence,
  createModelMeasurementEvidence,
} from "./model-measurements"

const documentId = "0195b5ac-b220-7a2c-8c33-67a36a7f2101"
const featureIds = [
  "0195b5ac-b220-7a2c-8c33-67a36a7f2102",
  "0195b5ac-b220-7a2c-8c33-67a36a7f2103",
  "0195b5ac-b220-7a2c-8c33-67a36a7f2104",
]

function feature(id: string) {
  return featureRecordSchema.parse({
    schemaVersion: 0,
    id,
    type: {
      moduleId: "vibeshape.part-design",
      moduleVersion: "1.0.0",
      typeId: "vibeshape.box",
      schemaVersion: 1,
    },
    parameters: {},
    dependencies: [],
    references: [],
    suppressed: false,
  })
}

function snapshot() {
  return documentSnapshotSchema.parse({
    schemaVersion: 0,
    id: documentId,
    revision: 4,
    name: "Evidence",
    features: featureIds.map(feature),
    sketches: [],
    variables: [],
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
  })
}

function response(records: unknown[], overrides: Record<string, unknown> = {}) {
  return {
    protocolVersion: 21,
    requestId: "0195b5ac-b220-7a2c-8c33-67a36a7f2201",
    documentId,
    revision: 4,
    generation: 9,
    type: "documentRebuilt",
    evaluation: { records, dirtyFeatureIds: [], evaluatedFeatureIds: [], reusedFeatureIds: [] },
    geometry: [],
    sketches: [],
    modelReferenceEvidence: [],
    ...overrides,
  }
}

function rebuild(value: unknown) {
  return { ok: true as const, response: value as never }
}

const successHash = "a".repeat(64)
const validGeometry = {
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
  shape: {
    valid: true,
    volume: 120,
    surfaceArea: 88,
    bounds: { min: [-1, -2, -3], max: [4, 5, 6] },
    faceCount: 6,
    edgeCount: 12,
    solidCount: 1,
  },
  topologyCandidates: [],
  mesh: {
    positions: new Float32Array([0, 0, 0]),
    normals: new Float32Array([0, 0, 1]),
    indices: new Uint32Array([0, 0, 0]),
    triangleFaceIds: new Uint32Array([1]),
  },
  cache: { brepHit: false },
  timings: { evaluationMs: 1, tessellationMs: 1, totalMs: 2 },
}

function successGeometry(overrides: Record<string, unknown> = {}) {
  return {
    featureId: featureIds[0],
    contentHash: successHash,
    meshPolicy: { chordTolerance: 0.01, angularTolerance: 0.1 },
    geometry: { ...validGeometry, ...overrides },
  }
}

describe("createModelMeasurementEvidence", () => {
  it("reports unavailable and stale rebuilds", () => {
    const current = snapshot()
    expect(createModelMeasurementEvidence(current, { ok: false, diagnostic: {} as never })).toEqual(
      {
        ok: false,
        code: "geometry-unavailable",
      },
    )
    expect(createModelMeasurementEvidence(current, rebuild(response([], { revision: 3 })))).toEqual(
      { ok: false, code: "stale-geometry" },
    )
  })

  it("converts failure, blocked, and suppressed records without leaking payloads", () => {
    const current = snapshot()
    const result = createModelMeasurementEvidence(
      current,
      rebuild(
        response([
          {
            featureId: featureIds[0],
            status: "failed",
            diagnostics: [{ code: "vibeshape.geometry.failed", values: { secret: "drop" } }],
          },
          { featureId: featureIds[1], status: "blocked", blockedBy: [featureIds[0]] },
          { featureId: featureIds[2], status: "suppressed" },
        ]),
      ),
    )
    expect(result).toEqual({
      ok: true,
      evidence: {
        schemaVersion: 1,
        documentId,
        revision: 4,
        generation: 9,
        features: [
          {
            featureId: featureIds[0],
            status: "failed",
            diagnosticCodes: ["vibeshape.geometry.failed"],
          },
          {
            featureId: featureIds[1],
            status: "blocked",
            blockedBy: [featureIds[0]],
          },
          { featureId: featureIds[2], status: "suppressed" },
        ],
      },
    })
    expect(current.features.map((feature) => feature.id)).toEqual(featureIds)
  })

  it("rejects foreign or missing evaluation IDs and malformed geometry evidence", () => {
    const current = snapshot()
    const foreign = "0195b5ac-b220-7a2c-8c33-67a36a7f2199"
    const records = featureIds.map((featureId) => ({ featureId, status: "suppressed" }))
    expect(createModelMeasurementEvidence(current, rebuild(response(records.slice(0, 2))))).toEqual(
      { ok: false, code: "invalid-geometry-evidence" },
    )
    expect(
      createModelMeasurementEvidence(
        current,
        rebuild(response(records.slice(0, 2).concat({ featureId: foreign, status: "suppressed" }))),
      ),
    ).toEqual({ ok: false, code: "invalid-geometry-evidence" })
    expect(
      createModelMeasurementEvidence(
        current,
        rebuild(
          response(records, {
            geometry: [{ featureId: featureIds[0], contentHash: "0".repeat(64) }],
          }),
        ),
      ),
    ).toEqual({ ok: false, code: "invalid-geometry-evidence" })
  })

  it("projects successful geometry metrics while omitting mesh and topology", () => {
    const current = snapshot()
    const result = createModelMeasurementEvidence(
      current,
      rebuild(
        response(
          [
            { featureId: featureIds[0], status: "succeeded", contentHash: successHash },
            { featureId: featureIds[1], status: "suppressed" },
            { featureId: featureIds[2], status: "suppressed" },
          ],
          { geometry: [successGeometry()] },
        ),
      ),
    )
    expect(result).toEqual({
      ok: true,
      evidence: expect.objectContaining({
        features: expect.arrayContaining([
          {
            featureId: featureIds[0],
            status: "succeeded",
            contentHash: successHash,
            shape: validGeometry.shape,
          },
        ]),
      }),
    })
    if (!result.ok) return
    expect(result.evidence.features[0]).not.toHaveProperty("mesh")
    expect(result.evidence.features[0]).not.toHaveProperty("topologyCandidates")
    ;(result.evidence.features[0] as { shape: { volume: number } }).shape.volume = 999
    expect(current.features.map((feature) => feature.id)).toEqual(featureIds)
    expect(validGeometry.shape.volume).toBe(120)
  })

  it.each([
    ["hash mismatch", { contentHash: "b".repeat(64) }, undefined],
    ["inverted bounds", {}, { bounds: { min: [2, 0, 0], max: [1, 1, 1] } }],
    ["nonfinite volume", {}, { volume: Number.NaN }],
  ])("rejects %s success evidence", (_name, geometryOverrides, shapeOverrides) => {
    const current = snapshot()
    const geometry = {
      ...successGeometry(
        shapeOverrides ? { shape: { ...validGeometry.shape, ...shapeOverrides } } : {},
      ),
      ...geometryOverrides,
    }
    const result = createModelMeasurementEvidence(
      current,
      rebuild(
        response(
          [
            { featureId: featureIds[0], status: "succeeded", contentHash: successHash },
            { featureId: featureIds[1], status: "suppressed" },
            { featureId: featureIds[2], status: "suppressed" },
          ],
          { geometry: [geometry] },
        ),
      ),
    )
    expect(result).toEqual({ ok: false, code: "invalid-geometry-evidence" })
  })

  it("rejects document mismatch and duplicate evaluation IDs", () => {
    const current = snapshot()
    expect(
      createModelMeasurementEvidence(
        current,
        rebuild(response([], { documentId: "0195b5ac-b220-7a2c-8c33-67a36a7f2199" })),
      ),
    ).toEqual({ ok: false, code: "stale-geometry" })
    const duplicate = [
      { featureId: featureIds[0], status: "suppressed" },
      { featureId: featureIds[0], status: "suppressed" },
      { featureId: featureIds[2], status: "suppressed" },
    ]
    expect(createModelMeasurementEvidence(current, rebuild(response(duplicate)))).toEqual({
      ok: false,
      code: "invalid-geometry-evidence",
    })
  })
})

describe("createModelBodyMeasurementEvidence", () => {
  function bodyResponse(catalog?: unknown[], shape = validGeometry.shape) {
    return response(
      [
        { featureId: featureIds[0], status: "succeeded", contentHash: successHash },
        { featureId: featureIds[1], status: "suppressed" },
        { featureId: featureIds[2], status: "suppressed" },
      ],
      { geometry: [successGeometry({ shape, ...(catalog ? { bodies: catalog } : {}) })] },
    )
  }

  it("projects distinct body metrics without mesh or topology payloads", () => {
    const firstShape = { ...validGeometry.shape }
    const catalog = [
      {
        outputRole: "pattern.instance.0",
        shape: firstShape,
        mesh: validGeometry.mesh,
        topologyCandidates: [],
      },
      {
        outputRole: "pattern.instance.1",
        shape: { ...validGeometry.shape, volume: 240 },
        mesh: validGeometry.mesh,
        topologyCandidates: [],
      },
    ]
    const source = bodyResponse(catalog, { ...validGeometry.shape, solidCount: 2, volume: 360 })
    const result = createModelBodyMeasurementEvidence(snapshot(), rebuild(source))
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error("Expected exact body metrics.")
    expect(result.evidence.bodies.map((body) => [body.outputRole, body.shape.volume])).toEqual([
      ["pattern.instance.0", 120],
      ["pattern.instance.1", 240],
    ])
    expect(Object.keys(result.evidence.bodies[0] ?? {}).sort()).toEqual([
      "contentHash",
      "featureId",
      "outputRole",
      "shape",
    ])
    firstShape.volume = 999
    expect(result.evidence.bodies[0]?.shape.volume).toBe(120)
  })

  it("omits construction-plane display solids while preserving model evidence", () => {
    const current = snapshot()
    current.features[0] = featureRecordSchema.parse({
      ...current.features[0],
      type: datumPlaneFeatureType.type,
      parameters: {
        mode: "offset",
        support: { kind: "origin-plane", plane: "xy" },
        offset: createLengthQuantity(5),
      },
    })
    const result = createModelBodyMeasurementEvidence(current, rebuild(bodyResponse([])))
    expect(result).toMatchObject({ ok: true, evidence: { bodies: [] } })
  })

  it("retains omitted legacy identity and an explicitly declared result alias", () => {
    const legacy = createModelBodyMeasurementEvidence(snapshot(), rebuild(bodyResponse()))
    expect(legacy).toMatchObject({ ok: true, evidence: { bodies: [{ shape: { volume: 120 } }] } })
    if (!legacy.ok) throw new Error("Expected legacy measurements.")
    expect(legacy.evidence.bodies[0]).not.toHaveProperty("outputRole")
    const named = createModelBodyMeasurementEvidence(
      snapshot(),
      rebuild(
        bodyResponse([
          {
            outputRole: "result",
            shape: validGeometry.shape,
            mesh: validGeometry.mesh,
            topologyCandidates: [],
          },
        ]),
      ),
    )
    expect(named).toMatchObject({ ok: true, evidence: { bodies: [{ outputRole: "result" }] } })
  })

  it("rejects stale, partial, mismatched, and foreign geometry instead of reporting root metrics", () => {
    const source = bodyResponse()
    expect(
      createModelBodyMeasurementEvidence(snapshot(), rebuild({ ...source, revision: 3 })),
    ).toEqual({ ok: false, code: "stale-geometry" })
    expect(
      createModelBodyMeasurementEvidence(snapshot(), rebuild({ ...source, geometry: [] })),
    ).toEqual({ ok: false, code: "invalid-geometry-evidence" })
    expect(
      createModelBodyMeasurementEvidence(
        snapshot(),
        rebuild({ ...source, geometry: [{ ...successGeometry(), contentHash: "b".repeat(64) }] }),
      ),
    ).toEqual({ ok: false, code: "invalid-geometry-evidence" })
    expect(
      createModelBodyMeasurementEvidence(
        snapshot(),
        rebuild({
          ...source,
          geometry: [successGeometry(), { ...successGeometry(), featureId: featureIds[1] }],
        }),
      ),
    ).toEqual({ ok: false, code: "invalid-geometry-evidence" })
  })
})
