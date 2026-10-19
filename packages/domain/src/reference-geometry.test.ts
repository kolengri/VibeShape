import { describe, expect, it } from "bun:test"
import { type DocumentSnapshotV1, documentSnapshotSchema } from "./document"
import { createDocumentDependencyGraphFromSnapshot } from "./document-graph"
import { documentRestoredEventSchema } from "./document-history"
import { createFeatureContentIdentity } from "./feature-content-identity"
import { featureRecordSchema } from "./feature-graph"
import { projectFirstPartyFeatureSemanticInputs } from "./feature-semantic-inputs"
import { createFeatureTypeRegistry } from "./feature-type-registry"
import { moduleIdSchema } from "./identifiers"
import {
  createModuleRegistry,
  documentCoreModule,
  featureCoreModule,
  referenceGeometryModule,
} from "./modules"
import {
  datumPlaneFeatureType,
  datumPlaneFeatureTypeV1,
  datumPlaneParametersSchema,
  datumPlaneParametersV1Schema,
  readDatumPlaneFeatureParameters,
  referenceGeometryFeatureTypeHandlers,
} from "./reference-geometry"
import { createAngleQuantity, createLengthQuantity } from "./units"
import { evaluateVariableDefinitions } from "./variables"
import {
  applyVersionedDocumentCommand,
  reduceVersionedDocumentEvent,
  replayVersionedDocumentEvents,
  type VersionedDocumentEvent,
} from "./versioned-document-commands"

const supportFeatureId = "0195b5ac-b220-7a2c-8c33-67a36a7f3301"
const datumFeatureId = "0195b5ac-b220-7a2c-8c33-67a36a7f3302"

function registry(legacyOnly = false) {
  const modules = createModuleRegistry([
    documentCoreModule,
    featureCoreModule,
    legacyOnly
      ? { ...referenceGeometryModule, featureTypes: [datumPlaneFeatureTypeV1] }
      : referenceGeometryModule,
  ])
  if (!modules.ok) throw new Error(modules.diagnostic.message)
  const featureTypes = createFeatureTypeRegistry(
    modules.registry,
    referenceGeometryFeatureTypeHandlers.filter(
      ({ type }) => !legacyOnly || type.schemaVersion === 1,
    ),
  )
  if (!featureTypes.ok) throw new Error(featureTypes.diagnostic.message)
  return featureTypes.registry
}

function planarReference() {
  return {
    schemaVersion: 0,
    featureId: supportFeatureId,
    kind: "face",
    semanticRole: "primitive.box.cap.end",
    signature: {
      kind: "face",
      geometryClass: "PLANE",
      measure: 600,
      centroid: [0, 0, 20],
      bounds: { min: [-10, -15, 20], max: [10, 15, 20] },
      direction: [0, 0, 1],
      directionMode: "oriented",
      boundaryCount: 4,
      adjacentGeometryClasses: ["PLANE"],
    },
  } as const
}

function datum(parameters: unknown, dependencies: string[] = [], references: unknown[] = []) {
  return featureRecordSchema.parse({
    schemaVersion: 0,
    id: datumFeatureId,
    type: datumPlaneFeatureType.type,
    parameters,
    dependencies,
    references,
    suppressed: false,
    label: "Plane 1",
  })
}

const originParameters = {
  mode: "offset",
  support: { kind: "origin-plane", plane: "xz" },
  offset: createLengthQuantity(12),
} as const

function contentIdentity(feature: unknown, legacyOnly = false) {
  const result = createFeatureContentIdentity(registry(legacyOnly), {
    feature,
    dependencies: [],
    environment: {
      schemaVersion: 0,
      hostApiVersion: "0.1.0",
      geometry: {
        adapterId: "org.vibeshape.geometry.replicad",
        adapterVersion: "0.1.0+test",
        kernelId: "org.opencascade.occt",
        kernelVersion: "7.8.1",
        kernelSourceRevision: null,
      },
      modelingTolerancePolicyVersion: 1,
      provider: { kind: "built-in" },
    },
  })
  if (!result.ok) throw new Error(result.diagnostic.message)
  return result.canonicalPayload
}

function angleVariables(expression: string) {
  const result = evaluateVariableDefinitions([
    {
      schemaVersion: 0,
      id: "0195b5ac-b240-7a2c-8c33-67a36a7f21ac",
      name: "tilt",
      expression,
    },
  ])
  if (!result.ok) throw new Error(result.diagnostic.message)
  return result.valuesByName
}

describe("datum plane feature", () => {
  it("registers strict legacy v1 and rotation-capable v2 without reclassifying old records", () => {
    const types = registry()
    expect(types.descriptors.map(({ type }) => type.schemaVersion)).toEqual([1, 2])
    const legacy = { ...datum(originParameters), type: datumPlaneFeatureTypeV1.type }
    expect(datumPlaneParametersV1Schema.parse(originParameters)).toEqual(originParameters)
    expect(types.validateFeature(legacy)).toMatchObject({ ok: true, feature: legacy })
    expect(types.resolveFeatureParameters(legacy, new Map())).toEqual({ ok: true, feature: legacy })
    expect(readDatumPlaneFeatureParameters(legacy)).toEqual(originParameters)
    expect(contentIdentity(legacy)).toEqual(contentIdentity(legacy, true))
    expect(types.validateFeature(legacy)).toMatchObject({
      contentParameters: { mode: "offset", support: originParameters.support, offset: 12 },
    })
    const rotated = datum({
      ...originParameters,
      rotation: { axis: "x", angle: createAngleQuantity(30, "deg") },
    })
    expect(rotated.type.schemaVersion).toBe(2)
    expect(types.validateFeature(rotated)).toMatchObject({ ok: true })
    expect(types.validateFeature({ ...rotated, type: datumPlaneFeatureTypeV1.type })).toMatchObject(
      {
        ok: false,
        diagnostic: { code: "invalid-feature-parameters" },
      },
    )
    expect(
      readDatumPlaneFeatureParameters({ ...rotated, type: datumPlaneFeatureTypeV1.type }),
    ).toBeNull()
    expect(datumPlaneParametersV1Schema.safeParse(rotated.parameters).success).toBe(false)
    expect(contentIdentity(datum(originParameters))).not.toEqual(contentIdentity(legacy))
    const oldTypes = registry(true)
    expect(oldTypes.validateFeature(rotated)).toMatchObject({
      ok: false,
      diagnostic: { code: "feature-type-unavailable" },
    })
    expect(oldTypes.resolveFeatureParameters(rotated, new Map())).toEqual({
      ok: true,
      feature: rotated,
    })
  })

  it.each([datumPlaneFeatureTypeV1, datumPlaneFeatureType])(
    "retains dependency and semantic-input projection for datum version $type.schemaVersion",
    (descriptor) => {
      const feature = { ...datum(originParameters), type: descriptor.type }
      expect(projectFirstPartyFeatureSemanticInputs(feature)).toEqual({
        recognized: true,
        ok: true,
        inputs: [],
      })
      const snapshot = documentSnapshotSchema.parse({
        schemaVersion: 0,
        id: "0195b5ac-b213-7f2c-9c33-67a36a7f21ac",
        revision: 1,
        name: "Datum versions",
        sketches: [],
        features: [feature],
        createdAt: "2026-08-20T00:00:00.000Z",
        updatedAt: "2026-08-20T00:00:00.000Z",
      })
      expect(createDocumentDependencyGraphFromSnapshot(snapshot)).toMatchObject({
        ok: true,
        graph: { dependencyModelIssues: [] },
      })
    },
  )

  it.each([
    { schemaVersion: 0 },
    { schemaVersion: 3 },
    { moduleVersion: "0.2.0" },
    { moduleId: moduleIdSchema.parse("org.example.reference-geometry") },
    { typeId: "org.example.datum-plane" },
  ])("rejects unknown datum type revisions %j", (type) => {
    expect(
      readDatumPlaneFeatureParameters({
        ...datum(originParameters),
        type: { ...datumPlaneFeatureType.type, ...type },
      }),
    ).toBeNull()
  })

  it("upgrades a legacy datum only through an explicit update and restores v1 through Undo", () => {
    const id = (n: number) => `0195b5ac-b250-7a2c-8c33-${String(n).padStart(12, "0")}`
    const actor = { type: "user", userId: null }
    const issuedAt = "2026-10-19T00:00:00Z"
    const events: VersionedDocumentEvent[] = []
    let snapshot: DocumentSnapshotV1 | null = null
    const apply = (kind: string, payload: unknown) => {
      const result = applyVersionedDocumentCommand(snapshot, {
        schemaVersion: 1,
        commandId: id(10 + events.length),
        documentId: id(1),
        baseRevision: snapshot?.revision ?? 0,
        kind,
        issuedAt,
        actor,
        payload,
      })
      if (!result.ok) throw new Error(result.diagnostic.message)
      snapshot = result.snapshot
      events.push(result.event)
      return result.snapshot
    }
    apply("org.vibeshape.document.create", { name: "Legacy datum" })
    const legacy = { ...datum(originParameters), type: datumPlaneFeatureTypeV1.type }
    const before = apply("org.vibeshape.history.insert-feature", {
      feature: legacy,
      historyAfter: null,
    })
    expect(before.features[0]?.type).toEqual(datumPlaneFeatureTypeV1.type)
    const after = apply("org.vibeshape.feature.update", {
      feature: {
        ...legacy,
        type: datumPlaneFeatureType.type,
        parameters: {
          ...originParameters,
          rotation: { axis: "x", angle: createAngleQuantity(30, "deg") },
        },
      },
    })
    expect(after.features[0]).toMatchObject({ id: legacy.id, type: datumPlaneFeatureType.type })
    expect(before.features[0]?.type).toEqual(datumPlaneFeatureTypeV1.type)
    const restore = documentRestoredEventSchema.parse({
      type: "org.vibeshape.document.restored",
      schemaVersion: 1,
      direction: "undo",
      commandId: id(30),
      transactionId: null,
      documentId: id(1),
      baseRevision: after.revision,
      revision: after.revision + 1,
      targetRevision: before.revision,
      issuedAt,
      actor,
    })
    const restored = reduceVersionedDocumentEvent(after, restore, before)
    expect(restored).toMatchObject({ ok: true, snapshot: { features: before.features } })
    expect(replayVersionedDocumentEvents([...events, restore])).toEqual(restored)
  })

  it("preserves latest offset-only records and canonical content for absent and zero rotation", () => {
    expect(datumPlaneParametersSchema.parse(originParameters)).toEqual(originParameters)
    const legacy = datum(originParameters)
    const resolved = registry().resolveFeatureParameters(legacy, new Map())
    expect(resolved).toEqual({ ok: true, feature: legacy })
    expect(registry().validateFeature(legacy)).toMatchObject({
      ok: true,
      contentParameters: { mode: "offset", support: originParameters.support, offset: 12 },
    })
    for (const axis of ["x", "y"]) {
      expect(
        contentIdentity(
          datum({ ...originParameters, rotation: { axis, angle: createAngleQuantity(0) } }),
        ),
      ).toEqual(contentIdentity(legacy))
    }
  })

  it.each([-360, -90, 0, 90, 360])("accepts a signed rotation of %s degrees", (degrees) => {
    expect(
      registry().validateFeature(
        datum({
          ...originParameters,
          rotation: { axis: "y", angle: createAngleQuantity(degrees, "deg") },
        }),
      ),
    ).toMatchObject({ ok: true })
  })

  it.each([
    { axis: "z", angle: createAngleQuantity(1) },
    { axis: "x" },
    { axis: "x", angle: createLengthQuantity(1) },
    { axis: "x", angle: createAngleQuantity(361, "deg") },
    { axis: "y", angle: createAngleQuantity(-361, "deg") },
    { axis: "x", angle: { ...createAngleQuantity(1), value: Number.POSITIVE_INFINITY } },
    { axis: "x", angle: createAngleQuantity(1), pivot: [0, 0, 0] },
  ])("rejects invalid rotation intent %j", (rotation) => {
    expect(datumPlaneParametersSchema.safeParse({ ...originParameters, rotation }).success).toBe(
      false,
    )
  })

  it("resolves variable angles before range validation and fingerprints only the resolved axis and angle", () => {
    const feature = datum({
      ...originParameters,
      rotation: { axis: "x", angle: createAngleQuantity(400, "deg", "#tilt") },
    })
    const resolve = (expression: string) => {
      const result = registry().resolveFeatureParameters(feature, angleVariables(expression))
      if (!result.ok) throw new Error(result.diagnostic.message)
      return result.feature
    }
    const first = resolve("90 deg")
    expect(first.parameters).toMatchObject({
      rotation: { axis: "x", angle: { value: Math.PI / 2, source: { expression: "#tilt" } } },
    })
    expect(contentIdentity(first)).toEqual(
      contentIdentity(
        datum({
          ...originParameters,
          rotation: { axis: "x", angle: createAngleQuantity(Math.PI / 2) },
        }),
      ),
    )
    expect(contentIdentity(resolve("-90 deg"))).not.toEqual(contentIdentity(first))
    const zero = resolve("0 deg")
    expect(zero.parameters).toMatchObject({
      rotation: { axis: "x", angle: { value: 0, source: { expression: "#tilt" } } },
    })
    expect(contentIdentity(zero)).toEqual(contentIdentity(datum(originParameters)))
    expect(
      contentIdentity(
        datum({
          ...originParameters,
          rotation: { axis: "y", angle: createAngleQuantity(90, "deg") },
        }),
      ),
    ).not.toEqual(contentIdentity(first))
    expect(registry().resolveFeatureParameters(feature, angleVariables("361 deg"))).toMatchObject({
      ok: false,
      diagnostic: {
        reason: "invalid-rotation-angle",
        issues: [{ path: "parameters.rotation.angle" }],
      },
    })
    expect(registry().resolveFeatureParameters(feature, angleVariables("2 mm"))).toMatchObject({
      ok: false,
      diagnostic: {
        reason: "expression-dimension-mismatch",
        issues: [{ path: "parameters.rotation.angle" }],
      },
    })
    expect(registry().resolveFeatureParameters(feature, new Map())).toMatchObject({
      ok: false,
      diagnostic: { issues: [{ path: "parameters.rotation.angle" }] },
    })
  })

  it("accepts a signed origin-plane offset without a feature dependency", () => {
    const feature = datum({
      mode: "offset",
      support: { kind: "origin-plane", plane: "xy" },
      offset: createLengthQuantity(-12),
    })

    expect(registry().validateFeature(feature)).toMatchObject({ ok: true })
  })

  it("requires a face support reference and its exact owning dependency", () => {
    const reference = planarReference()
    const parameters = {
      mode: "offset",
      support: { kind: "feature-face", reference },
      offset: createLengthQuantity(8),
    }
    const valid = datum(parameters, [supportFeatureId], [reference])
    const invalid = datum(parameters, [], [])

    expect(registry().validateFeature(valid)).toMatchObject({ ok: true })
    expect(registry().validateFeature(invalid)).toMatchObject({
      ok: false,
      diagnostic: { issues: [{ path: "dependencies" }] },
    })
  })
})
