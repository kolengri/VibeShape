import { describe, expect, it } from "bun:test"
import {
  assemblyAuthoritySchema,
  captureAssemblyDefinition,
  emptyAssemblyAuthority,
  projectAssemblyAuthority,
  upgradeAssemblyAuthority,
} from "./assembly-authority"
import { solveAssemblyKinematics } from "./assembly-kinematics"
import { applyDocumentV2Command } from "./document-v2-commands"
import { copyCompleteDocumentAuthorityHistory } from "./document-v2-copy"
import { applyDocumentUpgradeV2Command } from "./document-v2-migration"
import { replayDocumentAuthorityEvents } from "./document-v2-replay"
import { applyDocumentV3Command } from "./document-v3-commands"
import {
  type DocumentSnapshotV4,
  documentSnapshotV4Schema,
  projectDocumentSnapshotV4ToV2,
} from "./document-v4"
import {
  documentV4AssemblyEventSchema,
  documentV4AuthoredEventSchema,
} from "./document-v4-command-schemas"
import { applyDocumentV4Command, reduceDocumentV4Event } from "./document-v4-commands"
import { featureIdSchema } from "./identifiers"
import { boxFeatureType, extrusionFeatureTypeV5 } from "./part-design"
import { importedBodyOutputRole, importedFeatureType } from "./part-design-import"
import { meshImportFeatureType, meshImportOutputRole } from "./part-design-mesh-import"
import { mirrorFeatureType } from "./part-design-mirror"
import { datumPlaneFeatureType } from "./reference-geometry"
import { documentSourceAssetClosure } from "./source-asset-closure"
import { sourceAssetSchema } from "./source-assets"
import { createDefaultSurfaceTextureLayer, surfaceTextureLayerIdSchema } from "./surface-textures"
import { createLengthQuantity } from "./units"
import { applyVersionedDocumentCommand } from "./versioned-document-commands"

const id = (n: number) => `0195b5ac-b220-7a2c-8c33-${n.toString(16).padStart(12, "0")}`
const pose = { translation: [0, 0, 0], quaternion: [0, 0, 0, 1] }
const asset = sourceAssetSchema.parse({
  id: id(80),
  digest: "b".repeat(64),
  byteLength: 123,
  filename: "Body.3mf",
  format: "3mf",
  representation: "triangle-mesh",
  normalization: { sourceUnit: "millimeter", scaleToMillimeters: 1, normalizedUnit: "millimeter" },
  outputs: [id(81)],
})
function value<T extends { ok: boolean }>(result: T): Extract<T, { ok: true }> {
  if (!result.ok) throw new Error(JSON.stringify(result))
  return result as Extract<T, { ok: true }>
}
function envelope(revision: number) {
  return {
    documentId: id(1),
    commandId: id(1000 + revision),
    baseRevision: revision,
    issuedAt: "2026-10-03T00:00:00Z",
    actor: { type: "user", userId: null },
  }
}
function body() {
  return { schemaVersion: 0, featureId: id(2), outputRole: "result" }
}
function box(featureId = 2, width = 10) {
  return {
    schemaVersion: 0,
    id: id(featureId),
    type: boxFeatureType.type,
    dependencies: [],
    references: [],
    suppressed: false,
    parameters: {
      width: createLengthQuantity(width),
      depth: createLengthQuantity(20),
      height: createLengthQuantity(30),
      centered: false,
    },
  }
}
function definition() {
  return {
    schemaVersion: 1,
    id: id(50),
    name: "Frozen bracket",
    sources: [{ kind: "part", partId: id(30), body: body(), contentHash: "a".repeat(64) }],
    sourceFrame: pose,
  }
}
function instance(n: number, grounded = true) {
  return grounded
    ? {
        schemaVersion: 1,
        id: id(n),
        definitionId: id(50),
        name: `Occurrence ${n}`,
        grounded: true,
        worldFrame: pose,
      }
    : {
        schemaVersion: 1,
        id: id(n),
        definitionId: id(50),
        name: `Occurrence ${n}`,
        grounded: false,
      }
}
function joint(
  kind: "fixed" | "revolute" | "prismatic" = "fixed",
  n = 70,
  parent = 60,
  child = 61,
) {
  const fields = {
    schemaVersion: 1,
    id: id(n),
    kind,
    parentInstanceId: id(parent),
    childInstanceId: id(child),
    parentFrame: pose,
    childFrame: pose,
  }
  return kind === "fixed"
    ? fields
    : { ...fields, axis: [0, 0, 1], value: 0, limits: { min: -1, max: 1 } }
}
function fixture() {
  const created = value(
    applyVersionedDocumentCommand(null, {
      ...envelope(0),
      schemaVersion: 1,
      kind: "org.vibeshape.document.create",
      payload: { name: "Assembly source fixture" },
    }),
  )
  const upgraded = value(
    applyDocumentUpgradeV2Command(created.snapshot, {
      ...envelope(1),
      schemaVersion: 2,
      kind: "org.vibeshape.document.upgrade-v2",
      payload: { partAllocations: [] },
    }),
  )
  const source = value(
    applyDocumentV2Command(upgraded.snapshot, {
      ...envelope(2),
      schemaVersion: 2,
      kind: "org.vibeshape.document.model-command",
      payload: {
        command: {
          ...envelope(2),
          schemaVersion: 1,
          kind: "org.vibeshape.history.insert-feature",
          payload: { feature: box(), historyAfter: null },
        },
        partAllocations: [{ id: id(30), name: "Bracket", body: body(), origin: "independent" }],
      },
    }),
  )
  const unrelated = value(
    applyDocumentV2Command(source.snapshot, {
      ...envelope(3),
      schemaVersion: 2,
      kind: "org.vibeshape.document.model-command",
      payload: {
        command: {
          ...envelope(3),
          schemaVersion: 1,
          kind: "org.vibeshape.history.insert-feature",
          payload: { feature: box(3), historyAfter: { kind: "feature", id: id(2) } },
        },
        partAllocations: [
          {
            id: id(31),
            name: "Unrelated",
            body: { schemaVersion: 0, featureId: id(3), outputRole: "result" },
            origin: "independent",
          },
        ],
      },
    }),
  )
  const texture = value(
    applyDocumentV3Command(unrelated.snapshot, {
      ...envelope(4),
      schemaVersion: 3,
      kind: "org.vibeshape.document.upgrade-v3",
      payload: { change: null },
    }),
  )
  const v3 = value(
    applyDocumentV4Command(texture.snapshot, {
      ...envelope(5),
      schemaVersion: 4,
      kind: "org.vibeshape.document.upgrade-v4",
      payload: {},
    }),
  )
  return {
    snapshot: v3.snapshot,
    events: [created.event, upgraded.event, source.event, unrelated.event, texture.event, v3.event],
  }
}
function mutate(snapshot: DocumentSnapshotV4, changes: unknown, baseRevision = snapshot.revision) {
  return applyDocumentV4Command(snapshot, {
    ...envelope(baseRevision),
    schemaVersion: 4,
    kind: "org.vibeshape.document.assembly-command",
    payload: { changes },
  })
}
function populated() {
  const f = fixture()
  const added = value(
    mutate(f.snapshot, [
      { kind: "definition.create", definition: definition() },
      { kind: "instance.create", instance: instance(60) },
      { kind: "instance.create", instance: instance(61, false) },
      { kind: "joint.create", joint: joint("revolute") },
    ]),
  )
  return { ...f, added }
}
function meshImport(snapshot: DocumentSnapshotV4, featureId = 4, nodeKey = "3mf.node.1") {
  const outputId = asset.outputs[0]
  if (!outputId) throw new Error("Expected captured mesh output.")
  const selectedBody = {
    schemaVersion: 0,
    featureId: id(featureId),
    outputRole: meshImportOutputRole(outputId),
  }
  const feature = {
    schemaVersion: 0,
    id: id(featureId),
    type: meshImportFeatureType.type,
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
        parserPolicyVersion: 1,
      },
      outputs: [{ outputId, nodeKey }],
    },
  }
  return authoredImport(snapshot, feature, selectedBody, id(90 + featureId))
}
function authoredImport(
  snapshot: DocumentSnapshotV4,
  feature: unknown,
  selectedBody: { schemaVersion: number; featureId: string; outputRole: string },
  partId: string,
) {
  const authored = value(
    applyDocumentV2Command(projectDocumentSnapshotV4ToV2(snapshot), {
      ...envelope(snapshot.revision),
      schemaVersion: 2,
      kind: "org.vibeshape.document.model-command",
      payload: {
        command: {
          ...envelope(snapshot.revision),
          schemaVersion: 1,
          kind: "org.vibeshape.history.insert-feature",
          payload: { feature, historyAfter: snapshot.history.at(-1) ?? null },
        },
        partAllocations: [
          { id: partId, name: "Imported body", body: selectedBody, origin: "independent" },
        ],
      },
    }),
  )
  const event = documentV4AuthoredEventSchema.parse({
    ...envelope(snapshot.revision),
    schemaVersion: 4 as const,
    type: "org.vibeshape.document.authored-changed" as const,
    transactionId: null,
    revision: snapshot.revision + 1,
    authoredEvent: authored.event,
  })
  return { snapshot: value(reduceDocumentV4Event(snapshot, event)).snapshot, event, selectedBody }
}

describe("typed V3 assembly authority", () => {
  it("defaults prior source-only V3 payloads to an empty collection without relaxing V2", () => {
    const f = fixture()
    const { assembly: _assembly, ...prior } = f.snapshot
    expect(documentSnapshotV4Schema.parse(prior).assembly).toEqual(emptyAssemblyAuthority())
    expect(projectDocumentSnapshotV4ToV2(f.snapshot).schemaVersion).toBe(2)
    expect(
      documentSnapshotV4Schema.safeParse({
        ...prior,
        assembly: { ...emptyAssemblyAuthority(), unknown: true },
      }).success,
    ).toBe(false)
  })

  it("captures only the selected typed history closure and retains stable occurrence identities", () => {
    const f = populated()
    const captured = f.added.snapshot.assembly.definitions[0]
    expect(captured?.pinRevision).toBe(1)
    expect(captured?.pinnedModels[0]?.selectedBody).toEqual<unknown>(body())
    expect(captured?.pinnedModels[0]?.snapshot.features.map(({ id }) => id)).toEqual<unknown>([
      id(2),
    ])
    expect(captured?.pinnedModels[0]?.snapshot.history).toEqual<unknown>([
      { kind: "feature", id: id(2) },
    ])
    expect(f.added.snapshot.parts).toEqual(f.snapshot.parts)
    expect(solveAssemblyKinematics(projectAssemblyAuthority(f.added.snapshot.assembly)).ok).toBe(
      true,
    )
    expect(value(reduceDocumentV4Event(f.snapshot, f.added.event)).snapshot).toEqual(
      f.added.snapshot,
    )
  })

  it("keeps a source frozen after Part edits and captures replacement only through explicit relink", () => {
    const f = populated()
    const edited = value(
      applyDocumentV2Command(projectDocumentSnapshotV4ToV2(f.added.snapshot), {
        ...envelope(7),
        schemaVersion: 2,
        kind: "org.vibeshape.document.model-command",
        payload: {
          command: {
            ...envelope(7),
            schemaVersion: 1,
            kind: "org.vibeshape.feature.update",
            payload: { feature: box(2, 40) },
          },
          partAllocations: [],
        },
      }),
    )
    const event = {
      ...envelope(7),
      schemaVersion: 4,
      type: "org.vibeshape.document.authored-changed",
      transactionId: null,
      revision: 8,
      authoredEvent: edited.event,
    }
    const current = value(reduceDocumentV4Event(f.added.snapshot, event)).snapshot
    expect(current.assembly).toEqual(f.added.snapshot.assembly)
    const updated = value(
      mutate(current, [
        { kind: "definition.update", definitionId: id(50), name: "Renamed frozen bracket" },
      ]),
    ).snapshot
    expect(updated.assembly.definitions[0]?.pinnedModels).toEqual(
      current.assembly.definitions[0]?.pinnedModels,
    )
    expect(
      mutate(current, [
        { kind: "definition.update", definitionId: id(50), sources: definition().sources },
      ]).ok,
    ).toBe(false)
    const replacement = {
      ...definition(),
      sources: [{ ...definition().sources[0], contentHash: "c".repeat(64) }],
    }
    const relinked = value(
      mutate(updated, [{ kind: "definition.relink", definition: replacement }]),
    ).snapshot
    expect(relinked.assembly.definitions[0]?.pinRevision).toBe(2)
    expect(
      relinked.assembly.definitions[0]?.pinnedModels[0]?.snapshot.features[0]?.parameters.width,
    ).toEqual(createLengthQuantity(40))
    expect(relinked.assembly.instances).toEqual(current.assembly.instances)
  })

  it("rejects forged frozen content, missing ownership, role drift and stale revisions atomically", () => {
    const f = populated()
    for (const changed of [{ partId: id(99) }, { body: { ...body(), outputRole: "body.absent" } }])
      expect(
        mutate(f.snapshot, [
          {
            kind: "definition.create",
            definition: { ...definition(), sources: [{ ...definition().sources[0], ...changed }] },
          },
        ]).ok,
      ).toBe(false)
    expect(
      mutate(f.snapshot, [{ kind: "definition.create", definition: definition() }], 4),
    ).toMatchObject({ ok: false, diagnostic: { code: "stale-revision" } })
    if (f.added.event.type !== "org.vibeshape.document.assembly-changed")
      throw new Error("Expected captured assembly event.")
    const forged = documentV4AssemblyEventSchema.parse(JSON.parse(JSON.stringify(f.added.event)))
    const create = forged.changes.find((change) => change.kind === "definition.create")
    if (create?.kind !== "definition.create") throw new Error("Expected captured definition.")
    const model = create.definition.pinnedModels[0]
    if (!model?.snapshot.features[0]) throw new Error("Expected frozen feature.")
    model.snapshot.features[0].parameters.width = createLengthQuantity(999)
    expect(
      assemblyAuthoritySchema.safeParse({
        ...f.added.snapshot.assembly,
        definitions: [create.definition],
      }).success,
    ).toBe(true)
    expect(reduceDocumentV4Event(f.snapshot, forged).ok).toBe(false)
    expect(f.snapshot.assembly).toEqual(emptyAssemblyAuthority())
  })

  it.each(["revolute", "prismatic"] as const)(
    "keeps %s joint drives within inclusive limits without clamping",
    (kind) => {
      const f = populated()
      for (const drive of [-1, 1])
        expect(
          mutate(f.added.snapshot, [
            { kind: "joint.update", joint: { ...joint(kind), value: drive } },
          ]).ok,
        ).toBe(true)
      expect(
        mutate(f.added.snapshot, [
          { kind: "joint.update", joint: { ...joint(kind), value: 1.0001 } },
        ]).ok,
      ).toBe(false)
      expect(
        mutate(f.added.snapshot, [
          { kind: "joint.update", joint: { ...joint(kind), limits: { min: 1, max: -1 } } },
        ]).ok,
      ).toBe(false)
      expect(mutate(f.added.snapshot, [{ kind: "joint.remove", jointId: id(70) }]).ok).toBe(false)
      expect(
        mutate(f.added.snapshot, [
          { kind: "joint.remove", jointId: id(70) },
          { kind: "instance.update", instance: instance(61) },
        ]).ok,
      ).toBe(true)
    },
  )

  it("rejects invalid forests and cleans dependent subtrees only with explicit cascade", () => {
    const f = populated()
    expect(mutate(f.added.snapshot, [{ kind: "joint.create", joint: joint("fixed", 71) }]).ok).toBe(
      false,
    )
    expect(
      mutate(f.added.snapshot, [
        { kind: "instance.update", instance: instance(60, false) },
        { kind: "joint.create", joint: joint("fixed", 71, 61, 60) },
      ]).ok,
    ).toBe(false)
    expect(mutate(f.added.snapshot, [{ kind: "instance.remove", instanceId: id(60) }]).ok).toBe(
      false,
    )
    const removed = value(
      mutate(f.added.snapshot, [{ kind: "instance.remove", instanceId: id(60), cascade: true }]),
    ).snapshot
    expect(removed.assembly.instances).toEqual([])
    expect(removed.assembly.joints).toEqual([])
    expect(mutate(f.added.snapshot, [{ kind: "definition.remove", definitionId: id(50) }]).ok).toBe(
      false,
    )
    expect(
      value(
        mutate(f.added.snapshot, [
          { kind: "definition.remove", definitionId: id(50), cascade: true },
        ]),
      ).snapshot.assembly,
    ).toEqual(emptyAssemblyAuthority())
  })

  it("restores all frozen pins through Undo, Redo, complete replay and native-copy history", () => {
    const f = populated()
    const undo = {
      ...envelope(7),
      schemaVersion: 4,
      type: "org.vibeshape.document.restored",
      transactionId: null,
      revision: 8,
      direction: "undo",
      targetRevision: 6,
    }
    const undone = value(reduceDocumentV4Event(f.added.snapshot, undo, f.snapshot)).snapshot
    const redo = {
      ...envelope(8),
      schemaVersion: 4,
      type: "org.vibeshape.document.restored",
      transactionId: null,
      revision: 9,
      direction: "redo",
      targetRevision: 7,
    }
    const events = [...f.events, f.added.event, undo, redo]
    const snapshot = value(replayDocumentAuthorityEvents(null, events)).snapshot
    expect(snapshot.schemaVersion === 4 ? snapshot.assembly : null).toEqual(
      f.added.snapshot.assembly,
    )
    expect(undone.assembly).toEqual(emptyAssemblyAuthority())
    const copied = value(
      copyCompleteDocumentAuthorityHistory({
        sourceSeed: null,
        sourceLegacyEvents: [],
        sourceSnapshot: snapshot,
        sourceEvents: events,
        documentId: id(999),
        commandIds: Array.from({ length: 10 }, (_, index) => id(1100 + index)),
        transactionIds: [],
        name: "Assembly copy",
        issuedAt: "2026-10-03T00:00:00Z",
        actor: { type: "user", userId: null },
      }),
    )
    expect(copied.snapshot.schemaVersion === 4 ? copied.snapshot.assembly : null).toEqual(
      f.added.snapshot.assembly,
    )
  })

  it("requires immutable asset pin IDs/digests/outputs and preserves source closure after removing the definition", () => {
    const f = fixture()
    const sourced = value(
      applyDocumentV4Command(f.snapshot, {
        ...envelope(6),
        schemaVersion: 4,
        kind: "org.vibeshape.document.add-source-assets",
        payload: { assets: [asset] },
      }),
    )
    const def = {
      ...definition(),
      sources: [
        {
          kind: "asset-output",
          assetId: asset.id,
          outputId: asset.outputs[0],
          digest: asset.digest,
        },
      ],
    }
    expect(() => captureAssemblyDefinition(sourced.snapshot, def)).toThrow("Import the asset")
    const imported = meshImport(sourced.snapshot)
    const added = value(mutate(imported.snapshot, [{ kind: "definition.create", definition: def }]))
    const pinned = added.snapshot.assembly.definitions[0]?.pinnedModels[0]
    expect(pinned?.selectedBody).toEqual<unknown>(imported.selectedBody)
    expect(pinned?.snapshot.features[0]?.parameters).toEqual(
      imported.snapshot.features.find(({ id }) => id === imported.selectedBody.featureId)
        ?.parameters,
    )
    expect(captureAssemblyDefinition(imported.snapshot, def).sources).toEqual<unknown>(def.sources)
    expect(documentSourceAssetClosure(null, [added.event], f.snapshot)).toEqual([asset])
    for (const changed of [{ assetId: id(99) }, { digest: "d".repeat(64) }, { outputId: id(99) }])
      expect(
        mutate(imported.snapshot, [
          {
            kind: "definition.create",
            definition: { ...def, sources: [{ ...def.sources[0], ...changed }] },
          },
        ]).ok,
      ).toBe(false)
    const removed = value(
      mutate(added.snapshot, [{ kind: "definition.remove", definitionId: id(50) }]),
    )
    expect(
      documentSourceAssetClosure(
        null,
        [...f.events, sourced.event, imported.event, added.event, removed.event],
        removed.snapshot,
      ),
    ).toEqual([asset])
  })

  it("deduplicates identical import producers by stable identity and rejects conflicting manifests", () => {
    const f = fixture()
    const sourced = value(
      applyDocumentV4Command(f.snapshot, {
        ...envelope(6),
        schemaVersion: 4,
        kind: "org.vibeshape.document.add-source-assets",
        payload: { assets: [asset] },
      }),
    ).snapshot
    const def = {
      ...definition(),
      sources: [
        { kind: "asset-output", assetId: asset.id, outputId: id(81), digest: asset.digest },
      ],
    }
    const first = meshImport(sourced, 5)
    const identical = meshImport(first.snapshot, 4)
    const captured = captureAssemblyDefinition(identical.snapshot, def)
    expect(captured.pinnedModels[0]?.selectedBody.featureId).toBe<unknown>(id(4))
    const conflicting = meshImport(identical.snapshot, 6, "3mf.node.2")
    expect(() => captureAssemblyDefinition(conflicting.snapshot, def)).toThrow(
      "conflicting import manifests",
    )
    expect(mutate(conflicting.snapshot, [{ kind: "definition.create", definition: def }]).ok).toBe(
      false,
    )
    const pinned = captured.pinnedModels[0]
    if (!pinned) throw new Error("Expected captured import producer.")
    expect(
      assemblyAuthoritySchema.safeParse({
        ...emptyAssemblyAuthority(),
        definitions: [{ ...captured, pinnedModels: [{ ...pinned, selectedBody: body() }] }],
      }).success,
    ).toBe(false)
  })

  it("pins exact imported output roles and geometric matching manifests for direct STEP sources", () => {
    const f = fixture()
    const exactAsset = sourceAssetSchema.parse({
      ...asset,
      format: "step",
      representation: "exact-solid",
      filename: "Bracket.step",
    })
    const sourced = value(
      applyDocumentV4Command(f.snapshot, {
        ...envelope(6),
        schemaVersion: 4,
        kind: "org.vibeshape.document.add-source-assets",
        payload: { assets: [exactAsset] },
      }),
    ).snapshot
    const selectedBody = {
      schemaVersion: 0,
      featureId: id(4),
      outputRole: importedBodyOutputRole(id(81)),
    }
    const signature = {
      volume: 6000,
      area: 2200,
      centroid: [5, 10, 15],
      bounds: { min: [0, 0, 0], max: [10, 20, 30] },
      faceCount: 6,
      edgeCount: 12,
    }
    const parameters = {
      sourceAssetId: exactAsset.id,
      source: {
        digest: exactAsset.digest,
        byteLength: exactAsset.byteLength,
        format: "step",
        normalization: exactAsset.normalization,
        unitPolicy: "step-system-mm",
        readerPolicyVersion: 1,
      },
      outputs: [{ outputId: id(81), signature }],
      matchingPolicyVersion: 1,
    }
    const imported = authoredImport(
      sourced,
      {
        schemaVersion: 0,
        id: id(4),
        type: importedFeatureType.type,
        suppressed: false,
        dependencies: [],
        references: [],
        parameters,
      },
      selectedBody,
      id(94),
    )
    const captured = captureAssemblyDefinition(imported.snapshot, {
      ...definition(),
      sources: [
        {
          kind: "asset-output",
          assetId: exactAsset.id,
          outputId: id(81),
          digest: exactAsset.digest,
        },
      ],
    })
    expect(captured.pinnedModels[0]?.selectedBody).toEqual<unknown>(selectedBody)
    expect(captured.pinnedModels[0]?.snapshot.features[0]?.parameters).toEqual(parameters)
    expect(captured.pinnedModels[0]?.assets).toEqual([exactAsset])
  })

  it("freezes referenced variables transitively and permits later removal of the authored source", () => {
    const f = fixture()
    const variable = {
      schemaVersion: 0,
      id: id(91),
      name: "span",
      expression: "#base * 2",
    }
    const current = documentSnapshotV4Schema.parse({
      ...f.snapshot,
      variables: [
        variable,
        { ...variable, id: id(92), name: "base", expression: "5 mm" },
        { ...variable, id: id(93), name: "unrelated", expression: "99 mm" },
      ],
      features: f.snapshot.features.map((feature) =>
        feature.id === id(2)
          ? {
              ...feature,
              parameters: { ...feature.parameters, width: createLengthQuantity(10, "mm", "#span") },
            }
          : feature,
      ),
    })
    const added = value(
      mutate(current, [{ kind: "definition.create", definition: definition() }]),
    ).snapshot
    expect(
      added.assembly.definitions[0]?.pinnedModels[0]?.snapshot.variables.map(({ name }) => name),
    ).toEqual(["span", "base"])
    const removed = value(
      applyDocumentV2Command(projectDocumentSnapshotV4ToV2(added), {
        ...envelope(7),
        schemaVersion: 2,
        kind: "org.vibeshape.document.model-command",
        payload: {
          command: {
            ...envelope(7),
            schemaVersion: 1,
            kind: "org.vibeshape.feature.remove",
            payload: { featureId: id(2) },
          },
          partAllocations: [],
        },
      }),
    )
    const event = {
      ...envelope(7),
      schemaVersion: 4,
      type: "org.vibeshape.document.authored-changed",
      transactionId: null,
      revision: 8,
      authoredEvent: removed.event,
    }
    const snapshot = value(reduceDocumentV4Event(added, event)).snapshot
    expect(snapshot.parts.some(({ id: partId }) => partId === id(30))).toBe(false)
    expect(snapshot.assembly).toEqual(added.assembly)
  })

  it("captures transitive body dependencies in history order and rejects unrelated pinned nodes", () => {
    const f = fixture()
    const mirror = {
      schemaVersion: 0,
      id: id(5),
      type: mirrorFeatureType.type,
      dependencies: [id(2)],
      references: [],
      suppressed: false,
      parameters: { targetBody: body(), plane: "YZ" },
    }
    const authored = value(
      applyDocumentV2Command(projectDocumentSnapshotV4ToV2(f.snapshot), {
        ...envelope(6),
        schemaVersion: 2,
        kind: "org.vibeshape.document.model-command",
        payload: {
          command: {
            ...envelope(6),
            schemaVersion: 1,
            kind: "org.vibeshape.history.insert-feature",
            payload: { feature: mirror, historyAfter: { kind: "feature", id: id(3) } },
          },
          partAllocations: [],
        },
      }),
    )
    const source = value(
      reduceDocumentV4Event(f.snapshot, {
        ...envelope(6),
        schemaVersion: 4,
        type: "org.vibeshape.document.authored-changed",
        transactionId: null,
        revision: 7,
        authoredEvent: authored.event,
      }),
    ).snapshot
    const def = {
      ...definition(),
      sources: [{ ...definition().sources[0], body: { ...body(), featureId: id(5) } }],
    }
    const captured = captureAssemblyDefinition(source, def)
    expect(captured.pinnedModels[0]?.snapshot.history).toEqual<unknown>([
      { kind: "feature", id: id(2) },
      { kind: "feature", id: id(5) },
    ])
    const pinned = captured.pinnedModels[0]
    if (!pinned) throw new Error("Expected frozen dependency closure.")
    expect(
      assemblyAuthoritySchema.safeParse({
        ...emptyAssemblyAuthority(),
        definitions: [
          {
            ...captured,
            pinnedModels: [
              {
                ...pinned,
                snapshot: {
                  ...pinned.snapshot,
                  features: source.features,
                  history: source.history,
                },
              },
            ],
          },
        ],
      }).success,
    ).toBe(false)
  })

  it("freezes sketch and datum-plane dependencies with their first-party typed parameters", () => {
    const f = fixture()
    const datum = {
      schemaVersion: 1,
      id: id(10),
      type: datumPlaneFeatureType.type,
      dependencies: [],
      references: [],
      semanticInputs: [],
      suppressed: false,
      parameters: {
        mode: "offset",
        support: { kind: "origin-plane", plane: "xy" },
        offset: createLengthQuantity(5),
      },
    }
    const sketch = {
      schemaVersion: 0,
      id: id(11),
      label: "Datum profile",
      plane: "xy",
      support: {
        kind: "feature-face",
        reference: {
          schemaVersion: 0,
          featureId: datum.id,
          kind: "face",
          semanticRole: "reference.datum-plane.face",
          signature: {
            kind: "face",
            geometryClass: "PLANE",
            measure: 400,
            centroid: [0, 0, 5],
            bounds: { min: [-10, -10, 5], max: [10, 10, 5] },
            direction: [0, 0, 1],
            directionMode: "oriented",
            boundaryCount: 4,
            adjacentGeometryClasses: [],
          },
        },
      },
      entities: [
        { schemaVersion: 0, id: id(12), type: "point", x: 0, y: 0 },
        { schemaVersion: 0, id: id(13), type: "circle", centerPointId: id(12), radius: 5 },
      ],
      constraints: [],
    }
    const extrusion = {
      ...datum,
      id: id(14),
      type: extrusionFeatureTypeV5.type,
      semanticInputs: [{ kind: "sketch", id: sketch.id }],
      parameters: {
        profiles: {
          schemaVersion: 0,
          profiles: [
            {
              schemaVersion: 0,
              sketchId: sketch.id,
              outerBoundaryEntityIds: [id(13)],
              holeBoundaryEntityIds: [],
            },
          ],
        },
        distance: createLengthQuantity(10),
        symmetric: false,
        reversed: false,
        secondDistance: null,
        operation: "new",
      },
    }
    const selectedBody = { ...body(), featureId: extrusion.id }
    const source = documentSnapshotV4Schema.parse({
      ...f.snapshot,
      features: [...f.snapshot.features, datum, extrusion],
      sketches: [sketch],
      history: [
        ...f.snapshot.history,
        { kind: "feature", id: datum.id },
        { kind: "sketch", id: sketch.id },
        { kind: "feature", id: extrusion.id },
      ],
      parts: [
        ...f.snapshot.parts,
        {
          schemaVersion: 0,
          id: id(95),
          name: "Extrusion",
          visible: true,
          origin: "independent",
          consumedBy: null,
          bodyHistory: [selectedBody],
        },
      ],
    })
    const captured = captureAssemblyDefinition(source, {
      ...definition(),
      sources: [{ kind: "part", partId: id(95), body: selectedBody, contentHash: "e".repeat(64) }],
    })
    expect(captured.pinnedModels[0]?.snapshot.history).toEqual(source.history.slice(-3))
    expect(captured.pinnedModels[0]?.snapshot.sketches).toEqual(source.sketches)
    expect(captured.pinnedModels[0]?.snapshot.features[0]?.parameters).toEqual(datum.parameters)
  })

  it("captures typed mesh import descriptors in frozen Part closure without claiming an exact BREP", () => {
    const f = fixture()
    const sourced = value(
      applyDocumentV4Command(f.snapshot, {
        ...envelope(6),
        schemaVersion: 4,
        kind: "org.vibeshape.document.add-source-assets",
        payload: { assets: [asset] },
      }),
    ).snapshot
    const imported = meshImport(sourced)
    const source = imported.snapshot
    const meshBody = imported.selectedBody
    const def = {
      ...definition(),
      sources: [{ kind: "part", partId: id(94), body: meshBody, contentHash: "c".repeat(64) }],
    }
    const added = value(mutate(source, [{ kind: "definition.create", definition: def }]))
    expect(added.snapshot.assembly.definitions[0]?.pinnedModels[0]?.assets).toEqual([asset])
    expect(documentSnapshotV4Schema.safeParse({ ...added.snapshot, assets: [] }).success).toBe(
      false,
    )
    expect(documentSourceAssetClosure(null, [added.event], added.snapshot)).toEqual([asset])
  })
})

it("rejects textured frozen source capture without changing document authority", () => {
  const f = fixture()
  const sourceBody = body()
  const layer = createDefaultSurfaceTextureLayer(
    featureIdSchema.parse(sourceBody.featureId),
    sourceBody.outputRole,
    surfaceTextureLayerIdSchema.parse(id(1300)),
  )
  const textured = documentSnapshotV4Schema.parse({ ...f.snapshot, surfaceTextures: [layer] })
  const before = JSON.stringify(textured)
  expect(() => captureAssemblyDefinition(textured, definition())).toThrow(
    "Assembly/library pins for textured sources are not supported; remove/detach texture layers or use an untextured source.",
  )
  expect(JSON.stringify(textured)).toBe(before)
  expect(() => captureAssemblyDefinition(f.snapshot, definition())).not.toThrow()
})

describe("versioned general assembly authority", () => {
  it("upgrades explicitly with solved branch seeds and preserves strict legacy replay", () => {
    const f = populated(),
      legacy = f.added.snapshot
    const before = JSON.stringify(legacy)
    const legacyPoses = solveAssemblyKinematics(projectAssemblyAuthority(legacy.assembly))
    if (!legacyPoses.ok) throw new Error("Legacy fixture must solve.")
    const upgraded = value(mutate(legacy, [{ kind: "assembly.upgrade" }]))
    expect(upgraded.snapshot.assembly.schemaVersion).toBe(2)
    expect(upgraded.snapshot.assembly.definitions).toEqual(legacy.assembly.definitions)
    for (const instance of upgraded.snapshot.assembly.instances) {
      expect(instance.schemaVersion).toBe(2)
      if (instance.schemaVersion === 2 && !instance.grounded)
        expect(instance.initialFrame).toEqual<unknown>(
          legacyPoses.instances.find((p) => p.instanceId === instance.id)?.worldFrame,
        )
    }
    expect(upgraded.snapshot.assembly.joints[0]).toMatchObject({ schemaVersion: 2, driven: true })
    expect(value(reduceDocumentV4Event(legacy, upgraded.event)).snapshot).toEqual(upgraded.snapshot)
    expect(upgradeAssemblyAuthority(legacy.assembly)).toEqual(upgraded.snapshot.assembly)
    expect(JSON.stringify(legacy)).toBe(before)
    expect(mutate(upgraded.snapshot, [{ kind: "assembly.upgrade" }]).ok).toBe(false)
    expect(
      mutate(legacy, [{ kind: "joint.create", joint: { ...joint("fixed", 71), schemaVersion: 2 } }])
        .ok,
    ).toBe(false)
  })
  it("persists multiple mates and loops without treating edges as subtree ownership", () => {
    const f = populated()
    const upgraded = value(mutate(f.added.snapshot, [{ kind: "assembly.upgrade" }]))
    const loop = value(
      mutate(upgraded.snapshot, [
        { kind: "joint.create", joint: { ...joint("fixed", 71, 61, 60), schemaVersion: 2 } },
        { kind: "joint.create", joint: { ...joint("fixed", 72), schemaVersion: 2 } },
      ]),
    )
    expect(loop.snapshot.assembly.joints).toHaveLength(3)
    expect(value(reduceDocumentV4Event(upgraded.snapshot, loop.event)).snapshot).toEqual(
      loop.snapshot,
    )
    const removed = value(
      mutate(loop.snapshot, [{ kind: "instance.remove", instanceId: id(60), cascade: true }]),
    )
    expect(removed.snapshot.assembly.instances.map((i) => i.id)).toEqual<unknown>([id(61)])
    expect(removed.snapshot.assembly.joints).toEqual([])
    // Solvability is a worker concern; replay must retain even an unanchored authored graph.
    expect(documentSnapshotV4Schema.parse(removed.snapshot)).toEqual<unknown>(removed.snapshot)
  })
  it("restores the exact schema version and frozen pins through Undo, Redo and complete replay", () => {
    const f = populated(),
      legacy = f.added.snapshot
    const upgraded = value(mutate(legacy, [{ kind: "assembly.upgrade" }]))
    const undo = {
      ...envelope(upgraded.snapshot.revision),
      schemaVersion: 4,
      type: "org.vibeshape.document.restored",
      transactionId: null,
      revision: upgraded.snapshot.revision + 1,
      direction: "undo",
      targetRevision: legacy.revision,
    }
    const undone = value(reduceDocumentV4Event(upgraded.snapshot, undo, legacy)).snapshot
    expect(undone.assembly).toEqual(legacy.assembly)
    const redo = {
      ...envelope(undone.revision),
      schemaVersion: 4,
      type: "org.vibeshape.document.restored",
      transactionId: null,
      revision: undone.revision + 1,
      direction: "redo",
      targetRevision: upgraded.snapshot.revision,
    }
    const restored = value(reduceDocumentV4Event(undone, redo, upgraded.snapshot)).snapshot
    expect(restored.assembly).toEqual(upgraded.snapshot.assembly)
    const replayed = replayDocumentAuthorityEvents(null, [
      ...f.events,
      f.added.event,
      upgraded.event,
      undo,
      redo,
    ])
    expect(replayed.ok).toBe(true)
    if (replayed.ok) expect(replayed.snapshot).toEqual(restored)
  })
})
