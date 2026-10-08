import { describe, expect, it } from "bun:test"
import { createDocumentDependencyGraph } from "./document-graph"
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
import { boxFeatureType, partDesignFeatureTypeHandlers } from "./part-design"
import {
  mirrorFeatureParametersSchema,
  mirrorFeatureParametersV2Schema,
  mirrorFeatureType,
  mirrorFeatureTypeHandlerV2,
  mirrorFeatureTypeV2,
  readMirrorFeatureParameters,
} from "./part-design-mirror"
import { createAngleQuantity, createLengthQuantity } from "./units"
import type { ExpressionValue } from "./variables"

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
    expect(featureBodyDependencies(feature)).toEqual<unknown>([
      { featureId: sourceId, outputRole: "body.primary" },
    ])
    expect(readMirrorFeatureParameters(feature)?.targetBody.outputRole).toBe("body.primary")
    expect(
      readMirrorFeatureParameters({ ...feature, type: { ...feature.type, schemaVersion: 3 } }),
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
      registry.validateFeature({ ...feature, type: { ...feature.type, schemaVersion: 3 } }).ok,
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

describe("offset and preserve-source Mirror v2", () => {
  const enhanced = { ...parameters, offset: createLengthQuantity(-2, "cm"), preserveSource: true }
  const copy = { ...feature, type: mirrorFeatureTypeV2.type, parameters: enhanced }
  it("dispatches strictly by feature version and projects canonical signed millimeters", () => {
    expect(registry.validateFeature(copy)).toMatchObject({
      ok: true,
      contentParameters: { plane: "YZ", offset: -20, preserveSource: true },
    })
    expect(readMirrorFeatureParameters(copy)).toEqual<unknown>(enhanced)
    expect(registry.validateFeature({ ...copy, parameters }).ok).toBe(false)
    expect(registry.validateFeature({ ...feature, parameters: enhanced }).ok).toBe(false)
    expect(registry.validateFeature({ ...copy, dependencies: [mirrorId] }).ok).toBe(false)
    expect(registry.validateFeature({ ...copy, dependencies: [sourceId, mirrorId] }).ok).toBe(false)
    expect(featureBodyDependencies(copy)).toEqual<unknown>([
      { featureId: sourceId, outputRole: "body.primary" },
    ])
  })
  it("registers v2 in the complete dependency graph used for legacy-record reviews", () => {
    const source = {
      ...feature,
      id: sourceId,
      type: boxFeatureType.type,
      parameters: {
        width: createLengthQuantity(20),
        depth: createLengthQuantity(30),
        height: createLengthQuantity(40),
        centered: false,
      },
      dependencies: [],
    }
    expect(
      createDocumentDependencyGraph({
        sketches: [],
        features: [source, copy],
        history: [
          { kind: "feature", id: sourceId },
          { kind: "feature", id: mirrorId },
        ],
      }),
    ).toMatchObject({
      ok: true,
      graph: {
        dependencyModelIssues: [],
        edges: [
          {
            relation: "feature-dependency",
            source: { kind: "feature", id: sourceId },
            target: { kind: "feature", id: mirrorId },
          },
        ],
      },
    })
  })
  it.each([
    { offset: createLengthQuantity(100_001) },
    { offset: createLengthQuantity(-100_001) },
    { offset: createAngleQuantity(1) },
    { offset: { ...createLengthQuantity(0), value: Number.NaN } },
    { preserveSource: "true" },
    { matrix: [] },
  ])("rejects malformed or unbounded enhanced intent %j", (changes) => {
    expect(mirrorFeatureParametersV2Schema.safeParse({ ...enhanced, ...changes }).success).toBe(
      false,
    )
  })
  it("resolves offset expressions and fails closed for wrong dimensions, missing variables and overflow", () => {
    const expressionParameters = { ...enhanced, offset: createLengthQuantity(0, "mm", "#offset") }
    const resolve = mirrorFeatureTypeHandlerV2.resolveParameters
    if (!resolve) throw new Error("Mirror v2 must resolve authored offset expressions.")
    const variables = new Map<string, ExpressionValue>([
      ["offset", { dimension: "length", value: -25.4 }],
    ])
    expect(resolve(expressionParameters, variables)).toMatchObject({
      ok: true,
      parameters: { offset: { value: -25.4 } },
    })
    for (const values of [
      new Map(),
      new Map([["offset", { dimension: "angle", value: 1 } as ExpressionValue]]),
      new Map([["offset", { dimension: "length", value: 100_001 } as ExpressionValue]]),
    ])
      expect(resolve(expressionParameters, values)).toMatchObject({ ok: false })
  })
  it("binds exact roles and source hashes while distinguishing offset and preservation intent", () => {
    const input = {
      feature: copy,
      environment,
      dependencies: [
        { featureId: sourceId, contentHash: "a".repeat(64), outputRole: "body.primary" },
      ],
    }
    const identity = createFeatureContentIdentity(registry, input)
    expect(identity).toMatchObject({
      ok: true,
      identity: {
        feature: {
          parameters: { plane: "YZ", offset: -20, preserveSource: true },
          inputRoles: ["body.primary"],
        },
      },
    })
    for (const parameters of [
      { ...enhanced, preserveSource: false },
      { ...enhanced, offset: createLengthQuantity(20) },
    ])
      expect(
        createFeatureContentIdentity(registry, { ...input, feature: { ...copy, parameters } }),
      ).not.toEqual(identity)
    expect(
      createFeatureContentIdentity(registry, {
        ...input,
        dependencies: [{ ...input.dependencies[0], outputRole: "body.sibling" }],
      }).ok,
    ).toBe(false)
    const remapped = {
      ...copy,
      id: sourceId,
      dependencies: [mirrorId],
      parameters: { ...enhanced, targetBody: { ...enhanced.targetBody, featureId: mirrorId } },
    }
    expect(
      createFeatureContentIdentity(registry, {
        ...input,
        feature: remapped,
        dependencies: [{ ...input.dependencies[0], featureId: mirrorId }],
      }),
    ).toEqual(identity)
  })
})
