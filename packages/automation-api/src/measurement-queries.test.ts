import {
  boxFeatureType,
  createLengthQuantity,
  datumPlaneFeatureType,
  filletFeatureType,
  terminalFeatureIds,
} from "@vibeshape/domain"
import { documentSnapshotSchema } from "@vibeshape/domain/document"
import { featureRecordSchema } from "@vibeshape/domain/feature-graph"
import { modelMeasurementEvidenceSchema } from "@vibeshape/domain/model-measurements"
import { createModuleRegistry, documentCoreModule } from "@vibeshape/domain/modules"
import { expect, it } from "vitest"
import { createQueryDispatcher, documentCoreQueryHandlers } from "./queries"

const docId = "0195b5ac-b220-7a2c-8c33-67a36a7f6101"
const id = (index: number) => `0195b5ac-b220-7a2c-8c33-${String(index).padStart(12, "0")}`
const shape = {
  valid: true,
  volume: 6000,
  surfaceArea: 2200,
  bounds: { min: [0, 0, 0], max: [10, 20, 30] },
  solidCount: 1,
  faceCount: 6,
  edgeCount: 12,
}

function fixture(count = 1) {
  const features = Array.from({ length: count }, (_, index) =>
    featureRecordSchema.parse({
      schemaVersion: 0,
      id: id(index),
      type: boxFeatureType.type,
      parameters: {
        width: createLengthQuantity(10),
        depth: createLengthQuantity(20),
        height: createLengthQuantity(30),
        centered: false,
        origin: {
          x: createLengthQuantity(0),
          y: createLengthQuantity(0),
          z: createLengthQuantity(0),
        },
      },
      dependencies: [],
      references: [],
      suppressed: false,
      label: `Box ${index + 1}`,
    }),
  )
  const snapshot = documentSnapshotSchema.parse({
    schemaVersion: 0,
    id: docId,
    revision: 7,
    name: "Measured bodies",
    createdAt: "2026-09-05T00:00:00Z",
    updatedAt: "2026-09-05T00:00:00Z",
    features,
  })
  const evidence = modelMeasurementEvidenceSchema.parse({
    schemaVersion: 1,
    documentId: docId,
    revision: 7,
    generation: 2,
    features: features.map((feature) => ({
      featureId: feature.id,
      status: "succeeded",
      contentHash: "a".repeat(64),
      shape,
    })),
  })
  return { snapshot, evidence }
}

function dispatch() {
  const modules = createModuleRegistry([documentCoreModule])
  if (!modules.ok) throw new Error(modules.diagnostic.message)
  const result = createQueryDispatcher(modules.registry, documentCoreQueryHandlers)
  if (!result.ok) throw new Error(result.diagnostic.message)
  return result.dispatcher.dispatch
}
const query = (overrides: Record<string, unknown> = {}) => ({
  kind: "org.vibeshape.model.measurements",
  schemaVersion: 1,
  documentId: docId,
  revision: 7,
  ...overrides,
})

it("dispatches registered exact measurements without exposing raw geometry or model payloads", () => {
  const { snapshot, evidence } = fixture()
  const result = dispatch()(snapshot, query(), { measurements: evidence })
  expect(result).toMatchObject({
    ok: true,
    view: {
      documentId: docId,
      revision: 7,
      generation: 2,
      classification: "derived",
      units: { length: "mm", area: "mm2", volume: "mm3" },
      nextCursor: null,
      data: {
        total: 1,
        features: [{ featureId: id(0), label: "Box 1", status: "succeeded", shape }],
      },
    },
  })
  if (!result.ok || result.view.kind !== "org.vibeshape.model.measurements")
    throw new Error("Expected a measurement view.")
  expect(Object.keys(result.view.data.features[0] ?? {}).sort()).toEqual([
    "contentHash",
    "featureId",
    "label",
    "shape",
    "status",
  ])
})

it("paginates a bounded result deterministically and rejects invalid cursors and limits", () => {
  const { snapshot, evidence } = fixture(201)
  const run = (overrides: Record<string, unknown>) =>
    dispatch()(snapshot, query(overrides), { measurements: evidence })
  const first = run({ limit: 200 })
  expect(first).toMatchObject({ ok: true, view: { nextCursor: "200", data: { total: 201 } } })
  if (!first.ok || first.view.kind !== "org.vibeshape.model.measurements")
    throw new Error("Expected a page.")
  expect(first.view.data.features).toHaveLength(200)
  expect(run({ cursor: "200", limit: 200 })).toMatchObject({
    ok: true,
    view: { nextCursor: null, data: { features: [{ featureId: id(200) }] } },
  })
  for (const invalid of [
    { limit: 201 },
    { limit: 0 },
    { cursor: "202" },
    { cursor: "-1" },
    { cursor: "0".repeat(1000) },
    { raw: true },
  ])
    expect(run(invalid)).toMatchObject({ ok: false, diagnostic: { code: "invalid-query" } })
})

it("does not report history inputs as additional current bodies", () => {
  const { snapshot, evidence } = fixture(2)
  snapshot.features[1] = featureRecordSchema.parse({
    ...snapshot.features[1],
    type: filletFeatureType.type,
    parameters: { radius: createLengthQuantity(1) },
    dependencies: [id(0)],
  })
  expect([...terminalFeatureIds(snapshot.features)]).toEqual([id(1)])
  expect(dispatch()(snapshot, query(), { measurements: evidence })).toMatchObject({
    ok: true,
    view: { data: { total: 1, features: [{ featureId: id(1) }] } },
  })
  expect(
    dispatch()(snapshot, query({ featureId: id(0) }), { measurements: evidence }),
  ).toMatchObject({ ok: true, view: { data: { features: [{ featureId: id(0) }] } } })
})

it("fails closed for unavailable, stale, missing, duplicate or foreign evidence", () => {
  const { snapshot, evidence } = fixture()
  const run = (measurements?: unknown) => dispatch()(snapshot, query(), { measurements })
  expect(run()).toMatchObject({ ok: false, diagnostic: { code: "geometry-unavailable" } })
  expect(run({ ...evidence, revision: 6 })).toMatchObject({
    ok: false,
    diagnostic: { code: "stale-geometry" },
  })
  expect(run({ ...evidence, documentId: id(999) })).toMatchObject({
    ok: false,
    diagnostic: { code: "stale-geometry" },
  })
  for (const features of [
    [],
    [...evidence.features, ...evidence.features],
    [{ ...evidence.features[0], featureId: id(999) }],
  ])
    expect(run({ ...evidence, features })).toMatchObject({
      ok: false,
      diagnostic: { code: "invalid-geometry-evidence" },
    })
  expect(dispatch()(snapshot, query({ revision: 6 }), { measurements: evidence })).toMatchObject({
    ok: false,
    diagnostic: { code: "stale-query-revision" },
  })
  expect(
    dispatch()(snapshot, query({ featureId: id(888) }), { measurements: evidence }),
  ).toMatchObject({ ok: false, diagnostic: { code: "feature-not-found" } })
})

it("reports failures explicitly rather than inventing zero volume", () => {
  const { snapshot, evidence } = fixture()
  const result = dispatch()(snapshot, query(), {
    measurements: {
      ...evidence,
      features: [
        { featureId: id(0), status: "failed", diagnosticCodes: ["org.vibeshape.geometry.invalid"] },
      ],
    },
  })
  expect(result).toMatchObject({
    ok: true,
    view: {
      data: {
        features: [{ status: "failed", diagnosticCodes: ["org.vibeshape.geometry.invalid"] }],
      },
    },
  })
  if (!result.ok || result.view.kind !== "org.vibeshape.model.measurements")
    throw new Error("Expected a failed feature view.")
  expect(result.view.data.features[0]).not.toHaveProperty("shape")
})

it("never returns construction-plane display plate metrics, including explicit requests", () => {
  const { snapshot, evidence } = fixture()
  const original = snapshot.features[0]
  if (!original) throw new Error("Expected one fixture feature.")
  const datum = featureRecordSchema.parse({
    ...original,
    type: datumPlaneFeatureType.type,
    parameters: {
      mode: "offset",
      support: { kind: "origin-plane", plane: "xy" },
      offset: createLengthQuantity(0),
    },
  })
  const current = { ...snapshot, features: [datum] }
  const measurements = {
    ...evidence,
    features: evidence.features.map((entry) => ({
      ...entry,
      shape: {
        ...shape,
        volume: 4.096,
        surfaceArea: 8192.256,
        bounds: { min: [-32, -32, 0], max: [32, 32, 0.001] },
      },
    })),
  }
  expect(dispatch()(current, query(), { measurements })).toMatchObject({
    ok: true,
    view: { data: { features: [], total: 0 } },
  })
  expect(dispatch()(current, query({ featureId: datum.id }), { measurements })).toEqual({
    ok: false,
    diagnostic: {
      code: "feature-not-measurable",
      message: "Construction plane display geometry cannot be measured as a model output.",
      retryable: false,
      issues: [],
    },
  })
})
