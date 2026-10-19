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
  return "kind" in input || input.metadata !== undefined
}

type Decision = "approved" | "rejected" | "cancelled"

export type AutomationReviewState = Readonly<{
  id: string
  input: AutomationReviewInput
  status: "ready" | "applying" | "error"
  diagnostic: string | null
  draftViewport?: AutomationDraftViewport | null
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

// One visible review owns the editor's confirmation surface at a time.
export function createAutomationReviewController() {
  let state: AutomationReviewState | null = null
  let pending: PendingReview | null = null
  const listeners = new Set<() => void>()

  function publish(next: AutomationReviewState | null) {
    state = next
    for (const listener of listeners) listener()
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
        draftViewport,
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

  return {
    request,
    decide,
    cancel,
    complete,
    clearDraftViewport(owner: symbol) {
      if (pending?.owner === owner && state?.draftViewport)
        publish({ ...state, draftViewport: null })
    },
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
