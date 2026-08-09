import {
  commandIdSchema,
  documentEventSchema,
  documentIdSchema,
  documentSnapshotSchema,
  draftIdSchema,
  revisionSchema,
  sessionIdSchema,
  technicalIdentifierSchema,
  timestampSchema,
} from "@vibeshape/domain"
import { z } from "zod"

export const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/, "Expected a SHA-256 digest.")

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
export type SnapshotRecord = z.infer<typeof snapshotRecordSchema>
export type EventRecord = z.infer<typeof eventRecordSchema>
export type RecoveryRecord = z.infer<typeof recoveryRecordSchema>
export type LeaseRecord = z.infer<typeof leaseRecordSchema>
export type CacheIndexRecord = z.infer<typeof cacheIndexRecordSchema>
export type PersistenceCommitInput = z.input<typeof persistenceCommitInputSchema>
export type PersistenceDraftCommitInput = z.input<typeof persistenceDraftCommitInputSchema>
export type WriterLeaseClaim = z.infer<typeof writerLeaseClaimSchema>
export type PersistenceDiagnostic = z.infer<typeof persistenceDiagnosticSchema>
