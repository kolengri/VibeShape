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
  placementFeatureParametersSchema,
  placementFeatureType,
  placementFeatureTypeHandler,
  readPlacementFeatureParameters,
} from "./part-design-placement"
import { createAngleQuantity, createLengthQuantity } from "./units"
import type { ExpressionValue } from "./variables"

const sourceId = "0195b5ac-b220-7a2c-8c33-67a36a7f7101"
const placementId = "0195b5ac-b220-7a2c-8c33-67a36a7f7102"
function parameters() {
  return {
    targetBody: { schemaVersion: 0, featureId: sourceId, outputRole: "result" },
    translation: {
      x: createLengthQuantity(-4),
      y: createLengthQuantity(2, "cm"),
      z: createLengthQuantity(0),
    },
    rotation: {
      x: createAngleQuantity(90, "deg"),
      y: createAngleQuantity(0),
      z: createAngleQuantity(-Math.PI),
    },
  }
}
function feature() {
  return featureRecordSchema.parse({
    schemaVersion: 0,
    id: placementId,
    type: placementFeatureType.type,
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

describe("trusted exact-body placement", () => {
  it("registers one body dependency, projects canonical mm/radians, and preserves named roles", () => {
    const validated = registry().validateFeature(feature())
    expect(validated.ok).toBe(true)
    if (!validated.ok) throw new Error(validated.diagnostic.message)
    expect(validated.contentParameters).toEqual({
      translation: [-4, 20, 0],
      rotation: [Math.PI / 2, 0, -Math.PI],
    })
    expect(featureBodyDependencies(feature())).toEqual([
      { featureId: sourceId, outputRole: "result" },
    ])
    expect(readPlacementFeatureParameters(feature())?.targetBody.outputRole).toBe("result")
    expect(
      readPlacementFeatureParameters({
        ...feature(),
        type: { ...placementFeatureType.type, schemaVersion: 2 },
      }),
    ).toBeNull()
  })

  it.each([
    { translation: { ...parameters().translation, x: createLengthQuantity(100_001) } },
    { rotation: { ...parameters().rotation, x: createAngleQuantity(361, "deg") } },
    { rotation: { ...parameters().rotation, y: createLengthQuantity(1) } },
    { matrix: [1, 0, 0, 0] },
    { scale: 2 },
    { targetBody: { ...parameters().targetBody, outputRole: "Unknown" } },
    {
      translation: {
        ...parameters().translation,
        x: { ...createLengthQuantity(0), value: Number.NaN },
      },
    },
  ])("rejects unsupported authored intent %j", (changes) => {
    expect(
      placementFeatureParametersSchema.safeParse({ ...parameters(), ...changes }).success,
    ).toBe(false)
  })

  it("rejects a substituted target, surplus dependency, and an unregistered type", () => {
    const value = feature()
    expect(registry().validateFeature({ ...value, dependencies: [placementId] }).ok).toBe(false)
    expect(registry().validateFeature({ ...value, dependencies: [sourceId, placementId] }).ok).toBe(
      false,
    )
    expect(
      registry().validateFeature({ ...value, type: { ...value.type, schemaVersion: 2 } }),
    ).toMatchObject({ ok: false, diagnostic: { code: "feature-type-unavailable" } })
  })

  it("resolves dimensional expressions and rejects wrong dimensions, missing variables, and resolved overflow", () => {
    const value = parameters()
    value.translation.x = createLengthQuantity(0, "mm", "#offset")
    value.rotation.z = createAngleQuantity(0, "deg", "#turn")
    const variables = new Map<string, ExpressionValue>([
      ["offset", { dimension: "length" as const, value: 25 }],
      ["turn", { dimension: "angle" as const, value: Math.PI / 2 }],
    ])
    const resolved = placementFeatureTypeHandler.resolveParameters?.(value, variables)
    expect(resolved).toMatchObject({
      ok: true,
      parameters: { translation: { x: { value: 25 } }, rotation: { z: { value: Math.PI / 2 } } },
    })
    expect(placementFeatureTypeHandler.resolveParameters?.(value, new Map())).toMatchObject({
      ok: false,
    })
    expect(
      placementFeatureTypeHandler.resolveParameters?.(
        value,
        new Map([["offset", { dimension: "angle", value: 1 }]]),
      ),
    ).toMatchObject({ ok: false, diagnostic: { code: "expression-dimension-mismatch" } })
    expect(
      placementFeatureTypeHandler.resolveParameters?.(
        value,
        new Map([["offset", { dimension: "length", value: 100_001 }]]),
      ),
    ).toMatchObject({ ok: false, diagnostic: { code: "invalid-placement-bound" } })
  })

  it("fails closed when canonical dependency content drops or substitutes the authored body role", () => {
    const types = registry()
    const dependency = { featureId: sourceId, contentHash: "a".repeat(64), outputRole: "result" }
    const input = { feature: feature(), environment, dependencies: [dependency] }
    const valid = createFeatureContentIdentity(types, input)
    expect(valid).toMatchObject({
      ok: true,
      identity: { schemaVersion: 1, feature: { inputRoles: ["result"] } },
    })
    const { outputRole: _role, ...unnamed } = dependency
    expect(createFeatureContentIdentity(types, { ...input, dependencies: [unnamed] }).ok).toBe(
      false,
    )
    expect(
      createFeatureContentIdentity(types, {
        ...input,
        dependencies: [{ ...dependency, outputRole: "body.other" }],
      }).ok,
    ).toBe(false)
    const renamed = {
      ...feature(),
      id: sourceId,
      dependencies: [placementId],
      parameters: {
        ...parameters(),
        targetBody: { ...parameters().targetBody, featureId: placementId },
      },
    }
    expect(
      createFeatureContentIdentity(types, {
        ...input,
        feature: renamed,
        dependencies: [{ ...dependency, featureId: placementId }],
      }),
    ).toEqual(valid)
  })
})
