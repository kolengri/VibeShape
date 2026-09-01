import {
  commandIdSchema,
  documentEventSchema,
  documentIdSchema,
  documentSnapshotSchema,
  documentSnapshotV1Schema,
  draftIdSchema,
  revisionSchema,
  sessionIdSchema,
  technicalIdentifierSchema,
  timestampSchema,
  versionedDocumentEventSchema,
} from "@vibeshape/domain"
import { z } from "zod"

export const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/, "Expected a SHA-256 digest.")
export const PROJECT_THUMBNAIL_MAX_BYTES = 128 * 1024

const projectThumbnailSvgPattern =
  /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 240 160" role="img"><g stroke="#[0-9a-f]{6}" stroke-width="[0-9.]+" stroke-linejoin="round">(?:<polygon points="[0-9]{1,3}\.[0-9]{2},[0-9]{1,3}\.[0-9]{2}(?: [0-9]{1,3}\.[0-9]{2},[0-9]{1,3}\.[0-9]{2}){2}" fill="rgb\([0-9]{1,3} [0-9]{1,3} [0-9]{1,3}\)"\/>)+<\/g><\/svg>$/

function isSafeProjectThumbnailSvg(bytes: Uint8Array) {
  try {
    return projectThumbnailSvgPattern.test(new TextDecoder("utf-8", { fatal: true }).decode(bytes))
  } catch {
    return false
  }
}

const projectThumbnailPayloadSchema = z
  .object({
    revision: revisionSchema,
    mediaType: z.literal("image/svg+xml"),
    bytes: z
      .instanceof(Uint8Array)
      .refine((value) => value.byteLength > 0, "Project thumbnail is empty.")
      .refine(
        (value) => value.byteLength <= PROJECT_THUMBNAIL_MAX_BYTES,
        "Project thumbnail is too large.",
      )
      .refine(isSafeProjectThumbnailSvg, "Project thumbnail SVG is invalid."),
    generatedAt: timestampSchema,
  })
  .strict()

export const projectThumbnailRecordSchema = projectThumbnailPayloadSchema.extend({
  schemaVersion: z.literal(0),
  documentId: documentIdSchema,
})

export const projectRecordSchema = z
  .object({
    schemaVersion: z.literal(0),
    documentId: documentIdSchema,
    name: z.string().min(1).max(120),
    headRevision: revisionSchema,
    latestSnapshotRevision: revisionSchema,
    cleanCloseRevision: revisionSchema.nullable(),
    createdAt: timestampSchema,
    updatedAt: timestampSchema,
    lastExternalBackupAt: timestampSchema.nullable(),
  })
  .strict()

export const localProjectSummarySchema = z
  .object({
    documentId: documentIdSchema,
    name: z.string().min(1).max(120),
    headRevision: revisionSchema,
    createdAt: timestampSchema,
    updatedAt: timestampSchema,
    lastExternalBackupAt: timestampSchema.nullable(),
    thumbnail: projectThumbnailPayloadSchema.nullable(),
  })
  .strict()

export const snapshotRecordSchema = z
  .object({
    schemaVersion: z.literal(0),
    documentId: documentIdSchema,
    revision: revisionSchema,
    storedAt: timestampSchema,
    payload: z.string().min(2),
    checksum: sha256Schema,
  })
  .strict()

export const eventRecordSchema = z
  .object({
    schemaVersion: z.literal(0),
    documentId: documentIdSchema,
    revision: revisionSchema,
    commandId: commandIdSchema,
    storedAt: timestampSchema,
    payload: z.string().min(2),
    checksum: sha256Schema,
  })
  .strict()

export const recoveryRecordSchema = z
  .object({
    schemaVersion: z.literal(0),
    documentId: documentIdSchema,
    sessionId: sessionIdSchema,
    openedAt: timestampSchema,
    updatedAt: timestampSchema,
    lastConfirmedRevision: revisionSchema,
  })
  .strict()

export const leaseRecordSchema = z
  .object({
    schemaVersion: z.literal(0),
    documentId: documentIdSchema,
    ownerId: sessionIdSchema,
    epoch: z.number().int().positive().safe(),
    expiresAt: z.number().int().nonnegative().safe(),
  })
  .strict()

export const cacheIndexRecordSchema = z
  .object({
    schemaVersion: z.literal(0),
    contentHash: sha256Schema,
    path: z.string().regex(/^cache\/[a-f0-9]{64}\.bin$/),
    byteLength: z
      .number()
      .int()
      .nonnegative()
      .max(2 * 1024 * 1024 * 1024),
    engineBuildId: technicalIdentifierSchema,
    lastAccessedAt: timestampSchema,
  })
  .strict()

export const writerLeaseClaimSchema = z
  .object({
    epoch: z.number().int().positive().safe(),
    nowMs: z.number().int().nonnegative().safe(),
  })
  .strict()

export const persistenceCommitInputSchema = z
  .object({
    sessionId: sessionIdSchema,
    lease: writerLeaseClaimSchema.nullable(),
    storedAt: timestampSchema,
    baseSnapshot: documentSnapshotSchema.nullable(),
    event: documentEventSchema,
    snapshot: documentSnapshotSchema,
  })
  .strict()

export const persistenceDraftCommitInputSchema = z
  .object({
    sessionId: sessionIdSchema,
    lease: writerLeaseClaimSchema,
    storedAt: timestampSchema,
    transactionId: draftIdSchema,
    baseSnapshot: documentSnapshotSchema,
    events: z.array(documentEventSchema).min(1).max(256),
    snapshot: documentSnapshotSchema,
  })
  .strict()

// Version 1 records are stored beside (rather than in place of) the legacy
// records so a failed promotion cannot damage the recoverable v0 journal.
export const migrationProvenanceSchema = z.enum(["current", "journal-derived", "snapshot-derived"])

export const documentMigrationDiagnosticSchema = z
  .object({ code: z.string().min(1).max(128), message: z.string().min(1).max(512) })
  .strict()

export const unavailableRecordsSchema = z.array(z.string().min(1).max(256)).max(256)

const v1MigrationMetadataSchema = z
  .object({
    migrationProvenance: migrationProvenanceSchema,
    migrationDiagnostic: documentMigrationDiagnosticSchema.nullable(),
    unavailableRecords: unavailableRecordsSchema,
  })
  .strict()

export const projectRecordV1Schema = z
  .object({
    schemaVersion: z.literal(1),
    documentId: documentIdSchema,
    name: z.string().min(1).max(120),
    headRevision: revisionSchema,
    latestSnapshotRevision: revisionSchema,
    cleanCloseRevision: revisionSchema.nullable(),
    createdAt: timestampSchema,
    updatedAt: timestampSchema,
    lastExternalBackupAt: timestampSchema.nullable(),
    ...v1MigrationMetadataSchema.shape,
  })
  .strict()
  .superRefine((project, context) => {
    if (project.latestSnapshotRevision > project.headRevision)
      context.addIssue({
        code: "custom",
        path: ["latestSnapshotRevision"],
        message: "The latest snapshot cannot be newer than the project head.",
      })
    if (project.cleanCloseRevision !== null && project.cleanCloseRevision > project.headRevision)
      context.addIssue({
        code: "custom",
        path: ["cleanCloseRevision"],
        message: "The clean-close revision cannot be newer than the project head.",
      })
  })

export const snapshotRecordV1Schema = z
  .object({
    schemaVersion: z.literal(1),
    documentId: documentIdSchema,
    revision: revisionSchema,
    storedAt: timestampSchema,
    payload: z.string().min(2),
    checksum: sha256Schema,
  })
  .strict()

export const eventRecordV1Schema = z
  .object({
    schemaVersion: z.literal(1),
    documentId: documentIdSchema,
    revision: revisionSchema,
    commandId: commandIdSchema,
    storedAt: timestampSchema,
    payload: z.string().min(2),
    checksum: sha256Schema,
  })
  .strict()

export const recoveryRecordV1Schema = z
  .object({
    schemaVersion: z.literal(1),
    documentId: documentIdSchema,
    sessionId: sessionIdSchema,
    openedAt: timestampSchema,
    updatedAt: timestampSchema,
    lastConfirmedRevision: revisionSchema,
    ...v1MigrationMetadataSchema.shape,
  })
  .strict()

export const persistenceV1CommitInputSchema = z
  .object({
    sessionId: sessionIdSchema,
    lease: writerLeaseClaimSchema.nullable(),
    storedAt: timestampSchema,
    baseSnapshot: documentSnapshotV1Schema.nullable(),
    event: versionedDocumentEventSchema,
    snapshot: documentSnapshotV1Schema,
  })
  .strict()

export const persistenceV1DraftCommitInputSchema = z
  .object({
    sessionId: sessionIdSchema,
    lease: writerLeaseClaimSchema,
    storedAt: timestampSchema,
    transactionId: draftIdSchema,
    baseSnapshot: documentSnapshotV1Schema,
    events: z.array(versionedDocumentEventSchema).min(1).max(256),
    snapshot: documentSnapshotV1Schema,
  })
  .strict()

export const persistencePromotionInputSchema = z
  .object({
    sessionId: sessionIdSchema,
    lease: writerLeaseClaimSchema,
    storedAt: timestampSchema,
    sourceHeadRevision: revisionSchema,
    snapshot: documentSnapshotV1Schema,
    migrationProvenance: z.enum(["journal-derived", "snapshot-derived"]),
    migrationDiagnostic: documentMigrationDiagnosticSchema.nullable(),
    unavailableRecords: unavailableRecordsSchema,
  })
  .strict()
  .superRefine((input, context) => {
    if (input.snapshot.revision > input.sourceHeadRevision)
      context.addIssue({
        code: "custom",
        path: ["sourceHeadRevision"],
        message: "The source head cannot precede the recovered snapshot.",
      })
    if (
      input.migrationProvenance === "snapshot-derived" &&
      (input.migrationDiagnostic === null || input.unavailableRecords.length === 0)
    )
      context.addIssue({
        code: "custom",
        path: ["migrationProvenance"],
        message: "Snapshot-derived promotion requires degraded-recovery evidence.",
      })
  })

const portableProjectPayloadSchema = z
  .object({
    snapshot: documentSnapshotSchema,
    events: z.array(documentEventSchema).min(1).max(100_000),
  })
  .strict()

export const portableProjectImportSchema = portableProjectPayloadSchema.extend({
  importedAt: timestampSchema,
  exportedAt: timestampSchema,
})

export const portableProjectCopySchema = portableProjectPayloadSchema.extend({
  copiedAt: timestampSchema,
})

export const portableProjectV2HistoryModeSchema = z.enum(["complete", "checkpoint"])

type PortableV2Boundary = Readonly<{
  seed: { revision: number } | null
  legacyEvents: readonly unknown[]
  versionedEvents: readonly unknown[]
  historyMode: "complete" | "checkpoint"
  promotionRevision: number
  migrationDiagnostic: unknown | null
  unavailableRecords: readonly string[]
}>

function isNativeCompleteBoundary(input: PortableV2Boundary) {
  return [
    input.promotionRevision === 0,
    input.seed === null,
    input.legacyEvents.length === 0,
  ].every(Boolean)
}

function isPromotedCompleteBoundary(input: PortableV2Boundary) {
  return [
    input.promotionRevision > 0,
    input.seed?.revision === input.promotionRevision,
    input.legacyEvents.length === input.promotionRevision,
  ].every(Boolean)
}

function isCompleteBoundary(input: PortableV2Boundary) {
  return (
    input.historyMode === "complete" &&
    input.migrationDiagnostic === null &&
    input.unavailableRecords.length === 0 &&
    (isNativeCompleteBoundary(input) || isPromotedCompleteBoundary(input))
  )
}

function isCheckpointBoundary(input: PortableV2Boundary) {
  return [
    input.historyMode === "checkpoint",
    input.seed?.revision === input.promotionRevision,
    input.legacyEvents.length === 0,
    input.migrationDiagnostic !== null,
    input.unavailableRecords.length > 0,
  ].every(Boolean)
}

function validatePortableV2Boundary(input: PortableV2Boundary, context: z.RefinementCtx) {
  if (input.legacyEvents.length + input.versionedEvents.length > 100_000)
    context.addIssue({
      code: "custom",
      path: ["versionedEvents"],
      message: "The portable v2 history exceeds its aggregate event limit.",
    })
  if (isCompleteBoundary(input) || isCheckpointBoundary(input)) return
  context.addIssue({
    code: "custom",
    path: ["historyMode"],
    message: "The portable v2 replay boundary and recovery evidence are inconsistent.",
  })
}

export const portableProjectV2PayloadSchema = z
  .object({
    snapshot: documentSnapshotV1Schema,
    seed: documentSnapshotV1Schema.nullable(),
    legacyEvents: z.array(documentEventSchema).max(100_000),
    versionedEvents: z.array(versionedDocumentEventSchema).max(100_000),
    historyMode: portableProjectV2HistoryModeSchema,
    promotionRevision: revisionSchema,
    migrationDiagnostic: documentMigrationDiagnosticSchema.nullable(),
    unavailableRecords: unavailableRecordsSchema,
  })
  .strict()
  .superRefine(validatePortableV2Boundary)

function requireWritablePortableV2History(input: PortableV2Boundary, context: z.RefinementCtx) {
  if (input.historyMode === "complete") return
  context.addIssue({
    code: "custom",
    path: ["historyMode"],
    message: "Checkpoint history cannot become a writable local project.",
  })
}

export const portableProjectV2ImportSchema = portableProjectV2PayloadSchema
  .extend({
    importedAt: timestampSchema,
    exportedAt: timestampSchema,
  })
  .superRefine(requireWritablePortableV2History)

export const portableProjectV2CopySchema = portableProjectV2PayloadSchema
  .extend({ copiedAt: timestampSchema })
  .superRefine(requireWritablePortableV2History)

export const projectThumbnailWriteInputSchema = projectThumbnailRecordSchema.omit({
  schemaVersion: true,
})

export const projectThumbnailCopyInputSchema = z
  .object({
    sourceDocumentId: documentIdSchema,
    sourceRevision: revisionSchema,
    targetDocumentId: documentIdSchema,
    targetRevision: revisionSchema,
    generatedAt: timestampSchema,
  })
  .strict()
  .refine((input) => input.sourceDocumentId !== input.targetDocumentId, {
    message: "A project thumbnail copy requires distinct documents.",
    path: ["targetDocumentId"],
  })

export const projectDeleteInputSchema = z
  .object({
    documentId: documentIdSchema,
    expectedHeadRevision: revisionSchema,
    nowMs: z.number().int().nonnegative().safe(),
  })
  .strict()

export const persistenceDiagnosticCodeSchema = z.enum([
  "invalid-input",
  "document-already-exists",
  "document-not-found",
  "stale-revision",
  "corrupt-history",
  "quota-exceeded",
  "transaction-aborted",
  "storage-unavailable",
  "lease-held",
  "lease-lost",
  "takeover-snapshot-required",
])

export const persistenceDiagnosticSchema = z
  .object({
    code: persistenceDiagnosticCodeSchema,
    message: z.string().min(1),
    retryable: z.boolean(),
  })
  .strict()

export type ProjectRecord = z.infer<typeof projectRecordSchema>
export type ProjectRecordV1 = z.infer<typeof projectRecordV1Schema>
export type ProjectThumbnailRecord = z.infer<typeof projectThumbnailRecordSchema>
export type LocalProjectSummary = z.infer<typeof localProjectSummarySchema>
export type SnapshotRecord = z.infer<typeof snapshotRecordSchema>
export type SnapshotRecordV1 = z.infer<typeof snapshotRecordV1Schema>
export type EventRecord = z.infer<typeof eventRecordSchema>
export type EventRecordV1 = z.infer<typeof eventRecordV1Schema>
export type RecoveryRecord = z.infer<typeof recoveryRecordSchema>
export type RecoveryRecordV1 = z.infer<typeof recoveryRecordV1Schema>
export type LeaseRecord = z.infer<typeof leaseRecordSchema>
export type CacheIndexRecord = z.infer<typeof cacheIndexRecordSchema>
export type PersistenceCommitInput = z.input<typeof persistenceCommitInputSchema>
export type PersistenceDraftCommitInput = z.input<typeof persistenceDraftCommitInputSchema>
export type PersistenceV1CommitInput = z.input<typeof persistenceV1CommitInputSchema>
export type PersistenceV1DraftCommitInput = z.input<typeof persistenceV1DraftCommitInputSchema>
export type PersistencePromotionInput = z.input<typeof persistencePromotionInputSchema>
export type PortableProjectImport = z.input<typeof portableProjectImportSchema>
export type PortableProjectCopy = z.input<typeof portableProjectCopySchema>
export type PortableProjectV2Import = z.input<typeof portableProjectV2ImportSchema>
export type PortableProjectV2Copy = z.input<typeof portableProjectV2CopySchema>
export type ProjectThumbnailWriteInput = z.input<typeof projectThumbnailWriteInputSchema>
export type ProjectThumbnailCopyInput = z.input<typeof projectThumbnailCopyInputSchema>
export type ProjectDeleteInput = z.input<typeof projectDeleteInputSchema>
export type WriterLeaseClaim = z.infer<typeof writerLeaseClaimSchema>
export type PersistenceDiagnostic = z.infer<typeof persistenceDiagnosticSchema>
export type MigrationProvenance = z.infer<typeof migrationProvenanceSchema>
export type DocumentMigrationDiagnostic = z.infer<typeof documentMigrationDiagnosticSchema>
