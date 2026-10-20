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

type HistoryEntry<Snapshot> = Readonly<{
  before: Snapshot
  after: Snapshot
  size: number
}>

// Bound retained semantic checkpoints independently of the durable event journal.
const MAX_ENTRIES = 100
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
  #undo: HistoryEntry<Snapshot>[] = []
  #redo: HistoryEntry<Snapshot>[] = []
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
    const size = canonicalJson(after).length * 2
    for (const checkpoint of this.#checkpoints.values()) {
      if (!checkpoint.valid || checkpoint.sealed || checkpoint.revision !== before.revision)
        continue
      if (
        actors.every((actor) => accepts(checkpoint, actor)) &&
        checkpoint.size + size > MAX_CHECKPOINT_BYTES
      )
        return false
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
    this.#undo = this.#undo.filter((entry) => entry.after.revision <= target.revision)
    this.#redo = [
      {
        before: target,
        after: current,
        size: (canonicalJson(target).length + canonicalJson(current).length) * 2,
      },
    ]
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
    const size = (canonicalJson(before).length + canonicalJson(after).length) * 2
    this.#undo.push({ before, after, size })
    let total = this.#undo.reduce((sum, entry) => sum + entry.size, 0)
    while (this.#undo.length > MAX_ENTRIES || total > MAX_CHECKPOINT_BYTES) {
      const removed = this.#undo.shift()
      if (removed) total -= removed.size
    }
  }

  target(direction: "undo" | "redo") {
    const entry = (direction === "undo" ? this.#undo : this.#redo).at(-1)
    return entry ? (direction === "undo" ? entry.before : entry.after) : null
  }

  accept(direction: "undo" | "redo") {
    const source = direction === "undo" ? this.#undo : this.#redo
    const destination = direction === "undo" ? this.#redo : this.#undo
    const entry = source.pop()
    if (entry) destination.push(entry)
  }
}
