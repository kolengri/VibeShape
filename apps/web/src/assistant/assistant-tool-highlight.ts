import type { AssistantToolTargets } from "@vibeshape/automation-api/assistant"
import { useCallback } from "react"
import { useEditorSession } from "../editor-session/editor-session-provider"

export type AssistantToolHighlight = (owner: string, targets: AssistantToolTargets | null) => void

export function useAssistantToolHighlight(projectId: string): AssistantToolHighlight {
  const setPreselection = useEditorSession((state) => state.actions.setAssistantToolPreselection)
  return useCallback(
    (owner, targets) => {
      if (targets && targets.projectId !== projectId) return
      setPreselection(owner, targets)
    },
    [projectId, setPreselection],
  )
}
