import type { DocumentHistoryCheckpoint } from "@vibeshape/application/persistent-document-session"
import type { AssistantCheckpointPresentation } from "./assistant-checkpoint-presentation"

type Payload = Readonly<{
  snapshot: string
  authority: string
  rebuild: AssistantCheckpointPresentation["rebuild"]
}>
type Baseline<Owner> = Payload & Readonly<{ session: Owner }>

function primitiveBytes(value: unknown) {
  if (typeof value === "string") return 32 + value.length * 2
  if (typeof value === "number") return 8
  return typeof value === "boolean" ? 4 : 0
}

/** Conservative retention charge, not a portable measurement of JavaScript engine heap layout. */
export function measureCheckpointBaseline(payload: Payload, limit = Number.POSITIVE_INFINITY) {
  const objects = new WeakSet<object>()
  const buffers = new Set<ArrayBufferLike>()
  let bufferBytes = 0
  let heapBytes = 256 // Cache entry, references and accounting.
  const withinLimit = () => bufferBytes + heapBytes <= limit
  function buffer(value: ArrayBufferLike) {
    if (buffers.has(value)) return true
    buffers.add(value)
    bufferBytes += value.byteLength
    heapBytes += 64
    return withinLimit()
  }
  function array(value: unknown[]) {
    heapBytes += value.length * 8
    if (!withinLimit()) return false
    for (const item of value) if (!visit(item)) return false
    return true
  }
  function properties(value: object) {
    for (const key in value) {
      if (!Object.hasOwn(value, key)) continue
      heapBytes += 32 + key.length * 2
      if (!withinLimit() || !visit(Reflect.get(value, key))) return false
    }
    return true
  }
  function object(value: object) {
    if (ArrayBuffer.isView(value)) return buffer(value.buffer)
    if (value instanceof ArrayBuffer) return buffer(value)
    return Array.isArray(value) ? array(value) : properties(value)
  }
  function visit(value: unknown): boolean {
    if (value === null || typeof value !== "object") {
      heapBytes += primitiveBytes(value)
      return withinLimit()
    }
    if (objects.has(value)) return true
    objects.add(value)
    heapBytes += 64
    return withinLimit() && object(value)
  }
  const complete = visit(payload)
  return { bufferBytes, heapBytes, totalBytes: bufferBytes + heapBytes, complete }
}

/** Bounds only this optimization; eviction never releases or invalidates semantic checkpoints. */
export class AssistantCheckpointBaselines<Owner extends object> {
  readonly #entries = new Map<
    DocumentHistoryCheckpoint,
    { value: Baseline<Owner>; bytes: number }
  >()
  #bytes = 0

  constructor(
    private readonly budgetBytes = 64 * 1024 * 1024,
    private readonly isPinned: (handle: DocumentHistoryCheckpoint) => boolean = () => false,
  ) {}

  get retainedBytes() {
    return this.#bytes
  }

  get size() {
    return this.#entries.size
  }

  get(handle: DocumentHistoryCheckpoint) {
    return this.#entries.get(handle)?.value
  }

  set(handle: DocumentHistoryCheckpoint, value: Baseline<Owner>) {
    const charge = measureCheckpointBaseline(
      { snapshot: value.snapshot, authority: value.authority, rebuild: value.rebuild },
      this.budgetBytes,
    )
    if (!charge.complete || this.isPinned(handle)) return false
    const evictions = this.evictions(handle, charge.totalBytes)
    if (!evictions) return false
    // Free old owned buffers before allocating a new copy.
    for (const oldest of evictions) this.delete(oldest)
    const owned = { ...value, rebuild: structuredClone(value.rebuild) }
    this.#entries.set(handle, { value: owned, bytes: charge.totalBytes })
    this.#bytes += charge.totalBytes
    return true
  }

  private evictions(handle: DocumentHistoryCheckpoint, bytes: number) {
    const evictions: DocumentHistoryCheckpoint[] = [handle]
    let remaining = this.#bytes - (this.#entries.get(handle)?.bytes ?? 0)
    for (const [oldest, entry] of this.#entries) {
      if (remaining + bytes <= this.budgetBytes) break
      if (oldest === handle || this.isPinned(oldest)) continue
      evictions.push(oldest)
      remaining -= entry.bytes
    }
    return remaining + bytes <= this.budgetBytes ? evictions : null
  }

  delete(handle: DocumentHistoryCheckpoint) {
    const entry = this.#entries.get(handle)
    if (!entry) return
    this.#entries.delete(handle)
    this.#bytes -= entry.bytes
  }

  pruneOwner(owner: Owner | null) {
    for (const [handle, entry] of this.#entries)
      if (entry.value.session !== owner) this.delete(handle)
  }

  clear() {
    this.#entries.clear()
    this.#bytes = 0
  }
}
