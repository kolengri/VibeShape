import type { DocumentAuthorityEvent } from "./document-v2-command-schemas"
import { applyDocumentV2Command } from "./document-v2-commands"
import { applyDocumentUpgradeV2Command } from "./document-v2-migration"
import { documentSnapshotV2Schema } from "./document-v2-schema"
import { applyHistoryRemoveRetainingDependentsCommand } from "./document-v5-commands"
import { featureRecordV1Schema } from "./feature-graph"
import { sketchIdSchema } from "./identifiers"
import { boxFeatureType, extrusionFeatureTypeV5, filletFeatureType } from "./part-design"
import { createEmptySketch } from "./sketch-edit"
import { createLengthQuantity } from "./units"
import { applyVersionedDocumentCommand } from "./versioned-document-commands"

export const repairId = (n: number) => `0195b5ac-b220-7a2c-8c33-${n.toString(16).padStart(12, "0")}`
export const repairIssuedAt = "2026-10-07T00:00:00Z"
export const repairActor = { type: "user", userId: null } as const
export function historyRepairFixture() {
  const sketches = [1, 2].map((n) =>
    createEmptySketch({
      id: sketchIdSchema.parse(repairId(n)),
      label: `Profile ${n}`,
      plane: "xy",
    }),
  )
  const root = featureRecordV1Schema.parse({
    schemaVersion: 1,
    id: repairId(3),
    label: "Extrusion",
    type: extrusionFeatureTypeV5.type,
    parameters: {
      profiles: {
        schemaVersion: 0,
        profiles: [
          {
            schemaVersion: 0,
            sketchId: repairId(1),
            outerBoundaryEntityIds: [repairId(40)],
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
    dependencies: [],
    references: [],
    suppressed: false,
    semanticInputs: [{ kind: "sketch", id: repairId(1) }],
  })
  const modifiers = [4, 5].map((n) =>
    featureRecordV1Schema.parse({
      schemaVersion: 1,
      id: repairId(n),
      label: `Fillet ${n}`,
      type: filletFeatureType.type,
      parameters: { radius: createLengthQuantity(1) },
      dependencies: [repairId(n - 1)],
      references: [],
      semanticInputs: [],
      suppressed: false,
    }),
  )
  const independent = featureRecordV1Schema.parse({
    schemaVersion: 1,
    id: repairId(6),
    label: "Independent box",
    type: boxFeatureType.type,
    parameters: {
      width: createLengthQuantity(20),
      depth: createLengthQuantity(30),
      height: createLengthQuantity(40),
      centered: false,
    },
    dependencies: [],
    references: [],
    semanticInputs: [],
    suppressed: false,
  })
  const features = [root, ...modifiers, independent]
  const parts = [
    {
      schemaVersion: 0,
      id: repairId(100),
      name: "Housing",
      visible: false,
      origin: "independent",
      consumedBy: null,
      bodyHistory: [3, 4, 5].map((n) => ({
        schemaVersion: 0,
        featureId: repairId(n),
        outputRole: "result",
      })),
    },
    {
      schemaVersion: 0,
      id: repairId(101),
      name: "Box",
      visible: true,
      origin: "independent",
      consumedBy: null,
      bodyHistory: [{ schemaVersion: 0, featureId: repairId(6), outputRole: "result" }],
    },
  ]
  const history = [
    ...sketches.map((sketch) => ({ kind: "sketch", id: sketch.id })),
    ...features.map((feature) => ({ kind: "feature", id: feature.id })),
  ]
  return documentSnapshotV2Schema.parse({
    schemaVersion: 2,
    id: repairId(200),
    revision: 4,
    name: "Repair fixture",
    displayUnits: { length: "mm", angle: "deg" },
    variables: [],
    sketches,
    features,
    history,
    parts,
    folders: [
      { schemaVersion: 0, id: repairId(300), name: "Part operations", items: history.slice(2, 5) },
    ],
    createdAt: repairIssuedAt,
    updatedAt: repairIssuedAt,
  })
}
export function repairRemovalCommand(
  baseRevision: number,
  target: { kind: "feature" | "sketch"; id: string } = { kind: "sketch", id: repairId(1) },
) {
  return {
    schemaVersion: 5,
    kind: "org.vibeshape.history.remove-retaining-dependents",
    commandId: repairId(400 + baseRevision),
    documentId: repairId(200),
    baseRevision,
    issuedAt: repairIssuedAt,
    actor: repairActor,
    payload: { target },
  }
}

function accepted<T extends { ok: boolean }>(result: T): Extract<T, { ok: true }> {
  if (!result.ok) throw new Error(JSON.stringify(result))
  return result as Extract<T, { ok: true }>
}
export function historyRepairJournalFixture() {
  const desired = historyRepairFixture()
  const envelope = (baseRevision: number) => ({
    schemaVersion: 1,
    commandId: repairId(600 + baseRevision),
    documentId: desired.id,
    baseRevision,
    issuedAt: repairIssuedAt,
    actor: repairActor,
  })
  const created = accepted(
    applyVersionedDocumentCommand(null, {
      ...envelope(0),
      kind: "org.vibeshape.document.create",
      payload: { name: desired.name },
    }),
  )
  const events: DocumentAuthorityEvent[] = [created.event]
  let model = created.snapshot
  for (const sketch of desired.sketches) {
    const added = accepted(
      applyVersionedDocumentCommand(model, {
        ...envelope(model.revision),
        kind: "org.vibeshape.history.insert-sketch",
        payload: { sketch, historyAfter: model.history.at(-1) ?? null },
      }),
    )
    model = added.snapshot
    events.push(added.event)
  }
  for (const feature of desired.features) {
    const { semanticInputs: _semanticInputs, ...legacy } = feature
    const added = accepted(
      applyVersionedDocumentCommand(model, {
        ...envelope(model.revision),
        kind: "org.vibeshape.history.insert-feature",
        payload: {
          feature: { ...legacy, schemaVersion: 0 },
          historyAfter: model.history.at(-1) ?? null,
        },
      }),
    )
    model = added.snapshot
    events.push(added.event)
  }
  const upgraded = accepted(
    applyDocumentUpgradeV2Command(model, {
      ...envelope(model.revision),
      schemaVersion: 2,
      kind: "org.vibeshape.document.upgrade-v2",
      payload: {
        partAllocations: desired.parts.map((part) => ({
          id: part.id,
          name: part.name,
          origin: part.origin,
          body: part.bodyHistory[0],
        })),
      },
    }),
  )
  events.push(upgraded.event)
  const organized = accepted(
    applyDocumentV2Command(upgraded.snapshot, {
      ...envelope(upgraded.snapshot.revision),
      schemaVersion: 2,
      kind: "org.vibeshape.document.metadata-command",
      payload: { kind: "folder.create", folder: desired.folders[0] },
    }),
  )
  events.push(organized.event)
  const removed = accepted(
    applyHistoryRemoveRetainingDependentsCommand(
      organized.snapshot,
      repairRemovalCommand(organized.snapshot.revision),
    ),
  )
  events.push(removed.event)
  return {
    before: organized.snapshot,
    removed,
    events,
    upgradeRevision: upgraded.snapshot.revision,
  }
}
