import type { DocumentSnapshotV1 } from "./document"
import { documentRestoredEventSchema } from "./document-history"

/** Retains only historical revisions needed by a known replay suffix. */
export class VersionedReplayTargets {
  readonly #uses = new Map<number, number>()
  readonly #snapshots = new Map<number, DocumentSnapshotV1>()

  constructor(seed: DocumentSnapshotV1 | null, events: readonly unknown[]) {
    for (const event of events) {
      const parsed = documentRestoredEventSchema.safeParse(event)
      if (parsed.success) {
        const revision = parsed.data.targetRevision
        this.#uses.set(revision, (this.#uses.get(revision) ?? 0) + 1)
      }
    }
    if (seed) this.#retain(seed)
  }

  target(event: unknown) {
    const parsed = documentRestoredEventSchema.safeParse(event)
    return parsed.success ? this.#snapshots.get(parsed.data.targetRevision) : undefined
  }

  accept(snapshot: DocumentSnapshotV1, event: unknown) {
    const parsed = documentRestoredEventSchema.safeParse(event)
    if (parsed.success) {
      const revision = parsed.data.targetRevision
      const remaining = (this.#uses.get(revision) ?? 1) - 1
      if (remaining === 0) {
        this.#uses.delete(revision)
        this.#snapshots.delete(revision)
      } else this.#uses.set(revision, remaining)
    }
    this.#retain(snapshot)
  }

  #retain(snapshot: DocumentSnapshotV1) {
    if (this.#uses.has(snapshot.revision)) this.#snapshots.set(snapshot.revision, snapshot)
  }
}
