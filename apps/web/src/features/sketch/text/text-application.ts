import type { SketchRecord } from "@vibeshape/domain"
import { useTranslations } from "@vibeshape/i18n"
import { useCallback } from "react"
import type { DocumentControllerState } from "../../../document/document-controller"
import {
  useEditorSession,
  useEditorSessionStoreApi,
} from "../../../editor-session/editor-session-provider"
import { type ActiveSketchTool, isActiveSketchEditorTool } from "../sketch-tool"
import { useSketchTextManager } from "./use-sketch-text"

function textEditingDisabled(controller: DocumentControllerState, tool: ActiveSketchTool | null) {
  return (
    !isActiveSketchEditorTool(tool) ||
    controller.status !== "ready" ||
    controller.report?.mode !== "read-write" ||
    controller.saveStatus === "saving"
  )
}
export function useSketchTextApplication(controller: DocumentControllerState) {
  const t = useTranslations("app.sketchText")
  const store = useEditorSessionStoreApi()
  const sketch = useEditorSession((state) => state.sketch)
  const actions = useEditorSession((state) => state.actions)
  const getDraft = useCallback(() => store.getState().sketch.draft, [store])
  const commitDraft = (draft: SketchRecord) => {
    actions.setSketchDraft(draft)
    actions.setSketchSelectedEntityIds([])
    actions.setSketchSelectedConstraintId(null)
  }
  const dialog = useSketchTextManager({
    draft: sketch.draft,
    disabled: textEditingDisabled(controller, sketch.activeSketchTool),
    getDraft,
    onDraftChange: commitDraft,
    onOpen: () => actions.setSketchEditorTool("select"),
    staleMessage: t("draftChanged"),
  })
  return { ...dialog, getDraft, commitDraft }
}
