import { documentSnapshotSchema } from "@vibeshape/domain/document"
import { featureRecordSchema } from "@vibeshape/domain/feature-graph"
import { createModuleRegistry, documentCoreModule } from "@vibeshape/domain/modules"
import {
  boxFeatureType,
  extrusionFeatureTypeV3,
  revolveFeatureTypeV5,
} from "@vibeshape/domain/part-design"
import { sketchRecordSchema } from "@vibeshape/domain/sketch"
import { createAngleQuantity, createLengthQuantity } from "@vibeshape/domain/units"
import { describe, expect, it } from "vitest"
import { createQueryDispatcher, documentCoreQueryHandlers } from "./queries"

const documentId = "0195b5ac-b213-7f2c-9c33-67a36a7f21ac"
const featureId = "0195b5ac-b214-7a2c-8c33-67a36a7f21ac"
const secondFeatureId = "0195b5ac-b215-7a2c-8c33-67a36a7f21ac"
const sketchId = "0195b5ac-b216-7a2c-8c33-67a36a7f21ac"

function dispatcher() {
  const modules = createModuleRegistry([documentCoreModule])
  if (!modules.ok) throw new Error(modules.diagnostic.message)
  const result = createQueryDispatcher(modules.registry, documentCoreQueryHandlers)
  if (!result.ok) throw new Error(result.diagnostic.message)
  return result.dispatcher
}

function snapshot(overrides: Record<string, unknown> = {}) {
  return documentSnapshotSchema.parse({
    schemaVersion: 0,
    id: documentId,
    revision: 4,
    name: "Inspection",
    createdAt: "2026-08-08T12:00:00Z",
    updatedAt: "2026-08-08T12:05:00Z",
    ...overrides,
  })
}

function feature(parameters: Record<string, unknown> = {}, id = featureId, label = "Base box") {
  return featureRecordSchema.parse({
    schemaVersion: 0,
    id,
    type: boxFeatureType.type,
    parameters: {
      width: { value: 10, unit: "mm" },
      depth: { value: 10, unit: "mm" },
      height: { value: 10, unit: "mm" },
      ...parameters,
    },
    dependencies: [],
    references: [],
    suppressed: false,
    ...(label ? { label } : {}),
  })
}

function sketch(id = sketchId) {
  return sketchRecordSchema.parse({
    schemaVersion: 0,
    id,
    label: "Profile",
    plane: "xy",
    entities: [],
    constraints: [],
  })
}

function listQuery(overrides: Record<string, unknown> = {}) {
  return {
    kind: "org.vibeshape.cad.inspection.list",
    schemaVersion: 1,
    documentId,
    revision: 4,
    ...overrides,
  }
}

function detailQuery(overrides: Record<string, unknown> = {}) {
  return {
    kind: "org.vibeshape.cad.inspection.detail",
    schemaVersion: 1,
    documentId,
    revision: 4,
    entity: { kind: "feature", id: featureId },
    ...overrides,
  }
}

describe("CAD inspection queries", () => {
  it("dispatches bounded semantic pages of feature summaries", () => {
    const current = snapshot({ features: [feature()] })
    const result = dispatcher().dispatch(current, listQuery({ limit: 1 }))
    expect(result).toMatchObject({
      ok: true,
      view: { revision: 4, nextCursor: null, data: { total: 1 } },
    })
    if (result.ok && result.view.kind === "org.vibeshape.cad.inspection.list")
      expect(result.view.data.items[0]).toMatchObject({
        kind: "feature",
        id: featureId,
        type: "org.vibeshape.feature.part-design.box",
      })
  })

  it("rejects stale revisions, invalid cursors, and missing exact IDs", () => {
    const current = snapshot({ features: [feature()] })
    expect(dispatcher().dispatch(current, listQuery({ revision: 3 }))).toMatchObject({
      ok: false,
      diagnostic: { code: "stale-query-revision" },
    })
    expect(dispatcher().dispatch(current, listQuery({ cursor: "2" }))).toMatchObject({
      ok: false,
      diagnostic: { code: "invalid-query" },
    })
    expect(
      dispatcher().dispatch(
        current,
        detailQuery({ entity: { kind: "feature", id: "0195b5ac-b215-7a2c-8c33-67a36a7f21ac" } }),
      ),
    ).toMatchObject({ ok: false, diagnostic: { code: "feature-not-found" } })
    expect(
      dispatcher().dispatch(current, detailQuery({ entity: { kind: "sketch", id: sketchId } })),
    ).toMatchObject({ ok: false, diagnostic: { code: "sketch-not-found" } })
    expect(
      dispatcher().dispatch(
        current,
        listQuery({ documentId: "0195b5ac-b217-7a2c-8c33-67a36a7f21ac" }),
      ),
    ).toMatchObject({ ok: false, diagnostic: { code: "document-id-mismatch" } })
  })

  it("pages across the feature and sketch portions without losing order", () => {
    const current = snapshot({
      features: [feature(), feature({}, secondFeatureId)],
      sketches: [sketch()],
    })
    const result = dispatcher().dispatch(current, listQuery({ limit: 2, cursor: "1" }))
    expect(result).toMatchObject({ ok: true, view: { nextCursor: null, data: { total: 3 } } })
    if (result.ok && result.view.kind === "org.vibeshape.cad.inspection.list")
      expect(result.view.data.items.map((item) => item.id)).toEqual([secondFeatureId, sketchId])
  })

  it("derives multi-profile dependencies only from validated CAD feature types", () => {
    const sketchId = "0195b5ac-b215-7a2c-8c33-67a36a7f21ac"
    const profiles = {
      schemaVersion: 0,
      profiles: [
        {
          schemaVersion: 0,
          sketchId,
          outerBoundaryEntityIds: ["0195b5ac-b216-7a2c-8c33-67a36a7f21ac"],
          holeBoundaryEntityIds: [],
        },
      ],
    }
    const sketch = {
      schemaVersion: 0,
      id: sketchId,
      label: "Profile",
      plane: "xy",
      entities: [],
      constraints: [],
    }
    for (const [type, parameters] of [
      [
        extrusionFeatureTypeV3.type,
        { profiles, distance: createLengthQuantity(5), symmetric: false, operation: "new" },
      ],
      [
        revolveFeatureTypeV5.type,
        {
          profiles,
          angle: createAngleQuantity(180, "deg"),
          axis: { kind: "origin-axis", axis: "y" },
          operation: "new",
        },
      ],
    ] as const) {
      const record = featureRecordSchema.parse({ ...feature(), type, parameters })
      const result = dispatcher().dispatch(
        snapshot({ features: [record], sketches: [sketch] }),
        listQuery(),
      )
      expect(result).toMatchObject({
        ok: true,
        view: {
          data: {
            items: [
              { kind: "feature", version: type.schemaVersion, dependencies: [sketchId] },
              { kind: "sketch", dependencies: [] },
            ],
          },
        },
      })
    }
    const lookalike = featureRecordSchema.parse({
      ...feature(),
      type: { ...boxFeatureType.type, typeId: "org.example.feature.custom" },
      parameters: {
        profile: { sketchId },
        axis: { kind: "model-edge", reference: { featureId: sketchId } },
      },
    })
    expect(dispatcher().dispatch(snapshot({ features: [lookalike] }), listQuery())).toMatchObject({
      ok: true,
      view: { data: { items: [{ dependencies: [] }] } },
    })
  })

  it("returns full exact records and fails closed when serialized detail is too large", () => {
    const current = snapshot({ features: [feature()] })
    expect(dispatcher().dispatch(current, detailQuery())).toMatchObject({
      ok: true,
      view: { data: { entityKind: "feature", record: { id: featureId } } },
    })
    const oversized = snapshot({ features: [feature({ payload: "x".repeat(200_000) })] })
    expect(dispatcher().dispatch(oversized, detailQuery())).toMatchObject({
      ok: false,
      diagnostic: { code: "query-result-too-large" },
    })
  })

  it("fails before parsing a page with too many dependencies and preserves absent labels", () => {
    const dependencyIds = Array.from(
      { length: 257 },
      (_, index) => `0195b5ac-b300-7a2c-8c33-${String(index).padStart(12, "0")}`,
    )
    const tooManyDependencies = featureRecordSchema.parse({
      ...feature(),
      dependencies: dependencyIds,
    })
    const supportingFeatures = dependencyIds.map((id) => feature({}, id, "Support"))
    expect(
      dispatcher().dispatch(
        snapshot({ features: [tooManyDependencies, ...supportingFeatures] }),
        listQuery({ limit: 1 }),
      ),
    ).toMatchObject({
      ok: false,
      diagnostic: { code: "query-result-too-large" },
    })
    const unlabeled = feature({}, featureId, "")
    const result = dispatcher().dispatch(snapshot({ features: [unlabeled] }), listQuery())
    expect(result).toMatchObject({ ok: true })
    if (result.ok && result.view.kind === "org.vibeshape.cad.inspection.list")
      expect(result.view.data.items[0]).not.toHaveProperty("label")
  })
})
