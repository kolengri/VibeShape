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

export type EditorWorkspaceActions = Readonly<{
  closeTool: () => void
  createBox: () => void
  createCylinder: () => void
  createExtrusion: () => void
  createSketch: () => void
  createSubtract: () => void
  editFeature: (featureId: FeatureId) => void
  editSketch: (sketchId: SketchId) => void
  select: (selection: ViewerSelection | null) => void
  setSketchPreview: (preview: RectangleSketchPreview | null) => void
  sketchSaved: (sketch: SketchRecord) => void
  switchWorkspace: (workspace: EditorWorkspaceName) => void
}>

export function EditorWorkspace({
  actions,
  activeTool,
  activeSketchId,
  activeSketchTool,
  controller,
  selection,
  sketchPreview,
  workspace,
}: {
  actions: EditorWorkspaceActions
  activeTool: ActivePartDesignTool | null
  activeSketchId: SketchId | null
  activeSketchTool: ActiveSketchTool | null
  controller: DocumentControllerState
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
        onFeatureActivate={actions.editFeature}
        onSketchActivate={actions.editSketch}
        onWorkspaceChange={actions.switchWorkspace}
      />
      <WorkspaceContent
        controller={controller}
        workspace={workspace}
        selection={selection}
        selectedSketch={selectedSketch}
        sketchPreview={sketchPreview}
        onSelectionChange={actions.select}
      />
      <TaskPanel
        activeSketchId={activeSketchId}
        activeSketchTool={activeSketchTool}
        activeTool={activeTool}
        controller={controller}
        workspace={workspace}
        onCloseTool={actions.closeTool}
        onCreateBox={actions.createBox}
        onCreateCylinder={actions.createCylinder}
        onCreateExtrusion={actions.createExtrusion}
        onCreateSketch={actions.createSketch}
        onCreateSubtract={actions.createSubtract}
        onEditSketch={actions.editSketch}
        onSketchPreview={actions.setSketchPreview}
        onSketchSaved={actions.sketchSaved}
      />
    </div>
  )
}
