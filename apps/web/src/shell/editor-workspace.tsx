import type {
  FeatureId,
  SketchConstraintId,
  SketchEntityId,
  SketchId,
  SketchProfileSelector,
  SketchRecord,
} from "@vibeshape/domain"
import type { ViewerSelection } from "@vibeshape/viewer/three-viewport"
import type { DocumentControllerState } from "../document/document-controller"
import {
  type ActivePartDesignTool,
  activeFeatureId,
} from "../features/part-design/part-design-tool"
import type {
  ActiveSketchTool,
  SketchDraftChangeMode,
  SketchEditorTool,
} from "../features/sketch/sketch-tool"
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
  sketchConstruction,
  sketchDraft,
  sketchEditorTool,
  sketchSelectedEntityIds,
  sketchSelectedProfile,
  selectedSketch,
  onSketchDraftChange,
  onSketchFailedConstraintsChange,
  onSketchProfileSelect,
  onSketchProfilesChange,
  onSketchRedo,
  onSketchSelectionChange,
  onSketchUndo,
  workspace,
}: {
  controller: DocumentControllerState
  onSelectionChange: (selection: ViewerSelection | null) => void
  selection: ViewerSelection | null
  sketchConstruction: boolean
  sketchDraft: SketchRecord | null
  sketchEditorTool: SketchEditorTool
  sketchSelectedEntityIds: readonly SketchEntityId[]
  sketchSelectedProfile: SketchProfileSelector | null
  selectedSketch: SketchRecord | null
  onSketchDraftChange: (sketch: SketchRecord, mode?: SketchDraftChangeMode) => void
  onSketchFailedConstraintsChange: (constraintIds: readonly SketchConstraintId[]) => void
  onSketchProfileSelect: (profile: SketchProfileSelector) => void
  onSketchProfilesChange: (profiles: readonly SketchProfileSelector[]) => void
  onSketchRedo: () => void
  onSketchSelectionChange: (entityIds: readonly SketchEntityId[]) => void
  onSketchUndo: () => void
  workspace: EditorWorkspaceName
}) {
  if (workspace === "variables") return <VariablesPanel controller={controller} />
  if (workspace === "sketch") {
    return (
      <SketchViewport
        state={{
          construction: sketchConstruction,
          controller,
          draft: sketchDraft,
          editorTool: sketchEditorTool,
          selectedEntityIds: sketchSelectedEntityIds,
          selectedProfile: sketchSelectedProfile,
          sketch: selectedSketch,
        }}
        actions={{
          onDraftChange: onSketchDraftChange,
          onFailedConstraintsChange: onSketchFailedConstraintsChange,
          onProfileSelect: onSketchProfileSelect,
          onProfilesChange: onSketchProfilesChange,
          onRedo: onSketchRedo,
          onSelectionChange: onSketchSelectionChange,
          onUndo: onSketchUndo,
        }}
      />
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
  selectSketch: (sketchId: SketchId) => void
  redoSketchDraft: () => void
  setSketchConstruction: (construction: boolean) => void
  setSketchDraft: (sketch: SketchRecord, mode?: SketchDraftChangeMode) => void
  setSketchEditorTool: (tool: SketchEditorTool) => void
  setSketchFailedConstraintIds: (constraintIds: readonly SketchConstraintId[]) => void
  setSketchProfiles: (profiles: readonly SketchProfileSelector[]) => void
  setSketchSelectedEntityIds: (entityIds: readonly SketchEntityId[]) => void
  setSketchSelectedProfile: (profile: SketchProfileSelector | null) => void
  sketchSaved: (sketch: SketchRecord) => void
  switchWorkspace: (workspace: EditorWorkspaceName) => void
  undoSketchDraft: () => void
}>

export function EditorWorkspace({
  actions,
  activeTool,
  activeSketchId,
  activeSketchTool,
  controller,
  selection,
  sketchConstruction,
  sketchDraft,
  sketchEditorTool,
  sketchFailedConstraintIds,
  sketchProfiles,
  sketchRedoAvailable,
  sketchSelectedEntityIds,
  sketchSelectedProfile,
  sketchUndoAvailable,
  workspace,
}: {
  actions: EditorWorkspaceActions
  activeTool: ActivePartDesignTool | null
  activeSketchId: SketchId | null
  activeSketchTool: ActiveSketchTool | null
  controller: DocumentControllerState
  selection: ViewerSelection | null
  sketchConstruction: boolean
  sketchDraft: SketchRecord | null
  sketchEditorTool: SketchEditorTool
  sketchFailedConstraintIds: readonly SketchConstraintId[]
  sketchProfiles: readonly SketchProfileSelector[]
  sketchRedoAvailable: boolean
  sketchSelectedEntityIds: readonly SketchEntityId[]
  sketchSelectedProfile: SketchProfileSelector | null
  sketchUndoAvailable: boolean
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
        onSketchActivate={actions.selectSketch}
        onWorkspaceChange={actions.switchWorkspace}
      />
      <WorkspaceContent
        controller={controller}
        workspace={workspace}
        selection={selection}
        selectedSketch={selectedSketch}
        sketchConstruction={sketchConstruction}
        sketchDraft={sketchDraft}
        sketchEditorTool={sketchEditorTool}
        sketchSelectedEntityIds={sketchSelectedEntityIds}
        sketchSelectedProfile={sketchSelectedProfile}
        onSketchDraftChange={actions.setSketchDraft}
        onSketchFailedConstraintsChange={actions.setSketchFailedConstraintIds}
        onSketchProfileSelect={actions.setSketchSelectedProfile}
        onSketchProfilesChange={actions.setSketchProfiles}
        onSketchRedo={actions.redoSketchDraft}
        onSketchSelectionChange={actions.setSketchSelectedEntityIds}
        onSketchUndo={actions.undoSketchDraft}
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
        sketchConstruction={sketchConstruction}
        sketchDraft={sketchDraft}
        sketchEditorTool={sketchEditorTool}
        sketchFailedConstraintIds={sketchFailedConstraintIds}
        sketchProfiles={sketchProfiles}
        sketchRedoAvailable={sketchRedoAvailable}
        sketchSelectedEntityIds={sketchSelectedEntityIds}
        sketchSelectedProfile={sketchSelectedProfile}
        sketchUndoAvailable={sketchUndoAvailable}
        onSketchConstructionChange={actions.setSketchConstruction}
        onSketchDraftChange={actions.setSketchDraft}
        onSketchEditorToolChange={actions.setSketchEditorTool}
        onSketchSelectedProfileChange={actions.setSketchSelectedProfile}
        onSketchRedo={actions.redoSketchDraft}
        onSketchSaved={actions.sketchSaved}
        onSketchUndo={actions.undoSketchDraft}
      />
    </div>
  )
}
