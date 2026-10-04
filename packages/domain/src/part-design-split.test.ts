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
  readSplitFeatureParameters,
  splitFeatureParametersSchema,
  splitFeatureType,
  splitFeatureTypeHandler,
} from "./part-design-split"
import { createAngleQuantity, createLengthQuantity } from "./units"

const sourceId = "0195b5ac-b220-7a2c-8c33-67a36a7f7101"
const splitId = "0195b5ac-b220-7a2c-8c33-67a36a7f7102"
function parameters() {
  return {
    targetBody: { schemaVersion: 0, featureId: sourceId, outputRole: "body.primary" },
    plane: "XZ" as const,
    offset: createLengthQuantity(-2, "cm"),
  }
}
function feature() {
  return featureRecordSchema.parse({
    schemaVersion: 0,
    id: splitId,
    type: splitFeatureType.type,
    parameters: parameters(),
    dependencies: [sourceId],
    references: [],
    suppressed: false,
  })
}
function registry() {
  const modules = createModuleRegistry([documentCoreModule, featureCoreModule, partDesignModule])
  if (!modules.ok) throw new Error(modules.diagnostic.message)
  const types = createFeatureTypeRegistry(modules.registry, partDesignFeatureTypeHandlers)
  if (!types.ok) throw new Error(types.diagnostic.message)
  return types.registry
}
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

describe("trusted exact-body plane split", () => {
  it("registers one exact role dependency and canonical signed millimeters", () => {
    const validated = registry().validateFeature(feature())
    expect(validated).toMatchObject({ ok: true, contentParameters: { plane: "XZ", offset: -20 } })
    expect(featureBodyDependencies(feature())).toEqual([
      { featureId: sourceId, outputRole: "body.primary" },
    ])
    expect(readSplitFeatureParameters(feature())).toEqual(parameters())
    expect(
      readSplitFeatureParameters({
        ...feature(),
        type: { ...splitFeatureType.type, schemaVersion: 2 },
      }),
    ).toBeNull()
  })

  it.each([-100_000, 0, 100_000])("accepts the bounded signed offset %s", (offset) => {
    expect(
      splitFeatureParametersSchema.safeParse({
        ...parameters(),
        offset: createLengthQuantity(offset),
      }).success,
    ).toBe(true)
  })

  it.each([
    { plane: "arbitrary" },
    { offset: createLengthQuantity(100_001) },
    { offset: createLengthQuantity(-100_001) },
    { offset: createAngleQuantity(1) },
    { offset: { ...createLengthQuantity(0), value: Number.NaN } },
    { offset: { ...createLengthQuantity(0), value: Number.POSITIVE_INFINITY } },
    { targetBody: { ...parameters().targetBody, outputRole: "Unknown" } },
    { pieces: [1, 2] },
  ])("rejects malformed or unsupported intent %j", (changes) => {
    expect(splitFeatureParametersSchema.safeParse({ ...parameters(), ...changes }).success).toBe(
      false,
    )
  })

  it("rejects substituted dependencies, additional references, and unavailable versions", () => {
    const types = registry()
    expect(types.validateFeature({ ...feature(), dependencies: [splitId] }).ok).toBe(false)
    expect(types.validateFeature({ ...feature(), dependencies: [sourceId, splitId] }).ok).toBe(
      false,
    )
    expect(types.validateFeature({ ...feature(), dependencies: [] }).ok).toBe(false)
    expect(types.validateFeature({ ...feature(), references: [splitId] }).ok).toBe(false)
    expect(
      types.validateFeature({ ...feature(), type: { ...splitFeatureType.type, schemaVersion: 3 } }),
    ).toMatchObject({ ok: false, diagnostic: { code: "feature-type-unavailable" } })
  })

  it("resolves length expressions without removing authored expression provenance", () => {
    const value = { ...parameters(), offset: createLengthQuantity(0, "mm", "#offset") }
    expect(
      splitFeatureTypeHandler.resolveParameters?.(
        value,
        new Map([["offset", { dimension: "length", value: -25 }]]),
      ),
    ).toMatchObject({
      ok: true,
      parameters: { offset: { value: -25, source: { expression: "#offset" } } },
    })
    expect(value.offset.source.expression).toBe("#offset")
  })

  it.each([
    { variables: new Map(), code: "unknown-variable" },
    {
      variables: new Map([["offset", { dimension: "angle" as const, value: 1 }]]),
      code: "expression-dimension-mismatch",
    },
    {
      variables: new Map([["offset", { dimension: "length" as const, value: 100_001 }]]),
      code: "invalid-split-offset",
    },
    {
      variables: new Map([["offset", { dimension: "length" as const, value: -100_001 }]]),
      code: "invalid-split-offset",
    },
  ])("rejects invalid resolved offsets with $code", ({ variables, code }) => {
    const value = { ...parameters(), offset: createLengthQuantity(0, "mm", "#offset") }
    expect(splitFeatureTypeHandler.resolveParameters?.(value, variables)).toMatchObject({
      ok: false,
      diagnostic: { code, issues: [{ path: "offset" }] },
    })
  })

  it("uses exact input role and content while excluding document UUIDs from canonical identity", () => {
    const types = registry()
    const dependency = {
      featureId: sourceId,
      contentHash: "a".repeat(64),
      outputRole: "body.primary",
    }
    const input = { feature: feature(), environment, dependencies: [dependency] }
    const valid = createFeatureContentIdentity(types, input)
    expect(valid).toMatchObject({
      ok: true,
      identity: { schemaVersion: 1, feature: { inputRoles: ["body.primary"] } },
    })
    const renamed = {
      ...feature(),
      id: sourceId,
      dependencies: [splitId],
      parameters: {
        ...parameters(),
        targetBody: { ...parameters().targetBody, featureId: splitId },
      },
    }
    expect(
      createFeatureContentIdentity(types, {
        ...input,
        feature: renamed,
        dependencies: [{ ...dependency, featureId: splitId }],
      }),
    ).toEqual(valid)
    const { outputRole: _role, ...unnamed } = dependency
    expect(createFeatureContentIdentity(types, { ...input, dependencies: [unnamed] }).ok).toBe(
      false,
    )
    expect(
      createFeatureContentIdentity(types, {
        ...input,
        dependencies: [{ ...dependency, outputRole: "body.sibling" }],
      }).ok,
    ).toBe(false)
    expect(
      createFeatureContentIdentity(types, {
        ...input,
        dependencies: [{ ...dependency, contentHash: "b".repeat(64) }],
      }),
    ).not.toEqual(valid)
    expect(
      createFeatureContentIdentity(types, {
        ...input,
        feature: { ...feature(), parameters: { ...parameters(), offset: createLengthQuantity(1) } },
      }),
    ).not.toEqual(valid)
  })
})
