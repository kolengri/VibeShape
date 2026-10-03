import type { VibeShapeDatabase } from "./database"

/** V1 and V2 authority share the same writer lease and atomic native stores. */
export function versionedSemanticWriteTransaction(
  database: VibeShapeDatabase,
  operation: () => Promise<void>,
) {
  return database.transaction(
    "rw",
    [
      database.projects,
      database.projectsV1,
      database.eventsV1,
      database.snapshotsV1,
      database.recoveryV1,
      database.leases,
    ],
    operation,
  )
}
