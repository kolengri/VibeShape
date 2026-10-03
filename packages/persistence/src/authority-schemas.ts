import {
  documentAuthorityEventSchema,
  documentAuthoritySnapshotSchema,
  documentEventSchema,
  documentIdSchema,
  documentSnapshotV2Schema,
  draftIdSchema,
  revisionSchema,
  sessionIdSchema,
  timestampSchema,
} from "@vibeshape/domain"
import { z } from "zod"
import {
  documentMigrationDiagnosticSchema,
  eventRecordV1Schema,
  projectRecordV1Schema,
  recoveryRecordV1Schema,
  snapshotRecordV1Schema,
  unavailableRecordsSchema,
  writerLeaseClaimSchema,
} from "./schemas"

export const projectRecordV2Schema = z
  .object({
    ...projectRecordV1Schema.shape,
    schemaVersion: z.literal(2),
    upgradeRevision: revisionSchema,
  })
  .strict()
  .superRefine((project, context) => {
    const { upgradeRevision, ...v1 } = project
    const previous = projectRecordV1Schema.safeParse({ ...v1, schemaVersion: 1 })
    if (!previous.success)
      for (const issue of previous.error.issues)
        context.addIssue({ code: "custom", path: issue.path, message: issue.message })
    if (upgradeRevision < 1 || upgradeRevision > project.latestSnapshotRevision)
      context.addIssue({
        code: "custom",
        path: ["upgradeRevision"],
        message: "A V2 head requires a snapshot at or after its first upgrade revision.",
      })
  })
export const snapshotRecordV2Schema = snapshotRecordV1Schema.extend({ schemaVersion: z.literal(2) })
export const eventRecordV2Schema = eventRecordV1Schema.extend({ schemaVersion: z.literal(2) })
export const recoveryRecordV2Schema = recoveryRecordV1Schema.extend({ schemaVersion: z.literal(2) })
export const projectAuthorityRecordSchema = z.union([projectRecordV1Schema, projectRecordV2Schema])
export const snapshotAuthorityRecordSchema = z.union([
  snapshotRecordV1Schema,
  snapshotRecordV2Schema,
])
export const eventAuthorityRecordSchema = z.union([eventRecordV1Schema, eventRecordV2Schema])
export const recoveryAuthorityRecordSchema = z.union([
  recoveryRecordV1Schema,
  recoveryRecordV2Schema,
])
export type ProjectRecordV2 = z.infer<typeof projectRecordV2Schema>
export type ProjectAuthorityRecord = z.infer<typeof projectAuthorityRecordSchema>
export type SnapshotAuthorityRecord = z.infer<typeof snapshotAuthorityRecordSchema>
export type EventAuthorityRecord = z.infer<typeof eventAuthorityRecordSchema>
export type RecoveryAuthorityRecord = z.infer<typeof recoveryAuthorityRecordSchema>

export const persistenceAuthorityCommitInputSchema = z
  .object({
    sessionId: sessionIdSchema,
    lease: writerLeaseClaimSchema.nullable(),
    storedAt: timestampSchema,
    baseSnapshot: documentAuthoritySnapshotSchema.nullable(),
    event: documentAuthorityEventSchema,
    snapshot: documentAuthoritySnapshotSchema,
  })
  .strict()
export const persistenceAuthorityDraftCommitInputSchema = z
  .object({
    sessionId: sessionIdSchema,
    lease: writerLeaseClaimSchema,
    storedAt: timestampSchema,
    transactionId: draftIdSchema,
    baseSnapshot: documentAuthoritySnapshotSchema,
    events: z.array(documentAuthorityEventSchema).min(1).max(256),
    snapshot: documentAuthoritySnapshotSchema,
  })
  .strict()

const portableProjectV3ObjectSchema = z
  .object({
    snapshot: documentSnapshotV2Schema,
    seed: documentAuthoritySnapshotSchema.nullable(),
    legacyEvents: z.array(documentEventSchema).max(100_000),
    versionedEvents: z.array(documentAuthorityEventSchema).max(100_000),
    historyMode: z.enum(["complete", "checkpoint"]),
    promotionRevision: revisionSchema,
    upgradeRevision: revisionSchema,
    migrationDiagnostic: documentMigrationDiagnosticSchema.nullable(),
    unavailableRecords: unavailableRecordsSchema,
  })
  .strict()
type PortableBoundary = z.infer<typeof portableProjectV3ObjectSchema>

function completeBoundary(input: PortableBoundary): boolean {
  if (input.migrationDiagnostic !== null || input.unavailableRecords.length !== 0) return false
  if (input.seed === null) return input.promotionRevision === 0 && input.legacyEvents.length === 0
  return (
    input.seed.schemaVersion === 1 &&
    input.seed.revision === input.promotionRevision &&
    input.legacyEvents.length === input.promotionRevision
  )
}
function checkpointBoundary(input: PortableBoundary): boolean {
  return (
    input.seed !== null &&
    input.seed.revision === input.promotionRevision &&
    input.legacyEvents.length === 0 &&
    input.migrationDiagnostic !== null &&
    input.unavailableRecords.length > 0
  )
}
function upgradeBoundary(input: PortableBoundary): boolean {
  if (input.upgradeRevision < 1 || input.upgradeRevision > input.snapshot.revision) return false
  const upgrades = input.versionedEvents.filter(
    (event) => event.type === "org.vibeshape.document.upgraded-v2",
  )
  if (input.seed?.schemaVersion === 2)
    return input.upgradeRevision <= input.seed.revision && upgrades.length === 0
  return upgrades.length === 1 && upgrades[0]?.revision === input.upgradeRevision
}
export const portableProjectV3PayloadSchema = portableProjectV3ObjectSchema.superRefine(
  (input, context) => {
    const events = [...input.legacyEvents, ...input.versionedEvents]
    const modeValid =
      input.historyMode === "complete" ? completeBoundary(input) : checkpointBoundary(input)
    if (!modeValid || !upgradeBoundary(input))
      context.addIssue({
        code: "custom",
        message: "The V3 history boundary and upgrade provenance are inconsistent.",
      })
    if (
      events.length > 100_000 ||
      new Set(events.map((event) => event.commandId)).size !== events.length
    )
      context.addIssue({
        code: "custom",
        message: "The complete history exceeds its event budget or repeats a command identity.",
      })
  },
)
export type PortableProjectV3 = Readonly<z.infer<typeof portableProjectV3PayloadSchema>>

function requireCompleteHistory(input: PortableBoundary, context: z.RefinementCtx) {
  if (input.historyMode !== "complete")
    context.addIssue({
      code: "custom",
      path: ["historyMode"],
      message: "Checkpoint history cannot become a writable local project.",
    })
}
export const portableProjectV3ImportSchema = portableProjectV3PayloadSchema
  .safeExtend({
    importedAt: timestampSchema,
    exportedAt: timestampSchema,
  })
  .superRefine(requireCompleteHistory)
export const portableProjectV3CopySchema = portableProjectV3PayloadSchema
  .safeExtend({ copiedAt: timestampSchema })
  .superRefine(requireCompleteHistory)
export const authorityCleanCloseInputSchema = z
  .object({
    documentId: documentIdSchema,
    revision: revisionSchema,
    sessionId: sessionIdSchema,
    lease: writerLeaseClaimSchema,
  })
  .strict()
