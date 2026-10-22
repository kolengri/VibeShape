import { describe, expect, it } from "bun:test"
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
  pressPullFeatureParametersSchema,
  pressPullFeatureType,
  pressPullFeatureTypeHandler,
} from "./part-design-press-pull"
import { classifyPartOperation } from "./part-operation"
import { createLengthQuantity } from "./units"

const sourceId = "0195b5ac-b220-7a2c-8c33-67a36a7f7801"
const featureId = "0195b5ac-b220-7a2c-8c33-67a36a7f7802"
const face = {
  schemaVersion: 1,
  featureId: sourceId,
  outputRole: "body.primary",
  kind: "face",
  semanticRole: "top",
  signature: {
    kind: "face",
    geometryClass: "PLANE",
    measure: 240,
    centroid: [0, 0, 10],
    bounds: { min: [-10, -6, 10], max: [10, 6, 10] },
    boundaryCount: 4,
    adjacentGeometryClasses: ["PLANE"],
  },
}
const parameters = {
  targetBody: { schemaVersion: 0, featureId: sourceId, outputRole: "body.primary" },
  distance: createLengthQuantity(-2),
  sourceContentHash: "a".repeat(64),
  face,
}
const feature = featureRecordSchema.parse({
  schemaVersion: 0,
  id: featureId,
  type: pressPullFeatureType.type,
  parameters,
  dependencies: [sourceId],
  references: [],
  suppressed: false,
})
describe("registered planar Press Pull parameters", () => {
  it("registers a signed exact named-body modifier with UUID-free content", () => {
    const modules = createModuleRegistry([documentCoreModule, featureCoreModule, partDesignModule])
    if (!modules.ok) throw new Error(modules.diagnostic.message)
    const registry = createFeatureTypeRegistry(modules.registry, partDesignFeatureTypeHandlers)
    if (!registry.ok) throw new Error(registry.diagnostic.message)
    expect(registry.registry.validateFeature(feature)).toMatchObject({
      ok: true,
      contentParameters: {
        distance: -2,
        sourceContentHash: parameters.sourceContentHash,
        face: { outputRole: "body.primary" },
      },
    })
    expect(featureBodyDependencies(feature)).toEqual<unknown>([
      { featureId: sourceId, outputRole: "body.primary" },
    ])
    expect(
      classifyPartOperation({ ...feature, schemaVersion: 1, semanticInputs: [] }),
    ).toMatchObject({ kind: "modify", target: parameters.targetBody, consumed: [] })
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
    const input = {
      feature,
      environment,
      dependencies: [
        {
          featureId: sourceId,
          outputRole: parameters.targetBody.outputRole,
          contentHash: parameters.sourceContentHash,
        },
      ],
    }
    const identity = createFeatureContentIdentity(registry.registry, input)
    expect(identity).toMatchObject({
      ok: true,
      identity: { schemaVersion: 1, feature: { inputRoles: ["body.primary"] } },
    })
    expect(
      createFeatureContentIdentity(registry.registry, {
        ...input,
        feature: {
          ...feature,
          id: feature.dependencies[0],
          dependencies: [feature.id],
          parameters: {
            ...parameters,
            targetBody: { ...parameters.targetBody, featureId },
            face: { ...face, featureId },
          },
        },
        dependencies: [{ ...input.dependencies[0], featureId }],
      }),
    ).toEqual(identity)
    expect(
      createFeatureContentIdentity(registry.registry, {
        ...input,
        feature: { ...feature, parameters: { ...parameters, distance: createLengthQuantity(2) } },
      }),
    ).not.toEqual(identity)
    const content = pressPullFeatureTypeHandler.contentParameters?.(parameters)
    expect(JSON.stringify(content)).not.toContain(sourceId)
    expect(
      pressPullFeatureTypeHandler.validateFeature?.({ ...feature, dependencies: [feature.id] }),
    ).toHaveLength(1)
  })
  it.each([0, NaN, Infinity, -Infinity, 0.0001, -100001])(
    "rejects zero, nonfinite or out-of-range distance %s",
    (value) => {
      expect(
        pressPullFeatureParametersSchema.safeParse({
          ...parameters,
          distance: { ...parameters.distance, value },
        }).success,
      ).toBe(false)
    },
  )
  it("rejects curved, cross-body, mismatched-role and transient face references", () => {
    for (const changes of [
      { featureId },
      { outputRole: "other" },
      { candidateId: "face:2" },
      { meshFaceId: 3 },
      { signature: { ...face.signature, geometryClass: "CYLINDRE" } },
    ])
      expect(
        pressPullFeatureParametersSchema.safeParse({ ...parameters, face: { ...face, ...changes } })
          .success,
      ).toBe(false)
  })
  it("resolves signed variable expressions and rejects zero resolutions", () => {
    const withExpression = { ...parameters, distance: createLengthQuantity(-2, "mm", "-4 mm") }
    expect(
      pressPullFeatureTypeHandler.resolveParameters?.(withExpression, new Map()),
    ).toMatchObject({ ok: true, parameters: { distance: { value: -4 } } })
    expect(
      pressPullFeatureTypeHandler.resolveParameters?.(
        { ...withExpression, distance: createLengthQuantity(1, "mm", "0 mm") },
        new Map(),
      ),
    ).toMatchObject({ ok: false })
  })
})
