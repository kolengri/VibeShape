import {
  type DocumentAuthorityEvent,
  type DocumentAuthoritySnapshot,
  type DocumentId,
  documentAuthorityEventSchema,
  documentAuthoritySnapshotSchema,
} from "@vibeshape/domain"
import { z } from "zod"
import {
  eventAuthorityRecordSchema,
  type ProjectAuthorityRecord,
  projectAuthorityRecordSchema,
  snapshotAuthorityRecordSchema,
} from "./authority-schemas"
import type { VibeShapeDatabase } from "./database"
import { persistenceInvariantError } from "./diagnostics"
import { parseStoredRecordPayload, serializeStoredRecord } from "./stored-record-codec"

const versionHeaderSchema = z.object({ schemaVersion: z.number().int() }).passthrough()

/** Future versions are a capability boundary, never a corrupt-record fallback candidate. */
export function requireSupportedAuthorityVersion(value: unknown) {
  const header = versionHeaderSchema.safeParse(value)
  if (
    header.success &&
    header.data.schemaVersion !== 1 &&
    header.data.schemaVersion !== 2 &&
    header.data.schemaVersion !== 3
  )
    throw persistenceInvariantError(
      "unsupported-version",
      "This document requires a different authority schema version.",
    )
}

export function parseAuthorityProject(value: unknown): ProjectAuthorityRecord {
  requireSupportedAuthorityVersion(value)
  const project = projectAuthorityRecordSchema.safeParse(value)
  if (!project.success)
    throw persistenceInvariantError("corrupt-history", "The document authority head is invalid.")
  return project.data
}

export async function requireAuthorityProject(
  database: VibeShapeDatabase,
  documentId: DocumentId,
): Promise<ProjectAuthorityRecord> {
  const record = await database.projectsV1.get(documentId)
  if (!record)
    throw persistenceInvariantError("document-not-found", "The versioned document does not exist.")
  return parseAuthorityProject(record)
}

export async function validAuthoritySnapshot(
  value: unknown,
): Promise<DocumentAuthoritySnapshot | null> {
  requireSupportedAuthorityVersion(value)
  const record = snapshotAuthorityRecordSchema.safeParse(value)
  if (!record.success) return null
  const payload = await parseStoredRecordPayload(record.data, z.unknown())
  requireSupportedAuthorityVersion(payload)
  const snapshot = documentAuthoritySnapshotSchema.safeParse(payload)
  return snapshot.success &&
    snapshot.data.schemaVersion === record.data.schemaVersion &&
    snapshot.data.id === record.data.documentId &&
    snapshot.data.revision === record.data.revision
    ? snapshot.data
    : null
}

export async function validAuthorityEvent(value: unknown): Promise<DocumentAuthorityEvent | null> {
  requireSupportedAuthorityVersion(value)
  const record = eventAuthorityRecordSchema.safeParse(value)
  if (!record.success) return null
  const payload = await parseStoredRecordPayload(record.data, z.unknown())
  requireSupportedAuthorityVersion(payload)
  const event = documentAuthorityEventSchema.safeParse(payload)
  return event.success &&
    event.data.schemaVersion === record.data.schemaVersion &&
    event.data.documentId === record.data.documentId &&
    event.data.revision === record.data.revision &&
    event.data.commandId === record.data.commandId
    ? event.data
    : null
}

export async function storeAuthoritySnapshot(
  snapshot: DocumentAuthoritySnapshot,
  storedAt: string,
) {
  return snapshotAuthorityRecordSchema.parse({
    schemaVersion: snapshot.schemaVersion,
    documentId: snapshot.id,
    revision: snapshot.revision,
    storedAt,
    ...(await serializeStoredRecord(snapshot)),
  })
}
export async function storeAuthorityEvent(event: DocumentAuthorityEvent, storedAt: string) {
  return eventAuthorityRecordSchema.parse({
    schemaVersion: event.schemaVersion,
    documentId: event.documentId,
    revision: event.revision,
    commandId: event.commandId,
    storedAt,
    ...(await serializeStoredRecord(event)),
  })
}
