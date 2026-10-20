import type {
  DocumentHistoryCheckpoint,
  DocumentHistoryCheckpointState,
} from "@vibeshape/application/persistent-document-session"
import { type CommandActor, commandActorsEqual } from "@vibeshape/domain/commands"

type CheckpointPort = Readonly<{
  isSettled: () => boolean
  settleAccepted: () => Promise<number | null>
  capture: (acceptsActor: (actor: CommandActor) => boolean) => DocumentHistoryCheckpoint | null
  read: (handle: DocumentHistoryCheckpoint) => DocumentHistoryCheckpointState | null
  seal: (handle: DocumentHistoryCheckpoint, revision: number) => boolean
  release: (handle: DocumentHistoryCheckpoint) => void
  restore: (handle: DocumentHistoryCheckpoint, revision: number) => Promise<boolean>
  viewBefore: (handle: DocumentHistoryCheckpoint, revision: number) => Promise<boolean>
  isViewingBefore: (handle: DocumentHistoryCheckpoint) => boolean
  clearPreview: () => void
  subscribe?: (listener: () => void) => () => void
}>
export type AssistantCheckpointHost = Readonly<{
  open: () => CheckpointPort | null
  currentActor: () => CommandActor | null
  subscribeActor?: (listener: () => void) => () => void
}>
export type AssistantCheckpointState = Readonly<{
  canUndoAgentChanges: boolean
  undoingAgentChanges: boolean
  viewingBefore: boolean
  preparingBefore: boolean
  settlingCheckpoint: boolean
  checkpointError: "checkpointUnavailable" | "undoAgentChangesFailed" | "viewBeforeFailed" | null
}>
export function assistantCheckpointBusy(state: AssistantCheckpointState) {
  return state.undoingAgentChanges || state.preparingBefore || state.settlingCheckpoint
}

type Candidate = {
  id: symbol
  port: CheckpointPort
  handle: DocumentHistoryCheckpoint
  releaseActor?: (() => void) | undefined
  releaseUpdates?: (() => void) | undefined
  resultRevision?: number | undefined
  released?: boolean
}

/** Retains only the previous saved turn and the current/steering baseline candidates. */
export function createAssistantCheckpoints(
  host: AssistantCheckpointHost,
  publish: (state: AssistantCheckpointState) => void,
) {
  let completed: Candidate | null = null
  let active: Candidate | null = null
  let pending: Candidate | null = null
  let fallback: Candidate | null = null
  let undoing = false
  let preparingBefore = false
  let previewGeneration = 0
  let restoring: Candidate | null = null
  let generation = 0
  let boundaryCandidate: Candidate | null = null
  let boundary: Promise<void> | null = null
  let finishing: Promise<void> | null = null
  let error: AssistantCheckpointState["checkpointError"] = null
  const read = (candidate: Candidate | null) => candidate?.port.read(candidate.handle) ?? null
  const completedState = () => {
    const value = read(completed)
    return value?.changed && value.revision === completed?.resultRevision ? value : null
  }
  const notify = () =>
    publish({
      canUndoAgentChanges:
        !active && !pending && !boundary && !finishing && completedState() !== null,
      undoingAgentChanges: undoing,
      viewingBefore: completed?.port.isViewingBefore(completed.handle) ?? false,
      preparingBefore,
      settlingCheckpoint: boundary !== null || finishing !== null,
      checkpointError: error,
    })
  function clearPreview() {
    previewGeneration += 1
    preparingBefore = false
    for (const port of new Set(
      [active, pending, fallback, completed, boundaryCandidate].flatMap((candidate) =>
        candidate ? [candidate.port] : [],
      ),
    ))
      port.clearPreview()
    notify()
  }
  function release(candidate: Candidate | null) {
    if (!candidate || candidate.released) return
    if (candidate === restoring) return
    candidate.released = true
    candidate.releaseActor?.()
    candidate.releaseUpdates?.()
    candidate.port.release(candidate.handle)
  }
  function capture(turnId: string): Candidate | null {
    const port = host.open()
    if (!port?.isSettled()) return null
    const actor = { current: host.currentActor() }
    const handle = port.capture(
      (value) => actor.current !== null && commandActorsEqual(actor.current, value),
    )
    if (!handle) return null
    const fresh = port.read(handle)
    if (!fresh || fresh.changed) {
      port.release(handle)
      return null
    }
    const candidate: Candidate = { id: Symbol(turnId), port, handle }
    candidate.releaseActor = host.subscribeActor?.(() => {
      actor.current ??= host.currentActor()
    })
    candidate.releaseUpdates = port.subscribe?.(notify)
    return candidate
  }
  function lifecycleBusy() {
    return Boolean(undoing || pending || boundary || finishing)
  }
  function actionableCompleted() {
    if (lifecycleBusy() || active || preparingBefore) return null
    return completed
  }
  function begin(turnId: string, kind: "prompt" | "steer" = "prompt") {
    if (lifecycleBusy() || (kind === "prompt" && active)) return null
    clearPreview()
    let candidate: Candidate | null = null
    try {
      candidate = capture(turnId)
    } catch {
      /* The owning saved session is unavailable. */
    }
    if (!candidate) {
      error = "checkpointUnavailable"
      notify()
      return null
    }
    if (kind === "steer") pending = candidate
    else active = candidate
    error = null
    notify()
    return candidate.id
  }
  function acceptSteer(id: symbol) {
    if (pending?.id !== id) return
    const previous = active
    active = pending
    pending = null
    if (!previous) return notify()
    const at = generation
    const settlePrevious = (revision: number | null) => {
      if (at !== generation) return
      const sealed = sealCandidate(previous, revision)
      if (sealed) {
        release(fallback)
        fallback = sealed
      } else release(previous)
    }
    if (previous.port.isSettled()) settlePrevious(read(previous)?.revision ?? null)
    else {
      boundaryCandidate = previous
      boundary = previous.port
        .settleAccepted()
        .then(settlePrevious, () => release(previous))
        .finally(() => {
          if (at !== generation) return
          boundaryCandidate = null
          boundary = null
          notify()
        })
    }
    notify()
  }
  function discardSteer(id: symbol) {
    if (pending?.id !== id) return
    release(pending)
    pending = null
    notify()
  }
  function sealCandidate(candidate: Candidate | null, revision: number | null) {
    if (!candidate || revision === null) return null
    const value = read(candidate)
    if (
      !value?.changed ||
      value.revision !== revision ||
      !candidate.port.seal(candidate.handle, revision)
    )
      return null
    candidate.resultRevision = revision
    candidate.releaseActor?.()
    candidate.releaseActor = undefined
    return candidate
  }
  function finalize(revision: number | null) {
    const candidate =
      [active, fallback, completed].find((value) => {
        if (value === completed && !completedState()) return false
        const saved = read(value)
        return saved?.changed && saved.revision === revision
      }) ?? null
    const chosen = sealCandidate(candidate, revision)
    for (const candidate of [active, fallback, completed])
      if (candidate !== chosen) release(candidate)
    active = null
    fallback = null
    completed = chosen
    notify()
  }
  function finish(): Promise<void> {
    if (finishing) return finishing
    if (pending || undoing) return Promise.resolve()
    const candidate = [active, fallback, completed].find((value) => value !== null)
    if (!candidate) return Promise.resolve()
    if (!boundary && candidate.port.isSettled()) {
      finalize(read(candidate)?.revision ?? null)
      return Promise.resolve()
    }
    const at = generation
    // Capture this queue position now; later writes cannot extend the turn's boundary.
    const accepted = candidate.port.settleAccepted()
    finishing = Promise.all([accepted, boundary])
      .then(
        ([revision]) => {
          if (at === generation) finalize(revision)
        },
        () => {
          if (at !== generation) return
          release(active)
          release(fallback)
          active = fallback = null
          error = "checkpointUnavailable"
        },
      )
      .finally(() => {
        if (at !== generation) return
        finishing = null
        notify()
      })
    notify()
    return finishing
  }
  async function undo() {
    const candidate = actionableCompleted()
    if (!candidate) return false
    const value = completedState()
    if (!value) {
      error = "undoAgentChangesFailed"
      notify()
      return false
    }
    undoing = true
    clearPreview()
    restoring = candidate
    error = null
    notify()
    try {
      const restored = await candidate.port.restore(candidate.handle, value.revision)
      if (restored && completed === candidate) {
        release(completed)
        completed = null
      }
      if (!restored) error = "undoAgentChangesFailed"
      return restored
    } catch {
      error = "undoAgentChangesFailed"
      return false
    } finally {
      undoing = false
      restoring = null
      if (completed !== candidate) release(candidate)
      notify()
    }
  }
  function clear() {
    generation += 1
    clearPreview()
    for (const candidate of [active, pending, fallback, completed, boundaryCandidate])
      release(candidate)
    active = pending = fallback = completed = null
    boundaryCandidate = null
    boundary = finishing = null
    error = null
    notify()
  }
  function receivePreview(candidate: Candidate, at: number, shown: boolean) {
    const current = at === previewGeneration
    if (!current && shown && candidate.port.isViewingBefore(candidate.handle))
      candidate.port.clearPreview()
    if (current && !shown) error = "viewBeforeFailed"
    return shown && current
  }
  async function viewBefore() {
    const candidate = actionableCompleted()
    if (!candidate) return false
    const value = completedState()
    if (!value) return false
    if (candidate.port.isViewingBefore(candidate.handle)) {
      clearPreview()
      return true
    }
    const at = ++previewGeneration
    preparingBefore = true
    error = null
    notify()
    try {
      const shown = await candidate.port.viewBefore(candidate.handle, value.revision)
      return receivePreview(candidate, at, shown)
    } catch {
      if (at === previewGeneration) error = "viewBeforeFailed"
      return false
    } finally {
      if (at === previewGeneration) preparingBefore = false
      notify()
    }
  }
  return { begin, acceptSteer, discardSteer, finish, undo, clear, viewBefore, clearPreview }
}
