import { useMemo, useSyncExternalStore } from "react"
import { automationReviews } from "../automation/automation-review-controller"
import type { DocumentControllerState } from "../document/document-controller"
import { useEditorSession } from "../editor-session/editor-session-provider"

export type AssistantDraftDisplay = Readonly<{
  mode: "changes" | "result"
  onChange: (mode: "changes" | "result") => void
}>

export function useAssistantDraftDisplay(controller: DocumentControllerState) {
  const presentation = useSyncExternalStore(
    automationReviews.subscribe,
    automationReviews.getDraftViewportSnapshot,
    automationReviews.getDraftViewportSnapshot,
  )
  const editing = useEditorSession((state) =>
    Boolean(state.activePartDesignTool || state.sketch.activeSketchTool),
  )
  const viewport = presentation
  const snapshot = controller.report?.snapshot
  return useMemo((): AssistantDraftDisplay | undefined => {
    if (
      !viewport ||
      editing ||
      controller.assistantCheckpointPresentation ||
      snapshot?.id !== viewport.draft.documentId ||
      snapshot.revision !== viewport.draft.baseRevision
    )
      return undefined
    return {
      mode: viewport.preview.display,
      onChange: (mode) => {
        automationReviews.setDraftViewportDisplay(viewport.draft.draftId, mode)
      },
    }
  }, [viewport, editing, controller.assistantCheckpointPresentation, snapshot])
}
