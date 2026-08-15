import type {
  FeatureId,
  SketchConstraintId,
  SketchEntityId,
  SketchId,
  SketchProfileSelector,
  SketchRecord,
} from "@vibeshape/domain"
import type { ViewerSelection } from "@vibeshape/viewer/three-viewport"
import {
  type DocumentControllerState,
  updateFeature,
  updateSketch,
} from "../document/document-controller"
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

type WorkspaceContentProps = Readonly<{
  actions: Readonly<{
    onSelectionChange: (selection: ViewerSelection | null) => void
    onSketchDraftChange: (sketch: SketchRecord, mode?: SketchDraftChangeMode) => void
    onSketchFailedConstraintsChange: (constraintIds: readonly SketchConstraintId[]) => void
    onSketchPlaneSelect: (plane: SketchRecord["plane"]) => void
    onSketchProfileSelect: (profile: SketchProfileSelector) => void
    onSketchProfilesChange: (profiles: readonly SketchProfileSelector[]) => void
    onSketchRedo: () => void
    onSketchSelectionChange: (entityIds: readonly SketchEntityId[]) => void
    onSketchUndo: () => void
  }>
  controller: DocumentControllerState
  model: Readonly<{ selection: ViewerSelection | null }>
  sketch: Readonly<{
    activeTool: ActiveSketchTool | null
    construction: boolean
    draft: SketchRecord | null
    editorTool: SketchEditorTool
    selectedEntityIds: readonly SketchEntityId[]
    selectedProfile: SketchProfileSelector | null
    selectedSketch: SketchRecord | null
  }>
  workspace: EditorWorkspaceName
}>

function SketchWorkspaceContent({
  actions,
  controller,
  sketch,
}: Pick<WorkspaceContentProps, "actions" | "controller" | "sketch">) {
  return (
    <SketchViewport
      state={{
        construction: sketch.construction,
        controller,
        draft: sketch.draft,
        editorTool: sketch.editorTool,
        selectedEntityIds: sketch.selectedEntityIds,
        selectedProfile: sketch.selectedProfile,
        sketch: sketch.selectedSketch,
      }}
      actions={{
        onDraftChange: actions.onSketchDraftChange,
        onFailedConstraintsChange: actions.onSketchFailedConstraintsChange,
        onProfileSelect: actions.onSketchProfileSelect,
        onProfilesChange: actions.onSketchProfilesChange,
        onRedo: actions.onSketchRedo,
        onSelectionChange: actions.onSketchSelectionChange,
        onUndo: actions.onSketchUndo,
      }}
    />
  )
}

function ModelingWorkspaceContent({
  actions,
  controller,
  model,
  sketch,
}: Pick<WorkspaceContentProps, "actions" | "controller" | "model" | "sketch">) {
  return (
    <GeometryViewport
      controller={controller}
      selection={model.selection}
      onSelectionChange={actions.onSelectionChange}
      {...(sketch.activeTool?.kind === "select-sketch-plane" && sketch.draft
        ? {
            originPlaneSelection: {
              selectedPlane: sketch.draft.plane,
              onSelect: actions.onSketchPlaneSelect,
            },
          }
        : {})}
    />
  )
}

function WorkspaceContent(props: WorkspaceContentProps) {
  if (props.workspace === "variables") {
    return <VariablesPanel controller={props.controller} />
  }
  return props.workspace === "sketch" ? (
    <SketchWorkspaceContent
      actions={props.actions}
      controller={props.controller}
      sketch={props.sketch}
    />
  ) : (
    <ModelingWorkspaceContent
      actions={props.actions}
      controller={props.controller}
      model={props.model}
      sketch={props.sketch}
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
  selectSketchPlane: (plane: SketchRecord["plane"]) => void
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
  sketchSelectedEntityIds,
  sketchSelectedProfile,
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
  sketchSelectedEntityIds: readonly SketchEntityId[]
  sketchSelectedProfile: SketchProfileSelector | null
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
        onFeatureRename={updateFeature}
        onSketchActivate={actions.selectSketch}
        onSketchRename={updateSketch}
        onWorkspaceChange={actions.switchWorkspace}
        sketchRenameBlockedId={
          activeSketchTool?.kind === "edit-sketch" ? activeSketchTool.sketchId : null
        }
      />
      <WorkspaceContent
        actions={{
          onSelectionChange: actions.select,
          onSketchDraftChange: actions.setSketchDraft,
          onSketchFailedConstraintsChange: actions.setSketchFailedConstraintIds,
          onSketchPlaneSelect: actions.selectSketchPlane,
          onSketchProfileSelect: actions.setSketchSelectedProfile,
          onSketchProfilesChange: actions.setSketchProfiles,
          onSketchRedo: actions.redoSketchDraft,
          onSketchSelectionChange: actions.setSketchSelectedEntityIds,
          onSketchUndo: actions.undoSketchDraft,
        }}
        controller={controller}
        model={{ selection }}
        workspace={workspace}
        sketch={{
          activeTool: activeSketchTool,
          construction: sketchConstruction,
          draft: sketchDraft,
          editorTool: sketchEditorTool,
          selectedEntityIds: sketchSelectedEntityIds,
          selectedProfile: sketchSelectedProfile,
          selectedSketch,
        }}
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
        sketchDraft={sketchDraft}
        sketchFailedConstraintIds={sketchFailedConstraintIds}
        sketchProfiles={sketchProfiles}
        sketchSelectedEntityIds={sketchSelectedEntityIds}
        sketchSelectedProfile={sketchSelectedProfile}
        onSketchDraftChange={actions.setSketchDraft}
        onSketchSelectedProfileChange={actions.setSketchSelectedProfile}
        onSketchSaved={actions.sketchSaved}
        onSketchPlaneSelect={actions.selectSketchPlane}
      />
    </div>
  )
}
