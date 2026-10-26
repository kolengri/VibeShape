import {
  applyDocumentUpgradeV2Command,
  applyDocumentV2Command,
  applyVersionedDocumentCommand,
  createEmptySketch,
  type DocumentSnapshotV1,
  type FeatureRecord,
  featureIdSchema,
  projectDocumentSnapshotV1ToV0,
  sketchIdSchema,
} from "../../packages/domain/src/index"
import {
  authorityEnvelope,
  authorityFixture,
  authorityId,
  authorityTimestamp,
  evidenceValue,
} from "../../scripts/authority-persistence-fixture"

export const longHistoryLabel =
  "Operation 501 with a deliberately long descriptive name for the finishing fixture"

let baseFixture: ReturnType<typeof createHistoryFixture> | undefined
export function historyVirtualizationFixture(folder: boolean) {
  baseFixture ??= createHistoryFixture()
  if (!folder) return baseFixture
  const grouped = evidenceValue(
    applyDocumentV2Command(baseFixture.snapshot, {
      ...authorityEnvelope(baseFixture.snapshot.revision),
      schemaVersion: 2,
      kind: "org.vibeshape.document.metadata-command",
      payload: {
        kind: "folder.create",
        folder: {
          schemaVersion: 0,
          id: authorityId(9000),
          name: "Long folder",
          items: baseFixture.snapshot.history.slice(0, 600),
        },
      },
    }),
  )
  return {
    ...baseFixture,
    snapshot: grouped.snapshot,
    versionedEvents: [...baseFixture.versionedEvents, grouped.event],
  }
}
function fixturePayload(index: number, snapshot: DocumentSnapshotV1, prototype: FeatureRecord) {
  const historyAfter = snapshot.history.at(-1) ?? null
  if (index < 600)
    return {
      feature: {
        ...prototype,
        id: featureIdSchema.parse(authorityId(3000 + index)),
        label: index === 500 ? longHistoryLabel : `Operation ${index + 1}`,
        suppressed: true,
      },
      historyAfter,
    }
  return {
    sketch: createEmptySketch({
      id: sketchIdSchema.parse(authorityId(1000 + index)),
      label: `Profile ${index - 599}`,
      plane: index % 2 ? "xz" : "xy",
    }),
    historyAfter,
  }
}
function createHistoryFixture() {
  const { created, added } = authorityFixture()
  let snapshot = created.snapshot
  const events = [created.event]
  const prototype = evidenceValue(projectDocumentSnapshotV1ToV0(added.snapshot)).snapshot
    .features[0]
  if (!prototype) throw new Error("The History fixture requires a base recipe.")
  for (let index = 0; index < 800; index++) {
    const feature = index < 600
    const payload = fixturePayload(index, snapshot, prototype)
    const result = evidenceValue(
      applyVersionedDocumentCommand(snapshot, {
        ...authorityEnvelope(snapshot.revision),
        schemaVersion: 1,
        kind: feature
          ? "org.vibeshape.history.insert-feature"
          : "org.vibeshape.history.insert-sketch",
        payload,
      }),
    )
    snapshot = result.snapshot
    events.push(result.event)
  }
  const upgraded = evidenceValue(
    applyDocumentUpgradeV2Command(snapshot, {
      ...authorityEnvelope(snapshot.revision),
      schemaVersion: 2,
      kind: "org.vibeshape.document.upgrade-v2",
      payload: {
        partAllocations: snapshot.features.map((feature, index) => ({
          id: authorityId(5000 + index),
          name: `Part ${index + 1}`,
          origin: "independent",
          body: { schemaVersion: 0, featureId: feature.id, outputRole: "result" },
        })),
      },
    }),
  )
  return {
    snapshot: upgraded.snapshot,
    seed: null,
    legacyEvents: [],
    versionedEvents: [...events, upgraded.event],
    historyMode: "complete",
    promotionRevision: 0,
    upgradeRevision: upgraded.snapshot.revision,
    migrationDiagnostic: null,
    unavailableRecords: [],
    copiedAt: authorityTimestamp,
  }
}
