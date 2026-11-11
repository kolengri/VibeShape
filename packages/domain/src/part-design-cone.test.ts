import { describe, expect, it } from "bun:test"
import {
  createFeatureContentIdentity,
  type FeatureContentEnvironment,
} from "./feature-content-identity"
import { type FeatureRecord, featureRecordSchema } from "./feature-graph"
import { createFeatureTypeRegistry } from "./feature-type-registry"
import {
  createModuleRegistry,
  documentCoreModule,
  featureCoreModule,
  partDesignModule,
} from "./modules"
import {
  authoredConeFeatureType,
  coneFeatureParametersV2Schema,
  coneFeatureType,
  coneFeatureTypeV2,
  partDesignFeatureTypeHandlers,
  readConeFeatureParameters,
} from "./part-design"
import { createLengthQuantity } from "./units"
import type { ExpressionValue } from "./variables"

const featureId = "0195b5ac-b220-7a2c-8c33-67a36a7f3101"
const environment: FeatureContentEnvironment = {
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
const origin = {
  x: createLengthQuantity(0),
  y: createLengthQuantity(0),
  z: createLengthQuantity(5),
}
const pointed = {
  radius: createLengthQuantity(10),
  height: createLengthQuantity(20),
  centered: false,
  origin,
}

function registry() {
  const modules = createModuleRegistry([documentCoreModule, featureCoreModule, partDesignModule])
  if (!modules.ok) throw new Error(modules.diagnostic.message)
  const types = createFeatureTypeRegistry(modules.registry, partDesignFeatureTypeHandlers)
  if (!types.ok) throw new Error(types.diagnostic.message)
  return types.registry
}

function cone(type: FeatureRecord["type"], parameters: Record<string, unknown>): FeatureRecord {
  return featureRecordSchema.parse({
    schemaVersion: 0,
    id: featureId,
    type,
    parameters,
    dependencies: [],
    references: [],
    suppressed: false,
  })
}

function contentPayload(feature: FeatureRecord) {
  const content = createFeatureContentIdentity(registry(), {
    feature,
    environment,
    dependencies: [],
  })
  if (!content.ok) throw new Error(content.diagnostic.message)
  return content
}

describe("truncated cone version 2", () => {
  it("keeps saved pointed cone records on the exact version 1 content", () => {
    const legacy = cone(coneFeatureType.type, pointed)
    expect(contentPayload(legacy).identity.feature).toMatchObject({
      type: coneFeatureType.type,
      parameters: { radius: 10, height: 20, centered: false, origin: [0, 0, 5] },
    })
    expect(contentPayload(legacy).identity.feature.parameters).not.toHaveProperty("topRadius")
    expect(readConeFeatureParameters(legacy)?.topRadius.value).toBe(0)
  })

  it.each([
    ["narrowing", 4],
    ["inverted", 16],
    ["pointed", 0],
  ])("validates a %s top radius and hashes it as version 2 content", (_name, topRadius) => {
    const frustum = cone(coneFeatureTypeV2.type, {
      ...pointed,
      topRadius: createLengthQuantity(topRadius),
    })
    expect(registry().validateFeature(frustum)).toMatchObject({
      ok: true,
      contentParameters: { radius: 10, topRadius, height: 20, centered: false, origin: [0, 0, 5] },
    })
    expect(readConeFeatureParameters(frustum)?.topRadius.value).toBe(topRadius)
  })

  it("rejects equal, negative, sub-minimum, unbounded and workspace-escaping top radii", () => {
    for (const value of [10, -1, 0.0005, 1_000_001]) {
      expect(
        coneFeatureParametersV2Schema.safeParse({
          ...pointed,
          topRadius: createLengthQuantity(value),
        }).success,
      ).toBe(false)
    }
    // A wider top must also fit the workspace, not only the base radius.
    expect(
      coneFeatureParametersV2Schema.safeParse({
        ...pointed,
        topRadius: createLengthQuantity(99_999),
        origin: { ...origin, x: createLengthQuantity(10) },
      }).success,
    ).toBe(false)
    expect(
      registry().validateFeature(
        cone(coneFeatureType.type, { ...pointed, topRadius: createLengthQuantity(4) }),
      ).ok,
    ).toBe(false)
  })

  it("resolves top-radius expressions before hashing and rejects invalid resolutions", () => {
    const authored = cone(coneFeatureTypeV2.type, {
      ...pointed,
      topRadius: createLengthQuantity(4, "mm", "#top"),
    })
    const variables = new Map<string, ExpressionValue>([["top", { dimension: "length", value: 6 }]])
    const types = registry()
    const resolved = types.resolveFeatureParameters(authored, variables)
    if (!resolved.ok) throw new Error(resolved.diagnostic.message)
    expect(contentPayload(resolved.feature).identity.feature.parameters).toMatchObject({
      topRadius: 6,
    })
    for (const value of [10, -2]) {
      expect(
        types.resolveFeatureParameters(
          authored,
          new Map([["top", { dimension: "length" as const, value }]]),
        ),
      ).toMatchObject({ ok: false })
    }
    expect(types.resolveFeatureParameters(authored, new Map())).toMatchObject({ ok: false })
  })

  it("routes authoring versions without silently migrating saved records", () => {
    const literal = (expression: string | null, value = 0) =>
      createLengthQuantity(value, "mm", expression)
    expect(authoredConeFeatureType(null, undefined)).toEqual(coneFeatureType.type)
    for (const expression of [null, "0", "0 mm", "0.000 in", "-0mm"])
      expect(authoredConeFeatureType(null, literal(expression))).toEqual(coneFeatureType.type)
    expect(authoredConeFeatureType(null, literal("#top"))).toEqual(coneFeatureTypeV2.type)
    expect(authoredConeFeatureType(null, literal("4 mm", 4))).toEqual(coneFeatureTypeV2.type)
    expect(authoredConeFeatureType(coneFeatureTypeV2.type, literal("0 mm"))).toEqual(
      coneFeatureTypeV2.type,
    )
    expect(authoredConeFeatureType(coneFeatureType.type, literal("0 mm"))).toEqual(
      coneFeatureType.type,
    )
  })
})
