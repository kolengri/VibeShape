import type {
  AssemblyResult,
  AssemblyReviewInput,
} from "@vibeshape/automation-host/assembly-session-contract"
import type { HistoryReviewInput } from "@vibeshape/automation-host/history-session"
import type {
  AutomationHostDiagnosticCode,
  AutomationHostResult,
  DraftReviewInput,
} from "@vibeshape/automation-host/host"
import type { SurfaceTextureReviewInput } from "@vibeshape/automation-host/surface-texture-proposal-contract"
import type { AutomationDraftViewport } from "./automation-draft-viewport"
import type { ImportReviewInput } from "./import-upload-session"
import type { PlanarImportReviewInput } from "./planar-import-upload-session"

export type AutomationReviewInput =
  | DraftReviewInput
  | AssemblyReviewInput
  | HistoryReviewInput
  | ImportReviewInput
  | SurfaceTextureReviewInput
  | PlanarImportReviewInput
export function isImportReview(input: AutomationReviewInput): input is ImportReviewInput {
  return "kind" in input && input.kind === "import"
}
export function isPlanarImportReview(
  input: AutomationReviewInput,
): input is PlanarImportReviewInput {
  return "kind" in input && input.kind === "planar-import"
}
function expiresAt(input: AutomationReviewInput) {
  return "kind" in input ? input.draft.expiresAt : input.preview.draft.expiresAt
}
function hasReviewDeadline(input: AutomationReviewInput) {
  return "kind" in input || input.metadata !== undefined || input.historyMove !== undefined
}

type Decision = "approved" | "rejected" | "cancelled"

export type AutomationReviewState = Readonly<{
  id: string
  input: AutomationReviewInput
  status: "ready" | "applying" | "error"
  diagnostic: string | null
  draftViewport?: AutomationDraftViewport | null
}>

type AutomationDraftApplicationState = Readonly<{
  viewport: AutomationDraftViewport
  status: "ready" | "applying" | "error"
  diagnostic: AutomationHostDiagnosticCode | null
}>

type PendingReview = {
  owner: symbol
  id: string
  resolve: (decision: Decision) => void
  finish: () => void
  completed: Promise<void>
  timer: ReturnType<typeof setTimeout> | null
  decided: boolean
}

type DraftViewportIdentity = AutomationDraftViewport["preview"]["assistantDraft"]

function sameDraftViewportSource(left: DraftViewportIdentity, right: DraftViewportIdentity) {
  return (
    left.draftId === right.draftId &&
    left.documentId === right.documentId &&
    left.baseRevision === right.baseRevision
  )
}

function withDraftViewportDisplay(
  viewport: AutomationDraftViewport,
  display: AutomationDraftViewport["preview"]["display"],
): AutomationDraftViewport {
  return viewport.preview.display === display
    ? viewport
    : { ...viewport, preview: { ...viewport.preview, display } }
}

function retainDraftViewportDisplay(
  viewport: AutomationDraftViewport,
  previous: AutomationDraftViewport | null,
) {
  return withDraftViewportDisplay(
    viewport,
    previous && sameDraftViewportSource(previous.draft, viewport.draft)
      ? previous.preview.display
      : "result",
  )
}

function reviewDraftViewport(state: AutomationReviewState | null) {
  if (!state || state.status === "error") return null
  const { input, draftViewport } = state
  if ("kind" in input) return null
  if (hasReviewDeadline(input) || !draftViewport) return null
  const { draft, geometry } = input.preview
  if (!sameDraftViewportSource(draft, draftViewport.draft)) return null
  if (draft.revision !== draftViewport.draft.revision) return null
  if (geometry.measurements.generation !== draftViewport.generation) return null
  return draftViewport
}

// One visible review owns the editor's confirmation surface at a time.
export function createAutomationReviewController() {
  let state: AutomationReviewState | null = null
  let pending: PendingReview | null = null
  let draftPresentation: { owner: symbol; viewport: AutomationDraftViewport } | null = null
  let draftApplication: {
    owner: symbol
    state: AutomationDraftApplicationState
    apply: () => Promise<AutomationHostResult<unknown>>
  } | null = null
  const listeners = new Set<() => void>()

  function notify() {
    for (const listener of listeners) listener()
  }

  function publish(next: AutomationReviewState | null) {
    state = next
    notify()
  }

  function settle(record: PendingReview, decision: Decision) {
    if (record.decided) return
    record.decided = true
    if (record.timer !== null) clearTimeout(record.timer)
    record.timer = null
    record.resolve(decision)
  }

  function cancel(
    owner: symbol,
    diagnostic: AutomationHostDiagnosticCode = "draft-review-cancelled",
  ) {
    if (!pending || pending.owner !== owner) return
    settle(pending, "cancelled")
    pending.finish()
    if (state) publish({ ...state, status: "error", diagnostic, draftViewport: null })
    pending = null
  }

  function request(
    owner: symbol,
    input: AutomationReviewInput,
    draftViewport: AutomationDraftViewport | null = null,
  ): Promise<Decision> {
    if (pending) return Promise.resolve("cancelled")
    const previous = draftPresentation?.owner === owner ? draftPresentation.viewport : null
    draftPresentation = null
    if (draftApplication?.state.status !== "applying") draftApplication = null
    const expiresIn = hasReviewDeadline(input) ? Date.parse(expiresAt(input)) - Date.now() : null
    if (expiresIn !== null && (!Number.isFinite(expiresIn) || expiresIn <= 0))
      return Promise.resolve("cancelled")
    let finish = () => {}
    const completed = new Promise<void>((resolve) => {
      finish = resolve
    })
    return new Promise<Decision>((resolve) => {
      const id = crypto.randomUUID()
      const record: PendingReview = {
        owner,
        id,
        resolve,
        finish,
        completed,
        decided: false,
        timer:
          expiresIn === null ? null : setTimeout(() => cancel(owner, "draft-expired"), expiresIn),
      }
      pending = record
      publish({
        id,
        input: structuredClone(input),
        status: "ready",
        diagnostic: null,
        draftViewport: draftViewport ? retainDraftViewportDisplay(draftViewport, previous) : null,
      })
    })
  }

  function decide(id: string, decision: "approved" | "rejected"): Promise<void> {
    const record = pending
    if (!record || record.id !== id || !state || state.status !== "ready") return Promise.resolve()
    if (hasReviewDeadline(state.input) && Date.now() >= Date.parse(expiresAt(state.input))) {
      cancel(record.owner, "draft-expired")
      return Promise.resolve()
    }
    settle(record, decision)
    if (decision === "rejected") {
      record.finish()
      pending = null
      publish(null)
      return Promise.resolve()
    }
    publish({ ...state, status: "applying" })
    return record.completed
  }

  function complete(
    owner: symbol,
    result: AutomationHostResult<unknown> | AssemblyResult<unknown>,
  ) {
    if (!pending || pending.owner !== owner) return
    settle(pending, "cancelled")
    pending.finish()
    pending = null
    if (result.ok) publish(null)
    else if (state)
      publish({
        ...state,
        status: "error",
        diagnostic: result.diagnostic.code,
        draftViewport: null,
      })
  }

  function getDraftViewportSnapshot(): AutomationDraftViewport | null {
    const viewport = pending ? reviewDraftViewport(state) : draftPresentation?.viewport
    if (!viewport) return null
    return sameDraftViewportSource(viewport.draft, viewport.preview.assistantDraft)
      ? viewport
      : null
  }

  function setDraftViewportDisplay(
    draftId: string,
    display: AutomationDraftViewport["preview"]["display"],
  ): boolean {
    const viewport = getDraftViewportSnapshot()
    if (!viewport || viewport.draft.draftId !== draftId) return false
    const next = withDraftViewportDisplay(viewport, display)
    if (next === viewport) return true
    updateDraftApplicationViewport(viewport, next)
    if (draftPresentation?.viewport === viewport) {
      draftPresentation = { ...draftPresentation, viewport: next }
      notify()
    } else if (state?.draftViewport === viewport) publish({ ...state, draftViewport: next })
    return true
  }

  function updateDraftApplicationViewport(
    previous: AutomationDraftViewport,
    next: AutomationDraftViewport,
  ) {
    if (draftApplication?.state.viewport !== previous) return
    draftApplication = { ...draftApplication, state: { ...draftApplication.state, viewport: next } }
  }

  function clearDraftApplication(owner: symbol) {
    if (draftApplication?.owner !== owner || draftApplication.state.status === "applying")
      return false
    draftApplication = null
    return true
  }

  function clearDraftPresentation(owner: symbol) {
    if (draftPresentation?.owner !== owner) return false
    draftPresentation = null
    return true
  }

  async function applyDraftViewport(expected: AutomationDraftApplicationState): Promise<boolean> {
    const application = draftApplication
    if (!application || application.state !== expected || expected.status !== "ready") return false
    const applying = { ...application, state: { ...expected, status: "applying" as const } }
    draftApplication = applying
    notify()
    let result: AutomationHostResult<unknown>
    try {
      result = await application.apply()
    } catch {
      result = {
        ok: false,
        diagnostic: {
          code: "automation-operation-failed",
          message: "The browser draft could not be applied.",
          retryable: true,
          issues: [],
        },
      }
    }
    if (draftApplication === applying) {
      draftApplication = result.ok
        ? null
        : {
            ...applying,
            state: { ...applying.state, status: "error", diagnostic: result.diagnostic.code },
          }
      notify()
    }
    return result.ok
  }

  return {
    request,
    decide,
    cancel,
    complete,
    applyDraftViewport,
    getDraftApplicationSnapshot: () => draftApplication?.state ?? null,
    setDraftViewportDisplay,
    clearDraftViewport(owner: symbol) {
      const applicationCleared = clearDraftApplication(owner)
      const presentationCleared = clearDraftPresentation(owner)
      if (applicationCleared || presentationCleared) notify()
      if (pending?.owner === owner && state?.draftViewport)
        publish({ ...state, draftViewport: null })
    },
    presentDraftViewport(
      owner: symbol,
      viewport: AutomationDraftViewport,
      apply?: () => Promise<AutomationHostResult<unknown>>,
    ) {
      if (pending || draftApplication?.state.status === "applying") return
      const previous = draftPresentation?.owner === owner ? draftPresentation.viewport : null
      draftPresentation = { owner, viewport: retainDraftViewportDisplay(viewport, previous) }
      draftApplication =
        apply && viewport.draft.commandCount > 0
          ? {
              owner,
              apply,
              state: { viewport: draftPresentation.viewport, status: "ready", diagnostic: null },
            }
          : null
      notify()
    },
    getDraftViewportSnapshot,
    dismiss(id: string) {
      if (state?.id === id && state.status === "error") publish(null)
    },
    getSnapshot: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}
