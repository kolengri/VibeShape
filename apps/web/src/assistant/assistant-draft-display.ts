import type { DocumentSnapshot } from "@vibeshape/domain"
import { useMemo, useSyncExternalStore } from "react"
import type { AutomationDraftViewport } from "../automation/automation-draft-viewport"
import {
  automationReviews,
  getActiveAutomationReviews,
} from "../automation/automation-review-controller"
import type { AutomationReviewState } from "../automation/automation-review-state"
import type { DocumentControllerState } from "../document/document-controller"
import { useEditorSession } from "../editor-session/editor-session-provider"

export type AssistantDraftDisplay = Readonly<{
  mode: "changes" | "result"
  onChange: (mode: "changes" | "result") => void
  application?:
    | Readonly<{
        status: "ready" | "applying" | "error"
        diagnostic: string | null
        onApply: () => Promise<boolean>
      }>
    | undefined
  review?: AutomationReviewState | undefined
}>

function matchesCommittedSource(
  viewport: AutomationDraftViewport,
  snapshot: DocumentSnapshot | undefined,
) {
  return (
    snapshot?.id === viewport.draft.documentId && snapshot.revision === viewport.draft.baseRevision
  )
}

export function useAssistantDraftDisplay(controller: DocumentControllerState) {
  const presentation = useSyncExternalStore(
    automationReviews.subscribe,
    automationReviews.getDraftViewportSnapshot,
    automationReviews.getDraftViewportSnapshot,
  )
  const application = useSyncExternalStore(
    automationReviews.subscribe,
    automationReviews.getDraftApplicationSnapshot,
    automationReviews.getDraftApplicationSnapshot,
  )
  const review = useSyncExternalStore(
    automationReviews.subscribe,
    automationReviews.getSnapshot,
    automationReviews.getSnapshot,
  )
  const editing = useEditorSession((state) =>
    Boolean(state.activePartDesignTool || state.sketch.activeSketchTool),
  )
  const viewport = presentation ?? (application?.status !== "ready" ? application?.viewport : null)
  const snapshot = controller.report?.snapshot
  const reviews = getActiveAutomationReviews()
  const hidden = editing || Boolean(controller.assistantCheckpointPresentation)
  return useMemo((): AssistantDraftDisplay | undefined => {
    if (!viewport || hidden || !matchesCommittedSource(viewport, snapshot)) return undefined
    return {
      mode: viewport.preview.display,
      onChange: (mode) => {
        if (getActiveAutomationReviews() === reviews)
          reviews.setDraftViewportDisplay(viewport.draft.draftId, mode)
      },
      application: application
        ? {
            status: application.status,
            diagnostic: application.diagnostic,
            onApply: () =>
              getActiveAutomationReviews() === reviews
                ? reviews.applyDraftViewport(application)
                : Promise.resolve(false),
          }
        : undefined,
      review: review?.draftViewport === viewport ? review : undefined,
    }
  }, [viewport, application, review, reviews, hidden, snapshot])
}
