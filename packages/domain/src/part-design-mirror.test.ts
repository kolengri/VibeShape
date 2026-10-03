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
  mirrorFeatureParametersSchema,
  mirrorFeatureType,
  readMirrorFeatureParameters,
} from "./part-design-mirror"

const sourceId = "0195b5ac-b220-7a2c-8c33-67a36a7f7801"
const mirrorId = "0195b5ac-b220-7a2c-8c33-67a36a7f7802"
const parameters = {
  targetBody: { schemaVersion: 0, featureId: sourceId, outputRole: "body.primary" },
  plane: "YZ",
}
const feature = featureRecordSchema.parse({
  schemaVersion: 0,
  id: mirrorId,
  type: mirrorFeatureType.type,
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
describe("trusted exact-body mirror", () => {
  it("registers one exact body dependency and only the origin plane as numeric content", () => {
    expect(registry.validateFeature(feature)).toMatchObject({
      ok: true,
      contentParameters: { plane: "YZ" },
    })
    expect(featureBodyDependencies(feature)).toEqual([
      { featureId: sourceId, outputRole: "body.primary" },
    ])
    expect(readMirrorFeatureParameters(feature)?.targetBody.outputRole).toBe("body.primary")
    expect(
      readMirrorFeatureParameters({ ...feature, type: { ...feature.type, schemaVersion: 2 } }),
    ).toBeNull()
  })
  it.each([
    { plane: "xy" },
    { plane: "custom" },
    { keepSource: true },
    { fuse: true },
    { matrix: [1] },
    { targetBody: { ...parameters.targetBody, outputRole: "Unknown" } },
  ])("rejects unsupported mirror intent %j", (changes) => {
    expect(mirrorFeatureParametersSchema.safeParse({ ...parameters, ...changes }).success).toBe(
      false,
    )
  })
  it("rejects substituted or additional dependencies and unregistered versions", () => {
    expect(registry.validateFeature({ ...feature, dependencies: [mirrorId] }).ok).toBe(false)
    expect(registry.validateFeature({ ...feature, dependencies: [sourceId, mirrorId] }).ok).toBe(
      false,
    )
    expect(
      registry.validateFeature({ ...feature, type: { ...feature.type, schemaVersion: 2 } }).ok,
    ).toBe(false)
  })
  it("binds source hash and role while excluding document-local feature UUIDs from identity", () => {
    const dependency = {
      featureId: sourceId,
      contentHash: "a".repeat(64),
      outputRole: "body.primary",
    }
    const input = { feature, environment, dependencies: [dependency] }
    const identity = createFeatureContentIdentity(registry, input)
    expect(identity).toMatchObject({
      ok: true,
      identity: {
        schemaVersion: 1,
        feature: { parameters: { plane: "YZ" }, inputRoles: ["body.primary"] },
      },
    })
    const { outputRole: _role, ...unnamed } = dependency
    expect(createFeatureContentIdentity(registry, { ...input, dependencies: [unnamed] }).ok).toBe(
      false,
    )
    expect(
      createFeatureContentIdentity(registry, {
        ...input,
        dependencies: [{ ...dependency, outputRole: "body.other" }],
      }).ok,
    ).toBe(false)
    expect(
      createFeatureContentIdentity(registry, {
        ...input,
        feature: {
          ...feature,
          id: sourceId,
          dependencies: [mirrorId],
          parameters: {
            ...parameters,
            targetBody: { ...parameters.targetBody, featureId: mirrorId },
          },
        },
        dependencies: [{ ...dependency, featureId: mirrorId }],
      }),
    ).toEqual(identity)
  })
})
