import { describe, expect, it } from "vitest"
import { documentSnapshotSchema } from "./document"
import { createDocumentDependencyGraph } from "./document-graph"
import { documentSnapshotV2Schema } from "./document-v2"
import { applyDocumentV2Command, reduceDocumentV2Event } from "./document-v2-commands"
import { applyDocumentUpgradeV2Command } from "./document-v2-migration"
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
  coneFeatureParametersSchema,
  coneFeatureType,
  partDesignFeatureTypeHandlers,
  sphereFeatureParametersSchema,
  sphereFeatureType,
  torusFeatureParametersSchema,
  torusFeatureType,
} from "./part-design"
import { createLengthQuantity } from "./units"
import type { ExpressionValue } from "./variables"
import { applyVersionedDocumentCommand } from "./versioned-document-commands"

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
const primitives = [
  {
    type: sphereFeatureType,
    schema: sphereFeatureParametersSchema,
    parameters: { radius: createLengthQuantity(2, "cm") },
    content: { radius: 20, origin: [0, 0, 0] },
  },
  {
    type: coneFeatureType,
    schema: coneFeatureParametersSchema,
    parameters: {
      radius: createLengthQuantity(2, "cm"),
      height: createLengthQuantity(30),
      centered: true,
    },
    content: { radius: 20, height: 30, centered: true, origin: [0, 0, 0] },
  },
  {
    type: torusFeatureType,
    schema: torusFeatureParametersSchema,
    parameters: {
      majorRadius: createLengthQuantity(2, "cm"),
      minorRadius: createLengthQuantity(5),
    },
    content: { majorRadius: 20, minorRadius: 5, origin: [0, 0, 0] },
  },
] as const

function registry() {
  const modules = createModuleRegistry([documentCoreModule, featureCoreModule, partDesignModule])
  if (!modules.ok) throw new Error(modules.diagnostic.message)
  const types = createFeatureTypeRegistry(modules.registry, partDesignFeatureTypeHandlers)
  if (!types.ok) throw new Error(types.diagnostic.message)
  return types.registry
}
function feature(
  primitive: (typeof primitives)[number],
  parameters: Record<string, unknown> = primitive.parameters,
): FeatureRecord {
  return featureRecordSchema.parse({
    schemaVersion: 0,
    id: featureId,
    type: primitive.type.type,
    parameters,
    dependencies: [],
    references: [],
    suppressed: false,
  })
}

function origin(x: number, y = 0, z = 0) {
  return { x: createLengthQuantity(x), y: createLengthQuantity(y), z: createLengthQuantity(z) }
}

describe("radial part-design primitives", () => {
  it.each(primitives)(
    "registers $type.type.typeId with canonical dimensions and empty inputs",
    (primitive) => {
      const validated = registry().validateFeature(feature(primitive))
      expect(validated.ok).toBe(true)
      if (!validated.ok) throw new Error(validated.diagnostic.message)
      expect(validated.contentParameters).toEqual(primitive.content)
      expect(validated.descriptor.dependencies).toEqual({ min: 0, max: 0 })
      expect(validated.descriptor.references).toEqual({ min: 0, max: 0 })
      expect(
        registry().validateFeature({ ...feature(primitive), dependencies: [featureId] }).ok,
      ).toBe(false)
      expect(
        registry().validateFeature({
          ...feature(primitive),
          type: { ...primitive.type.type, schemaVersion: 2 },
        }),
      ).toMatchObject({ ok: false, diagnostic: { code: "feature-type-unavailable" } })
    },
  )

  it.each(primitives)(
    "round-trips authored quantities and placement for $type.type.typeId",
    (primitive) => {
      const authored = feature(primitive, { ...primitive.parameters, origin: origin(-15, 30, 12) })
      const snapshot = documentSnapshotSchema.parse({
        schemaVersion: 0,
        id: "0195b5ac-b220-7a2c-8c33-67a36a7f3000",
        revision: 1,
        name: "Radial primitive",
        displayUnits: { length: "mm", angle: "deg" },
        variables: [],
        sketches: [],
        features: [authored],
        createdAt: "2026-10-03T00:00:00.000Z",
        updatedAt: "2026-10-03T00:00:00.000Z",
      })
      const restored = documentSnapshotSchema.parse(JSON.parse(JSON.stringify(snapshot)))
      expect(restored.features[0]).toEqual(authored)
      expect(registry().validateFeature(restored.features[0])).toMatchObject({
        ok: true,
        contentParameters: { ...primitive.content, origin: [-15, 30, 12] },
      })
    },
  )

  it.each(primitives)(
    "rejects non-finite, nonpositive, excessive, and unknown authored dimensions for $type.type.typeId",
    (primitive) => {
      const key = primitive.type === torusFeatureType ? "majorRadius" : "radius"
      for (const value of [0, -1, 0.0005, 1_000_001]) {
        expect(
          primitive.schema.safeParse({
            ...primitive.parameters,
            [key]: createLengthQuantity(value),
          }).success,
        ).toBe(false)
      }
      for (const value of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
        expect(
          primitive.schema.safeParse({
            ...primitive.parameters,
            [key]: { ...createLengthQuantity(1), value },
          }).success,
        ).toBe(false)
      }
      expect(primitive.schema.safeParse({ ...primitive.parameters, extra: true }).success).toBe(
        false,
      )
    },
  )

  it("accepts the smallest supported radial dimensions", () => {
    expect(
      sphereFeatureParametersSchema.safeParse({ radius: createLengthQuantity(0.001) }).success,
    ).toBe(true)
    expect(
      coneFeatureParametersSchema.safeParse({
        radius: createLengthQuantity(0.001),
        height: createLengthQuantity(0.001),
        centered: true,
      }).success,
    ).toBe(true)
    expect(
      torusFeatureParametersSchema.safeParse({
        majorRadius: createLengthQuantity(0.002),
        minorRadius: createLengthQuantity(0.001),
      }).success,
    ).toBe(true)
  })

  it("checks workspace extents, pointed cone placement, and the ring-torus inequality", () => {
    expect(
      sphereFeatureParametersSchema.safeParse({
        radius: createLengthQuantity(20),
        origin: origin(99_980),
      }).success,
    ).toBe(true)
    expect(
      sphereFeatureParametersSchema.safeParse({
        radius: createLengthQuantity(20),
        origin: origin(99_981),
      }).success,
    ).toBe(false)
    expect(
      coneFeatureParametersSchema.safeParse({
        radius: createLengthQuantity(20),
        height: createLengthQuantity(30),
        centered: true,
        origin: origin(0, 0, 99_985),
      }).success,
    ).toBe(true)
    expect(
      coneFeatureParametersSchema.safeParse({
        radius: createLengthQuantity(20),
        height: createLengthQuantity(30),
        centered: false,
        origin: origin(0, 0, 99_985),
      }).success,
    ).toBe(false)
    expect(
      torusFeatureParametersSchema.safeParse({
        majorRadius: createLengthQuantity(20),
        minorRadius: createLengthQuantity(5),
        origin: origin(99_975),
      }).success,
    ).toBe(true)
    expect(
      torusFeatureParametersSchema.safeParse({
        majorRadius: createLengthQuantity(20),
        minorRadius: createLengthQuantity(5),
        origin: origin(99_976),
      }).success,
    ).toBe(false)
    for (const minorRadius of [20, 21]) {
      expect(
        torusFeatureParametersSchema.safeParse({
          majorRadius: createLengthQuantity(20),
          minorRadius: createLengthQuantity(minorRadius),
        }).success,
      ).toBe(false)
    }
  })

  it.each(primitives)(
    "resolves dimensions and origin before hashing $type.type.typeId",
    (primitive) => {
      const key = primitive.type === torusFeatureType ? "majorRadius" : "radius"
      const authored = feature(primitive, {
        ...primitive.parameters,
        [key]: createLengthQuantity(20, "mm", "#size"),
        origin: { ...origin(0), x: createLengthQuantity(0, "mm", "#offset") },
      })
      const variables = new Map<string, ExpressionValue>([
        ["size", { dimension: "length", value: 25 }],
        ["offset", { dimension: "length", value: 3 }],
      ])
      const types = registry()
      const resolved = types.resolveFeatureParameters(authored, variables)
      expect(resolved.ok).toBe(true)
      if (!resolved.ok) throw new Error(resolved.diagnostic.message)
      const content = createFeatureContentIdentity(types, {
        feature: resolved.feature,
        environment,
        dependencies: [],
      })
      expect(content).toMatchObject({
        ok: true,
        identity: { feature: { parameters: { [key]: 25, origin: [3, 0, 0] } } },
      })
      const literal = feature(primitive, {
        ...primitive.parameters,
        [key]: createLengthQuantity(2.5, "cm"),
        origin: origin(3),
      })
      const literalContent = createFeatureContentIdentity(types, {
        feature: literal,
        environment,
        dependencies: [],
      })
      if (!content.ok || !literalContent.ok)
        throw new Error("Expected canonical primitive identity")
      expect(content.canonicalPayload).toBe(literalContent.canonicalPayload)
      expect(types.resolveFeatureParameters(authored, new Map())).toMatchObject({
        ok: false,
        diagnostic: { code: "invalid-feature-expression" },
      })
      expect(
        types.resolveFeatureParameters(
          authored,
          new Map([["size", { dimension: "angle", value: 1 }]]),
        ),
      ).toMatchObject({ ok: false })
      for (const value of [0, -1, 0.0005, 100_001]) {
        expect(
          types.resolveFeatureParameters(
            authored,
            new Map([...variables, ["size", { dimension: "length" as const, value }]]),
          ),
        ).toMatchObject({ ok: false })
      }
      expect(
        types.resolveFeatureParameters(
          authored,
          new Map([...variables, ["offset", { dimension: "length" as const, value: 99_999 }]]),
        ),
      ).toMatchObject({ ok: false })
      const changed = types.resolveFeatureParameters(
        authored,
        new Map([...variables, ["size", { dimension: "length" as const, value: 30 }]]),
      )
      if (!changed.ok) throw new Error(changed.diagnostic.message)
      const changedContent = createFeatureContentIdentity(types, {
        feature: changed.feature,
        environment,
        dependencies: [],
      })
      if (!changedContent.ok) throw new Error(changedContent.diagnostic.message)
      expect(changedContent.canonicalPayload).not.toBe(content.canonicalPayload)
    },
  )

  it("rejects a variable edit that collapses a ring torus", () => {
    const primitive = primitives[2]
    const authored = feature(primitive, {
      majorRadius: createLengthQuantity(20, "mm", "#major"),
      minorRadius: createLengthQuantity(5, "mm", "#minor"),
    })
    for (const minor of [20, 21]) {
      expect(
        registry().resolveFeatureParameters(
          authored,
          new Map<string, ExpressionValue>([
            ["major", { dimension: "length", value: 20 }],
            ["minor", { dimension: "length", value: minor }],
          ]),
        ),
      ).toMatchObject({
        ok: false,
        diagnostic: {
          reason: "invalid-primitive-parameters",
          issues: [{ path: "parameters.minorRadius" }],
        },
      })
    }
  })
  it.each(primitives)(
    "commits, replays, and restores one authored Part for $type.type.typeId",
    (primitive) => {
      const envelope = (baseRevision: number) => ({
        schemaVersion: 1,
        documentId: "0195b5ac-b220-7a2c-8c33-67a36a7f3000",
        commandId: `0195b5ac-b220-7a2c-8c33-${(100 + baseRevision).toString().padStart(12, "0")}`,
        baseRevision,
        issuedAt: "2026-10-03T00:00:00Z",
        actor: { type: "user", userId: null },
      })
      const created = applyVersionedDocumentCommand(null, {
        ...envelope(0),
        kind: "org.vibeshape.document.create",
        payload: { name: "Primitive part" },
      })
      if (!created.ok) throw new Error(created.diagnostic.message)
      const upgraded = applyDocumentUpgradeV2Command(created.snapshot, {
        ...envelope(created.snapshot.revision),
        schemaVersion: 2,
        kind: "org.vibeshape.document.upgrade-v2",
        payload: { partAllocations: [] },
      })
      if (!upgraded.ok) throw new Error(upgraded.diagnostic.message)
      const committed = applyDocumentV2Command(upgraded.snapshot, {
        ...envelope(upgraded.snapshot.revision),
        schemaVersion: 2,
        kind: "org.vibeshape.document.model-command",
        payload: {
          command: {
            ...envelope(upgraded.snapshot.revision),
            kind: "org.vibeshape.history.insert-feature",
            payload: { feature: feature(primitive), historyAfter: null },
          },
          partAllocations: [
            {
              id: "0195b5ac-b220-7a2c-8c33-67a36a7f3200",
              name: "Primitive",
              origin: "independent",
              body: { schemaVersion: 0, featureId, outputRole: "result" },
            },
          ],
        },
      })
      expect(committed.ok).toBe(true)
      if (!committed.ok) throw new Error(committed.diagnostic.message)
      expect(committed.snapshot.features[0]?.semanticInputs).toEqual([])
      expect(committed.snapshot.parts).toHaveLength(1)
      expect(committed.snapshot.parts[0]?.bodyHistory).toEqual([
        { schemaVersion: 0, featureId, outputRole: "result" },
      ])
      expect(committed.snapshot.history).toEqual([{ kind: "feature", id: featureId }])
      expect(createDocumentDependencyGraph(committed.snapshot)).toMatchObject({
        ok: true,
        graph: { dependencyModelIssues: [] },
      })
      const replayed = reduceDocumentV2Event(upgraded.snapshot, committed.event)
      expect(replayed).toMatchObject({ ok: true, snapshot: committed.snapshot })
      expect(
        documentSnapshotV2Schema.parse(JSON.parse(JSON.stringify(committed.snapshot))),
      ).toEqual(committed.snapshot)
      expect(
        documentSnapshotV2Schema.safeParse({
          ...committed.snapshot,
          features: committed.snapshot.features.map((record) => ({
            ...record,
            semanticInputs: [{ kind: "feature", id: featureId }],
          })),
        }).success,
      ).toBe(false)
    },
  )
})
