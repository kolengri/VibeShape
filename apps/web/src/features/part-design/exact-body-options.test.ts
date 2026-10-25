import { describe, expect, it } from "bun:test"
import type { DocumentRebuildOutcome } from "@vibeshape/application/persistent-document-session"
import {
  booleanFeatureType,
  createAngleQuantity,
  createLengthQuantity,
  type FeatureRecord,
  featureRecordSchema,
} from "@vibeshape/domain"
import type { BodyReference } from "@vibeshape/domain/body-reference"
import {
  readRevolveFeatureParameters,
  revolveFeatureType,
  revolveFeatureTypeV7,
} from "@vibeshape/domain/part-design"
import { fdmFeatureType, readFdmFeatureParameters } from "@vibeshape/domain/part-design-fdm"
import { booleanFeatureTypeV2 } from "@vibeshape/domain/part-design-subtract"
import { bodyCatalogueFixture, catalogueHash } from "./exact-body-catalogue.test-fixtures"
import { exactSolidBodyOptions, hasMultipleExactSolidBodies } from "./exact-body-options"

type Fixture = ReturnType<typeof bodyCatalogueFixture>
function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("Expected catalogue fixture entry")
  return value
}
function options(fixture: Fixture, editing?: string) {
  return exactSolidBodyOptions(
    fixture.snapshot,
    fixture.rebuild,
    editing,
    fixture.parts,
    "Unnamed",
    (name) => `${name} · all bodies`,
  )
}
function body(feature: FeatureRecord, index: number): BodyReference {
  return { schemaVersion: 0, featureId: feature.id, outputRole: `pattern.instance.${index}` }
}
function withRecords(
  fixture: Fixture,
  records: readonly object[],
  geometry = fixture.rebuild.response.geometry,
) {
  return {
    ...fixture,
    rebuild: {
      ok: true,
      response: {
        ...fixture.rebuild.response,
        evaluation: { ...fixture.rebuild.response.evaluation, records },
        geometry,
      },
    } as Extract<DocumentRebuildOutcome, { ok: true }>,
  }
}
function booleanConsumer(feature: FeatureRecord, source: FeatureRecord, legacy = false) {
  return featureRecordSchema.parse({
    ...feature,
    type: legacy ? booleanFeatureType.type : booleanFeatureTypeV2.type,
    dependencies: [source.id],
    parameters: legacy
      ? { operation: "subtract" }
      : { operation: "subtract", targetBody: body(source, 0), toolBody: body(source, 1) },
  })
}

describe("exact solid body catalogue", () => {
  it("keeps order and one owner label despite repeated entries; ambiguous owners use the feature label", () => {
    const f = bodyCatalogueFixture(2, 2)
    const first = required(f.parts[0])
    const repeated = {
      ...first,
      part: { ...first.part, bodyHistory: [...first.part.bodyHistory, ...first.part.bodyHistory] },
    }
    expect(
      options({ ...f, parts: [repeated, required(f.parts[1])] }).map(({ label }) => label),
    ).toEqual(["Part 1", "Part 1", "Part 2", "Part 2"])
    const ambiguous = {
      ...first,
      part: { ...first.part, id: required(f.parts[1]).part.id, name: "Other owner" },
    }
    expect(options({ ...f, parts: [repeated, ambiguous] }).map(({ label }) => label)).toEqual([
      "Producer 1 · pattern.instance.0",
      "Producer 1 · pattern.instance.1",
      "Producer 2 · pattern.instance.0",
      "Producer 2 · pattern.instance.1",
    ])
  })

  it("requires valid positive-volume single exact bodies and never invents an aggregate option", () => {
    const f = bodyCatalogueFixture(1, 5)
    const record = required(f.rebuild.response.geometry[0])
    const source = required(record.geometry.bodies?.[0])
    const bodies = [
      source,
      { ...source, outputRole: "invalid", shape: { ...source.shape, valid: false } },
      { ...source, outputRole: "empty", shape: { ...source.shape, volume: 0 } },
      { ...source, outputRole: "compound", shape: { ...source.shape, solidCount: 2 } },
      { ...source, outputRole: "mesh", representation: "triangle-mesh" as const },
    ]
    const changed = withRecords(f, f.rebuild.response.evaluation.records, [
      { ...record, geometry: { ...record.geometry, bodies } },
    ])
    expect(options(changed).map(({ body }) => body?.outputRole)).toEqual(["pattern.instance.0"])
    expect(hasMultipleExactSolidBodies(changed.snapshot, changed.rebuild)).toBe(false)
    const aggregate = withRecords(f, f.rebuild.response.evaluation.records, [
      { ...record, geometry: { ...record.geometry, bodies: undefined } },
    ])
    expect(options(aggregate)).toEqual([])
  })

  it("keeps first geometry and any matching succeeded evaluation for retained edit inputs", () => {
    const f = bodyCatalogueFixture(2, 2)
    const [source, edited] = f.snapshot.features as [FeatureRecord, FeatureRecord]
    const snapshot = { ...f.snapshot, features: [source, booleanConsumer(edited, source)] }
    const first = required(f.rebuild.response.geometry[0])
    const duplicate = {
      ...first,
      contentHash: "b".repeat(64),
      geometry: {
        ...first.geometry,
        bodies: [{ ...required(first.geometry.bodies?.[0]), outputRole: "wrong" }],
      },
    }
    const records = [
      ...f.rebuild.response.evaluation.records,
      {
        featureId: source.id,
        status: "failed",
        diagnostics: [{ code: "test.failure", values: {} }],
      },
      { featureId: source.id, status: "succeeded", contentHash: "b".repeat(64) },
    ]
    const changed = withRecords({ ...f, snapshot }, records, [first, duplicate])
    expect(options(changed, edited.id).map(({ body }) => body?.outputRole)).toEqual([
      "pattern.instance.0",
      "pattern.instance.1",
    ])
    const swapped = withRecords({ ...f, snapshot }, records, [duplicate, first])
    expect(options(swapped, edited.id)).toEqual([])
    expect(hasMultipleExactSolidBodies(changed.snapshot, changed.rebuild)).toBe(false)
  })

  it("fails closed for malformed, stale, failed, missing and duplicate current catalogue evidence", () => {
    const f = bodyCatalogueFixture(2, 2)
    const records = f.rebuild.response.evaluation.records
    const cases = [
      withRecords(f, records.slice(1)),
      withRecords(
        f,
        records.map((record) => ({ ...record, contentHash: "b".repeat(64) })),
      ),
      withRecords(
        f,
        records.map((record) => ({ ...record, status: "failed" })),
      ),
      withRecords(f, [
        ...records,
        { featureId: "malformed", status: "succeeded", contentHash: catalogueHash },
      ]),
      withRecords(f, records, [
        ...f.rebuild.response.geometry,
        required(f.rebuild.response.geometry[0]),
      ]),
    ]
    for (const changed of cases) {
      expect(options(changed)).toEqual([])
      expect(hasMultipleExactSolidBodies(changed.snapshot, changed.rebuild)).toBe(false)
    }
    expect(exactSolidBodyOptions(f.snapshot, undefined, undefined, [], "Unnamed")).toEqual([])
    expect(hasMultipleExactSolidBodies(f.snapshot, undefined)).toBe(false)
  })

  it("preserves unconsumed siblings and saved exact inputs, excluding edited and later History", () => {
    const f = bodyCatalogueFixture(4, 3)
    const [source, first, edited, later] = f.snapshot.features as [
      FeatureRecord,
      FeatureRecord,
      FeatureRecord,
      FeatureRecord,
    ]
    const cut = booleanConsumer(first, source)
    const second = featureRecordSchema.parse({
      ...booleanConsumer(edited, source),
      parameters: { operation: "subtract", targetBody: body(source, 0), toolBody: body(source, 2) },
    })
    const changed = { ...f, snapshot: { ...f.snapshot, features: [source, cut, second, later] } }
    expect(options(changed).filter(({ body }) => body?.featureId === source.id)).toEqual([])
    const retained = options(changed, edited.id)
    expect(
      retained
        .filter(({ body }) => body?.featureId === source.id)
        .map(({ body }) => body?.outputRole),
    ).toEqual(["pattern.instance.0", "pattern.instance.2"])
    expect(
      retained.every(({ body }) => body?.featureId !== edited.id && body?.featureId !== later.id),
    ).toBe(true)
    expect(options(changed, "missing-edit-id")).toEqual(options(changed))
  })

  it("retains legacy whole-producer options and exact choices without migrating saved inputs", () => {
    const f = bodyCatalogueFixture(2, 3)
    const [source, edited] = f.snapshot.features as [FeatureRecord, FeatureRecord]
    const changed = {
      ...f,
      snapshot: { ...f.snapshot, features: [source, booleanConsumer(edited, source, true)] },
    }
    expect(
      options(changed, edited.id).map(({ id, label, body }) => [id, label, body?.outputRole]),
    ).toEqual([
      [source.id, "Producer 1 · all bodies", undefined],
      [JSON.stringify([source.id, "pattern.instance.0"]), "Part 1", "pattern.instance.0"],
      [JSON.stringify([source.id, "pattern.instance.1"]), "Part 1", "pattern.instance.1"],
      [JSON.stringify([source.id, "pattern.instance.2"]), "Part 1", "pattern.instance.2"],
    ])
  })

  it("does not consume sources for failed or suppressed consumers; predicate matches catalogue availability", () => {
    const f = bodyCatalogueFixture(2, 2)
    const [source, edited] = f.snapshot.features as [FeatureRecord, FeatureRecord]
    const cut = booleanConsumer(edited, source)
    for (const status of ["failed", "suppressed"] as const) {
      const snapshot = {
        ...f.snapshot,
        features: [source, { ...cut, suppressed: status === "suppressed" }],
      }
      const changed = withRecords(
        { ...f, snapshot },
        [
          required(f.rebuild.response.evaluation.records[0]),
          status === "failed"
            ? { featureId: edited.id, status, diagnostics: [{ code: "test.failure", values: {} }] }
            : { featureId: edited.id, status },
        ],
        [required(f.rebuild.response.geometry[0])],
      )
      expect(options(changed).map(({ body }) => body)).toEqual([body(source, 0), body(source, 1)])
      expect(hasMultipleExactSolidBodies(snapshot, changed.rebuild)).toBe(true)
    }
    for (const count of [0, 1, 2, 8]) {
      const changed = bodyCatalogueFixture(1, count)
      expect(hasMultipleExactSolidBodies(changed.snapshot, changed.rebuild)).toBe(
        options(changed).length >= 2,
      )
    }
  })
})

it("retains saved FDM and Revolve body roles consumed by an earlier branch, including legacy Revolve scope", () => {
  const f = bodyCatalogueFixture(3, 3)
  const [source, first, edited] = f.snapshot.features as [
    FeatureRecord,
    FeatureRecord,
    FeatureRecord,
  ]
  const cut = booleanConsumer(first, source)
  const profile = {
    schemaVersion: 0,
    sketchId: source.id,
    outerBoundaryEntityIds: [first.id],
    holeBoundaryEntityIds: [],
  }
  const revolveParameters = {
    axis: { kind: "origin-axis", axis: "y" },
    angle: createAngleQuantity(180, "deg"),
    operation: "remove",
  }
  const fdm = featureRecordSchema.parse({
    ...edited,
    type: fdmFeatureType.type,
    dependencies: [source.id],
    parameters: {
      kind: "teardrop-hole",
      targetBody: body(source, 0),
      axis: "Z",
      origin: {
        x: createLengthQuantity(0),
        y: createLengthQuantity(0),
        z: createLengthQuantity(0),
      },
      diameter: createLengthQuantity(4),
      depth: createLengthQuantity(4),
      roofAngle: createAngleQuantity(45, "deg"),
      flatTop: false,
    },
  })
  const revolve = featureRecordSchema.parse({
    ...edited,
    type: revolveFeatureTypeV7.type,
    dependencies: [source.id],
    parameters: {
      ...revolveParameters,
      profiles: { schemaVersion: 0, profiles: [profile] },
      targetBody: body(source, 1),
    },
  })
  const legacy = featureRecordSchema.parse({
    ...edited,
    type: revolveFeatureType.type,
    dependencies: [source.id],
    parameters: { ...revolveParameters, profile },
  })
  expect(readFdmFeatureParameters(fdm)).not.toBeNull()
  expect(readRevolveFeatureParameters(revolve)).not.toBeNull()
  expect(readRevolveFeatureParameters(legacy)).not.toBeNull()
  for (const [feature, roles] of [
    [fdm, ["pattern.instance.0", "pattern.instance.2"]],
    [revolve, ["pattern.instance.1", "pattern.instance.2"]],
  ] as const) {
    const changed = { ...f, snapshot: { ...f.snapshot, features: [source, cut, feature] } }
    expect(
      options(changed, edited.id)
        .filter(({ body }) => body?.featureId === source.id)
        .map(({ body }) => body?.outputRole),
    ).toEqual([...roles])
  }
  const changed = { ...f, snapshot: { ...f.snapshot, features: [source, cut, legacy] } }
  expect(
    options(changed, edited.id)
      .filter(({ id, body }) => id === source.id || body?.featureId === source.id)
      .map(({ body }) => body?.outputRole),
  ).toEqual([undefined, "pattern.instance.0", "pattern.instance.1", "pattern.instance.2"])
})

it("keeps malformed named-body validation equivalent for catalogue and eligibility", () => {
  const f = bodyCatalogueFixture(1, 3)
  const record = required(f.rebuild.response.geometry[0])
  const bodies = record.geometry.bodies?.map((body, index) =>
    index === 2 ? { ...body, outputRole: "INVALID role" } : body,
  )
  const changed = withRecords(f, f.rebuild.response.evaluation.records, [
    { ...record, geometry: { ...record.geometry, bodies } },
  ])
  expect(() => options(changed)).toThrow()
  expect(() => hasMultipleExactSolidBodies(changed.snapshot, changed.rebuild)).toThrow()
})
