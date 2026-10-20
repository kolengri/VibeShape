import {
  type AutomationReviewInput,
  createAutomationReviewController,
} from "./automation-review-state"

type Reviews = ReturnType<typeof createAutomationReviewController>

/** Host-selected model authority; external reviews and library publication stay visible. */
export function createConnectedAssistantReviews(
  visible: Reviews,
  isActive: () => boolean,
): Reviews {
  const internal = createAutomationReviewController()
  function clearError() {
    const state = internal.getSnapshot()
    if (state?.status === "error") internal.dismiss(state.id)
  }
  return {
    ...visible,
    getSnapshot: () => internal.getSnapshot() ?? visible.getSnapshot(),
    request(owner: symbol, input: AutomationReviewInput, viewport = null) {
      if (!isActive()) return Promise.resolve("cancelled")
      if ("kind" in input && input.kind === "library")
        return visible.request(owner, input, viewport)
      const other = visible.getSnapshot()
      if (other && other.status !== "error") return Promise.resolve("cancelled")
      const decision = internal.request(owner, input, viewport)
      const state = internal.getSnapshot()
      if (state?.status === "ready") void internal.decide(state.id, "approved")
      return decision
    },
    complete(owner, result) {
      internal.complete(owner, result)
      clearError()
      visible.complete(owner, result)
    },
    cancel(owner, diagnostic) {
      internal.cancel(owner, diagnostic)
      clearError()
      visible.cancel(owner, diagnostic)
    },
  }
}
