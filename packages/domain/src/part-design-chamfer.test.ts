import { expect, it } from "bun:test"
import { createFeatureContentIdentity } from "./feature-content-identity"
import { featureBodyDependencies } from "./feature-dependencies"
import { featureRecordSchema } from "./feature-graph"
import { createFeatureTypeRegistry } from "./feature-type-registry"
import {
  createModuleRegistry,
  documentCoreModule,
  featureCoreModule,
  partDesignModule,
} from "./modules"
import {
  boxFeatureType,
  chamferFeatureParametersV3Schema,
  chamferFeatureTypeV3,
  partDesignFeatureTypeHandlers,
} from "./part-design"
import { createAngleQuantity, createLengthQuantity } from "./units"
import {
  applyVersionedDocumentCommand,
  replayVersionedDocumentEvents,
} from "./versioned-document-commands"

const sourceId = "0195b5ac-b220-7a2c-8c33-67a36a7f3302"
const featureId = "0195b5ac-b220-7a2c-8c33-67a36a7f3303"
const reference = (kind: "edge" | "face") => ({
  schemaVersion: 1,
  featureId: sourceId,
  outputRole: "pattern.instance.1",
  kind,
  semanticRole: `source.${kind}`,
  signature: {
    kind,
    geometryClass: kind === "edge" ? "LINE" : "PLANE",
    measure: 20,
    centroid: [0, 0, 0],
    bounds: { min: [0, 0, 0], max: [20, 0, 0] },
    boundaryCount: kind === "edge" ? 2 : 4,
    adjacentGeometryClasses: ["PLANE", "PLANE"],
  },
})
function parameters() {
  return chamferFeatureParametersV3Schema.parse({
    targetBody: { schemaVersion: 0, featureId: sourceId, outputRole: "pattern.instance.1" },
    mode: "two-distances",
    distance: createLengthQuantity(2),
    secondDistance: createLengthQuantity(3),
    measurement: "offset",
    flip: true,
    tangentPropagation: true,
    targets: [{ kind: "edge", edge: reference("edge"), sideFace: reference("face") }],
    directionOverrides: [reference("edge")],
  })
}
function fixture() {
  const modules = createModuleRegistry([documentCoreModule, featureCoreModule, partDesignModule])
  if (!modules.ok) throw new Error(modules.diagnostic.message)
  const registry = createFeatureTypeRegistry(modules.registry, partDesignFeatureTypeHandlers)
  if (!registry.ok) throw new Error(registry.diagnostic.message)
  const feature = featureRecordSchema.parse({
    schemaVersion: 0,
    id: featureId,
    type: chamferFeatureTypeV3.type,
    parameters: parameters(),
    dependencies: [sourceId],
    references: [],
    suppressed: false,
  })
  return { registry: registry.registry, feature }
}

it("registers exact Chamfer V3 body-role and typed side intent without changing legacy versions", () => {
  const { registry, feature } = fixture()
  expect(registry.validateFeature(feature)).toMatchObject({ ok: true })
  expect(featureBodyDependencies(feature)).toEqual<unknown>([
    { featureId: sourceId, outputRole: "pattern.instance.1" },
  ])
  expect(registry.validateFeature({ ...feature, dependencies: [featureId] })).toMatchObject({
    ok: false,
  })
  expect(
    registry.validateFeature({
      ...feature,
      references: [{ ...reference("edge"), schemaVersion: 0 }],
    }),
  ).toMatchObject({ ok: false })
})

it("rejects incoherent modes, quantities, owner roles, missing side intent, and duplicate targets", () => {
  const valid = parameters()
  for (const patch of [
    { secondDistance: undefined },
    { angle: createAngleQuantity(30, "deg") },
    { distance: createLengthQuantity(0) },
    { distance: { ...createLengthQuantity(1), value: Number.NaN } },
    { targets: [] },
    { targets: [valid.targets[0], valid.targets[0]] },
    { targets: [{ kind: "edge", edge: reference("edge") }] },
    { targets: [{ kind: "face", face: { ...reference("face"), outputRole: "result" } }] },
    { directionOverrides: [reference("edge"), reference("edge")] },
    { mode: "equal-distance", secondDistance: undefined },
    { mode: "distance-angle", secondDistance: undefined, angle: createAngleQuantity(90, "deg") },
  ])
    expect(chamferFeatureParametersV3Schema.safeParse({ ...valid, ...patch }).success).toBe(false)
})

it("resolves both distances and angle expressions with dimension and range checks", () => {
  const { registry, feature } = fixture()
  expect(
    registry.resolveFeatureParameters(
      {
        ...feature,
        parameters: {
          ...parameters(),
          distance: createLengthQuantity(99, "mm", "2 mm"),
          secondDistance: createLengthQuantity(99, "mm", "4 mm"),
        },
      },
      new Map(),
    ),
  ).toMatchObject({
    ok: true,
    feature: { parameters: { distance: { value: 2 }, secondDistance: { value: 4 } } },
  })
  const { secondDistance: _second, ...common } = parameters()
  const input = {
    ...feature,
    parameters: {
      ...common,
      mode: "distance-angle",
      distance: createLengthQuantity(99, "mm", "2 mm"),
      angle: createAngleQuantity(20, "deg", "30 deg"),
    },
  }
  const resolved = registry.resolveFeatureParameters(input, new Map())
  expect(resolved).toMatchObject({
    ok: true,
    feature: { parameters: { distance: { value: 2 }, angle: { value: Math.PI / 6 } } },
  })
  const invalid = registry.resolveFeatureParameters(
    {
      ...input,
      parameters: { ...input.parameters, angle: createAngleQuantity(20, "deg", "2 mm") },
    },
    new Map(),
  )
  expect(invalid).toMatchObject({ ok: false })
})

it("projects quantities and exact semantic refs into content identity, retaining order and direction", () => {
  const { registry, feature } = fixture()
  const handler = partDesignFeatureTypeHandlers.find(
    ({ type }) => type.typeId === feature.type.typeId && type.schemaVersion === 3,
  )
  if (!handler?.contentParameters)
    throw new Error("Registered Chamfer V3 content projection is required.")
  const content = handler.contentParameters(feature.parameters)
  expect(content).toMatchObject({
    distance: 2,
    secondDistance: 3,
    flip: true,
    targets: [
      { edge: { schemaVersion: 1, outputRole: "pattern.instance.1" }, sideFace: { kind: "face" } },
    ],
  })
  expect(JSON.stringify(content)).not.toContain(sourceId)
  expect(registry.validateFeature(feature)).toMatchObject({ ok: true })
  const environment = {
    schemaVersion: 0,
    hostApiVersion: "0.1.0",
    modelingTolerancePolicyVersion: 1,
    geometry: {
      adapterId: "org.vibeshape.geometry.replicad",
      adapterVersion: "test",
      kernelId: "org.opencascade.occt",
      kernelVersion: "test",
      kernelSourceRevision: null,
    },
    provider: { kind: "built-in" },
  }
  const identity = (parameters: unknown) =>
    createFeatureContentIdentity(registry, {
      feature: { ...feature, parameters },
      dependencies: [
        { featureId: sourceId, outputRole: "pattern.instance.1", contentHash: "a".repeat(64) },
      ],
      environment,
    })
  const first = identity(feature.parameters)
  expect(first.ok).toBe(true)
  for (const patch of [
    { flip: false },
    { measurement: "tangent" },
    { directionOverrides: [] },
    { secondDistance: createLengthQuantity(4) },
  ]) {
    const changed = identity({ ...feature.parameters, ...patch })
    expect(changed.ok).toBe(true)
    if (first.ok && changed.ok) expect(changed.canonicalPayload).not.toBe(first.canonicalPayload)
  }
})

it("retains V3 face-side and direction intent through versioned command replay", () => {
  let commandNumber = 100
  const envelope = (kind: string, baseRevision: number) => ({
    kind,
    schemaVersion: 1,
    commandId: `0195b5ac-b220-7a2c-8c33-${String(commandNumber++).padStart(12, "0")}`,
    documentId: featureId,
    baseRevision,
    issuedAt: "2026-10-20T12:00:00.000Z",
    actor: { type: "user", userId: "org.vibeshape.user.chamfer-test" },
  })
  const created = applyVersionedDocumentCommand(null, {
    ...envelope("org.vibeshape.document.create", 0),
    payload: { name: "Chamfer V3 intent" },
  })
  if (!created.ok) throw new Error(created.diagnostic.message)
  const box = featureRecordSchema.parse({
    schemaVersion: 0,
    id: sourceId,
    type: boxFeatureType.type,
    parameters: {
      width: createLengthQuantity(20),
      depth: createLengthQuantity(12),
      height: createLengthQuantity(10),
      centered: false,
    },
    dependencies: [],
    references: [],
    suppressed: false,
  })
  const insertedBox = applyVersionedDocumentCommand(created.snapshot, {
    ...envelope("org.vibeshape.history.insert-feature", created.snapshot.revision),
    payload: { feature: box, historyAfter: null },
  })
  if (!insertedBox.ok) throw new Error(insertedBox.diagnostic.message)
  const source = parameters()
  const authored = {
    ...source,
    targetBody: { ...source.targetBody, outputRole: "result" },
    targets: [
      {
        kind: "edge",
        edge: { ...reference("edge"), outputRole: "result" },
        sideFace: { ...reference("face"), outputRole: "result" },
      },
    ],
    directionOverrides: [{ ...reference("edge"), outputRole: "result" }],
  }
  const { feature } = fixture()
  const inserted = applyVersionedDocumentCommand(insertedBox.snapshot, {
    ...envelope("org.vibeshape.history.insert-feature", insertedBox.snapshot.revision),
    payload: {
      feature: { ...feature, parameters: authored },
      historyAfter: { kind: "feature", id: sourceId },
    },
  })
  if (!inserted.ok) throw new Error(inserted.diagnostic.message)
  const replayed = replayVersionedDocumentEvents(created.snapshot, [
    insertedBox.event,
    inserted.event,
  ])
  expect(replayed.ok).toBe(true)
  if (replayed.ok)
    expect(replayed.snapshot.features.at(-1)).toMatchObject({
      type: { schemaVersion: 3 },
      parameters: authored,
      references: [],
      semanticInputs: [],
    })
})
