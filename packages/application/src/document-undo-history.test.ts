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
