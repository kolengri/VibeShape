import { describe, expect, it } from "bun:test"
import { createDocumentDependencyGraph } from "./document-graph"
import { projectAuthoredDocumentSnapshotToV1 } from "./document-v2"
import { replayDocumentAuthorityEvents } from "./document-v2-replay"
import { documentSnapshotV2Schema } from "./document-v2-schema"
import { documentSnapshotV4Schema } from "./document-v4"
import { documentSnapshotV5Schema } from "./document-v5"
import {
  applyDocumentV5ModelEvent,
  applyHistoryRemoveRetainingDependentsCommand,
  applyHistoryRepairCommand,
  reduceDocumentV5Event,
} from "./document-v5-commands"
import {
  authoredHistoryFeature,
  authoredHistorySketch,
  isMissingInputFeature,
} from "./history-repair"
import {
  historyRepairFixture,
  repairActor,
  repairId,
  repairIssuedAt,
  repairRemovalCommand,
} from "./history-repair.test-fixture"
import {
  applyVersionedDocumentCommand,
  projectDocumentSnapshotV1ToV0,
} from "./versioned-document-commands"

function success<T extends { ok: boolean }>(result: T): Extract<T, { ok: true }> {
  if (!result.ok) throw new Error(JSON.stringify(result))
  return result as Extract<T, { ok: true }>
}
function first<T>(items: readonly T[]): T {
  const item = items[0]
  if (!item) throw new Error("Expected a nonempty fixture collection.")
  return item
}
describe("retained History repair authority", () => {
  it("deletes an independent leaf without retaining orphan part identities", () => {
    const before = historyRepairFixture()
    const removed = success(
      applyHistoryRemoveRetainingDependentsCommand(
        before,
        repairRemovalCommand(before.revision, { kind: "feature", id: repairId(6) }),
      ),
    )
    expect(removed.snapshot.repairIntents).toEqual([])
    expect(removed.snapshot.suspendedParts).toEqual([])
    expect(removed.snapshot.parts).toEqual([first(before.parts)])
    expect(success(replayDocumentAuthorityEvents(before, [removed.event])).snapshot).toEqual(
      removed.snapshot,
    )
    const deletedPart = before.parts[1]
    if (!deletedPart) throw new Error("Missing independent part fixture.")
    expect(
      documentSnapshotV5Schema.safeParse({ ...removed.snapshot, suspendedParts: [deletedPart] })
        .success,
    ).toBe(false)
  })

  it("prunes a prior suspension when its authored root is deleted while retaining other repair intent", () => {
    const before = historyRepairFixture()
    const detached = success(
      applyHistoryRemoveRetainingDependentsCommand(before, repairRemovalCommand(before.revision)),
    )
    expect(detached.snapshot.suspendedParts).toEqual([first(before.parts)])
    const independentDeleted = success(
      applyHistoryRemoveRetainingDependentsCommand(
        detached.snapshot,
        repairRemovalCommand(detached.snapshot.revision, { kind: "feature", id: repairId(6) }),
      ),
    )
    expect(independentDeleted.snapshot.suspendedParts).toEqual([first(before.parts)])
    const ownerDeleted = success(
      applyHistoryRemoveRetainingDependentsCommand(
        independentDeleted.snapshot,
        repairRemovalCommand(independentDeleted.snapshot.revision, {
          kind: "feature",
          id: repairId(3),
        }),
      ),
    )
    expect(ownerDeleted.snapshot.suspendedParts).toEqual([])
    expect(
      ownerDeleted.snapshot.repairIntents.map((intent) => intent.authored.id),
    ).toEqual<unknown>([repairId(4), repairId(5)])
    expect(
      success(
        replayDocumentAuthorityEvents(before, [
          detached.event,
          independentDeleted.event,
          ownerDeleted.event,
        ]),
      ).snapshot,
    ).toEqual(ownerDeleted.snapshot)
  })

  it("allows strict removal of a disconnected leaf and prunes its repair marker", () => {
    const before = historyRepairFixture()
    const detached = success(
      applyHistoryRemoveRetainingDependentsCommand(before, repairRemovalCommand(before.revision)),
    )
    const removed = success(
      applyVersionedDocumentCommand(projectAuthoredDocumentSnapshotToV1(detached.snapshot), {
        schemaVersion: 1,
        kind: "org.vibeshape.feature.remove",
        commandId: repairId(470),
        documentId: before.id,
        baseRevision: detached.snapshot.revision,
        issuedAt: repairIssuedAt,
        actor: repairActor,
        payload: { featureId: repairId(5) },
      }),
    )
    const retained = success(applyDocumentV5ModelEvent(detached.snapshot, removed.event, []))
    expect(retained.snapshot.repairIntents.map((intent) => intent.authored.id)).toEqual<unknown>([
      repairId(3),
      repairId(4),
    ])
    expect(retained.snapshot.suspendedParts).toEqual(detached.snapshot.suspendedParts)
    expect(
      success(replayDocumentAuthorityEvents(before, [detached.event, retained.event])).snapshot,
    ).toEqual(retained.snapshot)
  })

  it("detaches a deleted profile, retains the complete descendant chain and isolates an independent branch", () => {
    const before = historyRepairFixture()
    const removed = success(
      applyHistoryRemoveRetainingDependentsCommand(before, repairRemovalCommand(before.revision)),
    )
    expect(removed.snapshot.schemaVersion).toBe(5)
    expect(removed.snapshot.features.map((feature) => feature.id)).toEqual(
      before.features.map((feature) => feature.id),
    )
    expect(removed.snapshot.features.slice(0, 3).every(isMissingInputFeature)).toBe(true)
    expect(removed.snapshot.features[1]?.dependencies).toEqual<unknown>([repairId(3)])
    expect(removed.snapshot.features[3]).toEqual(before.features[3])
    expect(authoredHistoryFeature(removed.snapshot, first(before.features).id)).toEqual(
      before.features[0],
    )
    expect(removed.snapshot.suspendedParts).toEqual<unknown>([before.parts[0]])
    expect(removed.snapshot.parts).toEqual<unknown>([before.parts[1]])
    expect(removed.snapshot.folders).toEqual(before.folders)
    expect(success(replayDocumentAuthorityEvents(before, [removed.event])).snapshot).toEqual(
      removed.snapshot,
    )
    expect(documentSnapshotV4Schema.safeParse(removed.snapshot).success).toBe(false)
    expect(
      replayDocumentAuthorityEvents(removed.snapshot, [{ ...removed.event, schemaVersion: 4 }]).ok,
    ).toBe(false)
    expect(
      documentSnapshotV5Schema.safeParse({ ...removed.snapshot, repairIntents: [] }).success,
    ).toBe(false)
    const runtime = success(
      projectDocumentSnapshotV1ToV0(projectAuthoredDocumentSnapshotToV1(removed.snapshot)),
    ).snapshot
    const graph = success(
      createDocumentDependencyGraph({ ...runtime, history: removed.snapshot.history }),
    ).graph
    expect(graph.dependencyModelIssues).toEqual([])
    expect(runtime.features[1]?.dependencies).toEqual<unknown>([repairId(3)])
    const corrupted = createDocumentDependencyGraph({
      ...runtime,
      history: removed.snapshot.history,
      features: runtime.features.map((feature, index) =>
        index === 0 ? { ...feature, parameters: {} } : feature,
      ),
    })
    expect(corrupted.ok && corrupted.graph.dependencyModelIssues.length === 0).toBe(false)
  })

  it("repairs the direct profile and restores valid descendants and the original part identity atomically", () => {
    const before = historyRepairFixture()
    const removed = success(
      applyHistoryRemoveRetainingDependentsCommand(before, repairRemovalCommand(before.revision)),
    )
    const root = first(before.features)
    const part = first(before.parts)
    const { semanticInputs: _semanticInputs, ...legacy } = root
    const feature = {
      ...legacy,
      schemaVersion: 0,
      parameters: {
        ...root.parameters,
        profiles: {
          schemaVersion: 0,
          profiles: [
            {
              schemaVersion: 0,
              sketchId: repairId(2),
              outerBoundaryEntityIds: [repairId(40)],
              holeBoundaryEntityIds: [],
            },
          ],
        },
      },
    }
    const model = success(
      applyVersionedDocumentCommand(projectAuthoredDocumentSnapshotToV1(removed.snapshot), {
        schemaVersion: 1,
        kind: "org.vibeshape.feature.update",
        commandId: repairId(450),
        documentId: before.id,
        baseRevision: removed.snapshot.revision,
        issuedAt: repairIssuedAt,
        actor: repairActor,
        payload: { feature },
      }),
    )
    const repaired = success(
      applyDocumentV5ModelEvent(removed.snapshot, model.event, [
        {
          id: part.id,
          name: "Housing",
          origin: "independent",
          body: first(part.bodyHistory),
        },
      ]),
    )
    expect(repaired.snapshot.repairIntents).toEqual([])
    expect(repaired.snapshot.suspendedParts).toEqual([])
    expect(repaired.snapshot.features.slice(1)).toEqual(before.features.slice(1))
    expect(repaired.snapshot.parts.find((candidate) => candidate.id === part.id)).toEqual(part)
    expect(
      success(replayDocumentAuthorityEvents(before, [removed.event, repaired.event])).snapshot,
    ).toEqual(repaired.snapshot)
  })

  it("retains disconnected authored feature recipes through rename, suppression and replay", () => {
    const before = historyRepairFixture()
    const removed = success(
      applyHistoryRemoveRetainingDependentsCommand(before, repairRemovalCommand(before.revision)),
    )
    const { semanticInputs: _semanticInputs, ...legacy } = first(removed.snapshot.features)
    const renamedModel = success(
      applyVersionedDocumentCommand(projectAuthoredDocumentSnapshotToV1(removed.snapshot), {
        schemaVersion: 1,
        kind: "org.vibeshape.feature.update",
        commandId: repairId(480),
        documentId: before.id,
        baseRevision: removed.snapshot.revision,
        issuedAt: repairIssuedAt,
        actor: repairActor,
        payload: { feature: { ...legacy, schemaVersion: 0, label: "Renamed extrusion" } },
      }),
    )
    const renamed = success(applyDocumentV5ModelEvent(removed.snapshot, renamedModel.event, []))
    const original = first(before.features)
    expect(authoredHistoryFeature(renamed.snapshot, original.id)).toEqual({
      ...original,
      label: "Renamed extrusion",
    })
    expect(renamed.snapshot.repairIntents).toHaveLength(3)
    const suppressedModel = success(
      applyVersionedDocumentCommand(projectAuthoredDocumentSnapshotToV1(renamed.snapshot), {
        schemaVersion: 1,
        kind: "org.vibeshape.feature.set-suppressed",
        commandId: repairId(481),
        documentId: before.id,
        baseRevision: renamed.snapshot.revision,
        issuedAt: repairIssuedAt,
        actor: repairActor,
        payload: { featureId: original.id, suppressed: true },
      }),
    )
    const suppressed = success(
      applyDocumentV5ModelEvent(renamed.snapshot, suppressedModel.event, []),
    )
    expect(authoredHistoryFeature(suppressed.snapshot, original.id)).toEqual({
      ...original,
      label: "Renamed extrusion",
      suppressed: true,
    })
    expect(first(suppressed.snapshot.features)).toMatchObject({
      label: "Renamed extrusion",
      suppressed: true,
    })
    expect(isMissingInputFeature(first(suppressed.snapshot.features))).toBe(true)
    expect(suppressed.snapshot.repairIntents).toHaveLength(3)
    expect(suppressed.snapshot.suspendedParts).toEqual(removed.snapshot.suspendedParts)
    expect(
      success(
        replayDocumentAuthorityEvents(before, [removed.event, renamed.event, suppressed.event]),
      ).snapshot,
    ).toEqual(suppressed.snapshot)
  })

  it("rejects incomplete repairs and restores deletion through Undo without downgrading authority", () => {
    const before = historyRepairFixture()
    const removed = success(
      applyHistoryRemoveRetainingDependentsCommand(before, repairRemovalCommand(before.revision)),
    )
    const { semanticInputs: _semanticInputs, ...root } = first(before.features)
    expect(
      applyVersionedDocumentCommand(projectAuthoredDocumentSnapshotToV1(removed.snapshot), {
        schemaVersion: 1,
        kind: "org.vibeshape.feature.update",
        commandId: repairId(451),
        documentId: before.id,
        baseRevision: removed.snapshot.revision,
        issuedAt: repairIssuedAt,
        actor: repairActor,
        payload: { feature: { ...root, schemaVersion: 0 } },
      }).ok,
    ).toBe(false)
    const undo = {
      schemaVersion: 5,
      documentId: before.id,
      issuedAt: repairIssuedAt,
      actor: repairActor,
      transactionId: null,
      commandId: repairId(452),
      type: "org.vibeshape.document.restored",
      baseRevision: removed.snapshot.revision,
      revision: removed.snapshot.revision + 1,
      direction: "undo",
      targetRevision: before.revision,
    }
    const restored = success(reduceDocumentV5Event(removed.snapshot, undo, before))
    expect(restored.snapshot.schemaVersion).toBe(5)
    expect(restored.snapshot.features).toEqual(before.features)
    expect(restored.snapshot.parts).toEqual(before.parts)
    expect(restored.snapshot.repairIntents).toEqual([])
  })

  it("deletes only the requested feature and retains dependent operations", () => {
    const before = historyRepairFixture()
    const source = first(before.sketches)
    const removed = success(
      applyHistoryRemoveRetainingDependentsCommand(
        before,
        repairRemovalCommand(before.revision, { kind: "feature", id: repairId(3) }),
      ),
    )
    expect(removed.snapshot.features.map((feature) => feature.id)).toEqual<unknown>([
      repairId(4),
      repairId(5),
      repairId(6),
    ])
    expect(authoredHistorySketch(removed.snapshot, source.id)).toEqual(source)
    expect(removed.snapshot.features[0]?.dependencies).toEqual([])
    expect(removed.snapshot.features[1]?.dependencies).toEqual<unknown>([repairId(4)])
  })

  it("clears feature support and model references while retaining the supported sketch for normal repair", () => {
    const fixture = historyRepairFixture()
    const sketch = fixture.sketches[1]
    if (!sketch) throw new Error("Missing supported sketch fixture.")
    const supported = {
      ...sketch,
      support: {
        kind: "feature-face",
        reference: {
          schemaVersion: 0,
          featureId: repairId(3),
          kind: "face",
          signature: {
            kind: "face",
            geometryClass: "PLANE",
            measure: 1,
            centroid: [0, 0, 0],
            bounds: { min: [0, 0, 0], max: [1, 1, 0] },
            boundaryCount: 4,
            adjacentGeometryClasses: [],
          },
        },
      },
      entities: [
        { schemaVersion: 0, id: repairId(41), type: "point", construction: false, x: 2, y: 3 },
      ],
      externalReferences: [
        {
          schemaVersion: 0,
          id: repairId(42),
          kind: "model-point",
          reference: {
            schemaVersion: 0,
            featureId: repairId(3),
            kind: "vertex",
            signature: {
              kind: "vertex",
              geometryClass: "POINT",
              measure: 0,
              centroid: [0, 0, 0],
              bounds: { min: [0, 0, 0], max: [0, 0, 0] },
              boundaryCount: 0,
              adjacentGeometryClasses: [],
            },
          },
          projectedPointId: repairId(43),
        },
      ],
    }
    const before = documentSnapshotV2Schema.parse({
      ...fixture,
      sketches: [first(fixture.sketches), supported],
      history: [
        fixture.history[0],
        fixture.history[2],
        fixture.history[1],
        ...fixture.history.slice(3),
      ],
      folders: [],
    })
    const removed = success(
      applyHistoryRemoveRetainingDependentsCommand(
        before,
        repairRemovalCommand(before.revision, { kind: "feature", id: repairId(3) }),
      ),
    )
    expect(authoredHistorySketch(removed.snapshot, sketch.id)).toEqual(before.sketches[1])
    expect(removed.snapshot.sketches[1]).toMatchObject({ entities: [], constraints: [] })
    expect(removed.snapshot.sketches[1]?.support).toBeUndefined()
    expect(removed.snapshot.sketches[1]?.externalReferences).toBeUndefined()
    const {
      support: _support,
      externalReferences: _references,
      ...repairedSketch
    } = before.sketches[1] ?? {}
    const changed = success(
      applyVersionedDocumentCommand(projectAuthoredDocumentSnapshotToV1(removed.snapshot), {
        schemaVersion: 1,
        kind: "org.vibeshape.sketch.update",
        commandId: repairId(460),
        documentId: before.id,
        baseRevision: removed.snapshot.revision,
        issuedAt: repairIssuedAt,
        actor: repairActor,
        payload: { sketch: repairedSketch },
      }),
    )
    const repaired = success(applyDocumentV5ModelEvent(removed.snapshot, changed.event, []))
    expect(repaired.snapshot.sketches[1]).toEqual<unknown>(repairedSketch)
    expect(repaired.snapshot.repairIntents.some((intent) => intent.kind === "sketch")).toBe(false)
    expect(
      success(replayDocumentAuthorityEvents(before, [removed.event, repaired.event])).snapshot,
    ).toEqual(repaired.snapshot)
  })

  it("detaches sketch projections of a deleted source and retains their projected identities in repair intent", () => {
    const fixture = historyRepairFixture()
    const source = first(fixture.sketches)
    const target = fixture.sketches[1]
    if (!target) throw new Error("Missing projected sketch fixture.")
    const before = documentSnapshotV2Schema.parse({
      ...fixture,
      sketches: [
        {
          ...source,
          entities: [
            { schemaVersion: 0, id: repairId(41), type: "point", construction: false, x: 1, y: 0 },
          ],
        },
        {
          ...target,
          entities: [
            { schemaVersion: 0, id: repairId(44), type: "point", construction: false, x: 2, y: 3 },
          ],
          externalReferences: [
            {
              schemaVersion: 0,
              id: repairId(42),
              sourceSketchId: source.id,
              sourcePointId: repairId(41),
              projectedPointId: repairId(43),
            },
          ],
        },
      ],
    })
    const removed = success(
      applyHistoryRemoveRetainingDependentsCommand(before, repairRemovalCommand(before.revision)),
    )
    expect(removed.snapshot.sketches).toHaveLength(1)
    expect(removed.snapshot.sketches[0]?.externalReferences).toBeUndefined()
    expect(authoredHistorySketch(removed.snapshot, target.id)).toEqual(before.sketches[1])
    expect(
      removed.snapshot.repairIntents.find((intent) => intent.kind === "sketch")?.missingInputs,
    ).toEqual([{ kind: "sketch", id: source.id }])
    expect(success(replayDocumentAuthorityEvents(before, [removed.event])).snapshot).toEqual(
      removed.snapshot,
    )
    const renamedModel = success(
      applyVersionedDocumentCommand(projectAuthoredDocumentSnapshotToV1(removed.snapshot), {
        schemaVersion: 1,
        kind: "org.vibeshape.sketch.update",
        commandId: repairId(482),
        documentId: before.id,
        baseRevision: removed.snapshot.revision,
        issuedAt: repairIssuedAt,
        actor: repairActor,
        payload: { sketch: { ...first(removed.snapshot.sketches), label: "Renamed projection" } },
      }),
    )
    const renamed = success(applyDocumentV5ModelEvent(removed.snapshot, renamedModel.event, []))
    expect(authoredHistorySketch(renamed.snapshot, target.id)).toEqual<unknown>({
      ...before.sketches[1],
      label: "Renamed projection",
    })
    expect(first(renamed.snapshot.sketches)).toMatchObject({
      label: "Renamed projection",
      entities: [],
      constraints: [],
    })
    expect(renamed.snapshot.repairIntents).toHaveLength(removed.snapshot.repairIntents.length)
    expect(
      success(replayDocumentAuthorityEvents(before, [removed.event, renamed.event])).snapshot,
    ).toEqual(renamed.snapshot)
    const repairCommand = {
      schemaVersion: 5,
      kind: "org.vibeshape.history.repair",
      commandId: repairId(483),
      documentId: before.id,
      baseRevision: renamed.snapshot.revision,
      issuedAt: repairIssuedAt,
      actor: repairActor,
      payload: { item: { kind: "sketch", sketch: first(renamed.snapshot.sketches) } },
    }
    expect(
      applyHistoryRepairCommand(renamed.snapshot, {
        ...repairCommand,
        payload: { item: { kind: "sketch", sketch: before.sketches[1] } },
      }).ok,
    ).toBe(false)
    const repaired = success(applyHistoryRepairCommand(renamed.snapshot, repairCommand))
    expect(repaired.snapshot.repairIntents.some((intent) => intent.kind === "sketch")).toBe(false)
    expect(authoredHistorySketch(repaired.snapshot, target.id)).toEqual(
      first(renamed.snapshot.sketches),
    )
    expect(repaired.snapshot.revision).toBe(renamed.snapshot.revision + 1)
    expect(
      success(replayDocumentAuthorityEvents(before, [removed.event, renamed.event, repaired.event]))
        .snapshot,
    ).toEqual(repaired.snapshot)
    expect(
      applyHistoryRepairCommand(repaired.snapshot, {
        ...repairCommand,
        commandId: repairId(484),
        baseRevision: repaired.snapshot.revision,
      }).ok,
    ).toBe(false)
    const strictRemoval = success(
      applyVersionedDocumentCommand(projectAuthoredDocumentSnapshotToV1(removed.snapshot), {
        schemaVersion: 1,
        kind: "org.vibeshape.sketch.remove",
        commandId: repairId(471),
        documentId: before.id,
        baseRevision: removed.snapshot.revision,
        issuedAt: repairIssuedAt,
        actor: repairActor,
        payload: { sketchId: target.id },
      }),
    )
    const retained = success(applyDocumentV5ModelEvent(removed.snapshot, strictRemoval.event, []))
    expect(retained.snapshot.sketches).toEqual([])
    expect(retained.snapshot.repairIntents.some((intent) => intent.kind === "sketch")).toBe(false)
    expect(retained.snapshot.suspendedParts).toEqual(removed.snapshot.suspendedParts)
  })
})
