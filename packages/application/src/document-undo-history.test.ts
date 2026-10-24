import { expect, it } from "bun:test"
import { canonicalJson } from "@vibeshape/domain"
import { sessionIdSchema } from "@vibeshape/domain/identifiers"
import { DocumentUndoHistory } from "./document-undo-history"

const limit = 32 * 1024 * 1024
const actor = {
  type: "mcp",
  clientId: "org.vibeshape.assistant",
  sessionId: sessionIdSchema.parse("0195b5ac-b250-7a2c-8c33-000000000090"),
} as const
const human = { type: "user", userId: null } as const
const rotated = {
  ...actor,
  sessionId: sessionIdSchema.parse("0195b5ac-b250-7a2c-8c33-000000000091"),
}
function snapshot(length: number, revision = 1, character = "a") {
  const base = { revision, updatedAt: "2026-10-20T00:00:00Z", payload: "" }
  return { ...base, payload: character.repeat(length - canonicalJson(base).length) }
}
type Snapshot = ReturnType<typeof snapshot>

it.each(["absent", "foreign", "sealed", "stale", "invalid"] as const)(
  "does not traverse proposed snapshots when the checkpoint is %s",
  (mode) => {
    const history = new DocumentUndoHistory<Snapshot>()
    const before = snapshot(100)
    if (mode !== "absent") {
      const handle = history.captureCheckpoint(before, (candidate) => candidate.type === "mcp")
      if (!handle) throw new Error("Missing checkpoint")
      if (mode === "sealed") history.sealCheckpoint(handle, before, before.revision)
      if (mode === "invalid") history.observe(before, before, [])
    }
    const publicationBase = mode === "stale" ? { ...before, revision: 2 } : before
    const after = {
      revision: publicationBase.revision + 1,
      updatedAt: before.updatedAt,
      get payload(): string {
        throw new Error("An unconstrained publication must not serialize its proposed snapshot.")
      },
    }
    expect(
      history.permitsPublication(publicationBase, after, [mode === "foreign" ? human : actor]),
    ).toBe(true)
  },
)

it("admits a readable baseline pair at the exact budget and rejects the next UTF-16 code unit", () => {
  const history = new DocumentUndoHistory<Snapshot>(),
    baseline = snapshot(limit / 4)
  const handle = history.captureCheckpoint(baseline, () => true)
  if (!handle) throw new Error("Exact-limit baseline was rejected")
  expect(history.checkpointState(handle, baseline)).toEqual({ revision: 1, changed: false })
  expect(history.captureCheckpoint(snapshot(limit / 4 + 1), () => true)).toBeNull()
  const saved = snapshot(limit / 4, 2, "b")
  expect(history.permitsPublication(baseline, saved, [actor])).toBe(true)
  history.observe(baseline, saved, [actor])
  expect(history.checkpointState(handle, saved)).toEqual({ revision: 2, changed: true })
  expect(history.permitsPublication(saved, snapshot(limit / 4 + 1, 3), [actor])).toBe(false)
  expect(history.checkpointState(handle, saved)).toEqual({ revision: 2, changed: true })
})

it("checks every active baseline but does not latch speculative actors or mutate saved rollback state", () => {
  const history = new DocumentUndoHistory<Snapshot>(),
    baseline = snapshot(100)
  const first = history.captureCheckpoint(baseline, () => true)
  if (!first) throw new Error("Missing checkpoint")
  const saved = snapshot(200, 2)
  expect(history.permitsPublication(baseline, saved, [rotated])).toBe(true)
  // A failed repository write never calls observe, so its speculative actor cannot own the handle.
  expect(history.checkpointState(first, baseline)).toEqual({ revision: 1, changed: false })
  history.observe(baseline, saved, [actor])
  const second = history.captureCheckpoint(saved, () => true)
  if (!first || !second) throw new Error("Missing active checkpoints")
  const next = snapshot(limit / 2 - 200, 3)
  expect(history.permitsPublication(saved, next, [actor])).toBe(true)
  expect(history.permitsPublication(saved, snapshot(limit / 2 - 199, 3), [actor])).toBe(false)
  expect(history.permitsPublication(saved, snapshot(limit / 2, 3), [rotated])).toBe(false)
  history.releaseCheckpoint(second)
  expect(history.permitsPublication(saved, snapshot(limit / 2, 3), [rotated])).toBe(true)
  expect(history.checkpointState(first, saved)).toEqual({ revision: 2, changed: true })
})

it("permits human, foreign and mixed-actor publications to invalidate rather than constrain an active baseline", () => {
  for (const actors of [[human], [rotated], [actor, human], []]) {
    const history = new DocumentUndoHistory<Snapshot>(),
      baseline = snapshot(100)
    const handle = history.captureCheckpoint(baseline, (value) => value.type === "mcp")
    if (!handle) throw new Error("Missing checkpoint")
    const saved = snapshot(200, 2)
    history.observe(baseline, saved, [actor])
    const next = snapshot(limit / 2, 3)
    expect(history.permitsPublication(saved, next, actors)).toBe(true)
    history.observe(saved, next, actors)
    expect(history.checkpointState(handle, next)).toBeNull()
  }
})

it("seals completed targets at their exact head and removes their growth constraint for the next turn", () => {
  const history = new DocumentUndoHistory<Snapshot>(),
    baseline = snapshot(limit / 4)
  const completed = history.captureCheckpoint(baseline, () => true)
  if (!completed) throw new Error("Missing first checkpoint")
  const saved = snapshot(100, 2)
  history.observe(baseline, saved, [actor])
  expect(history.sealCheckpoint(completed, saved, 1)).toBe(false)
  expect(history.sealCheckpoint(completed, saved, 2)).toBe(true)
  const active = history.captureCheckpoint(saved, () => true)
  if (!active) throw new Error("Missing next-turn checkpoint")
  const next = snapshot(limit / 2 - 100, 3)
  expect(history.permitsPublication(saved, next, [actor])).toBe(true)
  history.observe(saved, next, [actor])
  expect(history.checkpointState(completed, next)).toBeNull()
  expect(history.checkpointState(active, next)).toEqual({ revision: 3, changed: true })
})

it("rejects capture before evicting an existing active or completed rollback target", () => {
  const history = new DocumentUndoHistory<Snapshot>(),
    baseline = snapshot(100)
  const handles = Array.from({ length: 8 }, () => history.captureCheckpoint(baseline, () => true))
  expect(handles.every(Boolean)).toBe(true)
  expect(history.captureCheckpoint(baseline, () => true)).toBeNull()
  for (const handle of handles) {
    if (!handle) throw new Error("Missing retained checkpoint")
    expect(history.checkpointState(handle, baseline)).toEqual({ revision: 1, changed: false })
  }
})

it("evicts cached snapshots by bytes while retaining every navigation reference", async () => {
  const history = new DocumentUndoHistory<Snapshot>()
  let before = snapshot(limit / 16, 1)
  for (let revision = 2; revision <= 10; revision++) {
    const after = snapshot(limit / 16, revision, revision % 2 ? "a" : "b")
    history.record(before, after)
    before = after
  }
  expect(history.target("undo", 1) === null).toBe(true)
  expect(
    await history.loadTarget("undo", 1, async (revision) => snapshot(limit / 16, revision)),
  ).toMatchObject({ revision: 1 })
  history.accept("undo", 1)
  expect(history.availability).toEqual({ canUndo: false, canRedo: true })
  expect(history.target("redo", 10)?.revision).toBe(10)
})

it("retains steps larger than the cache and rejects stale async targets without moving references", async () => {
  const history = new DocumentUndoHistory<Snapshot>()
  history.restore({ schemaVersion: 1, undo: [{ before: 1, after: 2 }], redo: [] })
  let resolve!: (snapshot: Snapshot) => void
  const pending = history.loadTarget(
    "undo",
    undefined,
    () =>
      new Promise((done) => {
        resolve = done
      }),
  )
  history.clear()
  resolve(snapshot(100, 1))
  expect(await pending).toBeNull()
  history.record(snapshot(100, 1), snapshot(limit / 2 + 1, 2, "b"))
  expect(history.availability.canUndo).toBe(true)
  history.accept("undo")
  expect(history.availability.canRedo).toBe(true)
  expect(history.target("redo") === null).toBe(true)
  let loads = 0
  expect(
    (
      await history.loadTarget("redo", undefined, async (revision) => {
        loads++
        return snapshot(100, revision)
      })
    )?.revision,
  ).toBe(2)
  expect(loads).toBe(1)
})

it("moves very large durable ranges without spreading them into call arguments", () => {
  const history = new DocumentUndoHistory<Snapshot>()
  history.restore({
    schemaVersion: 1,
    undo: Array.from({ length: 150000 }, (_, index) => ({ before: index + 1, after: index + 2 })),
    redo: [],
  })
  history.accept("undo", 1)
  expect(history.availability).toEqual({ canUndo: false, canRedo: true })
  history.accept("redo", 150001)
  expect(history.availability).toEqual({ canUndo: true, canRedo: false })
})
