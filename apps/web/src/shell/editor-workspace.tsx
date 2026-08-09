import type { FeatureId } from "@vibeshape/domain"
import type { ViewerSelection } from "@vibeshape/viewer/three-viewport"
import type { DocumentControllerState } from "../document/document-controller"
import {
  type ActivePartDesignTool,
  activeFeatureId,
} from "../features/part-design/part-design-tool"
import { VariablesPanel } from "../features/variables/variables-panel"
import { GeometryViewport } from "./geometry-viewport"
import { ModelTree } from "./model-tree"
import { TaskPanel } from "./task-panel"

export function EditorWorkspace({
  activeTool,
  controller,
  onCloseTool,
  onCreateBox,
  onCreateCylinder,
  onEditFeature,
  onSelectionChange,
  onWorkspaceChange,
  selection,
  workspace,
}: {
  activeTool: ActivePartDesignTool | null
  controller: DocumentControllerState
  onCloseTool: () => void
  onCreateBox: () => void
  onCreateCylinder: () => void
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
        activeFeatureId={activeFeatureId(activeTool)}
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
        onCreateCylinder={onCreateCylinder}
      />
    </div>
  )
}
