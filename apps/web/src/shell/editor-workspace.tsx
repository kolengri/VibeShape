import type { FeatureId, SketchId, SketchRecord } from "@vibeshape/domain"
import type { ViewerSelection } from "@vibeshape/viewer/three-viewport"
import type { DocumentControllerState } from "../document/document-controller"
import {
  type ActivePartDesignTool,
  activeFeatureId,
} from "../features/part-design/part-design-tool"
import type { RectangleSketchPreview } from "../features/sketch/rectangle-sketch-form"
import type { ActiveSketchTool } from "../features/sketch/sketch-tool"
import { SketchViewport } from "../features/sketch/sketch-viewport"
import { VariablesPanel } from "../features/variables/variables-panel"
import { GeometryViewport } from "./geometry-viewport"
import { ModelTree } from "./model-tree"
import { TaskPanel } from "./task-panel"
import type { EditorWorkspaceName } from "./workspace"

function WorkspaceContent({
  controller,
  onSelectionChange,
  selection,
  selectedSketch,
  sketchPreview,
  workspace,
}: {
  controller: DocumentControllerState
  onSelectionChange: (selection: ViewerSelection | null) => void
  selection: ViewerSelection | null
  selectedSketch: SketchRecord | null
  sketchPreview: RectangleSketchPreview | null
  workspace: EditorWorkspaceName
}) {
  if (workspace === "variables") return <VariablesPanel controller={controller} />
  if (workspace === "sketch") {
    return (
      <SketchViewport controller={controller} preview={sketchPreview} sketch={selectedSketch} />
    )
  }
  return (
    <GeometryViewport
      controller={controller}
      selection={selection}
      onSelectionChange={onSelectionChange}
    />
  )
}

export function EditorWorkspace({
  activeTool,
  activeSketchId,
  activeSketchTool,
  controller,
  onCloseTool,
  onCreateBox,
  onCreateCylinder,
  onCreateSketch,
  onCreateSubtract,
  onEditFeature,
  onEditSketch,
  onSelectionChange,
  onWorkspaceChange,
  onSketchPreview,
  onSketchSaved,
  selection,
  sketchPreview,
  workspace,
}: {
  activeTool: ActivePartDesignTool | null
  activeSketchId: SketchId | null
  activeSketchTool: ActiveSketchTool | null
  controller: DocumentControllerState
  onCloseTool: () => void
  onCreateBox: () => void
  onCreateCylinder: () => void
  onCreateSketch: () => void
  onCreateSubtract: () => void
  onEditFeature: (featureId: FeatureId) => void
  onEditSketch: (sketchId: SketchId) => void
  onSelectionChange: (selection: ViewerSelection | null) => void
  onWorkspaceChange: (workspace: EditorWorkspaceName) => void
  onSketchPreview: (preview: RectangleSketchPreview | null) => void
  onSketchSaved: (sketch: SketchRecord) => void
  selection: ViewerSelection | null
  sketchPreview: RectangleSketchPreview | null
  workspace: EditorWorkspaceName
}) {
  const selectedSketch =
    controller.report?.snapshot.sketches.find(({ id }) => id === activeSketchId) ?? null
  return (
    <div className="cad-workspace-grid min-h-0">
      <ModelTree
        activeWorkspace={workspace}
        activeFeatureId={activeFeatureId(activeTool)}
        activeSketchId={activeSketchId}
        controller={controller}
        onFeatureActivate={onEditFeature}
        onSketchActivate={onEditSketch}
        onWorkspaceChange={onWorkspaceChange}
      />
      <WorkspaceContent
        controller={controller}
        workspace={workspace}
        selection={selection}
        selectedSketch={selectedSketch}
        sketchPreview={sketchPreview}
        onSelectionChange={onSelectionChange}
      />
      <TaskPanel
        activeSketchId={activeSketchId}
        activeSketchTool={activeSketchTool}
        activeTool={activeTool}
        controller={controller}
        workspace={workspace}
        onCloseTool={onCloseTool}
        onCreateBox={onCreateBox}
        onCreateCylinder={onCreateCylinder}
        onCreateSketch={onCreateSketch}
        onCreateSubtract={onCreateSubtract}
        onEditSketch={onEditSketch}
        onSketchPreview={onSketchPreview}
        onSketchSaved={onSketchSaved}
      />
    </div>
  )
}
