import Dexie, { type Table } from "dexie"
import type {
  EventAuthorityRecord,
  ProjectAuthorityRecord,
  RecoveryAuthorityRecord,
  SnapshotAuthorityRecord,
} from "./authority-schemas"
import type {
  CacheIndexRecord,
  EventRecord,
  LeaseRecord,
  ProjectRecord,
  ProjectThumbnailRecord,
  RecoveryRecord,
  SnapshotRecord,
} from "./schemas"

export const PERSISTENCE_SCHEMA_VERSION = 3

export class VibeShapeDatabase extends Dexie {
  projects!: Table<ProjectRecord, string>
  snapshots!: Table<SnapshotRecord, [string, number]>
  events!: Table<EventRecord, [string, number]>
  recovery!: Table<RecoveryRecord, string>
  leases!: Table<LeaseRecord, string>
  cacheIndex!: Table<CacheIndexRecord, string>
  projectThumbnails!: Table<ProjectThumbnailRecord, string>
  projectsV1!: Table<ProjectAuthorityRecord, string>
  snapshotsV1!: Table<SnapshotAuthorityRecord, [string, number]>
  eventsV1!: Table<EventAuthorityRecord, [string, number]>
  recoveryV1!: Table<RecoveryAuthorityRecord, string>

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
    this.version(2).stores({
      projectThumbnails: "documentId, revision, generatedAt",
    })
    this.version(3).stores({
      projectsV1: "documentId, updatedAt",
      snapshotsV1: "[documentId+revision], documentId, revision",
      eventsV1: "[documentId+revision], documentId, revision, &commandId",
      recoveryV1: "documentId, updatedAt",
    })
  }
}
