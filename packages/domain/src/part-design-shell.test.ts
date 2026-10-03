import { describe, expect, it } from "vitest"
import {
  createFeatureContentIdentity,
  type FeatureContentEnvironment,
} from "./feature-content-identity"
import { featureBodyDependencies } from "./feature-dependencies"
import { featureRecordSchema } from "./feature-graph"
import { createFeatureTypeRegistry } from "./feature-type-registry"
import {
  createModuleRegistry,
  documentCoreModule,
  featureCoreModule,
  partDesignModule,
} from "./modules"
import { partDesignFeatureTypeHandlers } from "./part-design"
import {
  readShellFeatureParameters,
  shellFeatureParametersSchema,
  shellFeatureType,
} from "./part-design-shell"
import { createLengthQuantity } from "./units"

const sourceId = "0195b5ac-b220-7a2c-8c33-67a36a7f7801"
const shellId = "0195b5ac-b220-7a2c-8c33-67a36a7f7802"
const opening = {
  schemaVersion: 1,
  featureId: sourceId,
  outputRole: "body.primary",
  kind: "face",
  semanticRole: "box.top",
  signature: {
    kind: "face",
    geometryClass: "plane",
    measure: 600,
    centroid: [0, 0, 40],
    bounds: { min: [-10, -15, 40], max: [10, 15, 40] },
    boundaryCount: 4,
    adjacentGeometryClasses: ["plane"],
  },
}
const parameters = {
  targetBody: { schemaVersion: 0, featureId: sourceId, outputRole: "body.primary" },
  thickness: createLengthQuantity(1),
  direction: "inward",
  sourceContentHash: "a".repeat(64),
  openings: [opening],
}
const feature = featureRecordSchema.parse({
  schemaVersion: 0,
  id: shellId,
  type: shellFeatureType.type,
  parameters,
  dependencies: [sourceId],
  references: [],
  suppressed: false,
})
const modules = createModuleRegistry([documentCoreModule, featureCoreModule, partDesignModule])
if (!modules.ok) throw new Error(modules.diagnostic.message)
const registered = createFeatureTypeRegistry(modules.registry, partDesignFeatureTypeHandlers)
if (!registered.ok) throw new Error(registered.diagnostic.message)
const registry = registered.registry
const environment: FeatureContentEnvironment = {
  schemaVersion: 0,
  hostApiVersion: "0.1.0",
  modelingTolerancePolicyVersion: 1,
  provider: { kind: "built-in" },
  geometry: {
    adapterId: "org.vibeshape.geometry.replicad",
    adapterVersion: "test",
    kernelId: "org.opencascade.occt",
    kernelVersion: "7.8.1",
    kernelSourceRevision: null,
  },
}
describe("persisted exact-body shell openings", () => {
  it("registers one exact body input and canonical v1 opening content without document UUIDs", () => {
    expect(registry.validateFeature(feature)).toMatchObject({
      ok: true,
      contentParameters: {
        thickness: 1,
        direction: "inward",
        sourceContentHash: parameters.sourceContentHash,
        openings: [{ schemaVersion: 1, outputRole: "body.primary", semanticRole: "box.top" }],
      },
    })
    expect(featureBodyDependencies(feature)).toEqual([
      { featureId: sourceId, outputRole: "body.primary" },
    ])
    expect(readShellFeatureParameters(feature)?.openings[0]?.featureId).toBe(sourceId)
    const dependency = {
      featureId: sourceId,
      contentHash: parameters.sourceContentHash,
      outputRole: "body.primary",
    }
    const original = createFeatureContentIdentity(registry, {
      feature,
      environment,
      dependencies: [dependency],
    })
    expect(original).toMatchObject({
      ok: true,
      identity: { schemaVersion: 1, feature: { inputRoles: ["body.primary"] } },
    })
    const remapped = {
      ...feature,
      id: sourceId,
      dependencies: [feature.id],
      parameters: {
        ...parameters,
        targetBody: { ...parameters.targetBody, featureId: feature.id },
        openings: [{ ...opening, featureId: feature.id }],
      },
    }
    expect(
      createFeatureContentIdentity(registry, {
        feature: remapped,
        environment,
        dependencies: [{ ...dependency, featureId: feature.id }],
      }),
    ).toEqual(original)
    expect(
      createFeatureContentIdentity(registry, {
        feature,
        environment,
        dependencies: [{ ...dependency, outputRole: "body.other" }],
      }).ok,
    ).toBe(false)
  })
  it.each([
    { thickness: createLengthQuantity(0) },
    { thickness: createLengthQuantity(-1) },
    { thickness: createLengthQuantity(100001) },
    { direction: "automatic" },
    { sourceContentHash: "unknown" },
    { openings: [] },
    { openings: [opening, opening] },
    { openings: [{ ...opening, kind: "edge" }] },
    { openings: [{ ...opening, outputRole: "body.other" }] },
    { openings: [{ ...opening, featureId: shellId }] },
    { openings: [{ ...opening, candidateId: "face:1" }] },
  ])("rejects unsafe or unbound opening intent %j", (changes) => {
    expect(shellFeatureParametersSchema.safeParse({ ...parameters, ...changes }).success).toBe(
      false,
    )
  })
  it("requires a sole matching dependency and exact registered version", () => {
    expect(registry.validateFeature({ ...feature, dependencies: [shellId] }).ok).toBe(false)
    expect(registry.validateFeature({ ...feature, dependencies: [sourceId, shellId] }).ok).toBe(
      false,
    )
    expect(
      readShellFeatureParameters({ ...feature, type: { ...feature.type, schemaVersion: 2 } }),
    ).toBeNull()
  })
})
