import { describe, expect, it } from "bun:test"
import type { DocumentSnapshotV2 } from "./document-v2"
import { applyDocumentV2Command, reduceDocumentV2Event } from "./document-v2-commands"
import { applyDocumentUpgradeV2Command } from "./document-v2-migration"
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
import { requiredPartAllocations } from "./part-bindings"
import { boxFeatureType, partDesignFeatureTypeHandlers } from "./part-design"
import {
  compoundBodyOutputRole,
  compoundFeatureParametersSchema,
  compoundFeatureType,
  compoundFeatureTypeV2,
  readCompoundFeatureParameters,
  unionFeatureParametersSchema,
  unionFeatureType,
  unionFeatureTypeV2,
} from "./part-design-body-combination"
import { patternFeatureType } from "./part-design-pattern"
import { placementFeatureType } from "./part-design-placement"
import { partBodyReference } from "./parts"
import { createAngleQuantity, createLengthQuantity, createScalarQuantity } from "./units"
import { applyVersionedDocumentCommand } from "./versioned-document-commands"

const id = (value: number) => `0195b5ac-b220-7a2c-8c33-${String(value).padStart(12, "0")}`
const body = (featureId: string, outputRole = "result") => ({
  schemaVersion: 0 as const,
  featureId,
  outputRole,
})
const slots = () => [
  { slotId: id(700), targetBody: body(id(2)) },
  { slotId: id(701), targetBody: body(id(3)) },
]
function combined(kind: "compound" | "union", suppressed = false) {
  return {
    schemaVersion: 0 as const,
    id: id(5),
    type: kind === "compound" ? compoundFeatureType.type : unionFeatureType.type,
    parameters:
      kind === "compound"
        ? { slots: slots() }
        : { bodies: slots().map(({ targetBody }) => targetBody) },
    dependencies: [id(2), id(3)],
    references: [],
    suppressed,
  }
}
function registry() {
  const modules = createModuleRegistry([documentCoreModule, featureCoreModule, partDesignModule])
  if (!modules.ok) throw new Error(modules.diagnostic.message)
  const result = createFeatureTypeRegistry(modules.registry, partDesignFeatureTypeHandlers)
  if (!result.ok) throw new Error(result.diagnostic.message)
  return result.registry
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

describe("trusted bounded body combinations", () => {
  it("requires explicit distinct producers, unique captured slots, and exact ordered dependencies", () => {
    const feature = featureRecordSchema.parse(combined("compound"))
    const validated = registry().validateFeature(feature)
    expect(validated).toMatchObject({
      ok: true,
      contentParameters: { outputRoles: [`body.${id(700)}`, `body.${id(701)}`] },
    })
    expect(featureBodyDependencies(feature)).toEqual<unknown>(
      slots().map(({ targetBody }) => targetBody),
    )
    expect(
      registry().validateFeature({ ...feature, dependencies: [...feature.dependencies].reverse() })
        .ok,
    ).toBe(false)
    expect(
      registry().validateFeature({ ...feature, dependencies: [...feature.dependencies, id(4)] }).ok,
    ).toBe(false)
    const sameProducer = slots().map((slot) => ({
      ...slot,
      targetBody: body(id(2), slot.slotId === id(700) ? "body.first" : "body.second"),
    }))
    expect(compoundFeatureParametersSchema.safeParse({ slots: sameProducer }).success).toBe(false)
    expect(
      unionFeatureParametersSchema.safeParse({
        bodies: sameProducer.map(({ targetBody }) => targetBody),
      }).success,
    ).toBe(false)
    expect(
      compoundFeatureParametersSchema.safeParse({
        slots: slots().map((slot) => ({ ...slot, slotId: id(700) })),
      }).success,
    ).toBe(false)
    expect(
      readCompoundFeatureParameters({ ...feature, type: { ...feature.type, schemaVersion: 3 } }),
    ).toBeNull()
  })
  it.each([0, 1, 9])("rejects %i selected bodies at the trusted boundary", (count) => {
    const selected = Array.from({ length: count }, (_, index) => ({
      slotId: id(700 + index),
      targetBody: body(id(20 + index)),
    }))
    expect(compoundFeatureParametersSchema.safeParse({ slots: selected }).success).toBe(false)
    expect(
      unionFeatureParametersSchema.safeParse({
        bodies: selected.map(({ targetBody }) => targetBody),
      }).success,
    ).toBe(false)
  })
  it("accepts eight explicit inputs and rejects nonsemantic or executable intent", () => {
    const selected = Array.from({ length: 8 }, (_, index) => ({
      slotId: id(700 + index),
      targetBody: body(id(20 + index)),
    }))
    expect(compoundFeatureParametersSchema.safeParse({ slots: selected }).success).toBe(true)
    expect(
      unionFeatureParametersSchema.safeParse({
        bodies: selected.map(({ targetBody }) => targetBody),
      }).success,
    ).toBe(true)
    for (const changes of [{ matrix: [] }, { scale: 2 }, { code: "arbitrary" }]) {
      expect(
        compoundFeatureParametersSchema.safeParse({ slots: slots(), ...changes }).success,
      ).toBe(false)
      expect(
        unionFeatureParametersSchema.safeParse({
          bodies: slots().map(({ targetBody }) => targetBody),
          ...changes,
        }).success,
      ).toBe(false)
    }
  })
  it("binds canonical identity to exact role/hash slots and authored output UUIDs", () => {
    const types = registry()
    const feature = featureRecordSchema.parse(combined("compound"))
    const dependencies = feature.dependencies.map((featureId, index) => ({
      featureId,
      contentHash: (index ? "b" : "a").repeat(64),
      outputRole: "result",
    }))
    const identity = createFeatureContentIdentity(types, { feature, environment, dependencies })
    expect(identity).toMatchObject({
      ok: true,
      identity: {
        schemaVersion: 1,
        feature: {
          inputRoles: ["result", "result"],
          parameters: { outputRoles: [`body.${id(700)}`, `body.${id(701)}`] },
        },
      },
    })
    expect(
      createFeatureContentIdentity(types, {
        feature,
        environment,
        dependencies: dependencies.map(({ outputRole: _outputRole, ...dependency }) => dependency),
      }).ok,
    ).toBe(false)
    expect(
      createFeatureContentIdentity(types, {
        feature,
        environment,
        dependencies: dependencies.map((dependency, index) => ({
          ...dependency,
          outputRole: index ? "body.other" : "result",
        })),
      }).ok,
    ).toBe(false)
    const changed = featureRecordSchema.parse({
      ...combined("compound"),
      parameters: { slots: slots().map((slot, index) => ({ ...slot, slotId: id(800 + index) })) },
    })
    expect(
      createFeatureContentIdentity(types, { feature: changed, environment, dependencies }),
    ).not.toEqual(identity)
    const selected = compoundFeatureParametersSchema.parse({ slots: slots() }).slots[0]
    if (!selected) throw new Error("A valid Compound must have an authored slot.")
    expect(compoundBodyOutputRole(selected.slotId)).toBe(`body.${id(700)}`)
  })
})

function success<T extends { ok: boolean }>(result: T): Extract<T, { ok: true }> {
  if (!result.ok) throw new Error(JSON.stringify(result))
  return result as Extract<T, { ok: true }>
}
function envelope(revision: number) {
  return {
    schemaVersion: 2,
    documentId: id(1),
    commandId: id(1000 + revision),
    baseRevision: revision,
    issuedAt: "2026-10-03T00:00:00Z",
    actor: { type: "user", userId: null },
  }
}
function model(
  snapshot: DocumentSnapshotV2,
  kind: string,
  payload: unknown,
  partAllocations: unknown[] = [],
) {
  return applyDocumentV2Command(snapshot, {
    ...envelope(snapshot.revision),
    kind: "org.vibeshape.document.model-command",
    payload: {
      command: { ...envelope(snapshot.revision), schemaVersion: 1, kind, payload },
      partAllocations,
    },
  })
}
function roots() {
  const created = success(
    applyVersionedDocumentCommand(null, {
      ...envelope(0),
      schemaVersion: 1,
      kind: "org.vibeshape.document.create",
      payload: { name: "Combination fixture" },
    }),
  )
  let snapshot = success(
    applyDocumentUpgradeV2Command(created.snapshot, {
      ...envelope(created.snapshot.revision),
      kind: "org.vibeshape.document.upgrade-v2",
      payload: { partAllocations: [] },
    }),
  ).snapshot
  for (const [index, featureId] of [id(2), id(3)].entries()) {
    snapshot = success(
      model(
        snapshot,
        "org.vibeshape.history.insert-feature",
        {
          historyAfter: snapshot.history.at(-1) ?? null,
          feature: {
            schemaVersion: 0,
            id: featureId,
            type: boxFeatureType.type,
            parameters: {
              width: createLengthQuantity(10),
              depth: createLengthQuantity(20),
              height: createLengthQuantity(30),
              centered: false,
            },
            dependencies: [],
            references: [],
            suppressed: false,
          },
        },
        [
          {
            id: id(100 + index),
            name: index ? "Tool" : "Housing",
            origin: "independent",
            body: body(featureId),
          },
        ],
      ),
    ).snapshot
  }
  return snapshot
}
function partBinding(snapshot: DocumentSnapshotV2, partId: string) {
  const part = snapshot.parts.find(({ id }) => id === partId)
  if (!part) throw new Error("Authored PartId must remain present.")
  return partBodyReference(part)
}
function insert(snapshot: DocumentSnapshotV2, feature: unknown, allocations: unknown[] = []) {
  return success(
    model(
      snapshot,
      "org.vibeshape.history.insert-feature",
      { feature, historyAfter: snapshot.history.at(-1) ?? null },
      allocations,
    ),
  )
}

describe("body combination authored identities", () => {
  it("keeps statically unavailable Union roles unconsumed, repairs them, and retains valid disjoint authored intent", () => {
    const zero = createLengthQuantity(0)
    const before = success(
      model(roots(), "org.vibeshape.feature.update", {
        feature: {
          schemaVersion: 0,
          id: id(3),
          type: boxFeatureType.type,
          parameters: {
            width: createLengthQuantity(10),
            depth: createLengthQuantity(20),
            height: createLengthQuantity(30),
            centered: false,
            origin: { x: createLengthQuantity(30), y: zero, z: zero },
          },
          dependencies: [],
          references: [],
          suppressed: false,
        },
      }),
    ).snapshot
    for (const unavailableIndex of [0, 1]) {
      const unavailable = {
        ...combined("union"),
        parameters: {
          bodies: slots().map(({ targetBody }, index) =>
            index === unavailableIndex
              ? { ...targetBody, outputRole: "body.unavailable" }
              : targetBody,
          ),
        },
      }
      const added = insert(before, unavailable).snapshot
      expect(added.parts).toEqual(before.parts)
      const repaired = success(
        model(added, "org.vibeshape.feature.update", { feature: combined("union") }),
      ).snapshot
      expect(partBinding(repaired, id(100))).toEqual<unknown>(body(id(5)))
      expect(repaired.parts.find(({ id: partId }) => partId === id(101))?.consumedBy).toBe<unknown>(
        id(5),
      )
      const unavailableAgain = success(
        model(repaired, "org.vibeshape.feature.update", { feature: unavailable }),
      ).snapshot
      expect(unavailableAgain.parts).toEqual(before.parts)
    }
  })

  it("advances each Compound input PartId in one replayable event and preserves slots on reorder", () => {
    const before = roots()
    const added = insert(before, combined("compound"))
    expect(added.snapshot.parts.map(({ id }) => id)).toEqual<unknown>([id(100), id(101)])
    expect(partBinding(added.snapshot, id(100))).toEqual<unknown>(body(id(5), `body.${id(700)}`))
    expect(partBinding(added.snapshot, id(101))).toEqual<unknown>(body(id(5), `body.${id(701)}`))
    expect(success(reduceDocumentV2Event(before, added.event)).snapshot).toEqual(added.snapshot)
    const reordered = success(
      model(added.snapshot, "org.vibeshape.feature.update", {
        feature: {
          ...combined("compound"),
          parameters: { slots: slots().reverse() },
          dependencies: [id(3), id(2)],
        },
      }),
    ).snapshot
    expect(reordered.parts).toEqual(added.snapshot.parts)
    expect(reordered.revision).toBe(added.snapshot.revision + 1)
  })
  it("restores every source PartId on Compound suppression and blocks all slot advancement if one source is unavailable", () => {
    const before = roots()
    const added = insert(before, combined("compound")).snapshot
    const suppressed = success(
      model(added, "org.vibeshape.feature.update", { feature: combined("compound", true) }),
    ).snapshot
    expect(suppressed.parts).toEqual(before.parts)
    const restored = success(
      model(suppressed, "org.vibeshape.feature.update", { feature: combined("compound") }),
    ).snapshot
    expect(restored.parts).toEqual(added.parts)
    const missing = success(
      model(restored, "org.vibeshape.feature.update", {
        feature: {
          ...combined("compound"),
          parameters: {
            slots: slots().map((slot, index) =>
              index ? slot : { ...slot, targetBody: body(id(2), "body.unavailable") },
            ),
          },
        },
      }),
    ).snapshot
    expect(missing.parts).toEqual(before.parts)
  })
  it("retains the first Union identity, consumes the remaining identities, and restores them on suppression or target reorder", () => {
    const before = roots()
    const added = insert(before, combined("union")).snapshot
    expect(partBinding(added, id(100))).toEqual<unknown>(body(id(5)))
    expect(added.parts.find(({ id: partId }) => partId === id(101))?.consumedBy).toBe<unknown>(
      id(5),
    )
    const suppressed = success(
      model(added, "org.vibeshape.feature.update", { feature: combined("union", true) }),
    ).snapshot
    expect(suppressed.parts).toEqual(before.parts)
    const reordered = success(
      model(suppressed, "org.vibeshape.feature.update", {
        feature: {
          ...combined("union"),
          parameters: {
            bodies: slots()
              .map(({ targetBody }) => targetBody)
              .reverse(),
          },
          dependencies: [id(3), id(2)],
        },
      }),
    ).snapshot
    expect(partBinding(reordered, id(101))).toEqual<unknown>(body(id(5)))
    expect(reordered.parts.find(({ id: partId }) => partId === id(100))?.consumedBy).toBe<unknown>(
      id(5),
    )
  })
  it("requires a captured fresh historical fork per Compound slot and preserves that fork when an earlier modifier is suppressed", () => {
    const before = roots()
    const zero = createLengthQuantity(0)
    const turn = createAngleQuantity(0)
    const placement = {
      schemaVersion: 0,
      id: id(4),
      type: placementFeatureType.type,
      parameters: {
        targetBody: body(id(2)),
        translation: { x: zero, y: zero, z: zero },
        rotation: { x: turn, y: turn, z: turn },
      },
      dependencies: [id(2)],
      references: [],
      suppressed: false,
    }
    const modified = insert(before, placement).snapshot
    expect(
      model(modified, "org.vibeshape.history.insert-feature", {
        feature: combined("compound"),
        historyAfter: modified.history.at(-1),
      }).ok,
    ).toBe(false)
    const forkBody = body(id(5), `body.${id(700)}`)
    const added = insert(modified, combined("compound"), [
      { id: id(102), name: "Historical fork", origin: "fork", body: forkBody },
    ]).snapshot
    expect(partBinding(added, id(100))).toEqual<unknown>(body(id(4)))
    expect(partBinding(added, id(102))).toEqual<unknown>(forkBody)
    expect(added.parts).toHaveLength(3)
    expect(requiredPartAllocations(added, added.parts)).toEqual([])
    const exposed = success(
      model(added, "org.vibeshape.feature.update", { feature: { ...placement, suppressed: true } }),
    ).snapshot
    expect(partBinding(exposed, id(102))).toEqual<unknown>(forkBody)
    expect(exposed.parts.find(({ id: partId }) => partId === id(102))?.origin).toBe("fork")
    expect(exposed.parts.find(({ id: partId }) => partId === id(100))?.consumedBy).toBe<unknown>(
      id(5),
    )
  })
})

function patternedRoots() {
  return insert(
    roots(),
    {
      schemaVersion: 0,
      id: id(6),
      type: patternFeatureType.type,
      dependencies: [id(2)],
      references: [],
      suppressed: false,
      parameters: {
        kind: "linear",
        targetBody: body(id(2)),
        count: createScalarQuantity(3),
        axis: "X",
        spacing: createLengthQuantity(5),
      },
    },
    [1, 2].map((index) => ({
      id: id(101 + index),
      name: `Copy ${index}`,
      origin: "independent",
      body: body(id(6), `pattern.instance.${index}`),
    })),
  ).snapshot
}
function v2Combination(kind: "compound" | "union", suppressed = false) {
  const selected = [1, 2].map((index) => body(id(6), `pattern.instance.${index}`))
  return {
    ...combined(kind, suppressed),
    type: kind === "compound" ? compoundFeatureTypeV2.type : unionFeatureTypeV2.type,
    dependencies: [id(6)],
    parameters:
      kind === "compound"
        ? { slots: selected.map((targetBody, index) => ({ slotId: id(700 + index), targetBody })) }
        : { bodies: selected },
  }
}
describe("ordered same-producer body ownership", () => {
  it.each(["compound", "union"] as const)(
    "binds both %s inputs independently and restores every source on suppression",
    (kind) => {
      const before = patternedRoots()
      const added = insert(before, v2Combination(kind))
      expect(partBinding(added.snapshot, id(102))).toEqual<unknown>(
        body(id(5), kind === "compound" ? `body.${id(700)}` : "result"),
      )
      if (kind === "compound")
        expect(partBinding(added.snapshot, id(103))).toEqual<unknown>(
          body(id(5), `body.${id(701)}`),
        )
      else
        expect(added.snapshot.parts.find((part) => part.id === id(103))?.consumedBy).toBe<unknown>(
          id(5),
        )
      expect(partBinding(added.snapshot, id(100))).toEqual<unknown>(
        body(id(6), "pattern.instance.0"),
      )
      expect(partBinding(added.snapshot, id(101))).toEqual<unknown>(body(id(3)))
      expect(success(reduceDocumentV2Event(before, added.event)).snapshot).toEqual(added.snapshot)
      const suppressed = success(
        model(added.snapshot, "org.vibeshape.feature.update", {
          feature: v2Combination(kind, true),
        }),
      ).snapshot
      expect(suppressed.parts).toEqual(before.parts)
    },
  )
  it.each(["compound", "union"] as const)(
    "keeps unavailable or invalid %s intent from consuming any source body",
    (kind) => {
      const before = patternedRoots()
      const parameters =
        kind === "compound"
          ? {
              slots: [
                { slotId: id(700), targetBody: body(id(6), "pattern.instance.1") },
                { slotId: id(701), targetBody: body(id(6), "pattern.instance.99") },
              ],
            }
          : { bodies: [body(id(6), "pattern.instance.1"), body(id(6), "pattern.instance.99")] }
      const unavailable = insert(before, { ...v2Combination(kind), parameters }).snapshot
      expect(unavailable.parts).toEqual(before.parts)
      const duplicate =
        kind === "compound"
          ? {
              slots: [700, 701].map((index) => ({
                slotId: id(index),
                targetBody: body(id(6), "pattern.instance.1"),
              })),
            }
          : { bodies: [body(id(6), "pattern.instance.1"), body(id(6), "pattern.instance.1")] }
      const result = model(unavailable, "org.vibeshape.feature.update", {
        feature: { ...v2Combination(kind), parameters: duplicate },
      })
      expect(registry().validateFeature({ ...v2Combination(kind), parameters: duplicate }).ok).toBe(
        false,
      )
      expect(success(result).snapshot.parts).toEqual(before.parts)
      expect(unavailable.parts).toEqual(before.parts)
    },
  )
  it("migrates only on explicit version 2 update and preserves authored output slots", () => {
    const before = patternedRoots()
    const legacy = {
      ...combined("compound"),
      dependencies: [id(6), id(3)],
      parameters: {
        slots: [
          { slotId: id(700), targetBody: body(id(6), "pattern.instance.1") },
          { slotId: id(701), targetBody: body(id(3)) },
        ],
      },
    }
    const old = insert(before, legacy).snapshot
    expect(old.features.find((feature) => feature.id === id(5))?.type?.schemaVersion).toBe(1)
    const upgraded = success(
      model(old, "org.vibeshape.feature.update", { feature: v2Combination("compound") }),
    ).snapshot
    expect(upgraded.features.find((feature) => feature.id === id(5))?.type?.schemaVersion).toBe(2)
    expect(partBinding(upgraded, id(102))).toEqual<unknown>(body(id(5), `body.${id(700)}`))
    expect(partBinding(upgraded, id(103))).toEqual<unknown>(body(id(5), `body.${id(701)}`))
    expect(partBinding(upgraded, id(101))).toEqual<unknown>(body(id(3)))
    expect(old.features.find((feature) => feature.id === id(5))?.type?.schemaVersion).toBe(1)
  })
})
