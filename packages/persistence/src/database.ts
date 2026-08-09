import Dexie, { type Table } from "dexie"
import type {
  CacheIndexRecord,
  EventRecord,
  LeaseRecord,
  ProjectRecord,
  ProjectThumbnailRecord,
  RecoveryRecord,
  SnapshotRecord,
} from "./schemas"

export const PERSISTENCE_SCHEMA_VERSION = 2

export class VibeShapeDatabase extends Dexie {
  projects!: Table<ProjectRecord, string>
  snapshots!: Table<SnapshotRecord, [string, number]>
  events!: Table<EventRecord, [string, number]>
  recovery!: Table<RecoveryRecord, string>
  leases!: Table<LeaseRecord, string>
  cacheIndex!: Table<CacheIndexRecord, string>
  projectThumbnails!: Table<ProjectThumbnailRecord, string>

  constructor(name: string) {
    super(name)
    this.version(1).stores({
      projects: "documentId, updatedAt",
      snapshots: "[documentId+revision], documentId, revision",
      events: "[documentId+revision], documentId, revision, &commandId",
      recovery: "documentId, updatedAt",
      leases: "documentId, expiresAt",
      cacheIndex: "contentHash, lastAccessedAt, engineBuildId",
    })
    this.version(PERSISTENCE_SCHEMA_VERSION).stores({
      projectThumbnails: "documentId, revision, generatedAt",
    })
  }
}
