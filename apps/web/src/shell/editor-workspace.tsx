import { ModelTree } from "./model-tree"
import { TaskPanel } from "./task-panel"
import { ViewportPlaceholder } from "./viewport-placeholder"

export function EditorWorkspace({
  controller,
  onWorkspaceChange,
  workspace,
}: {
  controller: DocumentControllerState
  onWorkspaceChange: (workspace: "model" | "variables") => void
  workspace: "model" | "variables"
}) {
  return (
    <div className="cad-workspace-grid min-h-0">
      <ModelTree activeWorkspace={workspace} onWorkspaceChange={onWorkspaceChange} />
      {workspace === "variables" ? (
        <VariablesPanel controller={controller} />
      ) : (
        <ViewportPlaceholder />
      )}
      <TaskPanel workspace={workspace} />
    </div>
  )
}
import type { DocumentControllerState } from "../document/document-controller"
import { VariablesPanel } from "../features/variables/variables-panel"
