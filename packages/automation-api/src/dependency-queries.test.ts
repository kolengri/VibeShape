import { describe, expect, it } from "bun:test"
import { documentSnapshotSchema } from "@vibeshape/domain/document"
import { featureRecordSchema } from "@vibeshape/domain/feature-graph"
import { createModuleRegistry, documentCoreModule } from "@vibeshape/domain/modules"
import {
  boxFeatureType,
  extrusionFeatureType,
  filletFeatureType,
} from "@vibeshape/domain/part-design"
import { sketchRecordSchema } from "@vibeshape/domain/sketch"
import { createLengthQuantity } from "@vibeshape/domain/units"
import {
  dependenciesResultContextMatches,
  modelDependenciesViewSchema,
  queryModelDependencies,
} from "./dependency-queries"
import { createQueryDispatcher, documentCoreQueryHandlers } from "./queries"

const id = (value: number) => `0195b5ac-b220-7a2c-8c33-${String(value).padStart(12, "0")}`
const source = featureRecordSchema.parse({
  schemaVersion: 0,
  id: id(1),
  label: "Base",
  type: boxFeatureType.type,
  parameters: {
    width: createLengthQuantity(20),
    depth: createLengthQuantity(30),
    height: createLengthQuantity(5),
  },
  dependencies: [],
  references: [],
  suppressed: false,
})
const sketch = sketchRecordSchema.parse({
  schemaVersion: 0,
  id: id(2),
  label: "Supported profile",
  plane: "xy",
  entities: [],
  constraints: [],
  support: {
    kind: "feature-face",
    reference: {
      schemaVersion: 0,
      featureId: source.id,
      kind: "face",
      signature: {
        kind: "face",
        geometryClass: "PLANE",
        measure: 600,
        centroid: [0, 0, 5],
        bounds: { min: [0, 0, 5], max: [20, 30, 5] },
        boundaryCount: 4,
        adjacentGeometryClasses: [],
      },
    },
  },
})
const extrusion = featureRecordSchema.parse({
  schemaVersion: 0,
  id: id(3),
  label: "Pad",
  type: extrusionFeatureType.type,
  parameters: {
    profile: {
      schemaVersion: 0,
      sketchId: sketch.id,
      outerBoundaryEntityIds: [id(20)],
      holeBoundaryEntityIds: [],
    },
    distance: createLengthQuantity(10),
    symmetric: false,
    operation: "new",
  },
  dependencies: [source.id],
  references: [sketch.support?.reference],
  suppressed: false,
})
const fillet = featureRecordSchema.parse({
  schemaVersion: 0,
  id: id(4),
  label: "Suppressed fillet",
  type: filletFeatureType.type,
  parameters: { radius: createLengthQuantity(1) },
  dependencies: [extrusion.id],
  references: [],
  suppressed: true,
})
const snapshot = documentSnapshotSchema.parse({
  schemaVersion: 0,
  id: id(10),
  revision: 7,
  name: "Dependency inspection",
  createdAt: "2026-10-27T12:00:00Z",
  updatedAt: "2026-10-27T12:00:00Z",
  features: [source, extrusion, fillet],
  sketches: [sketch],
})

function query(overrides: Record<string, unknown> = {}) {
  return {
    kind: "org.vibeshape.cad.dependencies",
    schemaVersion: 1,
    documentId: snapshot.id,
    revision: 7,
    entity: { kind: "sketch", id: sketch.id },
    ...overrides,
  }
}

function view(overrides: Record<string, unknown> = {}) {
  const result = queryModelDependencies(snapshot, query(overrides))
  expect(result.ok).toBe(true)
  if (!result.ok) throw new Error(result.diagnostic.message)
  expect(modelDependenciesViewSchema.safeParse(result.view).success).toBe(true)
  return result.view
}

describe("History dependency inspection", () => {
  it("includes external sketch links without confusing them with feature dependencies", () => {
    const upstream = sketchRecordSchema.parse({
      schemaVersion: 0,
      id: id(30),
      label: "Source sketch",
      plane: "xy",
      constraints: [],
      entities: [{ schemaVersion: 0, id: id(31), type: "point", construction: false, x: 0, y: 0 }],
    })
    const linked = sketchRecordSchema.parse({
      ...sketch,
      externalReferences: [
        {
          schemaVersion: 0,
          id: id(32),
          sourceSketchId: upstream.id,
          sourcePointId: id(31),
          projectedPointId: id(33),
        },
      ],
    })
    expect(
      queryModelDependencies(
        { ...snapshot, sketches: [upstream, linked] },
        query({ entity: { kind: "sketch", id: upstream.id } }),
      ),
    ).toMatchObject({
      ok: true,
      view: {
        data: {
          coverage: "complete",
          items: [{ entity: { kind: "sketch", id: linked.id }, distance: 1 }],
        },
      },
    })
  })

  it("keeps long transitive chains bounded by page size", () => {
    const features = Array.from({ length: 501 }, (_, index) =>
      featureRecordSchema.parse({
        ...source,
        id: id(1000 + index),
        type: { ...source.type, typeId: "org.example.opaque" },
        dependencies: index ? [id(999 + index)] : [],
      }),
    )
    const result = queryModelDependencies(
      { ...snapshot, features, sketches: [] },
      query({
        entity: { kind: "feature", id: id(1000) },
        transitive: true,
        cursor: "400",
      }),
    )
    expect(result).toMatchObject({ ok: true, view: { nextCursor: null, data: { total: 500 } } })
    if (!result.ok) throw new Error(result.diagnostic.message)
    expect(result.view.data.items).toHaveLength(100)
    expect(result.view.data.items.at(-1)).toMatchObject({ entity: { id: id(1500) }, distance: 500 })
  })

  it("correlates successful pages with the requested context and rejects incomplete or duplicated pages", () => {
    const operation = {
      tool: "model_dependencies",
      arguments: {
        revision: 7,
        entity: { kind: "sketch", id: sketch.id },
        transitive: true,
      },
    }
    const valid = view({ transitive: true })
    const matches = (value: unknown, documentId: string = snapshot.id) =>
      dependenciesResultContextMatches(operation, { ok: true, value }, documentId)
    expect(matches(valid)).toBe(true)
    for (const change of [
      { revision: 6 },
      { direction: "dependencies" },
      { transitive: false },
      { entity: { kind: "feature", id: sketch.id } },
      { documentId: id(99) },
      { nextCursor: "2" },
      { data: { ...valid.data, total: 1 } },
      { data: { ...valid.data, items: [valid.data.items[0], valid.data.items[0]] } },
      { data: { ...valid.data, items: [] } },
    ])
      expect(matches({ ...valid, ...change })).toBe(false)
    expect(matches(valid, id(99))).toBe(false)
    expect(dependenciesResultContextMatches(operation, { ok: false })).toBe(true)
    expect(
      dependenciesResultContextMatches({ tool: "model_info", arguments: {} }, { ok: true }),
    ).toBeNull()
    expect(
      dependenciesResultContextMatches(
        { ...operation, arguments: { ...operation.arguments, limit: 1 } },
        { ok: true, value: valid },
      ),
    ).toBe(false)
  })

  it("includes profile consumers, support owners and suppressed downstream features without geometry", () => {
    expect(view().data).toMatchObject({
      coverage: "complete",
      total: 1,
      items: [
        {
          entity: { kind: "feature", id: extrusion.id },
          label: "Pad",
          distance: 1,
          suppressed: false,
        },
      ],
    })
    expect(view({ direction: "dependencies" }).data.items).toMatchObject([
      { entity: { kind: "feature", id: source.id }, distance: 1 },
    ])
    expect(view({ transitive: true }).data.items).toMatchObject([
      { entity: { kind: "feature", id: extrusion.id }, distance: 1 },
      { entity: { kind: "feature", id: fillet.id }, distance: 2, suppressed: true },
    ])
  })

  it("deduplicates diamond paths and reports the shortest distance in either direction", () => {
    const downstream = view({ entity: { kind: "feature", id: source.id }, transitive: true })
    expect(downstream.data.items.map(({ entity, distance }) => [entity.id, distance])).toEqual([
      [extrusion.id, 1],
      [sketch.id, 1],
      [fillet.id, 2],
    ])
    const upstream = view({
      entity: { kind: "feature", id: fillet.id },
      direction: "dependencies",
      transitive: true,
    })
    expect(upstream.data.items.map(({ entity, distance }) => [entity.id, distance])).toEqual([
      [extrusion.id, 1],
      [source.id, 2],
      [sketch.id, 2],
    ])
  })

  it("paginates deterministically without truncating or repeating shared nodes", () => {
    const first = view({ transitive: true, limit: 1 })
    expect(first).toMatchObject({ nextCursor: "1", data: { total: 2 } })
    const second = view({ transitive: true, limit: 1, cursor: first.nextCursor })
    expect(second).toMatchObject({ nextCursor: null, data: { total: 2 } })
    expect([...first.data.items, ...second.data.items].map(({ entity }) => entity.id)).toEqual([
      extrusion.id,
      fillet.id,
    ])
    expect(view({ cursor: "1" }).data.items).toEqual([])
  })

  it("rejects stale revisions, foreign documents, missing items and malformed pages", () => {
    for (const [overrides, code] of [
      [{ revision: 6 }, "stale-query-revision"],
      [{ documentId: id(11) }, "document-id-mismatch"],
      [{ entity: { kind: "feature", id: id(99) } }, "feature-not-found"],
      [{ entity: { kind: "sketch", id: id(99) } }, "sketch-not-found"],
      [{ cursor: "2" }, "invalid-query"],
      [{ cursor: "-1" }, "invalid-query"],
      [{ limit: 101 }, "invalid-query"],
      [{ cascade: true }, "invalid-query"],
    ] as const) {
      expect(queryModelDependencies(snapshot, query(overrides))).toMatchObject({
        ok: false,
        diagnostic: { code },
      })
    }
    expect(queryModelDependencies(null, query())).toMatchObject({
      ok: false,
      diagnostic: { code: "document-not-found" },
    })
  })

  it("marks opaque feature semantics as partial and refuses an invalid graph", () => {
    const opaque = { ...source, type: { ...source.type, typeId: "org.example.opaque" } }
    const partial = queryModelDependencies(
      { ...snapshot, features: [opaque, extrusion, fillet] },
      query(),
    )
    expect(partial).toMatchObject({ ok: true, view: { data: { coverage: "partial" } } })
    const broken = { ...source, dependencies: [fillet.id] }
    expect(
      queryModelDependencies({ ...snapshot, features: [broken, extrusion, fillet] }, query()),
    ).toMatchObject({ ok: false, diagnostic: { code: "invalid-query" } })
  })

  it("registers the semantic query on the ordinary trusted dispatcher", () => {
    const registry = createModuleRegistry([documentCoreModule])
    if (!registry.ok) throw new Error(registry.diagnostic.message)
    const dispatcher = createQueryDispatcher(registry.registry, documentCoreQueryHandlers)
    if (!dispatcher.ok) throw new Error(dispatcher.diagnostic.message)
    expect(dispatcher.dispatcher.dispatch(snapshot, query())).toEqual(
      queryModelDependencies(snapshot, query()),
    )
  })
})
