import { describe, expect, it } from "bun:test"
import { createDocumentDependencyGraph } from "./document-graph"
import type { DocumentSnapshotV2 } from "./document-v2"
import { applyDocumentV2Command, reduceDocumentV2Event } from "./document-v2-commands"
import { applyDocumentUpgradeV2Command } from "./document-v2-migration"
import { replayDocumentAuthorityEvents } from "./document-v2-replay"
import { featureBodyDependencies, featureBodyDependencyIds } from "./feature-dependencies"
import { featureRecordSchema, featureRecordV1Schema } from "./feature-graph"
import { projectFirstPartyFeatureSemanticInputs } from "./feature-semantic-inputs"
import { createFeatureTypeRegistry } from "./feature-type-registry"
import { sketchIdSchema } from "./identifiers"
import { terminalBodyOutputs } from "./model-bodies"
import {
  createModuleRegistry,
  documentCoreModule,
  featureCoreModule,
  partDesignModule,
} from "./modules"
import { boxFeatureType, partDesignFeatureTypeHandlers } from "./part-design"
import { loftFeatureType, loftFeatureTypeV2 } from "./part-design-loft"
import { sweepFeatureType } from "./part-design-sweep"
import { partBodyReference } from "./parts"
import { sketchFeatureFaceSupportSchema } from "./sketch"
import { createEmptySketch } from "./sketch-edit"
import { createLengthQuantity } from "./units"
import { applyVersionedDocumentCommand } from "./versioned-document-commands"

type SketchSolid = "Loft" | "Sweep"
const id = (suffix: number) => `0195b5ac-b220-7a2c-8c33-${suffix.toString(16).padStart(12, "0")}`
function success<T extends { ok: boolean }>(result: T): Extract<T, { ok: true }> {
  if (!result.ok) throw new Error(JSON.stringify(result))
  return result as Extract<T, { ok: true }>
}
function envelope(revision: number) {
  return {
    schemaVersion: 2,
    documentId: id(1),
    commandId: id(1000 + revision),
    baseRevision: revision,
    issuedAt: "2026-10-03T00:00:00Z",
    actor: { type: "user", userId: null },
  }
}
function profile(sketch = 400, boundary = 500) {
  return {
    schemaVersion: 0,
    sketchId: id(sketch),
    outerBoundaryEntityIds: [id(boundary)],
    holeBoundaryEntityIds: [],
  }
}
function parameters(kind: SketchSolid, edited = false) {
  return kind === "Loft"
    ? { sections: [profile(400), profile(401)], ruled: edited }
    : {
        profile: profile(400),
        path: {
          schemaVersion: 0,
          sketchId: id(401),
          entityIds: [id(501)],
          startPointId: id(edited ? 503 : 502),
        },
      }
}
function feature(kind: SketchSolid, edited = false, suppressed = false) {
  return featureRecordSchema.parse({
    schemaVersion: 0,
    id: id(3),
    type: kind === "Loft" ? loftFeatureType.type : sweepFeatureType.type,
    parameters: parameters(kind, edited),
    dependencies: [id(2)],
    references: [],
    suppressed,
  })
}
function registry() {
  const modules = success(
    createModuleRegistry([documentCoreModule, featureCoreModule, partDesignModule]),
  )
  return success(createFeatureTypeRegistry(modules.registry, partDesignFeatureTypeHandlers))
    .registry
}
function model(
  snapshot: DocumentSnapshotV2,
  kind: string,
  payload: unknown,
  partAllocations: unknown[] = [],
) {
  return applyDocumentV2Command(snapshot, {
    ...envelope(snapshot.revision),
    kind: "org.vibeshape.document.model-command",
    payload: {
      command: { ...envelope(snapshot.revision), schemaVersion: 1, kind, payload },
      partAllocations,
    },
  })
}
function allocation(featureId: number, partId: number) {
  return {
    id: id(partId),
    name: `Part ${partId}`,
    origin: "independent",
    body: { schemaVersion: 0, featureId: id(featureId), outputRole: "result" },
  }
}
function sectionSketch(value: number) {
  const support = sketchFeatureFaceSupportSchema.parse({
    kind: "feature-face",
    reference: {
      schemaVersion: 0,
      featureId: id(2),
      kind: "face",
      signature: {
        kind: "face",
        geometryClass: "PLANE",
        measure: 600,
        centroid: [10, 15, 40],
        bounds: { min: [0, 0, 40], max: [20, 30, 40] },
        boundaryCount: 4,
        adjacentGeometryClasses: [],
      },
    },
  })
  return createEmptySketch({
    id: sketchIdSchema.parse(id(value)),
    label: `Section ${value}`,
    plane: "xy",
    support,
  })
}
function fixture() {
  const created = success(
    applyVersionedDocumentCommand(null, {
      ...envelope(0),
      schemaVersion: 1,
      kind: "org.vibeshape.document.create",
      payload: { name: "Sketch solid fixture" },
    }),
  )
  const upgraded = success(
    applyDocumentUpgradeV2Command(created.snapshot, {
      ...envelope(created.snapshot.revision),
      kind: "org.vibeshape.document.upgrade-v2",
      payload: { partAllocations: [] },
    }),
  )
  const box = {
    schemaVersion: 0,
    id: id(2),
    type: boxFeatureType.type,
    parameters: {
      width: createLengthQuantity(20),
      depth: createLengthQuantity(30),
      height: createLengthQuantity(40),
      centered: false,
    },
    dependencies: [],
    references: [],
    suppressed: false,
  }
  const root = success(
    model(
      upgraded.snapshot,
      "org.vibeshape.history.insert-feature",
      { feature: box, historyAfter: null },
      [allocation(2, 100)],
    ),
  )
  let snapshot = root.snapshot
  const events = [created.event, upgraded.event, root.event]
  for (const sketch of [400, 401].map(sectionSketch)) {
    const added = success(
      model(snapshot, "org.vibeshape.history.insert-sketch", {
        sketch,
        historyAfter: snapshot.history.at(-1),
      }),
    )
    snapshot = added.snapshot
    events.push(added.event)
  }
  return { snapshot, events }
}
function insert(
  snapshot: DocumentSnapshotV2,
  kind: SketchSolid,
  partAllocations = [allocation(3, 101)],
) {
  return model(
    snapshot,
    "org.vibeshape.history.insert-feature",
    { feature: feature(kind), historyAfter: snapshot.history.at(-1) },
    partAllocations,
  )
}

describe.each(["Loft", "Sweep"] as const)("registered new-body %s", (kind) => {
  it("registers bounded descriptors and leaves all scheduling owner bodies unconsumed", () => {
    const value = feature(kind)
    expect(registry().validateFeature(value).ok).toBe(true)
    expect(featureBodyDependencyIds(value)).toEqual([])
    expect(featureBodyDependencies(value)).toEqual([])
    const sourceRecord = fixture().snapshot.features[0]
    if (!sourceRecord) throw new Error("The scheduling owner must remain authored.")
    const { semanticInputs: _inputs, ...sourceIntent } = sourceRecord
    const source = featureRecordSchema.parse({ ...sourceIntent, schemaVersion: 0 })
    const ownerBody = { featureId: source.id, outputRole: "result" }
    const resultBody = { featureId: value.id, outputRole: "result" }
    expect(
      terminalBodyOutputs(
        [source, value],
        new Map([
          [source.id, [ownerBody]],
          [value.id, [resultBody]],
        ]),
      ),
    ).toEqual([ownerBody, resultBody])
    const dependencyLimit = kind === "Loft" ? 24 : 8
    expect(
      registry().validateFeature({
        ...value,
        dependencies: Array.from({ length: dependencyLimit }, (_, index) => id(20 + index)),
      }).ok,
    ).toBe(true)
    expect(
      registry().validateFeature({
        ...value,
        dependencies: Array.from({ length: dependencyLimit + 1 }, (_, index) => id(20 + index)),
      }).ok,
    ).toBe(false)
  })

  it("captures an independent PartId and preserves it through parameter edits, suppression, and replay", () => {
    const before = fixture()
    expect(insert(before.snapshot, kind, []).ok).toBe(false)
    const added = success(insert(before.snapshot, kind))
    expect(added.snapshot.parts[0]).toEqual(before.snapshot.parts[0])
    expect(added.snapshot.parts[1]).toMatchObject({
      id: id(101),
      origin: "independent",
      consumedBy: null,
      bodyHistory: [{ featureId: id(3), outputRole: "result" }],
    })
    const edited = success(
      model(added.snapshot, "org.vibeshape.feature.update", { feature: feature(kind, true) }),
    )
    const hidden = success(
      model(edited.snapshot, "org.vibeshape.feature.update", {
        feature: feature(kind, true, true),
      }),
    )
    const restored = success(
      model(hidden.snapshot, "org.vibeshape.feature.update", { feature: feature(kind, true) }),
    )
    expect(edited.snapshot.parts).toEqual(added.snapshot.parts)
    expect(hidden.snapshot.parts).toEqual(added.snapshot.parts)
    expect(restored.snapshot.parts).toEqual(added.snapshot.parts)
    const resultPart = restored.snapshot.parts.find((part) => part.id === id(101))
    if (!resultPart) throw new Error("The captured sketch solid PartId must remain authored.")
    expect(partBodyReference(resultPart)).toMatchObject({ featureId: id(3) })
    expect(success(reduceDocumentV2Event(before.snapshot, added.event)).snapshot).toEqual(
      added.snapshot,
    )
    expect(
      success(
        replayDocumentAuthorityEvents(null, [
          ...before.events,
          added.event,
          edited.event,
          hidden.event,
          restored.event,
        ]),
      ).snapshot,
    ).toEqual(restored.snapshot)
  })

  it("declares both direct sketches and rejects substituted semantic inputs and missing sketches", () => {
    const value = feature(kind)
    expect(projectFirstPartyFeatureSemanticInputs(value)).toEqual<unknown>({
      recognized: true,
      ok: true,
      inputs: [
        { kind: "sketch", id: id(400) },
        { kind: "sketch", id: id(401) },
      ],
    })
    const added = success(insert(fixture().snapshot, kind)).snapshot
    const graph = success(createDocumentDependencyGraph(added))
    expect(graph.graph.dependencyModelIssues).toEqual([])
    expect(graph.graph.dependenciesOf({ kind: "feature", id: value.id })).toEqual<unknown>([
      { kind: "feature", id: id(2) },
      { kind: "sketch", id: id(400) },
      { kind: "sketch", id: id(401) },
    ])
    const authored = featureRecordV1Schema.parse({
      ...value,
      schemaVersion: 1,
      semanticInputs: [{ kind: "sketch", id: id(400) }],
    })
    expect(
      createDocumentDependencyGraph({
        ...added,
        features: [added.features[0], authored],
      }).ok,
    ).toBe(false)
    expect(
      createDocumentDependencyGraph({
        ...added,
        sketches: added.sketches.slice(0, 1),
        history: added.history.filter((item) => item.id !== id(401)),
      }).ok,
    ).toBe(false)
  })

  it("projects legacy graph relations for every selected sketch before feature-record migration", () => {
    const before = fixture().snapshot
    const value = feature(kind)
    const graph = success(
      createDocumentDependencyGraph({
        sketches: before.sketches,
        features: [before.features[0], value],
        history: [...before.history, { kind: "feature", id: value.id }],
      }),
    )
    expect(graph.graph.dependencyModelIssues).toEqual([])
    expect(
      graph.graph.edges
        .filter((edge) => edge.target.id === value.id && edge.relation === "semantic-input")
        .map((edge) => edge.source.id),
    ).toEqual<unknown>([id(400), id(401)])
  })

  it("retains recursive source-sketch reachability through direct sketch semantic inputs", () => {
    const before = fixture().snapshot
    const sourceSketch = {
      ...sectionSketch(399),
      entities: [{ schemaVersion: 0, id: id(550), type: "point", construction: false, x: 0, y: 0 }],
    }
    const profileSketch = {
      ...sectionSketch(400),
      externalReferences: [
        {
          schemaVersion: 0,
          id: id(551),
          sourceSketchId: sourceSketch.id,
          sourcePointId: id(550),
          projectedPointId: id(552),
        },
      ],
    }
    const value = feature(kind)
    const graph = success(
      createDocumentDependencyGraph({
        sketches: [sourceSketch, profileSketch, sectionSketch(401)],
        features: [before.features[0], value],
        history: [
          { kind: "feature", id: id(2) },
          { kind: "sketch", id: sourceSketch.id },
          { kind: "sketch", id: profileSketch.id },
          { kind: "sketch", id: id(401) },
          { kind: "feature", id: value.id },
        ],
      }),
    )
    expect(graph.graph.dependenciesOf({ kind: "feature", id: value.id })).toContainEqual({
      kind: "sketch",
      id: profileSketch.id,
    })
    expect(graph.graph.dependenciesOf({ kind: "sketch", id: profileSketch.id })).toContainEqual({
      kind: "sketch",
      id: sourceSketch.id,
    })
    expect(graph.graph.dependencyModelIssues).toEqual([])
  })
})

describe("ordered sketch-solid semantic inputs", () => {
  it("deduplicates repeated Loft sketch IDs in first-section order without collapsing section intent", () => {
    const value = {
      ...feature("Loft"),
      parameters: { sections: [profile(401), profile(400), profile(401, 504)], ruled: false },
    }
    expect(projectFirstPartyFeatureSemanticInputs(value)).toEqual<unknown>({
      recognized: true,
      ok: true,
      inputs: [
        { kind: "sketch", id: id(401) },
        { kind: "sketch", id: id(400) },
      ],
    })
    expect(registry().validateFeature(value).ok).toBe(true)
  })
  it("recognizes Loft v2 ordered section bindings and rejects malformed correspondence", () => {
    const legacy = feature("Loft")
    const value = {
      ...legacy,
      type: loftFeatureTypeV2.type,
      parameters: { sections: [profile(401), profile(400)], ruled: false, holeCorrespondence: [] },
    }
    expect(projectFirstPartyFeatureSemanticInputs(value)).toEqual<unknown>({
      recognized: true,
      ok: true,
      inputs: [
        { kind: "sketch", id: id(401) },
        { kind: "sketch", id: id(400) },
      ],
    })
    expect(registry().validateFeature(value).ok).toBe(true)
    expect(
      projectFirstPartyFeatureSemanticInputs({
        ...value,
        parameters: { ...value.parameters, holeCorrespondence: [{ sectionBoundaryEntityIds: [] }] },
      }),
    ).toMatchObject({ recognized: true, ok: false })
  })
  it("deduplicates a Sweep profile and path on the same sketch", () => {
    const value = {
      ...feature("Sweep"),
      parameters: {
        profile: profile(),
        path: { schemaVersion: 0, sketchId: id(400), entityIds: [id(501)], startPointId: id(502) },
      },
    }
    expect(projectFirstPartyFeatureSemanticInputs(value)).toEqual<unknown>({
      recognized: true,
      ok: true,
      inputs: [{ kind: "sketch", id: id(400) }],
    })
  })
  it.each(["Loft", "Sweep"] as const)(
    "fails closed for invalid %s selectors and does not recognize other schema versions",
    (kind) => {
      const value = feature(kind)
      expect(projectFirstPartyFeatureSemanticInputs({ ...value, parameters: {} })).toMatchObject({
        recognized: true,
        ok: false,
      })
      expect(
        projectFirstPartyFeatureSemanticInputs({
          ...value,
          type: { ...value.type, schemaVersion: 99 },
        }),
      ).toEqual({ recognized: false })
    },
  )
})
