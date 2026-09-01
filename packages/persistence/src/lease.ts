import { documentIdSchema, sessionIdSchema } from "@vibeshape/domain"
import { z } from "zod"
import type { VibeShapeDatabase } from "./database"
import {
  classifyPersistenceError,
  createPersistenceDiagnostic,
  persistenceInvariantError,
} from "./diagnostics"
import type { PersistenceResult } from "./repository"
import {
  type LeaseRecord,
  leaseRecordSchema,
  projectRecordSchema,
  projectRecordV1Schema,
} from "./schemas"

const leaseRequestSchema = z
  .object({
    documentId: documentIdSchema,
    ownerId: sessionIdSchema,
    nowMs: z.number().int().nonnegative().safe(),
    durationMs: z.number().int().min(1_000).max(60_000),
  })
  .strict()

const leaseIdentitySchema = leaseRequestSchema.pick({
  documentId: true,
  ownerId: true,
  nowMs: true,
})

export interface LeaseGrant {
  status: "acquired" | "renewed" | "taken-over"
  lease: LeaseRecord
}

function activeLeaseOwnedByAnother(
  current: LeaseRecord | undefined,
  ownerId: string,
  nowMs: number,
) {
  return current !== undefined && current.ownerId !== ownerId && current.expiresAt > nowMs
}

function grantStatus(current: LeaseRecord | undefined, ownerId: string, nowMs: number) {
  if (!current) return "acquired" as const
  return current.ownerId === ownerId && current.expiresAt > nowMs
    ? ("renewed" as const)
    : ("taken-over" as const)
}

function nextLease(
  current: LeaseRecord | undefined,
  input: z.output<typeof leaseRequestSchema>,
): LeaseRecord {
  const status = grantStatus(current, input.ownerId, input.nowMs)
  const previousEpoch = current ? current.epoch : 0
  const epoch = status === "renewed" ? previousEpoch : previousEpoch + 1
  return leaseRecordSchema.parse({
    schemaVersion: 0,
    documentId: input.documentId,
    ownerId: input.ownerId,
    epoch,
    expiresAt: input.nowMs + input.durationMs,
  })
}

function requireLeaseAvailable(
  current: LeaseRecord | undefined,
  input: z.output<typeof leaseRequestSchema>,
) {
  if (activeLeaseOwnedByAnother(current, input.ownerId, input.nowMs)) {
    throw persistenceInvariantError("lease-held", "Another tab owns the document lease.")
  }
}

function requireTakeoverSnapshot(
  status: LeaseGrant["status"],
  project: { latestSnapshotRevision: number; headRevision: number },
) {
  const snapshotRequired =
    status === "taken-over" && project.latestSnapshotRevision !== project.headRevision
  if (snapshotRequired) {
    throw persistenceInvariantError(
      "takeover-snapshot-required",
      "A current snapshot is required before lease takeover.",
    )
  }
}

async function grantDocumentLease(
  database: VibeShapeDatabase,
  input: z.output<typeof leaseRequestSchema>,
): Promise<PersistenceResult<LeaseGrant>> {
  const current = await database.leases.get(input.documentId)
  requireLeaseAvailable(current, input)
  const versionedProject = await database.projectsV1.get(input.documentId)
  const legacyProject = versionedProject ? undefined : await database.projects.get(input.documentId)
  if (!versionedProject && !legacyProject) {
    throw persistenceInvariantError("document-not-found", "The document does not exist.")
  }
  const project = versionedProject
    ? projectRecordV1Schema.safeParse(versionedProject)
    : projectRecordSchema.safeParse(legacyProject)
  if (!project.success)
    throw persistenceInvariantError("corrupt-history", "The persisted project head is invalid.")
  const status = grantStatus(current, input.ownerId, input.nowMs)
  requireTakeoverSnapshot(status, project.data)
  const lease = nextLease(current, input)
  await database.leases.put(lease)
  return { ok: true, value: { status, lease } }
}

export async function acquireDocumentLease(
  database: VibeShapeDatabase,
  input: unknown,
): Promise<PersistenceResult<LeaseGrant>> {
  const parsed = leaseRequestSchema.safeParse(input)
  if (!parsed.success) {
    return {
      ok: false,
      diagnostic: createPersistenceDiagnostic("invalid-input", "The lease request is invalid."),
    }
  }
  try {
    return await database.transaction(
      "rw",
      database.projects,
      database.projectsV1,
      database.leases,
      () => grantDocumentLease(database, parsed.data),
    )
  } catch (error) {
    return { ok: false, diagnostic: classifyPersistenceError(error) }
  }
}

function requireLeaseOwner(current: LeaseRecord | undefined, ownerId: string) {
  const owned = current !== undefined && current.ownerId === ownerId
  if (!owned) {
    throw persistenceInvariantError("lease-lost", "The document lease is no longer owned.")
  }
}

export async function releaseDocumentLease(
  database: VibeShapeDatabase,
  input: unknown,
): Promise<PersistenceResult<void>> {
  const parsed = leaseIdentitySchema.safeParse(input)
  if (!parsed.success) {
    return {
      ok: false,
      diagnostic: createPersistenceDiagnostic("invalid-input", "The lease identity is invalid."),
    }
  }
  try {
    await database.transaction("rw", database.leases, async () => {
      const current = await database.leases.get(parsed.data.documentId)
      requireLeaseOwner(current, parsed.data.ownerId)
      await database.leases.delete(parsed.data.documentId)
    })
    return { ok: true, value: undefined }
  } catch (error) {
    return { ok: false, diagnostic: classifyPersistenceError(error) }
  }
}
