import { describe, expect, it } from "vitest"
import { documentSnapshotV2Schema } from "./document-v2"
import { applyDocumentV2Command } from "./document-v2-commands"
import { applyDocumentUpgradeV2Command } from "./document-v2-migration"
import { replayDocumentAuthorityEvents } from "./document-v2-replay"
import { applyDocumentV3Command } from "./document-v3-commands"
import {
  type DocumentSnapshotV4,
  documentSnapshotV4Schema,
  projectDocumentSnapshotV4ToV2,
} from "./document-v4"
import { applyDocumentV4Command, reduceDocumentV4Event } from "./document-v4-commands"
import { createFeatureContentIdentity } from "./feature-content-identity"
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
import { partDesignFeatureTypeHandlers } from "./part-design"
import {
  importedBodyOutputRole,
  importedFeatureParametersSchema,
  importedFeatureType,
  readImportedFeatureParameters,
  validateImportedFeatureAssets,
} from "./part-design-import"
import { sourceAssetSchema } from "./source-assets"
import { applyVersionedDocumentCommand } from "./versioned-document-commands"

const id = (n: number) => `0195b5ac-b220-7a2c-8c33-${n.toString(16).padStart(12, "0")}`
const signature = {
  volume: 24,
  area: 52,
  centroid: [1, 1.5, 2],
  bounds: { min: [0, 0, 0], max: [2, 3, 4] },
  faceCount: 6,
  edgeCount: 24,
}
const asset = sourceAssetSchema.parse({
  id: id(10),
  digest: "a".repeat(64),
  byteLength: 123,
  filename: "Bodies.step",
  format: "step",
  representation: "exact-solid",
  normalization: { sourceUnit: "millimeter", scaleToMillimeters: 1, normalizedUnit: "millimeter" },
  outputs: [id(11), id(12)],
})
function feature() {
  return featureRecordSchema.parse({
    schemaVersion: 0,
    id: id(20),
    type: importedFeatureType.type,
    dependencies: [],
    references: [],
    suppressed: false,
    parameters: {
      sourceAssetId: asset.id,
      source: {
        digest: asset.digest,
        byteLength: asset.byteLength,
        format: asset.format,
        normalization: asset.normalization,
        unitPolicy: "step-system-mm",
        readerPolicyVersion: 1,
      },
      outputs: asset.outputs.map((outputId) => ({ outputId, signature })),
      matchingPolicyVersion: 1,
    },
  })
}
function value<T extends { ok: boolean }>(result: T): Extract<T, { ok: true }> {
  if (!result.ok) throw new Error(JSON.stringify(result))
  return result as Extract<T, { ok: true }>
}
function envelope(baseRevision: number) {
  return {
    documentId: id(1),
    commandId: id(100 + baseRevision),
    baseRevision,
    issuedAt: "2026-10-03T00:00:00Z",
    actor: { type: "user", userId: null },
  }
}
function fixture() {
  const created = value(
    applyVersionedDocumentCommand(null, {
      ...envelope(0),
      schemaVersion: 1,
      kind: "org.vibeshape.document.create",
      payload: { name: "Exact source fixture" },
    }),
  )
  const authored = value(
    applyDocumentUpgradeV2Command(created.snapshot, {
      ...envelope(1),
      schemaVersion: 2,
      kind: "org.vibeshape.document.upgrade-v2",
      payload: { partAllocations: [] },
    }),
  )
  const textureUpgraded = value(
    applyDocumentV3Command(authored.snapshot, {
      ...envelope(2),
      schemaVersion: 3,
      kind: "org.vibeshape.document.upgrade-v3",
      payload: { change: null },
    }),
  )
  const upgraded = value(
    applyDocumentV4Command(textureUpgraded.snapshot, {
      ...envelope(3),
      schemaVersion: 4,
      kind: "org.vibeshape.document.upgrade-v4",
      payload: {},
    }),
  )
  const sourced = value(
    applyDocumentV4Command(upgraded.snapshot, {
      ...envelope(4),
      schemaVersion: 4,
      kind: "org.vibeshape.document.add-source-assets",
      payload: { assets: [asset] },
    }),
  )
  return {
    snapshot: sourced.snapshot,
    events: [created.event, authored.event, textureUpgraded.event, upgraded.event, sourced.event],
  }
}
function allocations() {
  return asset.outputs.map((outputId, index) => ({
    id: id(30 + index),
    name: `Imported body ${index + 1}`,
    body: { schemaVersion: 0, featureId: id(20), outputRole: importedBodyOutputRole(outputId) },
    origin: "independent",
  }))
}
function insert(snapshot: DocumentSnapshotV4, partAllocations: unknown = allocations()) {
  return applyDocumentV2Command(projectDocumentSnapshotV4ToV2(snapshot), {
    ...envelope(snapshot.revision),
    schemaVersion: 2,
    kind: "org.vibeshape.document.model-command",
    payload: {
      command: {
        ...envelope(snapshot.revision),
        schemaVersion: 1,
        kind: "org.vibeshape.history.insert-feature",
        payload: { feature: feature(), historyAfter: null },
      },
      partAllocations,
    },
  })
}
function registry() {
  const modules = value(
    createModuleRegistry([documentCoreModule, featureCoreModule, partDesignModule]),
  )
  return value(createFeatureTypeRegistry(modules.registry, partDesignFeatureTypeHandlers)).registry
}

describe("captured exact source body features", () => {
  it("registers dependency-free immutable content and excludes only the source asset record identity", () => {
    const original = feature()
    expect(registry().validateFeature(original)).toMatchObject({
      ok: true,
      contentParameters: { source: { digest: asset.digest }, matchingPolicyVersion: 1 },
    })
    expect(readImportedFeatureParameters(original)?.sourceAssetId).toBe(asset.id)
    expect(featureBodyDependencies(original)).toEqual([])
    expect(
      readImportedFeatureParameters({ ...original, type: { ...original.type, schemaVersion: 2 } }),
    ).toBeNull()
    expect(registry().validateFeature({ ...original, dependencies: [id(99)] }).ok).toBe(false)
    const parameters = importedFeatureParametersSchema.parse(original.parameters)
    const environment = {
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
    const input = { feature: original, environment, dependencies: [] }
    const identity = createFeatureContentIdentity(registry(), input)
    expect(identity.ok).toBe(true)
    expect(
      createFeatureContentIdentity(registry(), {
        ...input,
        feature: { ...original, id: id(99), parameters: { ...parameters, sourceAssetId: id(98) } },
      }),
    ).toEqual(identity)
    expect(
      createFeatureContentIdentity(registry(), {
        ...input,
        feature: {
          ...original,
          parameters: { ...parameters, source: { ...parameters.source, digest: "b".repeat(64) } },
        },
      }),
    ).not.toEqual(identity)
    expect(
      createFeatureContentIdentity(registry(), {
        ...input,
        feature: {
          ...original,
          parameters: { ...parameters, outputs: [...parameters.outputs].reverse() },
        },
      }),
    ).not.toEqual(identity)
  })

  it("captures an independent Part for every output and replays their UUIDs through Undo and Redo", () => {
    const f = fixture()
    const added = value(insert(f.snapshot))
    expect(
      added.snapshot.parts.map(({ origin, bodyHistory }) => ({ origin, bodyHistory })),
    ).toEqual(allocations().map(({ origin, body }) => ({ origin, bodyHistory: [body] })))
    const event = {
      ...envelope(f.snapshot.revision),
      schemaVersion: 4,
      type: "org.vibeshape.document.authored-changed",
      transactionId: null,
      revision: f.snapshot.revision + 1,
      authoredEvent: added.event,
    }
    const imported = value(reduceDocumentV4Event(f.snapshot, event)).snapshot
    expect(imported.assets).toEqual([asset])
    expect(
      requiredPartAllocations(projectDocumentSnapshotV4ToV2(imported), imported.parts),
    ).toEqual([])
    const undo = {
      ...envelope(imported.revision),
      schemaVersion: 4,
      type: "org.vibeshape.document.restored",
      transactionId: null,
      revision: imported.revision + 1,
      direction: "undo",
      targetRevision: f.snapshot.revision,
    }
    const reverted = value(reduceDocumentV4Event(imported, undo, f.snapshot)).snapshot
    expect(reverted.parts).toEqual([])
    const redo = {
      ...envelope(reverted.revision),
      schemaVersion: 4,
      type: "org.vibeshape.document.restored",
      transactionId: null,
      revision: reverted.revision + 1,
      direction: "redo",
      targetRevision: imported.revision,
    }
    const redone = value(reduceDocumentV4Event(reverted, redo, imported)).snapshot
    expect(redone.parts).toEqual(imported.parts)
    expect(
      value(replayDocumentAuthorityEvents(null, [...f.events, event, undo, redo])).snapshot,
    ).toEqual(redone)
  })

  it("rejects missing, partial, reused and modifier-style allocations without publishing any Part", () => {
    const f = fixture()
    const parts = allocations()
    for (const invalid of [
      [],
      parts.slice(0, 1),
      parts.map((part) => ({ ...part, id: id(30) })),
      parts.map((part) => ({ ...part, origin: "fork" })),
      [...parts, { ...parts[0], id: id(99) }],
    ])
      expect(insert(f.snapshot, invalid).ok).toBe(false)
    expect(f.snapshot.parts).toEqual([])
  })

  it("checks persisted asset closure in V4 while keeping the historical V2 structural projection", () => {
    const f = fixture()
    const added = value(insert(f.snapshot))
    const snapshot = { ...added.snapshot, schemaVersion: 4, surfaceTextures: [], assets: [asset] }
    expect(documentSnapshotV4Schema.safeParse(snapshot).success).toBe(true)
    expect(documentSnapshotV2Schema.safeParse(added.snapshot).success).toBe(true)
    for (const assets of [
      [],
      [{ ...asset, digest: "b".repeat(64) }],
      [{ ...asset, outputs: [...asset.outputs].reverse() }],
      [{ ...asset, format: "stl", representation: "triangle-mesh" }],
      [{ ...asset, normalization: { ...asset.normalization, scaleToMillimeters: 25.4 } }],
    ])
      expect(documentSnapshotV4Schema.safeParse({ ...snapshot, assets }).success).toBe(false)
    expect(validateImportedFeatureAssets({ features: [feature()], assets: [] })).toContain(
      "persisted exact-solid",
    )
  })

  it("rejects empty outputs, duplicated IDs, hostile bounds, unknown policies and unknown source units", () => {
    const parameters = importedFeatureParametersSchema.parse(feature().parameters)
    for (const changed of [
      { outputs: [] },
      { outputs: [...parameters.outputs, ...parameters.outputs] },
      {
        outputs: Array.from({ length: 129 }, (_, index) => ({
          outputId: id(500 + index),
          signature,
        })),
      },
      { outputs: [{ outputId: id(11), signature: { ...signature, volume: 0 } }] },
      { source: { ...parameters.source, readerPolicyVersion: 2 } },
      { source: { ...parameters.source, unitPolicy: "brep-source-normalized" } },
      {
        source: {
          ...parameters.source,
          normalization: { ...parameters.source.normalization, sourceUnit: "unitless" },
        },
      },
      { matchingPolicyVersion: 2 },
      { extra: true },
    ])
      expect(importedFeatureParametersSchema.safeParse({ ...parameters, ...changed }).success).toBe(
        false,
      )
  })
})
