import { canonicalJson, type DocumentSnapshotV1 } from "@vibeshape/domain"

type HistoryEntry = Readonly<{
  before: DocumentSnapshotV1
  after: DocumentSnapshotV1
  size: number
}>

// Bound retained semantic checkpoints independently of the durable event journal.
const MAX_ENTRIES = 100
const MAX_CHECKPOINT_BYTES = 32 * 1024 * 1024

export class DocumentUndoHistory {
  #undo: HistoryEntry[] = []
  #redo: HistoryEntry[] = []

  get availability() {
    return { canUndo: this.#undo.length > 0, canRedo: this.#redo.length > 0 }
  }

  clear() {
    this.#undo = []
    this.#redo = []
  }

  record(before: DocumentSnapshotV1 | null, after: DocumentSnapshotV1) {
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
