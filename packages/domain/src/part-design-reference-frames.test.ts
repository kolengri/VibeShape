import { describe, expect, it } from "vitest"
import { createDocumentDependencyGraph } from "./document-graph"
import { featureBodyDependencies, featureBodyDependencyIds } from "./feature-dependencies"
import { featureRecordSchema } from "./feature-graph"
import { createFeatureTypeRegistry } from "./feature-type-registry"
import { featureIdSchema } from "./identifiers"
import {
  createModuleRegistry,
  documentCoreModule,
  featureCoreModule,
  partDesignModule,
} from "./modules"
import { partDesignFeatureTypeHandlers } from "./part-design"
import {
  mirrorFeatureTypeHandlerV3,
  mirrorFeatureTypeV2,
  mirrorFeatureTypeV3,
  readMirrorFeatureParameters,
  readMirrorFeatureParametersV3,
} from "./part-design-mirror"
import { patternFeatureTypeV2 } from "./part-design-pattern"
import { splitFeatureTypeV2 } from "./part-design-split"
import { classifyPartOperation } from "./part-operation"
import { referenceFrameDependencyIds } from "./reference-frame"
import { createLengthQuantity, createScalarQuantity } from "./units"

const sourceId = "0195b5ac-b220-7a2c-8c33-000000003301",
  supportId = "0195b5ac-b220-7a2c-8c33-000000003302",
  id = "0195b5ac-b220-7a2c-8c33-000000003303"
const targetBody = { schemaVersion: 0, featureId: sourceId, outputRole: "pattern.instance.1" }
const modules = createModuleRegistry([documentCoreModule, featureCoreModule, partDesignModule])
if (!modules.ok) throw new Error(modules.diagnostic.message)
const registryResult = createFeatureTypeRegistry(modules.registry, partDesignFeatureTypeHandlers)
if (!registryResult.ok) throw new Error(registryResult.diagnostic.message)
const registry = registryResult.registry
function feature(
  type: typeof mirrorFeatureTypeV3.type,
  parameters: unknown,
  dependencies = [sourceId, supportId],
) {
  return featureRecordSchema.parse({
    schemaVersion: 0,
    id,
    type,
    parameters,
    dependencies,
    references: [],
    suppressed: false,
  })
}
describe("versioned body reference frame features", () => {
  it.each([
    [
      mirrorFeatureTypeV3,
      {
        targetBody,
        plane: { kind: "datum-plane", featureId: supportId },
        offset: createLengthQuantity(0),
        preserveSource: false,
      },
    ],
    [
      splitFeatureTypeV2,
      {
        targetBody,
        plane: { kind: "datum-plane", featureId: supportId },
        offset: createLengthQuantity(-5),
      },
    ],
    [
      patternFeatureTypeV2,
      {
        targetBody,
        kind: "linear",
        axis: { kind: "datum-axis", featureId: supportId, axis: "normal" },
        count: createScalarQuantity(3),
        spacing: createLengthQuantity(12),
      },
    ],
  ] as const)("orders %j support after the sole consumed body", (type, parameters) => {
    const authored = feature(type.type, parameters)
    expect(registry.validateFeature(authored).ok).toBe(true)
    expect(featureBodyDependencies(authored)).toEqual([
      { featureId: sourceId, outputRole: "pattern.instance.1" },
    ])
    expect(featureBodyDependencyIds(authored)).toEqual([sourceId])
    expect(registry.validateFeature({ ...authored, dependencies: [supportId, sourceId] }).ok).toBe(
      false,
    )
    expect(registry.validateFeature({ ...authored, dependencies: [sourceId] }).ok).toBe(false)
  })
  it("keeps world-plane v2 replay separate from v3 and retains offset expression resolution", () => {
    const legacy = feature(
      mirrorFeatureTypeV2.type,
      {
        targetBody,
        plane: "YZ",
        offset: createLengthQuantity(-20),
        preserveSource: true,
      },
      [sourceId],
    )
    expect(registry.validateFeature(legacy)).toMatchObject({
      ok: true,
      contentParameters: { plane: "YZ", offset: -20, preserveSource: true },
    })
    expect(readMirrorFeatureParametersV3(legacy)).toBeNull()
    const copy = feature(mirrorFeatureTypeV3.type, {
      targetBody,
      plane: { kind: "datum-plane", featureId: supportId },
      offset: createLengthQuantity(0, "mm", "#offset"),
      preserveSource: true,
    })
    expect(readMirrorFeatureParameters(copy)).toBeNull()
    const resolve = mirrorFeatureTypeHandlerV3.resolveParameters
    if (!resolve) throw new Error("Mirror v3 must resolve offset expressions.")
    expect(
      resolve(copy.parameters, new Map([["offset", { dimension: "length", value: -25.4 }]])),
    ).toMatchObject({
      ok: true,
      parameters: { offset: { value: -25.4 }, preserveSource: true },
    })
    expect(resolve(copy.parameters, new Map())).toMatchObject({ ok: false })
    expect(featureBodyDependencyIds(copy)).toEqual([])
    expect(featureBodyDependencies(copy)).toEqual([
      { featureId: sourceId, outputRole: "pattern.instance.1" },
    ])
    expect(classifyPartOperation({ ...copy, schemaVersion: 1, semanticInputs: null })).toEqual({
      kind: "new",
    })
    expect(registry.validateFeature({ ...copy, type: mirrorFeatureTypeV2.type }).ok).toBe(false)
  })
  it("keeps reference support dependencies complete in the legacy document graph", () => {
    const source = feature(mirrorFeatureTypeV3.type, {
      targetBody,
      plane: { kind: "datum-plane", featureId: supportId },
      offset: createLengthQuantity(0),
      preserveSource: false,
    })
    const authored = { ...source, id, dependencies: [sourceId, supportId] }
    const prerequisite = (id: string) =>
      featureRecordSchema.parse({
        ...source,
        id,
        type: {
          ...source.type,
          moduleId: "org.vibeshape.test.core",
          typeId: "org.vibeshape.test.unknown",
          schemaVersion: 1,
        },
        parameters: {},
        dependencies: [],
        references: [],
      })
    const graph = createDocumentDependencyGraph({
      sketches: [],
      history: [sourceId, supportId, id].map((id) => ({ kind: "feature", id })),
      features: [prerequisite(sourceId), prerequisite(supportId), authored],
    })
    expect(graph.ok, JSON.stringify(graph)).toBe(true)
    if (graph.ok)
      expect(graph.graph.dependencyModelIssues.some((issue) => issue.featureId === id)).toBe(false)
    const missingSupport = createDocumentDependencyGraph({
      sketches: [],
      history: [sourceId, supportId, id].map((id) => ({ kind: "feature", id })),
      features: [
        prerequisite(sourceId),
        prerequisite(supportId),
        { ...authored, dependencies: [sourceId] },
      ],
    })
    expect(missingSupport.ok).toBe(true)
    if (missingSupport.ok)
      expect(
        missingSupport.graph.dependencyModelIssues.some((issue) => issue.featureId === id),
      ).toBe(true)
  })
  it("deduplicates a stable support on the target producer and rejects degenerate explicit planes", () => {
    const plane = { kind: "explicit-plane", origin: [3, 4, 5], normal: [0.6, 0.8, 0] }
    const authored = feature(
      mirrorFeatureTypeV3.type,
      { targetBody, plane, offset: createLengthQuantity(0), preserveSource: false },
      [sourceId],
    )
    expect(registry.validateFeature(authored).ok).toBe(true)
    expect(readMirrorFeatureParametersV3(authored)?.plane).toEqual(plane)
    expect(
      referenceFrameDependencyIds(featureIdSchema.parse(sourceId), {
        kind: "datum-plane",
        featureId: featureIdSchema.parse(sourceId),
      }),
    ).toEqual([sourceId])
    expect(
      registry.validateFeature({
        ...authored,
        parameters: {
          targetBody,
          plane: { ...plane, normal: [0, 0, 0] },
          offset: createLengthQuantity(0),
          preserveSource: false,
        },
      }).ok,
    ).toBe(false)
    expect(registry.validateFeature({ ...authored, dependencies: [sourceId, supportId] }).ok).toBe(
      false,
    )
  })
})
