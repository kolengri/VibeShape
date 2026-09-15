import type {
  AutomationHostDiagnosticCode,
  AutomationHostResult,
  DraftReviewInput,
} from "@vibeshape/automation-host/host"

type Decision = "approved" | "rejected" | "cancelled"

export type AutomationReviewState = Readonly<{
  id: string
  input: DraftReviewInput
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
    if (state) publish({ ...state, status: "error", diagnostic })
    pending = null
  }

  function request(owner: symbol, input: DraftReviewInput): Promise<Decision> {
    if (pending) return Promise.resolve("cancelled")
    const expiresIn = Date.parse(input.preview.draft.expiresAt) - Date.now()
    if (!Number.isFinite(expiresIn) || expiresIn <= 0) return Promise.resolve("cancelled")
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
        timer: setTimeout(() => cancel(owner, "draft-expired"), expiresIn),
      }
      pending = record
      publish({ id, input: structuredClone(input), status: "ready", diagnostic: null })
    })
  }

  function decide(id: string, decision: "approved" | "rejected"): Promise<void> {
    const record = pending
    if (!record || record.id !== id || !state || state.status !== "ready") return Promise.resolve()
    if (Date.now() >= Date.parse(state.input.preview.draft.expiresAt)) {
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

  function complete(owner: symbol, result: AutomationHostResult<unknown>) {
    if (!pending || pending.owner !== owner) return
    settle(pending, "cancelled")
    pending.finish()
    pending = null
    if (result.ok) publish(null)
    else if (state) publish({ ...state, status: "error", diagnostic: result.diagnostic.code })
  }

  return {
    request,
    decide,
    cancel,
    complete,
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
