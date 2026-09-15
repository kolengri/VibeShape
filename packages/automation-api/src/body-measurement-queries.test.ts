import { boxFeatureType, createLengthQuantity } from "@vibeshape/domain"
import { documentSnapshotSchema } from "@vibeshape/domain/document"
import { featureRecordSchema } from "@vibeshape/domain/feature-graph"
import { modelBodyMeasurementEvidenceSchema } from "@vibeshape/domain/model-body-measurements"
import { createModuleRegistry, documentCoreModule } from "@vibeshape/domain/modules"
import { holeFeatureTypeV2 } from "@vibeshape/domain/part-design-hole"
import { describe, expect, it } from "vitest"
import {
  modelBodyMeasurementArgumentsSchema,
  modelBodyMeasurementQuerySchema,
  queryModelBodyMeasurements,
} from "./body-measurement-queries"
import { createQueryDispatcher, documentCoreQueryHandlers } from "./queries"

const documentId = "0195b5ac-b213-7f2c-9c33-67a36a7f21ac"
const featureId = "0195b5ac-b213-7f2c-9c33-67a36a7f21ad"
const shape = {
  valid: true as const,
  volume: 6000,
  surfaceArea: 2200,
  bounds: {
    min: [0, 0, 0] as [number, number, number],
    max: [10, 20, 30] as [number, number, number],
  },
  solidCount: 1,
  faceCount: 6,
  edgeCount: 12,
}

const feature = featureRecordSchema.parse({
  schemaVersion: 0,
  id: featureId,
  type: boxFeatureType.type,
  parameters: {
    width: createLengthQuantity(10),
    depth: createLengthQuantity(20),
    height: createLengthQuantity(30),
    centered: false,
    origin: { x: createLengthQuantity(0), y: createLengthQuantity(0), z: createLengthQuantity(0) },
  },
  dependencies: [],
  references: [],
  suppressed: false,
  label: "Box body",
})

const snapshot = documentSnapshotSchema.parse({
  schemaVersion: 0,
  id: documentId,
  revision: 2,
  name: "Body query fixture",
  createdAt: "2026-08-08T12:00:00Z",
  updatedAt: "2026-08-08T12:05:00Z",
  features: [feature],
})

const evidence = modelBodyMeasurementEvidenceSchema.parse({
  schemaVersion: 1,
  documentId,
  revision: 2,
  generation: 9,
  features: [{ featureId, status: "succeeded", contentHash: "a".repeat(64), shape }],
  bodies: [{ featureId, contentHash: "a".repeat(64), shape }],
})

function dispatch() {
  const modules = createModuleRegistry([documentCoreModule])
  if (!modules.ok) throw new Error(modules.diagnostic.message)
  const result = createQueryDispatcher(modules.registry, documentCoreQueryHandlers)
  if (!result.ok) throw new Error(result.diagnostic.message)
  return result.dispatcher.dispatch
}

function query(overrides: Record<string, unknown> = {}) {
  return {
    kind: "org.vibeshape.model.body-measurements",
    schemaVersion: 1,
    documentId,
    revision: 2,
    ...overrides,
  }
}

describe("model body measurement query", () => {
  it("returns terminal bodies and preserves explicit feature selection", () => {
    const run = dispatch()
    const result = run(snapshot, query(), { bodyMeasurements: evidence })
    expect(result).toMatchObject({
      ok: true,
      view: {
        generation: 9,
        data: { total: 1, bodies: [{ featureId, label: "Box body", shape }] },
      },
    })
    const explicit = run(snapshot, query({ featureId, outputRole: "missing" }), {
      bodyMeasurements: evidence,
    })
    expect(explicit).toMatchObject({ ok: false, diagnostic: { code: "body-not-found" } })
    const exact = run(snapshot, query({ featureId }), { bodyMeasurements: evidence })
    expect(exact).toMatchObject({ ok: true, view: { data: { total: 1, bodies: [{ featureId }] } } })
    const namedEvidence = {
      ...evidence,
      bodies: [{ ...evidence.bodies[0], outputRole: "result" }],
    }
    expect(
      run(snapshot, query({ featureId, outputRole: "result" }), {
        bodyMeasurements: namedEvidence,
      }),
    ).toMatchObject({ ok: true, view: { data: { bodies: [{ featureId, outputRole: "result" }] } } })
  })

  it("requires a feature when selecting an output role and applies bounds", () => {
    expect(
      modelBodyMeasurementArgumentsSchema.safeParse({ revision: 2, outputRole: "result" }).success,
    ).toBe(false)
    expect(
      modelBodyMeasurementArgumentsSchema.safeParse({
        revision: 2,
        featureId: "0195b5ac-b213-7f2c-9c33-67a36a7f21ac",
        outputRole: "result",
      }).success,
    ).toBe(true)
    expect(modelBodyMeasurementQuerySchema.safeParse(query({ outputRole: "result" })).success).toBe(
      false,
    )
    expect(
      modelBodyMeasurementQuerySchema.safeParse(query({ cursor: "1000000", limit: 201 })).success,
    ).toBe(false)
    expect(modelBodyMeasurementQuerySchema.parse(query()).cursor).toBeNull()
    expect(modelBodyMeasurementQuerySchema.parse(query()).limit).toBe(20)
  })

  it("fails closed when trusted body evidence is absent or stale", () => {
    expect(queryModelBodyMeasurements(snapshot, query())).toMatchObject({
      ok: false,
      diagnostic: { code: "geometry-unavailable", retryable: true },
    })
    expect(
      queryModelBodyMeasurements(snapshot, query({ revision: 1 }), { bodyMeasurements: {} }),
    ).toMatchObject({ ok: false, diagnostic: { code: "stale-query-revision", retryable: true } })
  })

  it("rejects foreign hashes and failed or suppressed explicit features without zero metrics", () => {
    expect(
      queryModelBodyMeasurements(snapshot, query({ featureId }), {
        bodyMeasurements: {
          ...evidence,
          bodies: [{ ...evidence.bodies[0], contentHash: "b".repeat(64) }],
        },
      }),
    ).toMatchObject({ ok: false, diagnostic: { code: "invalid-geometry-evidence" } })
    const failed = {
      ...evidence,
      features: [
        { featureId, status: "failed", diagnosticCodes: ["org.vibeshape.geometry-unavailable"] },
      ],
      bodies: [],
    }
    expect(
      queryModelBodyMeasurements(snapshot, query({ featureId }), { bodyMeasurements: failed }),
    ).toMatchObject({
      ok: false,
      diagnostic: { code: "geometry-unavailable" },
    })
  })

  it("paginates 201 independent body outputs with a bounded page size", () => {
    const features = Array.from({ length: 201 }, (_, index) => ({
      ...feature,
      id: `${featureId.slice(0, -3)}${String(index).padStart(3, "0")}`,
    }))
    const pagedSnapshot = documentSnapshotSchema.parse({ ...snapshot, features })
    const pagedEvidence = modelBodyMeasurementEvidenceSchema.parse({
      ...evidence,
      features: features.map((candidate) => ({
        featureId: candidate.id,
        status: "succeeded",
        contentHash: "a".repeat(64),
        shape,
      })),
      bodies: features.map((candidate) => ({
        featureId: candidate.id,
        contentHash: "a".repeat(64),
        shape,
      })),
    })
    const run = dispatch()
    const first = run(pagedSnapshot, query({ limit: 200 }), { bodyMeasurements: pagedEvidence })
    expect(first).toMatchObject({ ok: true, view: { nextCursor: "200", data: { total: 201 } } })
    const second = run(pagedSnapshot, query({ cursor: "200", limit: 200 }), {
      bodyMeasurements: pagedEvidence,
    })
    expect(second).toMatchObject({
      ok: true,
      view: { nextCursor: null, data: { total: 201, bodies: [{ featureId: features[200]?.id }] } },
    })
  })

  it("consumes only the selected source role and preserves siblings for unavailable consumers", () => {
    const sourceId = featureId
    const consumerId = "0195b5ac-b213-7f2c-9c33-67a36a7f21ae"
    const consumer = featureRecordSchema.parse({
      schemaVersion: 0,
      id: consumerId,
      type: holeFeatureTypeV2.type,
      parameters: {
        sketchId: "0195b5ac-b213-7f2c-9c33-67a36a7f21af",
        pointIds: ["0195b5ac-b213-7f2c-9c33-67a36a7f21b0"],
        diameter: createLengthQuantity(2),
        direction: "forward",
        extent: "blind",
        depth: createLengthQuantity(3),
        targetBody: { schemaVersion: 0, featureId: sourceId, outputRole: "pattern.instance.0" },
      },
      dependencies: [sourceId],
      references: [],
      suppressed: false,
    })
    const sourceShape = {
      ...shape,
      volume: shape.volume * 2,
      surfaceArea: shape.surfaceArea * 2,
      solidCount: 2,
    }
    const consumerShape = { ...shape, volume: 500, surfaceArea: 500 }
    const sourceBodies = [0, 1].map((index) => ({
      featureId: sourceId,
      outputRole: `pattern.instance.${index}`,
      contentHash: "a".repeat(64),
      shape,
    }))
    const baseEvidence = {
      schemaVersion: 1 as const,
      documentId,
      revision: 2,
      generation: 10,
      features: [
        {
          featureId: sourceId,
          status: "succeeded" as const,
          contentHash: "a".repeat(64),
          shape: sourceShape,
        },
        {
          featureId: consumerId,
          status: "succeeded" as const,
          contentHash: "c".repeat(64),
          shape: consumerShape,
        },
      ],
      bodies: [
        ...sourceBodies,
        {
          featureId: consumerId,
          outputRole: "result",
          contentHash: "c".repeat(64),
          shape: consumerShape,
        },
      ],
    }
    const consumedSnapshot = documentSnapshotSchema.parse({
      ...snapshot,
      features: [feature, consumer],
    })
    const run = dispatch()
    const consumed = run(consumedSnapshot, query(), {
      bodyMeasurements: modelBodyMeasurementEvidenceSchema.parse(baseEvidence),
    })
    expect(consumed).toMatchObject({
      ok: true,
      view: {
        data: {
          total: 2,
          bodies: [{ outputRole: "pattern.instance.1" }, { featureId: consumerId }],
        },
      },
    })
    const history = run(
      consumedSnapshot,
      query({ featureId: sourceId, outputRole: "pattern.instance.0" }),
      { bodyMeasurements: modelBodyMeasurementEvidenceSchema.parse(baseEvidence) },
    )
    expect(history).toMatchObject({
      ok: true,
      view: { data: { total: 1, bodies: [{ outputRole: "pattern.instance.0" }] } },
    })
    for (const status of ["failed", "suppressed"] as const) {
      const unavailableEvidence = modelBodyMeasurementEvidenceSchema.parse({
        ...baseEvidence,
        features: [
          baseEvidence.features[0],
          status === "failed"
            ? {
                featureId: consumerId,
                status,
                diagnosticCodes: ["org.vibeshape.geometry-unavailable"],
              }
            : { featureId: consumerId, status },
        ],
        bodies: sourceBodies,
      })
      const unavailable = run(consumedSnapshot, query(), { bodyMeasurements: unavailableEvidence })
      expect(unavailable).toMatchObject({
        ok: true,
        view: {
          data: {
            total: 2,
            bodies: [{ outputRole: "pattern.instance.0" }, { outputRole: "pattern.instance.1" }],
          },
        },
      })
    }
    const emptyEvidence = modelBodyMeasurementEvidenceSchema.parse({
      ...baseEvidence,
      features: [
        baseEvidence.features[0],
        {
          featureId: consumerId,
          status: "succeeded",
          contentHash: "c".repeat(64),
          shape: {
            ...consumerShape,
            volume: 0,
            surfaceArea: 0,
            solidCount: 0,
            faceCount: 0,
            edgeCount: 0,
          },
        },
      ],
      bodies: sourceBodies,
    })
    expect(run(consumedSnapshot, query(), { bodyMeasurements: emptyEvidence })).toMatchObject({
      ok: true,
      view: {
        data: {
          total: 2,
          bodies: [{ outputRole: "pattern.instance.0" }, { outputRole: "pattern.instance.1" }],
        },
      },
    })
  })
})
