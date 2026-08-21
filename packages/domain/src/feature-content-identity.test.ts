import { describe, expect, it, vi } from "vitest"
import { z } from "zod"
import {
  computeFeatureContentHash,
  createFeatureContentIdentity,
  type FeatureContentEnvironment,
} from "./feature-content-identity"
import { type FeatureRecord, featureRecordSchema } from "./feature-graph"
import { featureTypeDescriptorSchema } from "./feature-type-contracts"
import { createFeatureTypeRegistry, type FeatureTypeRegistry } from "./feature-type-registry"
import {
  createModuleRegistry,
  documentCoreModule,
  featureCoreModule,
  partDesignModule,
} from "./modules"
import { booleanFeatureType, boxFeatureType, partDesignFeatureTypeHandlers } from "./part-design"
import { topoRefSchema } from "./topology"
import { createLengthQuantity } from "./units"

const featureIds = {
  a: "0195b5ac-b220-7a2c-8c33-67a36a7f3101",
  b: "0195b5ac-b220-7a2c-8c33-67a36a7f3102",
  c: "0195b5ac-b220-7a2c-8c33-67a36a7f3103",
  d: "0195b5ac-b220-7a2c-8c33-67a36a7f3104",
  e: "0195b5ac-b220-7a2c-8c33-67a36a7f3105",
  f: "0195b5ac-b220-7a2c-8c33-67a36a7f3106",
} as const

const environment: FeatureContentEnvironment = {
  schemaVersion: 0,
  hostApiVersion: "0.1.0",
  geometry: {
    adapterId: "org.vibeshape.geometry.replicad",
    adapterVersion: "0.1.0+test",
    kernelId: "org.opencascade.occt",
    kernelVersion: "7.8.1",
    kernelSourceRevision: "bb368e271e24f63078129283148ce83db6b9670a",
  },
  modelingTolerancePolicyVersion: 1,
  provider: { kind: "built-in" },
}

function requireRegistry(
  modules: readonly unknown[],
  handlers: Parameters<typeof createFeatureTypeRegistry>[1],
) {
  const registeredModules = createModuleRegistry(modules)
  if (!registeredModules.ok) throw new Error(registeredModules.diagnostic.message)
  const registeredTypes = createFeatureTypeRegistry(registeredModules.registry, handlers)
  if (!registeredTypes.ok) throw new Error(registeredTypes.diagnostic.message)
  return registeredTypes.registry
}

function partDesignRegistry() {
  return requireRegistry(
    [partDesignModule, featureCoreModule, documentCoreModule],
    partDesignFeatureTypeHandlers,
  )
}

function boxFeature(
  id: string,
  units: { width: [number, "mm" | "cm"]; height: [number, "mm" | "in"] },
  values: Partial<FeatureRecord> = {},
) {
  return featureRecordSchema.parse({
    schemaVersion: 0,
    id,
    type: boxFeatureType.type,
    parameters: {
      width: createLengthQuantity(...units.width),
      depth: createLengthQuantity(30),
      height: createLengthQuantity(...units.height),
      centered: true,
    },
    dependencies: [],
    references: [],
    suppressed: false,
    ...values,
  })
}

function booleanFeature(id: string, dependencies: [string, string]) {
  return featureRecordSchema.parse({
    schemaVersion: 0,
    id,
    type: booleanFeatureType.type,
    parameters: { operation: "subtract" },
    dependencies,
    references: [],
    suppressed: false,
  })
}

const dependentFeatureType = featureTypeDescriptorSchema.parse({
  schemaVersion: 0,
  type: {
    moduleId: "org.example.feature-kit",
    moduleVersion: "1.0.0",
    typeId: "org.example.feature.combine",
    schemaVersion: 1,
  },
  classification: "solid",
  dependencies: { min: 2, max: 2 },
  references: { min: 1, max: 1 },
})

function dependentRegistry() {
  const parametersSchema = z.object({ mode: z.enum(["union", "cut"]) }).strict()
  return requireRegistry(
    [
      {
        id: "org.example.feature-kit",
        version: "1.0.0",
        dependencies: [],
        commands: [],
        queries: [],
        featureTypes: [dependentFeatureType],
      },
    ],
    [
      {
        type: dependentFeatureType.type,
        parametersSchema,
        contentParameters: (parameters) => parametersSchema.parse(parameters),
      },
    ],
  )
}

function faceReference(featureId: string) {
  return topoRefSchema.parse({
    schemaVersion: 0,
    featureId,
    kind: "face",
    semanticRole: "primitive.cap.end",
    signature: {
      kind: "face",
      geometryClass: "plane",
      measure: 100,
      centroid: [0, 0, 10],
      bounds: { min: [-5, -5, 10], max: [5, 5, 10] },
      direction: [0, 0, 1],
      directionMode: "oriented",
      boundaryCount: 4,
      adjacentGeometryClasses: ["line", "line", "line", "line"],
    },
  })
}

function dependentFeature(id: string, dependencies: [string, string]) {
  return featureRecordSchema.parse({
    schemaVersion: 0,
    id,
    type: dependentFeatureType.type,
    parameters: { mode: "cut" },
    dependencies,
    references: [faceReference(dependencies[1])],
    suppressed: false,
  })
}

function identity(
  registry: FeatureTypeRegistry,
  feature: FeatureRecord,
  dependencies: readonly unknown[] = [],
) {
  return createFeatureContentIdentity(registry, { feature, dependencies, environment })
}

describe("feature content identity", () => {
  it("ignores record identity, labels, suppression, and equivalent source units", () => {
    const registry = partDesignRegistry()
    const first = identity(
      registry,
      boxFeature(featureIds.a, { width: [20, "mm"], height: [1, "in"] }, { label: "Box" }),
    )
    const equivalent = identity(
      registry,
      boxFeature(
        featureIds.b,
        { width: [2, "cm"], height: [25.4, "mm"] },
        { label: "Renamed", suppressed: true },
      ),
    )

    expect(first.ok).toBe(true)
    expect(equivalent.ok).toBe(true)
    if (!first.ok || !equivalent.ok) return
    expect(first.identity).toEqual(equivalent.identity)
    expect(first.canonicalPayload).toBe(equivalent.canonicalPayload)
    expect(first.identity.feature.parameters).toEqual({
      width: 20,
      depth: 30,
      height: 25.4,
      centered: true,
      origin: [0, 0, 0],
    })
  })

  it("orders input hashes by declared dependency slots and replaces reference UUIDs with slots", () => {
    const registry = dependentRegistry()
    const first = identity(registry, dependentFeature(featureIds.e, [featureIds.a, featureIds.b]), [
      { featureId: featureIds.b, contentHash: "b".repeat(64) },
      { featureId: featureIds.a, contentHash: "a".repeat(64) },
    ])
    const equivalent = identity(
      registry,
      dependentFeature(featureIds.f, [featureIds.c, featureIds.d]),
      [
        { featureId: featureIds.c, contentHash: "a".repeat(64) },
        { featureId: featureIds.d, contentHash: "b".repeat(64) },
      ],
    )

    expect(first.ok).toBe(true)
    expect(equivalent.ok).toBe(true)
    if (!first.ok || !equivalent.ok) return
    expect(first.identity).toEqual(equivalent.identity)
    expect(first.identity.feature.inputs).toEqual(["a".repeat(64), "b".repeat(64)])
    expect(first.identity.feature.references[0]).toMatchObject({ inputIndex: 1 })
    expect(first.canonicalPayload).not.toContain(featureIds.a)
    expect(first.canonicalPayload).not.toContain(featureIds.b)
  })

  it("creates first-party Boolean content from two ordered dependency hashes", () => {
    const result = identity(
      partDesignRegistry(),
      booleanFeature(featureIds.e, [featureIds.a, featureIds.b]),
      [
        { featureId: featureIds.b, contentHash: "b".repeat(64) },
        { featureId: featureIds.a, contentHash: "a".repeat(64) },
      ],
    )

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.identity.feature).toMatchObject({
      type: booleanFeatureType.type,
      parameters: { operation: "subtract" },
      inputs: ["a".repeat(64), "b".repeat(64)],
      references: [],
    })
  })

  it("changes identity for semantic parameters, input order, runtime, and extension integrity", () => {
    const registry = partDesignRegistry()
    const feature = boxFeature(featureIds.a, { width: [20, "mm"], height: [25.4, "mm"] })
    const baseline = identity(registry, feature)
    const changedParameter = identity(
      registry,
      boxFeature(featureIds.a, { width: [21, "mm"], height: [25.4, "mm"] }),
    )
    const changedPlacement = identity(
      registry,
      featureRecordSchema.parse({
        ...feature,
        parameters: {
          ...feature.parameters,
          origin: {
            x: createLengthQuantity(10),
            y: createLengthQuantity(0),
            z: createLengthQuantity(0),
          },
        },
      }),
    )
    const changedRuntime = createFeatureContentIdentity(registry, {
      feature,
      dependencies: [],
      environment: {
        ...environment,
        geometry: { ...environment.geometry, adapterVersion: "0.1.1" },
      },
    })
    const extensionRuntime = createFeatureContentIdentity(registry, {
      feature,
      dependencies: [],
      environment: {
        ...environment,
        provider: {
          kind: "extension",
          extensionId: "org.example.feature-pack",
          extensionVersion: "1.0.0",
          apiVersion: "0.1.0",
          integrity: "c".repeat(64),
        },
      },
    })

    expect(baseline.ok && changedParameter.ok && changedPlacement.ok).toBe(true)
    expect(baseline.ok && changedRuntime.ok).toBe(true)
    expect(baseline.ok && extensionRuntime.ok).toBe(true)
    if (
      !baseline.ok ||
      !changedParameter.ok ||
      !changedPlacement.ok ||
      !changedRuntime.ok ||
      !extensionRuntime.ok
    ) {
      return
    }
    expect(changedParameter.canonicalPayload).not.toBe(baseline.canonicalPayload)
    expect(changedPlacement.canonicalPayload).not.toBe(baseline.canonicalPayload)
    expect(changedRuntime.canonicalPayload).not.toBe(baseline.canonicalPayload)
    expect(extensionRuntime.canonicalPayload).not.toBe(baseline.canonicalPayload)
  })

  it("fails closed on incomplete, duplicate, extra, and invalid dependency content", () => {
    const registry = dependentRegistry()
    const feature = dependentFeature(featureIds.e, [featureIds.a, featureIds.b])

    expect(
      identity(registry, feature, [{ featureId: featureIds.a, contentHash: "a".repeat(64) }]),
    ).toMatchObject({ ok: false, diagnostic: { code: "missing-feature-dependency-content" } })
    expect(
      identity(registry, feature, [
        { featureId: featureIds.a, contentHash: "a".repeat(64) },
        { featureId: featureIds.a, contentHash: "b".repeat(64) },
      ]),
    ).toMatchObject({ ok: false, diagnostic: { code: "duplicate-feature-dependency-content" } })
    expect(
      identity(registry, feature, [
        { featureId: featureIds.a, contentHash: "a".repeat(64) },
        { featureId: featureIds.b, contentHash: "b".repeat(64) },
        { featureId: featureIds.c, contentHash: "c".repeat(64) },
      ]),
    ).toMatchObject({ ok: false, diagnostic: { code: "unexpected-feature-dependency-content" } })
    expect(
      identity(registry, feature, [
        { featureId: featureIds.a, contentHash: "invalid" },
        { featureId: featureIds.b, contentHash: "b".repeat(64) },
      ]),
    ).toMatchObject({ ok: false, diagnostic: { code: "invalid-feature-dependency-content" } })
  })

  it("rejects unavailable feature types and non-normalized runtime identity", () => {
    const registry = partDesignRegistry()
    const feature = boxFeature(featureIds.a, { width: [20, "mm"], height: [25.4, "mm"] })

    expect(
      createFeatureContentIdentity(registry, {
        feature: {
          ...feature,
          type: {
            moduleId: "org.example.features",
            moduleVersion: "1.0.0",
            typeId: "org.example.feature.unknown",
            schemaVersion: 1,
          },
        },
        dependencies: [],
        environment,
      }),
    ).toMatchObject({ ok: false, diagnostic: { code: "invalid-feature-content" } })
    expect(
      createFeatureContentIdentity(registry, {
        feature,
        dependencies: [],
        environment: {
          ...environment,
          geometry: { ...environment.geometry, adapterVersion: " 0.1.0" },
        },
      }),
    ).toMatchObject({
      ok: false,
      diagnostic: { code: "invalid-feature-content-environment" },
    })
  })

  it("validates the injected hash port and contains its failures", async () => {
    const registry = partDesignRegistry()
    const feature = boxFeature(featureIds.a, { width: [20, "mm"], height: [25.4, "mm"] })
    const hash = vi.fn(async () => "d".repeat(64))
    const result = await computeFeatureContentHash(
      registry,
      { feature, dependencies: [], environment },
      hash,
    )

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.contentHash).toBe("d".repeat(64))
      expect(hash).toHaveBeenCalledWith(result.canonicalPayload)
    }
    await expect(
      computeFeatureContentHash(registry, { feature, dependencies: [], environment }, () => {
        throw new Error("host detail")
      }),
    ).resolves.toMatchObject({
      ok: false,
      diagnostic: { code: "feature-content-hash-failed" },
    })
    await expect(
      computeFeatureContentHash(
        registry,
        { feature, dependencies: [], environment },
        () => "invalid",
      ),
    ).resolves.toMatchObject({
      ok: false,
      diagnostic: { code: "invalid-feature-content-hash" },
    })
  })
})
