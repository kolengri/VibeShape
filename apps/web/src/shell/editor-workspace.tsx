import { ModelTree } from "./model-tree"
import { TaskPanel } from "./task-panel"
import { ViewportPlaceholder } from "./viewport-placeholder"

export function EditorWorkspace({
  activeTool,
  controller,
  onCloseTool,
  onCreateBox,
  onWorkspaceChange,
  workspace,
}: {
  activeTool: "box" | null
  controller: DocumentControllerState
  onCloseTool: () => void
  onCreateBox: () => void
  onWorkspaceChange: (workspace: "model" | "variables") => void
  workspace: "model" | "variables"
}) {
  return (
    <div className="cad-workspace-grid min-h-0">
      <ModelTree
        activeWorkspace={workspace}
        controller={controller}
        onWorkspaceChange={onWorkspaceChange}
      />
      {workspace === "variables" ? (
        <VariablesPanel controller={controller} />
      ) : (
        <ViewportPlaceholder />
      )}
      <TaskPanel
        activeTool={activeTool}
        controller={controller}
        workspace={workspace}
        onCloseTool={onCloseTool}
        onCreateBox={onCreateBox}
      />
    </div>
  )
}
import type { DocumentControllerState } from "../document/document-controller"
import { VariablesPanel } from "../features/variables/variables-panel"
