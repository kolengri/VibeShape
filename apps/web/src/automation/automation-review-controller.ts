import { createAutomationReviewController } from "./automation-review-state"

type ReviewController = ReturnType<typeof createAutomationReviewController>
let active = createAutomationReviewController()
const listeners = new Set<() => void>()
const publish = () => {
  for (const listener of listeners) listener()
}
let unsubscribe = active.subscribe(publish)

export function getActiveAutomationReviews() {
  return active
}

export function setActiveAutomationReviews(controller: ReviewController) {
  if (controller === active) return
  unsubscribe()
  active = controller
  unsubscribe = active.subscribe(publish)
  publish()
}

// The visible confirmation surface projects the active project's retained review owner.
export const automationReviews: ReviewController = {
  request: (...args) => active.request(...args),
  decide: (...args) => active.decide(...args),
  cancel: (...args) => active.cancel(...args),
  complete: (...args) => active.complete(...args),
  clearDraftViewport: (...args) => active.clearDraftViewport(...args),
  dismiss: (...args) => active.dismiss(...args),
  getSnapshot: () => active.getSnapshot(),
  subscribe(listener) {
    listeners.add(listener)
    return () => listeners.delete(listener)
  },
}
