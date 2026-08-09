import { ModelTree } from "./model-tree"
import { TaskPanel } from "./task-panel"
import { GeometryViewport } from "./geometry-viewport"
import type { ViewerSelection } from "@vibeshape/viewer/three-viewport"

export function EditorWorkspace({
  activeTool,
  controller,
  onCloseTool,
  onCreateBox,
  onSelectionChange,
  onWorkspaceChange,
  selection,
  workspace,
}: {
  activeTool: "box" | null
  controller: DocumentControllerState
  onCloseTool: () => void
  onCreateBox: () => void
  onSelectionChange: (selection: ViewerSelection | null) => void
  onWorkspaceChange: (workspace: "model" | "variables") => void
  selection: ViewerSelection | null
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
        <GeometryViewport
          controller={controller}
          selection={selection}
          onSelectionChange={onSelectionChange}
        />
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
