import { canonicalJson, type DocumentSnapshotV1 } from "@vibeshape/domain"
import {
  type CommandActor,
  commandActorSchema,
  commandActorsEqual,
} from "@vibeshape/domain/commands"

export type DocumentHistoryCheckpoint = Readonly<{ id: symbol }>
export type DocumentHistoryCheckpointState = Readonly<{ revision: number; changed: boolean }>
type Checkpoint<Snapshot> = {
  snapshot: Snapshot
  revision: number
  actor: CommandActor | null
  acceptsActor: (actor: CommandActor) => boolean
  valid: boolean
  sealed: boolean
  size: number
}

export type DocumentHistoryNavigationState = Readonly<{
  schemaVersion: 1
  undo: readonly Readonly<{ before: number; after: number }>[]
  redo: readonly Readonly<{ before: number; after: number }>[]
}>
type HistoryEntry = Readonly<{ before: number; after: number }>

// Bound retained semantic checkpoints independently of the durable event journal.
const MAX_CHECKPOINT_BYTES = 32 * 1024 * 1024
const MAX_PINNED_CHECKPOINTS = 8

function content(snapshot: { revision: number; updatedAt: string }) {
  const { revision: _revision, updatedAt: _updatedAt, ...value } = snapshot
  return canonicalJson(value)
}

function accepts(checkpoint: Checkpoint<unknown>, actor: CommandActor) {
  try {
    return (
      checkpoint.acceptsActor(actor) &&
      (!checkpoint.actor || commandActorsEqual(checkpoint.actor, actor))
    )
  } catch {
    return false
  }
}

export class DocumentUndoHistory<
  Snapshot extends { revision: number; updatedAt: string } = DocumentSnapshotV1,
> {
  #undo: HistoryEntry[] = []
  #redo: HistoryEntry[] = []
  #cache = new Map<number, { snapshot: Snapshot; size: number }>()
  #cacheBytes = 0
  #checkpoints = new Map<DocumentHistoryCheckpoint, Checkpoint<Snapshot>>()

  constructor(private readonly checkpointContent: (snapshot: Snapshot) => string = content) {}

  get availability() {
    return { canUndo: this.#undo.length > 0, canRedo: this.#redo.length > 0 }
  }

  clear() {
    this.clearUndoRedo()
    this.#checkpoints.clear()
  }

  clearUndoRedo() {
    this.#undo = []
    this.#redo = []
    this.#cache.clear()
    this.#cacheBytes = 0
  }

  captureCheckpoint(snapshot: Snapshot, acceptsActor: (actor: CommandActor) => boolean) {
    const size = canonicalJson(snapshot).length * 2
    const retained = [...this.#checkpoints.values()].reduce(
      (sum, checkpoint) => sum + checkpoint.size,
      0,
    )
    if (
      size * 2 > MAX_CHECKPOINT_BYTES ||
      retained + size > MAX_CHECKPOINT_BYTES ||
      this.#checkpoints.size >= MAX_PINNED_CHECKPOINTS
    )
      return null
    const handle = Object.freeze({ id: Symbol("document-history-checkpoint") })
    this.#checkpoints.set(handle, {
      snapshot,
      revision: snapshot.revision,
      actor: null,
      acceptsActor,
      valid: true,
      sealed: false,
      size,
    })
    return handle
  }

  sealCheckpoint(handle: DocumentHistoryCheckpoint, current: Snapshot, revision: number) {
    const checkpoint = this.#checkpoints.get(handle)
    if (!checkpoint || this.checkpointState(handle, current)?.revision !== revision) return false
    checkpoint.sealed = true
    return true
  }

  permitsPublication(before: Snapshot, after: Snapshot, actors: readonly CommandActor[]) {
    if (!actors.length) return true
    let size: number | undefined
    for (const checkpoint of this.#checkpoints.values()) {
      if (!checkpoint.valid || checkpoint.sealed || checkpoint.revision !== before.revision)
        continue
      if (!actors.every((actor) => accepts(checkpoint, actor))) continue
      size ??= canonicalJson(after).length * 2
      if (checkpoint.size + size > MAX_CHECKPOINT_BYTES) return false
    }
    return true
  }

  releaseCheckpoint(handle: DocumentHistoryCheckpoint) {
    this.#checkpoints.delete(handle)
  }

  checkpointState(
    handle: DocumentHistoryCheckpoint,
    current: Snapshot,
  ): DocumentHistoryCheckpointState | null {
    const checkpoint = this.#checkpoints.get(handle)
    if (
      !checkpoint?.valid ||
      checkpoint.revision !== current.revision ||
      checkpoint.size + canonicalJson(current).length * 2 > MAX_CHECKPOINT_BYTES
    )
      return null
    return {
      revision: current.revision,
      changed: this.checkpointContent(checkpoint.snapshot) !== this.checkpointContent(current),
    }
  }

  checkpointTarget(handle: DocumentHistoryCheckpoint, current: Snapshot) {
    return this.checkpointState(handle, current)?.changed
      ? (this.#checkpoints.get(handle)?.snapshot ?? null)
      : null
  }

  observe(before: Snapshot, after: Snapshot, actors: readonly CommandActor[]) {
    for (const checkpoint of this.#checkpoints.values()) {
      if (!checkpoint.valid) continue
      if (checkpoint.sealed || checkpoint.revision !== before.revision || !actors.length) {
        checkpoint.valid = false
        continue
      }
      for (const actor of actors) {
        if (!accepts(checkpoint, actor)) {
          checkpoint.valid = false
          break
        }
        checkpoint.actor ??= commandActorSchema.parse(actor)
      }
      checkpoint.revision = after.revision
    }
  }

  acceptCheckpoint(handle: DocumentHistoryCheckpoint, current: Snapshot) {
    const target = this.checkpointTarget(handle, current)
    if (!target) return
    this.#undo = this.#undo.filter((entry) => entry.after <= target.revision)
    this.#redo = [
      {
        before: target.revision,
        after: current.revision,
      },
    ]
    this.#retain(target)
    this.#retain(current)
    this.#checkpoints.clear()
  }

  record(
    before: Snapshot | null,
    after: Snapshot,
    actors: readonly CommandActor[] = [],
    checkpointBase = before,
  ) {
    // Ordinary Undo can start after adoption; a turn still owns the entire saved publication.
    if (checkpointBase) this.observe(checkpointBase, after, actors)
    if (!before) return
    const { revision: _beforeRevision, updatedAt: _beforeTime, ...beforeContent } = before
    const { revision: _afterRevision, updatedAt: _afterTime, ...afterContent } = after
    if (canonicalJson(beforeContent) === canonicalJson(afterContent)) return
    this.#redo = []
    this.#undo.push({ before: before.revision, after: after.revision })
    this.#retain(before)
    this.#retain(after)
  }

  restore(state?: DocumentHistoryNavigationState) {
    this.clear()
    this.#undo = state?.undo.map((entry) => ({ ...entry })) ?? []
    this.#redo = state?.redo.map((entry) => ({ ...entry })) ?? []
  }

  #retain(snapshot: Snapshot) {
    const previous = this.#cache.get(snapshot.revision)
    if (previous) {
      this.#cache.delete(snapshot.revision)
      this.#cacheBytes -= previous.size
    }
    const size = canonicalJson(snapshot).length * 2
    if (size > MAX_CHECKPOINT_BYTES) return
    this.#cache.set(snapshot.revision, { snapshot, size })
    this.#cacheBytes += size
    while (this.#cacheBytes > MAX_CHECKPOINT_BYTES) {
      const oldest = this.#cache.entries().next().value
      if (!oldest) break
      this.#cache.delete(oldest[0])
      this.#cacheBytes -= oldest[1].size
    }
  }

  async loadTarget(
    direction: "undo" | "redo",
    targetRevision: number | undefined,
    load: (revision: number) => Promise<Snapshot | null>,
  ) {
    const revision = this.#targetRevision(direction, targetRevision)
    if (revision === undefined) return null
    const cached = this.#cache.get(revision)
    if (cached) {
      this.#cache.delete(revision)
      this.#cache.set(revision, cached)
      return cached.snapshot
    }
    const snapshot = await load(revision)
    if (
      !snapshot ||
      snapshot.revision !== revision ||
      this.#targetRevision(direction, targetRevision) !== revision
    )
      return null
    this.#retain(snapshot)
    return snapshot
  }

  #targetRevision(direction: "undo" | "redo", targetRevision?: number) {
    const source = direction === "undo" ? this.#undo : this.#redo
    const entry = source[this.#targetIndex(direction, targetRevision)]
    return entry ? (direction === "undo" ? entry.before : entry.after) : undefined
  }

  #targetIndex(direction: "undo" | "redo", targetRevision?: number) {
    const source = direction === "undo" ? this.#undo : this.#redo
    if (targetRevision === undefined) return source.length - 1
    for (let index = source.length - 1; index >= 0; index -= 1) {
      const entry = source[index]
      if (entry && (direction === "undo" ? entry.before : entry.after) === targetRevision)
        return index
    }
    return -1
  }

  target(direction: "undo" | "redo", targetRevision?: number) {
    const revision = this.#targetRevision(direction, targetRevision)
    return revision === undefined ? null : (this.#cache.get(revision)?.snapshot ?? null)
  }

  accept(direction: "undo" | "redo", targetRevision?: number) {
    const source = direction === "undo" ? this.#undo : this.#redo
    const destination = direction === "undo" ? this.#redo : this.#undo
    const index = this.#targetIndex(direction, targetRevision)
    if (index < 0) return
    // Move the crossed entries only after one successful target publication.
    for (const entry of source.splice(index).reverse()) destination.push(entry)
  }
}
