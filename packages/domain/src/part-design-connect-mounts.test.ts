import { describe, expect, it } from "bun:test"
import { documentSnapshotSchema } from "./document"
import {
  createFeatureContentIdentity,
  type FeatureContentEnvironment,
} from "./feature-content-identity"
import { featureRecordSchema } from "./feature-graph"
import { projectFirstPartyFeatureSemanticInputs } from "./feature-semantic-inputs"
import { createFeatureTypeRegistry } from "./feature-type-registry"
import {
  createModuleRegistry,
  documentCoreModule,
  featureCoreModule,
  partDesignModule,
} from "./modules"
import { partDesignFeatureTypeHandlers } from "./part-design"
import {
  connectMountsFeatureParametersSchema,
  connectMountsFeatureType,
  readConnectMountsFeatureParameters,
} from "./part-design-connect-mounts"
import { classifyPartOperation } from "./part-operation"

const parameters = {
  points: [
    [0, 0, 0],
    [30, 0, 0],
    [0, 20, 10],
  ],
  nodeRadius: 4,
  strutRadius: 2,
}
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
function feature(input: unknown = parameters) {
  return featureRecordSchema.parse({
    schemaVersion: 0,
    id: "0195b5ac-b220-7a2c-8c33-67a36a7f3101",
    type: connectMountsFeatureType.type,
    parameters: input,
    dependencies: [],
    references: [],
    suppressed: false,
  })
}
function registry() {
  const modules = createModuleRegistry([documentCoreModule, featureCoreModule, partDesignModule])
  if (!modules.ok) throw new Error(modules.diagnostic.message)
  const result = createFeatureTypeRegistry(modules.registry, partDesignFeatureTypeHandlers)
  if (!result.ok) throw new Error(result.diagnostic.message)
  return result.registry
}

describe("Connect Mounts domain contract", () => {
  it("reserves the exact workspace margin for OCCT shape tolerance", () => {
    for (const [x, accepted] of [
      [99_995.999, true],
      [99_995.9991, false],
    ] as const)
      expect(
        connectMountsFeatureParametersSchema.safeParse({
          ...parameters,
          points: [
            [0, 0, 0],
            [x, 0, 0],
          ],
        }).success,
      ).toBe(accepted)
  })

  it("registers an independent exact body with no model dependencies", () => {
    const authored = feature()
    expect(registry().validateFeature(authored)).toMatchObject({
      ok: true,
      contentParameters: { connectionMode: "tree" },
    })
    expect(registry().validateFeature({ ...authored, dependencies: [authored.id] }).ok).toBe(false)
    expect(classifyPartOperation({ ...authored, schemaVersion: 1, semanticInputs: [] })).toEqual({
      kind: "new",
    })
    expect(projectFirstPartyFeatureSemanticInputs(authored)).toEqual({
      recognized: true,
      ok: true,
      inputs: [],
    })
    expect(readConnectMountsFeatureParameters(authored)).toMatchObject(parameters)
  })

  it("canonicalizes point order and defaults while retaining every geometry input", () => {
    const types = registry()
    const identity = (input: unknown) => {
      const result = createFeatureContentIdentity(types, {
        feature: feature(input),
        environment,
        dependencies: [],
      })
      if (!result.ok) throw new Error(result.diagnostic.message)
      return result.canonicalPayload
    }
    const original = identity(parameters)
    expect(
      identity({ ...parameters, points: [...parameters.points].reverse(), connectionMode: "tree" }),
    ).toBe(original)
    expect(
      identity({
        ...parameters,
        points: [
          [-0, 0, -0],
          [30, 0, 0],
          [0, 20, 10],
        ],
      }),
    ).toBe(original)
    for (const changed of [
      { ...parameters, nodeRadius: 5 },
      { ...parameters, strutRadius: 3 },
      {
        ...parameters,
        points: [
          [0, 0, 0],
          [30, 0, 0],
          [0, 20, 11],
        ],
      },
      { ...parameters, connectionMode: "complete" },
    ])
      expect(identity(changed)).not.toBe(original)
  })

  it.each([
    { points: [] },
    { points: [[0, 0, 0]] },
    { points: Array.from({ length: 17 }, (_, index) => [index, 0, 0]) },
    {
      points: [
        [0, 0, 0],
        [0, 0, 0],
      ],
    },
    {
      points: [
        [0, 0, 0],
        [0.0005, 0, 0],
      ],
    },
    {
      points: [
        [0, 0, 0],
        [100_001, 0, 0],
      ],
    },
    {
      points: [
        [0, 0, 0],
        [99_997, 0, 0],
      ],
    },
    {
      points: [
        [0, 0, 0],
        [Number.NaN, 0, 0],
      ],
    },
    {
      points: [
        [0, 0, 0],
        [0, Number.POSITIVE_INFINITY, 0],
      ],
    },
    {
      points: [
        [0, 0],
        [30, 0, 0],
      ],
    },
    { nodeRadius: 0 },
    { nodeRadius: Number.POSITIVE_INFINITY },
    { strutRadius: -1 },
    { strutRadius: 0.0005 },
    { strutRadius: 5 },
    { connectionMode: "mesh" },
    { extra: true },
  ])("rejects invalid or excessive geometry inputs %j", (invalid) => {
    expect(
      connectMountsFeatureParametersSchema.safeParse({ ...parameters, ...invalid }).success,
    ).toBe(false)
  })

  it("accepts workspace, radius, separation, and cardinality boundaries", () => {
    expect(
      connectMountsFeatureParametersSchema.safeParse({
        points: [
          [0, 0, 0],
          [0.001, 0, 0],
        ],
        nodeRadius: 0.001,
        strutRadius: 0.001,
      }).success,
    ).toBe(true)
    expect(
      connectMountsFeatureParametersSchema.safeParse({
        ...parameters,
        points: Array.from({ length: 16 }, (_, i) => [99_995.999, i, 0]),
      }).success,
    ).toBe(true)
  })

  it("round-trips authored parameters through the native document snapshot", () => {
    const snapshot = documentSnapshotSchema.parse({
      schemaVersion: 0,
      id: "0195b5ac-b220-7a2c-8c33-67a36a7f3000",
      revision: 1,
      name: "Mount connector",
      displayUnits: { length: "mm", angle: "deg" },
      variables: [],
      sketches: [],
      features: [feature()],
      createdAt: "2026-10-31T00:00:00.000Z",
      updatedAt: "2026-10-31T00:00:00.000Z",
    })
    const restored = documentSnapshotSchema.parse(JSON.parse(JSON.stringify(snapshot)))
    expect(restored).toEqual(snapshot)
    expect(registry().validateFeature(restored.features[0]).ok).toBe(true)
  })
})
