import { expect, it } from "vitest"
import { createDocumentDependencyGraphFromSnapshot } from "./document-graph"
import { createFeatureContentIdentity } from "./feature-content-identity"
import { featureBodyDependencyIds } from "./feature-dependencies"
import { featureRecordSchema } from "./feature-graph"
import { createFeatureTypeRegistry } from "./feature-type-registry"
import { featureIdSchema } from "./identifiers"
import {
  createModuleRegistry,
  documentCoreModule,
  featureCoreModule,
  partDesignModule,
} from "./modules"
import {
  boxFeatureType,
  chamferFeatureTypeV2,
  filletFeatureType,
  filletFeatureTypeV2,
  partDesignFeatureTypeHandlers,
} from "./part-design"
import { createLengthQuantity } from "./units"
import {
  applyVersionedDocumentCommand,
  projectDocumentSnapshotV1ToV0,
  replayVersionedDocumentEvents,
} from "./versioned-document-commands"

const targetId = "0195b5ac-b220-7a2c-8c33-67a36a7f3302"
const featureId = "0195b5ac-b220-7a2c-8c33-67a36a7f3303"
const targetFeatureId = featureIdSchema.parse(targetId)
const selectedFeatureId = featureIdSchema.parse(featureId)

const edge = (overrides: Record<string, unknown> = {}) => ({
  schemaVersion: 0 as const,
  featureId: targetId,
  kind: "edge" as const,
  semanticRole: "primitive.box.edge.x.y-min.z-min",
  signature: {
    kind: "edge" as const,
    geometryClass: "LINE",
    measure: 20,
    centroid: [0, 0, 0] as const,
    bounds: { min: [-10, 0, 0] as const, max: [10, 0, 0] as const },
    direction: [1, 0, 0] as const,
    directionMode: "axis" as const,
    boundaryCount: 2,
    adjacentGeometryClasses: ["PLANE", "PLANE"],
  },
  ...overrides,
})

function registry() {
  const modules = createModuleRegistry([documentCoreModule, featureCoreModule, partDesignModule])
  if (!modules.ok) throw new Error(modules.diagnostic.message)
  const result = createFeatureTypeRegistry(modules.registry, partDesignFeatureTypeHandlers)
  if (!result.ok) throw new Error(result.diagnostic.message)
  return result.registry
}

function treatment(
  type: typeof filletFeatureTypeV2 | typeof chamferFeatureTypeV2,
  references = [edge()],
) {
  return featureRecordSchema.parse({
    schemaVersion: 0,
    id: featureId,
    type: type.type,
    parameters:
      type === filletFeatureTypeV2
        ? { radius: createLengthQuantity(2, "mm", "#size") }
        : { distance: createLengthQuantity(2, "mm", "#size") },
    dependencies: [targetId],
    references,
    suppressed: false,
    label: "Selected edge treatment",
  })
}

it.each([filletFeatureTypeV2, chamferFeatureTypeV2])(
  "validates selected-edge %s through the production registry",
  (type) => {
    const feature = treatment(type)
    expect(registry().validateFeature(feature)).toMatchObject({ ok: true })
    expect(featureBodyDependencyIds(feature)).toEqual([targetId])
  },
)

it("rejects wrong kinds, duplicate durable selections, and invalid cardinality", () => {
  const selected = treatment(filletFeatureTypeV2)
  expect(registry().validateFeature({ ...selected, references: [] })).toMatchObject({
    diagnostic: { code: "invalid-feature-reference-count" },
  })
  expect(
    registry().validateFeature({ ...selected, references: [edge({ kind: "face" })] }),
  ).toMatchObject({ diagnostic: { code: "invalid-feature" } })
  expect(
    registry().validateFeature({
      ...selected,
      references: [edge(), edge({ signature: { ...edge().signature, centroid: [1, 0, 0] } })],
    }),
  ).toMatchObject({ diagnostic: { code: "invalid-feature-parameters" } })
  expect(
    registry().validateFeature({
      ...selected,
      references: [
        edge({ lineageToken: "stable-edge" }),
        edge({ semanticRole: "other", lineageToken: "stable-edge" }),
      ],
    }),
  ).toMatchObject({ diagnostic: { code: "invalid-feature-parameters" } })
  expect(
    registry().validateFeature({
      ...selected,
      references: Array.from({ length: 257 }, (_, index) =>
        edge({ semanticRole: `edge-${index}` }),
      ),
    }),
  ).toMatchObject({ diagnostic: { code: "invalid-feature-reference-count" } })
  expect(
    registry().validateFeature({
      ...selected,
      dependencies: ["0195b5ac-b220-7a2c-8c33-67a36a7f3304"],
    }),
  ).toMatchObject({ diagnostic: { code: "invalid-feature" } })
})

it("rejects a valid face reference through the selected-edge invariant", () => {
  const face = edge({
    kind: "face",
    signature: {
      ...edge().signature,
      kind: "face",
      geometryClass: "PLANE",
      direction: undefined,
      directionMode: undefined,
      boundaryCount: 4,
    },
  })
  expect(
    registry().validateFeature({ ...treatment(filletFeatureTypeV2), references: [face] }),
  ).toMatchObject({
    diagnostic: { code: "invalid-feature-parameters" },
  })
})

it("retains v1 all-edge compatibility", () => {
  const feature = featureRecordSchema.parse({
    ...treatment(filletFeatureTypeV2),
    type: filletFeatureType.type,
    references: [],
  })
  expect(registry().validateFeature(feature)).toMatchObject({ ok: true })
})

const commandId = (value: number) => `0195b5ac-b220-7a2c-8c33-${value.toString().padStart(12, "0")}`
const commandEnvelope = (kind: string, baseRevision: number, value: number) => ({
  kind,
  schemaVersion: 1,
  commandId: commandId(value),
  documentId: commandId(1),
  baseRevision,
  issuedAt: "2026-09-05T08:00:00.000Z",
  actor: { type: "user", userId: "org.vibeshape.user.selected-edge-test" },
})

it("preserves selected references through versioned history, replay, projection, and deletion blocking", () => {
  const created = applyVersionedDocumentCommand(null, {
    ...commandEnvelope("org.vibeshape.document.create", 0, 2),
    payload: { name: "Selected edge history" },
  })
  expect(created).toMatchObject({ ok: true })
  if (!created.ok) return
  const box = featureRecordSchema.parse({
    schemaVersion: 0,
    id: targetId,
    type: boxFeatureType.type,
    parameters: {
      width: createLengthQuantity(20),
      depth: createLengthQuantity(15),
      height: createLengthQuantity(10),
      centered: false,
    },
    dependencies: [],
    references: [],
    suppressed: false,
    label: "Box",
  })
  const insertedBox = applyVersionedDocumentCommand(created.snapshot, {
    ...commandEnvelope("org.vibeshape.history.insert-feature", created.snapshot.revision, 3),
    payload: { feature: box, historyAfter: null },
  })
  expect(insertedBox).toMatchObject({ ok: true })
  if (!insertedBox.ok) return
  const inserted = applyVersionedDocumentCommand(insertedBox.snapshot, {
    ...commandEnvelope("org.vibeshape.history.insert-feature", insertedBox.snapshot.revision, 4),
    payload: {
      feature: treatment(filletFeatureTypeV2),
      historyAfter: { kind: "feature", id: targetFeatureId },
    },
  })
  expect(inserted).toMatchObject({ ok: true })
  if (!inserted.ok) return
  const updatedFeature = {
    ...treatment(filletFeatureTypeV2),
    references: [edge({ semanticRole: "updated-edge" })],
  }
  const updated = applyVersionedDocumentCommand(inserted.snapshot, {
    ...commandEnvelope("org.vibeshape.feature.update", inserted.snapshot.revision, 5),
    payload: { feature: updatedFeature },
  })
  expect(updated).toMatchObject({ ok: true })
  if (!updated.ok) return
  const saved = updated.snapshot.features.at(-1)
  expect(saved).toMatchObject({ references: updatedFeature.references, semanticInputs: [] })
  const replayed = replayVersionedDocumentEvents(created.snapshot, [
    insertedBox.event,
    inserted.event,
    updated.event,
  ])
  expect(replayed).toMatchObject({ ok: true })
  if (!replayed.ok) return
  expect(replayed.snapshot.features.at(-1)).toMatchObject({
    references: updatedFeature.references,
    semanticInputs: [],
  })
  const projected = projectDocumentSnapshotV1ToV0(updated.snapshot)
  expect(projected).toMatchObject({ ok: true })
  if (projected.ok)
    expect(projected.snapshot.features.at(-1)?.references).toEqual(updatedFeature.references)
  const graph = createDocumentDependencyGraphFromSnapshot({
    sketches: [],
    features: [box, updatedFeature],
  })
  expect(graph).toMatchObject({ ok: true })
  if (graph.ok) {
    expect(graph.graph.deletionBlockersFor({ kind: "feature", id: targetFeatureId })).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          dependent: { kind: "feature", id: selectedFeatureId },
          relation: "feature-dependency",
        }),
        expect.objectContaining({ relation: "feature-topology-reference" }),
      ]),
    )
  }
})

it("resolves variable sizes and keeps references in content identity", () => {
  const selected = treatment(filletFeatureTypeV2)
  const resolved = registry().resolveFeatureParameters(
    selected,
    new Map([["size", { dimension: "length", value: 3, unit: "mm" }]]),
  )
  expect(resolved).toMatchObject({ ok: true, feature: { parameters: { radius: { value: 3 } } } })
  if (!resolved.ok) return
  const environment = {
    schemaVersion: 0,
    hostApiVersion: "0.1.0",
    geometry: {
      adapterId: "org.vibeshape.geometry.occt",
      adapterVersion: "0.1.0",
      kernelId: "org.opencascade.occt",
      kernelVersion: "7.8.0",
      kernelSourceRevision: null,
    },
    modelingTolerancePolicyVersion: 1,
    provider: { kind: "built-in" },
  }
  const dependency = [{ featureId: targetId, contentHash: "a".repeat(64) }]
  const first = createFeatureContentIdentity(registry(), {
    feature: selected,
    dependencies: dependency,
    environment,
  })
  const second = createFeatureContentIdentity(registry(), {
    feature: { ...selected, references: [edge({ semanticRole: "other" })] },
    dependencies: dependency,
    environment,
  })
  expect(first).toMatchObject({ ok: true })
  expect(second).toMatchObject({ ok: true })
  if (first.ok && second.ok) expect(first.canonicalPayload).not.toBe(second.canonicalPayload)
})
