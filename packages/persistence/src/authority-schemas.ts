import {
  canonicalJson,
  documentAuthorityEventSchema,
  documentAuthoritySnapshotSchema,
  documentAuthorityV2EventSchema,
  documentAuthorityV2SnapshotSchema,
  documentEventSchema,
  documentIdSchema,
  documentSnapshotV2Schema,
  documentSnapshotV3Schema,
  documentSnapshotV4Schema,
  documentSnapshotV5Schema,
  documentSnapshotV6Schema,
  draftIdSchema,
  projectDocumentSnapshotV4ToV3,
  replayDocumentAuthorityEvents,
  revisionSchema,
  sessionIdSchema,
  sourceAssetBlobSchema,
  timestampSchema,
  validateAppearanceAuthorityBoundary,
  validateRepairAuthorityBoundaries,
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
export const projectRecordV3Schema = z
  .object({
    ...projectRecordV2Schema.shape,
    schemaVersion: z.literal(3),
    textureUpgradeRevision: revisionSchema,
  })
  .strict()
  .superRefine((project, context) => {
    const { textureUpgradeRevision, ...previous } = project
    const v2 = projectRecordV2Schema.safeParse({ ...previous, schemaVersion: 2 })
    if (!v2.success)
      for (const issue of v2.error.issues)
        context.addIssue({ code: "custom", path: issue.path, message: issue.message })
    if (
      textureUpgradeRevision <= project.upgradeRevision ||
      textureUpgradeRevision > project.latestSnapshotRevision
    )
      context.addIssue({
        code: "custom",
        path: ["textureUpgradeRevision"],
        message: "A V3 head requires its texture upgrade after V2 adoption.",
      })
  })
export const snapshotRecordV3Schema = snapshotRecordV1Schema.extend({ schemaVersion: z.literal(3) })
export const eventRecordV3Schema = eventRecordV1Schema.extend({ schemaVersion: z.literal(3) })
export const recoveryRecordV3Schema = recoveryRecordV1Schema.extend({ schemaVersion: z.literal(3) })
export const projectRecordV4Schema = z
  .object({
    ...projectRecordV3Schema.shape,
    schemaVersion: z.literal(4),
    sourceUpgradeRevision: revisionSchema,
  })
  .strict()
  .superRefine((project, context) => {
    const { sourceUpgradeRevision, ...previous } = project
    const v3 = projectRecordV3Schema.safeParse({ ...previous, schemaVersion: 3 })
    if (!v3.success)
      for (const issue of v3.error.issues)
        context.addIssue({ code: "custom", path: issue.path, message: issue.message })
    if (
      sourceUpgradeRevision <= project.textureUpgradeRevision ||
      sourceUpgradeRevision > project.latestSnapshotRevision
    )
      context.addIssue({
        code: "custom",
        message: "Source authority must follow its texture upgrade and have a committed snapshot.",
      })
  })
export const snapshotRecordV4Schema = snapshotRecordV1Schema.extend({ schemaVersion: z.literal(4) })
export const eventRecordV4Schema = eventRecordV1Schema.extend({ schemaVersion: z.literal(4) })
export const recoveryRecordV4Schema = recoveryRecordV1Schema.extend({ schemaVersion: z.literal(4) })
export type ProjectRecordV4 = z.infer<typeof projectRecordV4Schema>
export const projectRecordV5Schema = z
  .object({
    ...projectRecordV1Schema.shape,
    schemaVersion: z.literal(5),
    upgradeRevision: revisionSchema,
    textureUpgradeRevision: revisionSchema,
    sourceUpgradeRevision: revisionSchema,
    repairUpgradeRevision: revisionSchema,
  })
  .strict()
  .superRefine((project, context) => {
    const {
      upgradeRevision,
      textureUpgradeRevision,
      sourceUpgradeRevision,
      repairUpgradeRevision,
      ...head
    } = project
    const validHead = projectRecordV1Schema.safeParse({ ...head, schemaVersion: 1 })
    if (!validHead.success)
      for (const issue of validHead.error.issues)
        context.addIssue({ code: "custom", path: issue.path, message: issue.message })
    if (
      !(
        1 <= upgradeRevision &&
        upgradeRevision <= textureUpgradeRevision &&
        textureUpgradeRevision <= sourceUpgradeRevision &&
        sourceUpgradeRevision <= repairUpgradeRevision &&
        repairUpgradeRevision <= project.latestSnapshotRevision
      )
    )
      context.addIssue({
        code: "custom",
        message: "V5 adoption boundaries must be ordered and have a committed snapshot.",
      })
  })
export const snapshotRecordV5Schema = snapshotRecordV1Schema.extend({ schemaVersion: z.literal(5) })
export const eventRecordV5Schema = eventRecordV1Schema.extend({ schemaVersion: z.literal(5) })
export const recoveryRecordV5Schema = recoveryRecordV1Schema.extend({ schemaVersion: z.literal(5) })
export type ProjectRecordV5 = z.infer<typeof projectRecordV5Schema>
export const projectRecordV6Schema = z
  .object({
    ...projectRecordV5Schema.shape,
    schemaVersion: z.literal(6),
    appearanceUpgradeRevision: revisionSchema,
  })
  .strict()
  .superRefine((project, context) => {
    const { appearanceUpgradeRevision, ...previous } = project
    const parsed = projectRecordV5Schema.safeParse({ ...previous, schemaVersion: 5 })
    if (!parsed.success)
      for (const issue of parsed.error.issues)
        context.addIssue({ code: "custom", path: issue.path, message: issue.message })
    if (
      appearanceUpgradeRevision < project.repairUpgradeRevision ||
      appearanceUpgradeRevision > project.latestSnapshotRevision
    )
      context.addIssue({
        code: "custom",
        message: "Appearance adoption must follow repair authority and have a committed snapshot.",
      })
  })
export const snapshotRecordV6Schema = snapshotRecordV1Schema.extend({ schemaVersion: z.literal(6) })
export const eventRecordV6Schema = eventRecordV1Schema.extend({ schemaVersion: z.literal(6) })
export const recoveryRecordV6Schema = recoveryRecordV1Schema.extend({ schemaVersion: z.literal(6) })
export type ProjectRecordV6 = z.infer<typeof projectRecordV6Schema>
export const projectAuthorityRecordSchema = z.union([
  projectRecordV1Schema,
  projectRecordV2Schema,
  projectRecordV3Schema,
  projectRecordV4Schema,
  projectRecordV5Schema,
  projectRecordV6Schema,
])
export const snapshotAuthorityRecordSchema = z.union([
  snapshotRecordV1Schema,
  snapshotRecordV2Schema,
  snapshotRecordV3Schema,
  snapshotRecordV4Schema,
  snapshotRecordV5Schema,
  snapshotRecordV6Schema,
])
export const eventAuthorityRecordSchema = z.union([
  eventRecordV1Schema,
  eventRecordV2Schema,
  eventRecordV3Schema,
  eventRecordV4Schema,
  eventRecordV5Schema,
  eventRecordV6Schema,
])
export const recoveryAuthorityRecordSchema = z.union([
  recoveryRecordV1Schema,
  recoveryRecordV2Schema,
  recoveryRecordV3Schema,
  recoveryRecordV4Schema,
  recoveryRecordV5Schema,
  recoveryRecordV6Schema,
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
    checkpointRestore: z.literal(true).optional(),
    snapshot: documentAuthoritySnapshotSchema,
    assetBlobs: z.array(sourceAssetBlobSchema).max(1024).default([]),
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
    assetBlobs: z.array(sourceAssetBlobSchema).max(1024).default([]),
  })
  .strict()

const portableProjectV3ObjectSchema = z
  .object({
    snapshot: documentSnapshotV2Schema,
    seed: documentAuthorityV2SnapshotSchema.nullable(),
    legacyEvents: z.array(documentEventSchema).max(100_000),
    versionedEvents: z.array(documentAuthorityV2EventSchema).max(100_000),
    historyMode: z.enum(["complete", "checkpoint"]),
    promotionRevision: revisionSchema,
    upgradeRevision: revisionSchema,
    migrationDiagnostic: documentMigrationDiagnosticSchema.nullable(),
    unavailableRecords: unavailableRecordsSchema,
  })
  .strict()
type PortableBoundary = Omit<
  z.infer<typeof portableProjectV3ObjectSchema>,
  "snapshot" | "seed" | "versionedEvents"
> & {
  snapshot: { revision: number }
  seed: z.infer<typeof documentAuthoritySnapshotSchema> | null
  versionedEvents: z.infer<typeof documentAuthorityEventSchema>[]
}

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
  if (input.seed && input.seed.schemaVersion !== 1)
    return input.upgradeRevision <= input.seed.revision && upgrades.length === 0
  return upgrades.length === 1 && upgrades[0]?.revision === input.upgradeRevision
}
export const portableProjectV3PayloadSchema = portableProjectV3ObjectSchema.superRefine(
  (input, context) => {
    const modeValid =
      input.historyMode === "complete" ? completeBoundary(input) : checkpointBoundary(input)
    if (!modeValid || !upgradeBoundary(input))
      context.addIssue({
        code: "custom",
        message: "The V3 history boundary and upgrade provenance are inconsistent.",
      })
    validatePortableEventBudget(input, context)
  },
)
export type PortableProjectV3 = Readonly<z.infer<typeof portableProjectV3PayloadSchema>>

const portableProjectV4ObjectSchema = portableProjectV3ObjectSchema.extend({
  snapshot: documentSnapshotV3Schema,
  seed: documentAuthoritySnapshotSchema.nullable(),
  versionedEvents: z.array(documentAuthorityEventSchema).max(100_000),
  textureUpgradeRevision: revisionSchema,
})
export const portableProjectV4PayloadSchema = portableProjectV4ObjectSchema.superRefine(
  (input, context) => {
    const modeValid =
      input.historyMode === "complete" ? completeBoundary(input) : checkpointBoundary(input)
    const upgrades = input.versionedEvents.filter(
      (event) => event.type === "org.vibeshape.document.upgraded-v3",
    )
    const textureValid =
      input.textureUpgradeRevision > input.upgradeRevision &&
      input.textureUpgradeRevision <= input.snapshot.revision &&
      (input.seed?.schemaVersion === 3
        ? input.textureUpgradeRevision <= input.seed.revision && upgrades.length === 0
        : upgrades.length === 1 && upgrades[0]?.revision === input.textureUpgradeRevision)
    if (!modeValid || !upgradeBoundary(input) || !textureValid)
      context.addIssue({
        code: "custom",
        message: "The V4 history and texture upgrade boundaries are inconsistent.",
      })
    validatePortableEventBudget(input, context)
  },
)
export type PortableProjectV4 = Readonly<z.infer<typeof portableProjectV4PayloadSchema>>

function requireCompleteHistory(
  input: { historyMode: "complete" | "checkpoint" },
  context: z.RefinementCtx,
) {
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
export const portableProjectV4ImportSchema = portableProjectV4PayloadSchema
  .safeExtend({ importedAt: timestampSchema, exportedAt: timestampSchema })
  .superRefine(requireCompleteHistory)
export const portableProjectV4CopySchema = portableProjectV4PayloadSchema
  .safeExtend({ copiedAt: timestampSchema })
  .superRefine(requireCompleteHistory)

export const authoredPortableProjectImportSchema = z.union([
  portableProjectV3ImportSchema,
  portableProjectV4ImportSchema,
])
export const authoredPortableProjectCopySchema = z.union([
  portableProjectV3CopySchema,
  portableProjectV4CopySchema,
])
export const authorityCleanCloseInputSchema = z
  .object({
    documentId: documentIdSchema,
    revision: revisionSchema,
    sessionId: sessionIdSchema,
    lease: writerLeaseClaimSchema,
  })
  .strict()

const portableProjectV5ObjectSchema = z
  .object({
    ...portableProjectV4ObjectSchema.shape,
    snapshot: documentSnapshotV4Schema,
    sourceUpgradeRevision: revisionSchema,
    assetBlobs: z.array(sourceAssetBlobSchema).max(1024),
  })
  .strict()

function validV5SourceBoundary(input: z.infer<typeof portableProjectV5ObjectSchema>) {
  const sourceUpgradeRevision = input.sourceUpgradeRevision
  const upgrades = input.versionedEvents.filter(
    (event) => event.type === "org.vibeshape.document.upgraded-v4",
  )
  const valid =
    input.seed?.schemaVersion === 4
      ? sourceUpgradeRevision <= input.seed.revision && upgrades.length === 0
      : upgrades.length === 1 && upgrades[0]?.revision === sourceUpgradeRevision
  return (
    valid &&
    sourceUpgradeRevision > input.textureUpgradeRevision &&
    sourceUpgradeRevision <= input.snapshot.revision
  )
}
function validateV5PortableBoundary(
  input: z.infer<typeof portableProjectV5ObjectSchema>,
  context: z.RefinementCtx,
) {
  const boundary = portableProjectV4PayloadSchema.safeParse({
    historyMode: input.historyMode,
    promotionRevision: input.promotionRevision,
    upgradeRevision: input.upgradeRevision,
    textureUpgradeRevision: input.textureUpgradeRevision,
    migrationDiagnostic: input.migrationDiagnostic,
    unavailableRecords: input.unavailableRecords,
    legacyEvents: input.legacyEvents,
    versionedEvents: input.versionedEvents,
    snapshot: projectDocumentSnapshotV4ToV3(input.snapshot),
    seed: input.seed?.schemaVersion === 4 ? projectDocumentSnapshotV4ToV3(input.seed) : input.seed,
  })
  if (!boundary.success)
    for (const issue of boundary.error.issues)
      context.addIssue({ code: "custom", path: issue.path, message: issue.message })
  if (!validV5SourceBoundary(input))
    context.addIssue({ code: "custom", message: "The V5 source upgrade boundary is inconsistent." })
}
export const portableProjectV5PayloadSchema = portableProjectV5ObjectSchema.superRefine(
  validateV5PortableBoundary,
)
export type PortableProjectV5 = Readonly<z.infer<typeof portableProjectV5PayloadSchema>>
export const portableProjectV5ImportSchema = portableProjectV5PayloadSchema
  .safeExtend({
    importedAt: timestampSchema,
    exportedAt: timestampSchema,
  })
  .superRefine((input, context) => {
    if (input.historyMode !== "complete")
      context.addIssue({
        code: "custom",
        message: "A checkpoint cannot become writable local authority.",
      })
  })
export const portableProjectV5CopySchema = portableProjectV5PayloadSchema
  .safeExtend({ copiedAt: timestampSchema })
  .superRefine((input, context) => {
    if (input.historyMode !== "complete")
      context.addIssue({
        code: "custom",
        message: "A checkpoint cannot become writable local authority.",
      })
  })

export type ProjectRecordV3 = z.infer<typeof projectRecordV3Schema>

export const portableProjectV6PayloadSchema = z
  .object({
    ...portableProjectV5ObjectSchema.shape,
    snapshot: documentSnapshotV5Schema,
    repairUpgradeRevision: revisionSchema,
  })
  .strict()
  .superRefine((input, context) => {
    const modeValid =
      input.historyMode === "complete" ? completeBoundary(input) : checkpointBoundary(input)
    const boundaryIssue = validateRepairAuthorityBoundaries(input)
    const replayed = replayDocumentAuthorityEvents(input.seed, input.versionedEvents)
    if (
      !modeValid ||
      boundaryIssue !== null ||
      !replayed.ok ||
      canonicalJson(replayed.snapshot) !== canonicalJson(input.snapshot)
    )
      context.addIssue({
        code: "custom",
        message: "The V6 history must reproduce its V5 authority and adoption boundaries.",
      })
    validatePortableEventBudget(input, context)
  })
export type PortableProjectV6 = Readonly<z.infer<typeof portableProjectV6PayloadSchema>>
export const portableProjectV6ImportSchema = portableProjectV6PayloadSchema
  .safeExtend({ importedAt: timestampSchema, exportedAt: timestampSchema })
  .superRefine(requireCompleteHistory)
export const portableProjectV6CopySchema = portableProjectV6PayloadSchema
  .safeExtend({ copiedAt: timestampSchema })
  .superRefine(requireCompleteHistory)
export const portableProjectV7PayloadSchema = z
  .object({
    ...portableProjectV6PayloadSchema.shape,
    snapshot: documentSnapshotV6Schema,
    appearanceUpgradeRevision: revisionSchema,
  })
  .strict()
  .superRefine((input, context) => {
    const replayed = replayDocumentAuthorityEvents(input.seed, input.versionedEvents)
    const modeValid =
      input.historyMode === "complete" ? completeBoundary(input) : checkpointBoundary(input)
    if (
      !modeValid ||
      validateRepairAuthorityBoundaries(input) !== null ||
      validateAppearanceAuthorityBoundary(input) !== null ||
      !replayed.ok ||
      canonicalJson(replayed.snapshot) !== canonicalJson(input.snapshot)
    )
      context.addIssue({
        code: "custom",
        message: "The V7 history must reproduce its appearance authority and adoption boundaries.",
      })
    validatePortableEventBudget(input, context)
  })
export type PortableProjectV7 = Readonly<z.infer<typeof portableProjectV7PayloadSchema>>
export const portableProjectV7ImportSchema = portableProjectV7PayloadSchema
  .safeExtend({ importedAt: timestampSchema, exportedAt: timestampSchema })
  .superRefine(requireCompleteHistory)
export const portableProjectV7CopySchema = portableProjectV7PayloadSchema
  .safeExtend({ copiedAt: timestampSchema })
  .superRefine(requireCompleteHistory)
export const authoredPortableProjectPayloadSchema = z.union([
  portableProjectV3PayloadSchema,
  portableProjectV4PayloadSchema,
  portableProjectV5PayloadSchema,
  portableProjectV6PayloadSchema,
  portableProjectV7PayloadSchema,
])

function validatePortableEventBudget(
  input: Pick<PortableBoundary, "legacyEvents" | "versionedEvents">,
  context: z.RefinementCtx,
) {
  const events = [...input.legacyEvents, ...input.versionedEvents]
  if (
    events.length > 100_000 ||
    new Set(events.map((event) => event.commandId)).size !== events.length
  )
    context.addIssue({
      code: "custom",
      message: "The complete history exceeds its event budget or repeats a command identity.",
    })
}
