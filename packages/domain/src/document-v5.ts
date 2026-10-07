import { z } from "zod"
import { type DocumentSnapshotV4, documentSnapshotV4Schema } from "./document-v4"
import {
  type HistoryRepairIntent,
  historyRepairIntentsSchema,
  validateHistoryRepairIntents,
} from "./history-repair"
import { type PartRecord, partRecordsSchema } from "./parts"

/** V5 retains disconnected authored inputs without relaxing any historical authority parser. */
export const documentSnapshotV5Schema = z
  .object({
    ...documentSnapshotV4Schema.shape,
    schemaVersion: z.literal(5),
    repairIntents: historyRepairIntentsSchema,
    suspendedParts: partRecordsSchema,
  })
  .strict()
  .superRefine((snapshot, context) => {
    const { repairIntents: _repairIntents, suspendedParts: _suspendedParts, ...active } = snapshot
    const parsed = documentSnapshotV4Schema.safeParse({ ...active, schemaVersion: 4 })
    if (!parsed.success)
      for (const issue of parsed.error.issues)
        context.addIssue({ code: "custom", path: issue.path, message: issue.message })
    if (
      snapshot.suspendedParts.some((part) => snapshot.parts.some((active) => active.id === part.id))
    )
      context.addIssue({
        code: "custom",
        path: ["suspendedParts"],
        message: "Active and suspended parts must have distinct identities.",
      })
    const repairOwners = new Set(
      snapshot.repairIntents
        .filter((intent) => intent.kind === "feature")
        .map((intent) => intent.authored.id),
    )
    if (
      snapshot.suspendedParts.some((part) => {
        const owner = part.bodyHistory[0]
        return !owner || !repairOwners.has(owner.featureId)
      })
    )
      context.addIssue({
        code: "custom",
        path: ["suspendedParts"],
        message: "A suspended part requires its retained authored root repair intent.",
      })
    const repairIssue = validateHistoryRepairIntents(snapshot)
    if (repairIssue)
      context.addIssue({ code: "custom", path: ["repairIntents"], message: repairIssue })
  })
export type DocumentSnapshotV5 = Readonly<
  Omit<DocumentSnapshotV4, "schemaVersion"> & {
    schemaVersion: 5
    repairIntents: readonly HistoryRepairIntent[]
    suspendedParts: readonly PartRecord[]
  }
>

/** Read-only compatibility projection is an explicitly disconnected model, never V5 authority. */
export function projectDocumentSnapshotV5ToV4(snapshot: DocumentSnapshotV5): DocumentSnapshotV4 {
  const {
    repairIntents: _repairIntents,
    suspendedParts: _suspendedParts,
    ...active
  } = documentSnapshotV5Schema.parse(snapshot)
  return documentSnapshotV4Schema.parse({ ...active, schemaVersion: 4 })
}

export function validateRepairAuthorityBoundaries(input: {
  seed: { schemaVersion: number; revision: number } | null
  versionedEvents: readonly { schemaVersion: number; revision: number }[]
  snapshot: { revision: number }
  upgradeRevision: number
  textureUpgradeRevision: number
  sourceUpgradeRevision: number
  repairUpgradeRevision: number
}) {
  const boundaries = [
    input.upgradeRevision,
    input.textureUpgradeRevision,
    input.sourceUpgradeRevision,
    input.repairUpgradeRevision,
  ]
  const ordered = boundaries.every(
    (revision, index) =>
      revision >= 1 &&
      revision <= input.snapshot.revision &&
      (index === 0 || revision >= (boundaries[index - 1] ?? revision)),
  )
  const provenance = boundaries.every((revision, index) => {
    const version = index + 2
    return input.seed && input.seed.schemaVersion >= version
      ? revision <= input.seed.revision
      : input.versionedEvents.find((event) => event.schemaVersion >= version)?.revision === revision
  })
  return ordered && provenance
    ? null
    : "Repair authority adoption boundaries do not match the journal."
}
