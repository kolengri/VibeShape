import { applyDocumentV6MetadataCommand } from "./document-v6-commands"
import {
  historyRepairJournalFixture,
  repairActor,
  repairId,
  repairIssuedAt,
} from "./history-repair.test-fixture"

export function partAppearanceJournalFixture() {
  const previous = historyRepairJournalFixture()
  const before = previous.removed.snapshot
  const changed = applyDocumentV6MetadataCommand(before, {
    schemaVersion: 6,
    kind: "org.vibeshape.document.metadata-command",
    commandId: repairId(1300),
    documentId: before.id,
    baseRevision: before.revision,
    issuedAt: repairIssuedAt,
    actor: repairActor,
    payload: {
      kind: "part.set-appearance",
      partId: repairId(101),
      appearance: { presetId: "copper", color: "#4488cc" },
    },
  })
  if (!changed.ok) throw new Error(changed.diagnostic.message)
  return {
    previous,
    changed,
    payload: {
      snapshot: changed.snapshot,
      seed: null,
      legacyEvents: [],
      versionedEvents: [...previous.events, changed.event],
      assetBlobs: [],
      historyMode: "complete" as const,
      promotionRevision: 0,
      upgradeRevision: previous.upgradeRevision,
      textureUpgradeRevision: before.revision,
      sourceUpgradeRevision: before.revision,
      repairUpgradeRevision: before.revision,
      appearanceUpgradeRevision: changed.snapshot.revision,
      migrationDiagnostic: null,
      unavailableRecords: [],
    },
  }
}
