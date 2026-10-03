import { describe, expect, it } from "vitest"
import {
  createFeatureContentIdentity,
  type FeatureContentEnvironment,
  featureContentIdentitySchema,
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
  compoundFeatureParametersSchema,
  compoundFeatureParametersV2Schema,
  compoundFeatureType,
  compoundFeatureTypeV2,
  readCompoundFeatureParameters,
  unionFeatureParametersV2Schema,
  unionFeatureTypeV2,
} from "./part-design-body-combination"

const id = (n: number) => `0195b5ac-b220-7a2c-8c33-${String(n).padStart(12, "0")}`
const bodies = (producer = id(2)) =>
  [0, 1].map((index) => ({
    schemaVersion: 0 as const,
    featureId: producer,
    outputRole: `pattern.instance.${index}`,
  }))
function feature(kind: "compound" | "union", selected = bodies()) {
  return featureRecordSchema.parse({
    schemaVersion: 0,
    id: id(5),
    type: kind === "compound" ? compoundFeatureTypeV2.type : unionFeatureTypeV2.type,
    parameters:
      kind === "compound"
        ? { slots: selected.map((targetBody, index) => ({ slotId: id(700 + index), targetBody })) }
        : { bodies: selected },
    dependencies: [...new Set(selected.map(({ featureId }) => featureId))],
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
  provider: { kind: "built-in" },
  modelingTolerancePolicyVersion: 1,
  geometry: {
    adapterId: "org.vibeshape.geometry.replicad",
    adapterVersion: "test",
    kernelId: "org.opencascade.occt",
    kernelVersion: "7.8.1",
    kernelSourceRevision: null,
  },
}
function identity(kind: "compound" | "union", selected = bodies()) {
  const record = feature(kind, selected)
  return createFeatureContentIdentity(registry(), {
    feature: record,
    environment,
    dependencies: record.dependencies.map((featureId, index) => ({
      featureId,
      contentHash: (index ? "b" : "a").repeat(64),
    })),
  })
}
describe("ordered exact body slots in Compound and Union version 2", () => {
  it.each(["compound", "union"] as const)(
    "preserves two %s roles from one producer with one graph dependency",
    (kind) => {
      const record = feature(kind)
      expect(registry().validateFeature(record).ok).toBe(true)
      expect(record.dependencies).toEqual([id(2)])
      expect(featureBodyDependencies(record)).toEqual(bodies())
      expect(identity(kind)).toMatchObject({
        ok: true,
        identity: {
          schemaVersion: 2,
          feature: {
            inputs: ["a".repeat(64)],
            inputSlots: bodies().map(({ outputRole }) => ({
              inputIndex: 0,
              contentHash: "a".repeat(64),
              outputRole,
            })),
          },
        },
      })
    },
  )
  it("keeps producer IDs unique in first-occurrence order and retains interleaved body ordering", () => {
    const selected = [bodies(id(3))[0], bodies(id(2))[0], bodies(id(3))[1]].filter(
      (value) => value !== undefined,
    )
    const record = feature("union", selected)
    expect(record.dependencies).toEqual([id(3), id(2)])
    expect(identity("union", selected)).toMatchObject({
      ok: true,
      identity: {
        feature: {
          inputSlots: [
            { inputIndex: 0, contentHash: "a".repeat(64) },
            { inputIndex: 1, contentHash: "b".repeat(64) },
            { inputIndex: 0, contentHash: "a".repeat(64) },
          ],
        },
      },
    })
    expect(registry().validateFeature({ ...record, dependencies: [id(2), id(3)] }).ok).toBe(false)
    expect(registry().validateFeature({ ...record, dependencies: [id(3), id(3), id(2)] }).ok).toBe(
      false,
    )
  })
  it("retains version 1 validation and never migrates records while reading", () => {
    const modern = feature("compound")
    const legacy = { ...modern, type: compoundFeatureType.type }
    expect(compoundFeatureParametersSchema.safeParse(legacy.parameters).success).toBe(false)
    expect(readCompoundFeatureParameters(legacy)).toBeNull()
    expect(readCompoundFeatureParameters(modern)).toEqual(modern.parameters)
    expect(modern.type.schemaVersion).toBe(2)
  })
  it("rejects repeated exact bodies and duplicate authored Compound output identities", () => {
    const first = bodies()[0]
    expect(unionFeatureParametersV2Schema.safeParse({ bodies: [first, first] }).success).toBe(false)
    expect(
      compoundFeatureParametersV2Schema.safeParse({
        slots: bodies().map((targetBody) => ({ targetBody, slotId: id(700) })),
      }).success,
    ).toBe(false)
    expect(
      unionFeatureParametersV2Schema.safeParse({ bodies: [bodies(id(2))[0], bodies(id(3))[0]] })
        .success,
    ).toBe(true)
  })
  it.each([0, 1, 9])("rejects %i ordered body slots", (count) => {
    const selected = Array.from({ length: count }, (_, index) => ({
      schemaVersion: 0,
      featureId: id(2),
      outputRole: `pattern.instance.${index}`,
    }))
    expect(unionFeatureParametersV2Schema.safeParse({ bodies: selected }).success).toBe(false)
  })
  it("excludes producer and feature UUIDs from canonical input identity", () => {
    const first = identity("union")
    const remapped = identity("union", bodies(id(20)))
    if (!first.ok || !remapped.ok) throw new Error("Expected valid slotted content")
    expect(first.canonicalPayload).toBe(remapped.canonicalPayload)
    expect(first.canonicalPayload).not.toContain(id(2))
    expect(first.canonicalPayload).not.toContain(id(5))
    const reordered = identity("union", bodies().reverse())
    expect(reordered.ok && reordered.canonicalPayload).not.toBe(first.canonicalPayload)
  })
  it("rejects role collapse into a producer-level dependency and invalid canonical slot hashes", () => {
    const record = feature("union")
    expect(
      createFeatureContentIdentity(registry(), {
        feature: record,
        environment,
        dependencies: [
          { featureId: id(2), contentHash: "a".repeat(64), outputRole: "pattern.instance.1" },
        ],
      }).ok,
    ).toBe(false)
    const valid = identity("union")
    if (!valid.ok || valid.identity.schemaVersion !== 2)
      throw new Error("Expected slotted identity")
    const changed = {
      ...valid.identity,
      feature: {
        ...valid.identity.feature,
        inputSlots: valid.identity.feature.inputSlots.map((slot, index) =>
          index ? { ...slot, contentHash: "b".repeat(64) } : slot,
        ),
      },
    }
    expect(featureContentIdentitySchema.safeParse(changed).success).toBe(false)
  })
})
