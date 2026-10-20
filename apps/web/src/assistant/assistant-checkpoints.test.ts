import { expect, it } from "bun:test"
import { sessionIdSchema } from "@vibeshape/domain/identifiers"
import { type AssistantCheckpointState, createAssistantCheckpoints } from "./assistant-checkpoints"
import { checkpointActor, checkpointFixture } from "./assistant-checkpoints.test-fixture"

function fixture() {
  const f = checkpointFixture()
  let state: AssistantCheckpointState | null = null
  const checkpoints = createAssistantCheckpoints(f.host, (value) => {
    state = value
  })
  return { ...f, checkpoints, state: () => state }
}

it("checkpoints a user-applied draft, locks repeated activation through persistence, and restores its baseline", async () => {
  const f = fixture()
  let release = () => {}
  const saving = new Promise<void>((resolve) => {
    release = resolve
  })
  let calls = 0
  const operation = async () => {
    calls += 1
    await saving
    f.save()
    return true
  }
  const applied = f.checkpoints.applyDraft(operation)
  expect(f.state()).toMatchObject({ settlingCheckpoint: true, canUndoAgentChanges: false })
  expect(await f.checkpoints.applyDraft(operation)).toBe(false)
  expect(f.checkpoints.begin("new prompt")).toBeNull()
  expect(await f.checkpoints.undo()).toBe(false)
  expect(await f.checkpoints.viewBefore()).toBe(false)
  expect(calls).toBe(1)
  release()
  expect(await applied).toBe(true)
  expect(f.state()).toMatchObject({ settlingCheckpoint: false, canUndoAgentChanges: true })
  expect(await f.checkpoints.viewBefore()).toBe(true)
  expect(await f.checkpoints.undo()).toBe(true)
  expect(f.restores).toEqual([{ baseline: 1, revision: 2 }])
})

it("releases the Apply lock on rejection and retains the previous saved checkpoint", async () => {
  const f = fixture()
  f.checkpoints.begin("previous turn")
  f.save()
  await f.checkpoints.finish()
  await expect(
    f.checkpoints.applyDraft(async () => {
      throw new Error("Rejected")
    }),
  ).rejects.toThrow("Rejected")
  expect(f.state()).toMatchObject({ settlingCheckpoint: false, canUndoAgentChanges: true })
  expect(await f.checkpoints.applyDraft(async () => false)).toBe(false)
  expect(await f.checkpoints.undo()).toBe(true)
  expect(f.restores).toEqual([{ baseline: 1, revision: 2 }])
})

it("binds the verified lazy grant before saving and retains stopped-turn changes for one locked restore", async () => {
  const f = fixture()
  f.pair(null)
  expect(f.checkpoints.begin("turn-a")).not.toBeNull()
  f.pair(checkpointActor)
  f.save()
  f.pair(null)
  f.save()
  f.checkpoints.finish()
  expect(f.state()).toMatchObject({ canUndoAgentChanges: true })
  const finish = f.deferRestore(),
    pending = f.checkpoints.undo()
  expect(f.state()).toMatchObject({ undoingAgentChanges: true })
  expect(await f.checkpoints.undo()).toBe(false)
  expect(f.checkpoints.begin("must-wait")).toBeNull()
  finish(true)
  expect(await pending).toBe(true)
  expect(f.restores).toEqual([{ baseline: 1, revision: 3 }])
  expect(f.state()).toMatchObject({ canUndoAgentChanges: false, undoingAgentChanges: false })
  expect(f.retained()).toBe(0)
})

it("keeps the previous saved turn through a no-change turn and replaces it only after new saved changes", async () => {
  const f = fixture()
  f.checkpoints.begin("first")
  f.save()
  f.checkpoints.finish()
  f.checkpoints.begin("read-only")
  f.checkpoints.finish()
  expect(f.state()).toMatchObject({ canUndoAgentChanges: true })
  expect(f.retained()).toBe(1)
  f.checkpoints.begin("next")
  f.save()
  f.checkpoints.finish()
  expect(f.retained()).toBe(1)
  expect(await f.checkpoints.undo()).toBe(true)
  expect(f.restores).toEqual([{ baseline: 2, revision: 3 }])
})

it("retains the original baseline on failed steering and chooses the accepted steering baseline when it saves", async () => {
  const f = fixture()
  f.checkpoints.begin("original")
  f.save()
  const failed = f.checkpoints.begin("failed-steer", "steer")
  if (!failed) throw new Error("Missing steer candidate")
  f.checkpoints.discardSteer(failed)
  const accepted = f.checkpoints.begin("accepted-steer", "steer")
  if (!accepted) throw new Error("Missing steer candidate")
  f.checkpoints.acceptSteer(accepted)
  f.save()
  f.checkpoints.finish()
  expect(f.retained()).toBe(1)
  expect(await f.checkpoints.undo()).toBe(true)
  expect(f.restores).toEqual([{ baseline: 2, revision: 3 }])
})

it("rejects a checkpoint after an intervening human or rotated grant writes", async () => {
  for (const actor of [
    { type: "user", userId: null } as const,
    {
      ...checkpointActor,
      sessionId: sessionIdSchema.parse("0195b5ac-b250-7a2c-8c33-000000000091"),
    },
  ]) {
    const f = fixture()
    f.checkpoints.begin("turn")
    f.save()
    f.checkpoints.finish()
    f.save(actor)
    expect(f.state()).toMatchObject({ canUndoAgentChanges: false })
    expect(await f.checkpoints.undo()).toBe(false)
    expect(f.restores).toEqual([])
  }
})

it("previews the exact saved-turn pair without restoring, and Stop clears only the comparison", async () => {
  const f = fixture()
  f.checkpoints.begin("turn")
  f.save()
  f.checkpoints.finish()
  expect(await f.checkpoints.viewBefore()).toBe(true)
  expect(f.state()).toMatchObject({ viewingBefore: true, canUndoAgentChanges: true })
  expect(f.previews).toEqual([2])
  expect(f.restores).toEqual([])
  expect(f.revision()).toBe(2)
  f.checkpoints.clearPreview()
  expect(f.state()).toMatchObject({ viewingBefore: false, canUndoAgentChanges: true })
})

it("ignores a canceled before-view result when a new prompt starts", async () => {
  const f = fixture()
  f.checkpoints.begin("turn")
  f.save()
  f.checkpoints.finish()
  const resolve = f.deferPreview(),
    preview = f.checkpoints.viewBefore()
  expect(f.state()).toMatchObject({ preparingBefore: true })
  f.checkpoints.begin("new-turn")
  resolve(true)
  expect(await preview).toBe(false)
  expect(f.state()).toMatchObject({ preparingBefore: false, checkpointError: null })
  f.checkpoints.finish()
})

it("allows an already published restore to settle when the owning chat is cleared", async () => {
  const f = fixture()
  f.checkpoints.begin("turn")
  f.save()
  f.checkpoints.finish()
  const resolve = f.deferRestore(),
    restore = f.checkpoints.undo()
  f.checkpoints.clear()
  expect(f.retained()).toBe(1)
  resolve(true)
  expect(await restore).toBe(true)
  expect(f.restores).toHaveLength(1)
  expect(f.retained()).toBe(0)
})

it.each([false, true])(
  "retains the baseline while an accepted %s save settles after the turn and Stop",
  async (priorSave) => {
    const f = fixture()
    f.checkpoints.begin("stopped")
    if (priorSave) f.save()
    const save = f.deferSave()
    f.pair(null)
    const finished = f.checkpoints.finish()
    expect(f.state()).toMatchObject({ settlingCheckpoint: true, canUndoAgentChanges: false })
    expect(f.checkpoints.begin("next")).toBeNull()
    expect(f.checkpoints.begin("steer", "steer")).toBeNull()
    expect(await f.checkpoints.undo()).toBe(false)
    expect(f.retained()).toBe(1)
    save()
    await finished
    expect(f.state()).toMatchObject({ settlingCheckpoint: false, canUndoAgentChanges: true })
    expect(await f.checkpoints.undo()).toBe(true)
    expect(f.restores).toEqual([{ baseline: 1, revision: priorSave ? 3 : 2 }])
  },
)

it("does not adopt foreign writes or a cleared generation when an accepted boundary resolves", async () => {
  for (const clear of [false, true]) {
    const f = fixture()
    f.checkpoints.begin("old")
    const save = f.deferSave({ type: "user", userId: null })
    const finished = f.checkpoints.finish()
    if (clear) f.checkpoints.clear()
    save()
    await finished
    expect(f.state()).toMatchObject({ settlingCheckpoint: false, canUndoAgentChanges: false })
    expect(f.retained()).toBe(0)
    expect(await f.checkpoints.undo()).toBe(false)
  }
})

it("settles the old accepted work before sealing a steering fallback", async () => {
  const f = fixture()
  f.checkpoints.begin("original")
  const steer = f.checkpoints.begin("steer", "steer")
  if (!steer) throw new Error("Missing steer candidate")
  const save = f.deferSave()
  f.checkpoints.acceptSteer(steer)
  expect(f.state()).toMatchObject({ settlingCheckpoint: true })
  const finished = f.checkpoints.finish()
  save()
  await finished
  expect(await f.checkpoints.undo()).toBe(true)
  expect(f.restores).toEqual([{ baseline: 1, revision: 2 }])
})

it("rejects an unreadable fresh capture before a prompt is dispatched", () => {
  const f = checkpointFixture(),
    port = f.host.open()
  if (!port) throw new Error("Missing fixture port")
  const checkpoints = createAssistantCheckpoints(
    { ...f.host, open: () => ({ ...port, read: () => null }) },
    () => {},
  )
  expect(checkpoints.begin("unreadable")).toBeNull()
  expect(f.retained()).toBe(0)
})

it("releases a failed settlement without dropping the previous completed target", async () => {
  const f = checkpointFixture(),
    port = f.host.open()
  if (!port) throw new Error("Missing fixture port")
  let fail = false,
    state: AssistantCheckpointState | null = null
  const checkpoints = createAssistantCheckpoints(
    {
      ...f.host,
      open: () => ({
        ...port,
        isSettled: () => !fail,
        settleAccepted: async () => {
          throw new Error("Closed owning session")
        },
      }),
    },
    (value) => {
      state = value
    },
  )
  checkpoints.begin("completed")
  f.save()
  await checkpoints.finish()
  checkpoints.begin("read-only")
  fail = true
  await checkpoints.finish()
  expect(state).toMatchObject({
    settlingCheckpoint: false,
    canUndoAgentChanges: true,
    checkpointError: "checkpointUnavailable",
  })
  expect(f.retained()).toBe(1)
  expect(await checkpoints.undo()).toBe(true)
  expect(f.restores).toEqual([{ baseline: 1, revision: 2 }])
})
