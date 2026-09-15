import { describe, expect, it } from "vitest"
import { featureRecordSchema } from "./feature-graph"
import {
  bodyMeasurementOutputs,
  modelBodyMeasurementEvidenceSchema,
} from "./model-body-measurements"
import { boxFeatureType } from "./part-design"
import { datumPlaneFeatureType } from "./reference-geometry"
import { createLengthQuantity } from "./units"

const featureId = "0195b5ac-b220-7a2c-8c33-67a36a7f3101"
const hash = "a".repeat(64)
const shape = {
  valid: true as const,
  volume: 1,
  surfaceArea: 6,
  bounds: { min: [0, 0, 0] as const, max: [1, 1, 1] as const },
  solidCount: 1,
  faceCount: 6,
  edgeCount: 12,
}
const feature = { featureId, status: "succeeded" as const, contentHash: hash, shape }
const body = { featureId, outputRole: "result", contentHash: hash, shape }
const base = {
  schemaVersion: 1 as const,
  documentId: "0195b5ac-b220-7a2c-8c33-67a36a7f31ff",
  revision: 1,
  generation: 1,
  features: [feature],
  bodies: [body],
}

describe("model body measurement evidence", () => {
  it("accepts a named single solid catalog", () => {
    expect(modelBodyMeasurementEvidenceSchema.safeParse(base).success).toBe(true)
  })

  it("rejects foreign and mismatched body provenance", () => {
    expect(
      modelBodyMeasurementEvidenceSchema.safeParse({
        ...base,
        bodies: [{ ...body, featureId: "0195b5ac-b220-7a2c-8c33-67a36a7f3102" }],
      }).success,
    ).toBe(false)
    expect(
      modelBodyMeasurementEvidenceSchema.safeParse({
        ...base,
        bodies: [{ ...body, contentHash: "b".repeat(64) }],
      }).success,
    ).toBe(false)
  })

  it("rejects duplicate body keys and invalid named metrics", () => {
    expect(
      modelBodyMeasurementEvidenceSchema.safeParse({ ...base, bodies: [body, body] }).success,
    ).toBe(false)
    expect(
      modelBodyMeasurementEvidenceSchema.safeParse({
        ...base,
        bodies: [{ ...body, shape: { ...shape, volume: 0 } }],
      }).success,
    ).toBe(false)
  })
})

it("requires complete model catalogs but excludes construction plane display geometry", () => {
  const record = featureRecordSchema.parse({
    schemaVersion: 0,
    id: featureId,
    type: boxFeatureType.type,
    parameters: {},
    dependencies: [],
    references: [],
    suppressed: false,
  })
  const evidence = modelBodyMeasurementEvidenceSchema.parse({ ...base, bodies: [] })
  expect(bodyMeasurementOutputs([record], evidence)).toBeNull()
  const datum = featureRecordSchema.parse({
    ...record,
    type: datumPlaneFeatureType.type,
    parameters: {
      mode: "offset",
      support: { kind: "origin-plane", plane: "xy" },
      offset: createLengthQuantity(5),
    },
  })
  expect(bodyMeasurementOutputs([datum], evidence)?.get(record.id)).toEqual([])
  expect(bodyMeasurementOutputs([datum], modelBodyMeasurementEvidenceSchema.parse(base))).toBeNull()
})

it("rejects missing, mixed, and malformed body catalogs", () => {
  expect(
    modelBodyMeasurementEvidenceSchema.safeParse({
      ...base,
      features: [{ ...feature, shape: { ...shape, solidCount: 2 } }],
    }).success,
  ).toBe(false)
  expect(
    modelBodyMeasurementEvidenceSchema.safeParse({
      ...base,
      bodies: [body, { featureId, contentHash: hash, shape }],
    }).success,
  ).toBe(false)
  expect(
    modelBodyMeasurementEvidenceSchema.safeParse({
      ...base,
      bodies: [{ ...body, shape: { ...shape, bounds: { min: [2, 0, 0], max: [1, 1, 1] } } }],
    }).success,
  ).toBe(false)
})
