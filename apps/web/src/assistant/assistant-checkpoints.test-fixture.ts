import type { DocumentHistoryCheckpoint } from "@vibeshape/application/persistent-document-session"
import type { CommandActor } from "@vibeshape/domain/commands"
import { sessionIdSchema } from "@vibeshape/domain/identifiers"
import type { AssistantCheckpointHost } from "./assistant-checkpoints"

export const checkpointActor = {
  type: "mcp",
  clientId: "org.vibeshape.test-assistant",
  sessionId: sessionIdSchema.parse("0195b5ac-b250-7a2c-8c33-000000000090"),
} as const

export function checkpointFixture() {
  let revision = 1,
    currentActor: CommandActor | null = checkpointActor
  let before: DocumentHistoryCheckpoint | null = null
  const listeners = new Set<() => void>(),
    actors = new Set<() => void>()
  const states = new Map<
    DocumentHistoryCheckpoint,
    { baseline: number; valid: boolean; sealed: boolean; accepts: (actor: CommandActor) => boolean }
  >()
  const restores: { baseline: number; revision: number }[] = []
  const previews: number[] = []
  const emit = () => {
    for (const listener of listeners) listener()
  }
  let restoreGate: Promise<boolean> | null = null,
    previewGate: Promise<boolean> | null = null
  let accepted: Promise<void> = Promise.resolve(),
    pendingSaves = 0
  function save(actor: CommandActor = checkpointActor) {
    revision += 1
    for (const value of states.values()) value.valid &&= !value.sealed && value.accepts(actor)
    before = null
    emit()
  }
  const port = {
    isSettled: () => pendingSaves === 0,
    settleAccepted() {
      return accepted.then(() => revision)
    },
    seal(handle: DocumentHistoryCheckpoint, expected: number) {
      const value = states.get(handle)
      if (!value?.valid || expected !== revision) return false
      value.sealed = true
      return true
    },
    capture(accepts: (actor: CommandActor) => boolean) {
      if (pendingSaves) return null
      const handle = { id: Symbol("test-checkpoint") }
      states.set(handle, { baseline: revision, valid: true, sealed: false, accepts })
      return handle
    },
    read(handle: DocumentHistoryCheckpoint) {
      const value = states.get(handle)
      return value?.valid ? { revision, changed: value.baseline !== revision } : null
    },
    release(handle: DocumentHistoryCheckpoint) {
      states.delete(handle)
    },
    async restore(handle: DocumentHistoryCheckpoint, expected: number) {
      const value = states.get(handle)
      if (!value?.valid || expected !== revision) return false
      restores.push({ baseline: value.baseline, revision: expected })
      const saved = restoreGate ? await restoreGate : true
      if (saved) {
        revision += 1
        before = null
        emit()
      }
      return saved
    },
    async viewBefore(handle: DocumentHistoryCheckpoint, expected: number) {
      const value = states.get(handle)
      if (!value?.valid || expected !== revision) return false
      previews.push(expected)
      const shown = previewGate ? await previewGate : true
      if (shown) {
        before = handle
        emit()
      }
      return shown
    },
    clearPreview() {
      before = null
      emit()
    },
    isViewingBefore: (handle: DocumentHistoryCheckpoint) => before === handle,
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
  const host: AssistantCheckpointHost = {
    open: () => port,
    currentActor: () => currentActor,
    subscribeActor(listener) {
      actors.add(listener)
      return () => {
        actors.delete(listener)
      }
    },
  }
  return {
    host,
    restores,
    previews,
    revision: () => revision,
    retained: () => states.size,
    pair(actor: CommandActor | null) {
      currentActor = actor
      for (const listener of actors) listener()
    },
    save,
    deferSave(actor: CommandActor = checkpointActor) {
      let resolve!: () => void
      const gate = new Promise<void>((done) => {
        resolve = done
      })
      pendingSaves += 1
      accepted = accepted.then(async () => {
        await gate
        save(actor)
        pendingSaves -= 1
      })
      return resolve
    },
    deferRestore() {
      let resolve!: (saved: boolean) => void
      restoreGate = new Promise((done) => {
        resolve = done
      })
      return resolve
    },
    deferPreview() {
      let resolve!: (shown: boolean) => void
      previewGate = new Promise((done) => {
        resolve = done
      })
      return resolve
    },
  }
}
