import type { DocumentEvent, DocumentSnapshot } from "@vibeshape/domain"
import {
  type EventRecord,
  eventRecordSchema,
  projectRecordSchema,
  snapshotRecordSchema,
} from "./schemas"
import { serializeStoredRecord } from "./stored-record-codec"

export async function storedLegacyPortableRecords(
  events: readonly DocumentEvent[],
  snapshot: DocumentSnapshot,
  storedAt: string,
) {
  const storedEvents: EventRecord[] = []
  for (const event of events) {
    const serialized = await serializeStoredRecord(event)
    storedEvents.push(
      eventRecordSchema.parse({
        schemaVersion: 0,
        documentId: event.documentId,
        revision: event.revision,
        commandId: event.commandId,
        storedAt,
        ...serialized,
      }),
    )
  }
  const serialized = await serializeStoredRecord(snapshot)
  const storedSnapshot = snapshotRecordSchema.parse({
    schemaVersion: 0,
    documentId: snapshot.id,
    revision: snapshot.revision,
    storedAt,
    ...serialized,
  })
  return { events: storedEvents, snapshot: storedSnapshot }
}

export function importedLegacyProject(
  snapshot: DocumentSnapshot,
  storedAt: string,
  externalBackupAt: string | null,
) {
  return projectRecordSchema.parse({
    schemaVersion: 0,
    documentId: snapshot.id,
    name: snapshot.name,
    headRevision: snapshot.revision,
    latestSnapshotRevision: snapshot.revision,
    cleanCloseRevision: snapshot.revision,
    createdAt: snapshot.createdAt,
    updatedAt: storedAt,
    lastExternalBackupAt: externalBackupAt,
  })
}
