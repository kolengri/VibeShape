import { ModelTree } from "./model-tree"
import { TaskPanel } from "./task-panel"
import { GeometryViewport } from "./geometry-viewport"
import type { ViewerSelection } from "@vibeshape/viewer/three-viewport"
import type { FeatureId } from "@vibeshape/domain"
import type { ActiveBoxTool } from "../features/box/box-tool"

export function EditorWorkspace({
  activeTool,
  controller,
  onCloseTool,
  onCreateBox,
  onEditFeature,
  onSelectionChange,
  onWorkspaceChange,
  selection,
  workspace,
}: {
  activeTool: ActiveBoxTool | null
  controller: DocumentControllerState
  onCloseTool: () => void
  onCreateBox: () => void
  onEditFeature: (featureId: FeatureId) => void
  onSelectionChange: (selection: ViewerSelection | null) => void
  onWorkspaceChange: (workspace: "model" | "variables") => void
  selection: ViewerSelection | null
  workspace: "model" | "variables"
}) {
  return (
    <div className="cad-workspace-grid min-h-0">
      <ModelTree
        activeWorkspace={workspace}
        activeFeatureId={activeTool?.kind === "edit-box" ? activeTool.featureId : null}
        controller={controller}
        onFeatureActivate={onEditFeature}
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
