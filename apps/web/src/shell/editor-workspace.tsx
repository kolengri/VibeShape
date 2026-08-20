import type {
  FeatureId,
  FeatureRecord,
  SketchConstraintId,
  SketchEntityId,
  SketchId,
  SketchProfileSelector,
  SketchRecord,
} from "@vibeshape/domain"
import type {
  ViewerOriginPlane,
  ViewerOriginPlaneVisibility,
} from "@vibeshape/viewer/origin-planes"
import type { ViewerSelection } from "@vibeshape/viewer/three-viewport"
import { useState } from "react"
import {
  type DocumentControllerState,
  updateFeature,
  updateSketch,
} from "../document/document-controller"
import { useExtrusionPreview } from "../features/extrusion/use-extrusion-preview"
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

const EMPTY_GEOMETRY = [] as const

function committedGeometry(controller: DocumentControllerState) {
  const rebuild = controller.report?.rebuild
  return rebuild?.ok ? rebuild.response.geometry : EMPTY_GEOMETRY
}

function isExtrusionToolActive(activeTool: ActivePartDesignTool | null) {
  return activeTool?.kind === "create-extrusion" || activeTool?.kind === "edit-extrusion"
}

function extrusionPreviewCandidate(
  activeTool: ActivePartDesignTool | null,
  candidate: FeatureRecord | null,
) {
  return isExtrusionToolActive(activeTool) ? candidate : null
}

type WorkspaceContentProps = Readonly<{
  actions: Readonly<{
    onSelectionChange: (selection: ViewerSelection | null) => void
    onSketchDraftChange: (sketch: SketchRecord, mode?: SketchDraftChangeMode) => void
    onSketchEditorToolChange: (tool: SketchEditorTool) => void
    onSketchFailedConstraintsChange: (constraintIds: readonly SketchConstraintId[]) => void
    onSketchPlaneSelect: (plane: SketchRecord["plane"]) => void
    onOriginPlaneVisibilityChange: (plane: ViewerOriginPlane, visible: boolean) => void
    onSketchProfileSelect: (profile: SketchProfileSelector) => void
    onSketchProfilesChange: (profiles: readonly SketchProfileSelector[]) => void
    onSketchRedo: () => void
    onSketchConstraintSelectionChange: (constraintId: SketchConstraintId | null) => void
    onSketchSelectionChange: (entityIds: readonly SketchEntityId[]) => void
    onSketchUndo: () => void
  }>
  controller: DocumentControllerState
  model: Readonly<{
    extrusionPreview: ReturnType<typeof useExtrusionPreview>
    hiddenFeatureIds: readonly FeatureId[]
    originPlaneVisibility: ViewerOriginPlaneVisibility
    selection: ViewerSelection | null
  }>
  sketch: Readonly<{
    activeTool: ActiveSketchTool | null
    construction: boolean
    draft: SketchRecord | null
    editorTool: SketchEditorTool
    selectedConstraintId: SketchConstraintId | null
    selectedEntityIds: readonly SketchEntityId[]
    selectedProfile: SketchProfileSelector | null
    selectedSketch: SketchRecord | null
  }>
  workspace: EditorWorkspaceName
}>

function SketchWorkspaceContent({
  actions,
  controller,
  model,
  sketch,
}: Pick<WorkspaceContentProps, "actions" | "controller" | "model" | "sketch">) {
  return (
    <SketchViewport
      state={{
        construction: sketch.construction,
        controller,
        draft: sketch.draft,
        editorTool: sketch.editorTool,
        originPlaneVisibility: model.originPlaneVisibility,
        selectedConstraintId: sketch.selectedConstraintId,
        selectedEntityIds: sketch.selectedEntityIds,
        selectedProfile: sketch.selectedProfile,
        sketch: sketch.selectedSketch,
      }}
      actions={{
        onDraftChange: actions.onSketchDraftChange,
        onEditorToolChange: actions.onSketchEditorToolChange,
        onFailedConstraintsChange: actions.onSketchFailedConstraintsChange,
        onOriginPlaneVisibilityChange: actions.onOriginPlaneVisibilityChange,
        onProfileSelect: actions.onSketchProfileSelect,
        onProfilesChange: actions.onSketchProfilesChange,
        onRedo: actions.onSketchRedo,
        onConstraintSelectionChange: actions.onSketchConstraintSelectionChange,
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
      extrusionPreview={model.extrusionPreview}
      hiddenFeatureIds={model.hiddenFeatureIds}
      originPlaneVisibility={{
        visibility: model.originPlaneVisibility,
        onChange: actions.onOriginPlaneVisibilityChange,
      }}
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
      model={props.model}
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
  createExtrusion: () => Promise<boolean>
  createSketch: () => void
  createSubtract: () => void
  editFeature: (featureId: FeatureId) => void
  editSketch: (sketchId: SketchId) => void
  select: (selection: ViewerSelection | null) => void
  selectSketchPlane: (plane: SketchRecord["plane"]) => void
  redoSketchDraft: () => void
  setFeatureVisibility: (featureId: FeatureId, visible: boolean) => void
  setOriginPlaneVisibility: (plane: ViewerOriginPlane, visible: boolean) => void
  setSketchConstruction: (construction: boolean) => void
  setSketchDraft: (sketch: SketchRecord, mode?: SketchDraftChangeMode) => void
  setSketchEditorTool: (tool: SketchEditorTool) => void
  setSketchFailedConstraintIds: (constraintIds: readonly SketchConstraintId[]) => void
  setSketchProfiles: (profiles: readonly SketchProfileSelector[]) => void
  setSketchSelectedConstraintId: (constraintId: SketchConstraintId | null) => void
  setSketchSelectedEntityIds: (entityIds: readonly SketchEntityId[]) => void
  setSketchSelectedProfile: (profile: SketchProfileSelector | null) => void
  sketchSaved: (sketch: SketchRecord) => void
  switchWorkspace: (workspace: EditorWorkspaceName) => void
  undoSketchDraft: () => void
}>

type EditorWorkspaceProps = Readonly<{
  actions: EditorWorkspaceActions
  activeTool: ActivePartDesignTool | null
  activeSketchId: SketchId | null
  activeSketchTool: ActiveSketchTool | null
  controller: DocumentControllerState
  hiddenFeatureIds: readonly FeatureId[]
  originPlaneVisibility: ViewerOriginPlaneVisibility
  selection: ViewerSelection | null
  sketchConstruction: boolean
  sketchDraft: SketchRecord | null
  sketchEditorTool: SketchEditorTool
  sketchFailedConstraintIds: readonly SketchConstraintId[]
  sketchProfiles: readonly SketchProfileSelector[]
  sketchSelectedConstraintId: SketchConstraintId | null
  sketchSelectedEntityIds: readonly SketchEntityId[]
  sketchSelectedProfile: SketchProfileSelector | null
  workspace: EditorWorkspaceName
}>

function useEditorExtrusionPreview(
  controller: DocumentControllerState,
  activeTool: ActivePartDesignTool | null,
) {
  const [extrusionPreviewFeature, setExtrusionPreviewFeature] = useState<FeatureRecord | null>(null)
  const extrusionPreview = useExtrusionPreview(
    controller.report?.snapshot ?? null,
    extrusionPreviewCandidate(activeTool, extrusionPreviewFeature),
    committedGeometry(controller),
  )
  return { extrusionPreview, setExtrusionPreviewFeature }
}

function EditorModelTree({ props }: { props: EditorWorkspaceProps }) {
  const { actions, activeSketchId, activeSketchTool, activeTool, controller, workspace } = props
  return (
    <ModelTree
      activeWorkspace={workspace}
      activeFeatureId={activeFeatureId(activeTool)}
      activeSketchId={activeSketchId}
      controller={controller}
      hiddenFeatureIds={props.hiddenFeatureIds}
      onFeatureActivate={actions.editFeature}
      onFeatureRename={updateFeature}
      onFeatureVisibilityChange={actions.setFeatureVisibility}
      onSketchActivate={actions.editSketch}
      onSketchRename={updateSketch}
      onWorkspaceChange={actions.switchWorkspace}
      sketchRenameBlockedId={
        activeSketchTool?.kind === "edit-sketch" ? activeSketchTool.sketchId : null
      }
    />
  )
}

function EditorContent({
  extrusionPreview,
  props,
}: {
  extrusionPreview: ReturnType<typeof useExtrusionPreview>
  props: EditorWorkspaceProps
}) {
  const { actions, activeSketchId, activeSketchTool, controller, selection, workspace } = props
  const selectedSketch =
    controller.report?.snapshot.sketches.find(({ id }) => id === activeSketchId) ?? null
  return (
    <WorkspaceContent
      actions={{
        onSelectionChange: actions.select,
        onSketchDraftChange: actions.setSketchDraft,
        onSketchEditorToolChange: actions.setSketchEditorTool,
        onSketchFailedConstraintsChange: actions.setSketchFailedConstraintIds,
        onSketchPlaneSelect: actions.selectSketchPlane,
        onOriginPlaneVisibilityChange: actions.setOriginPlaneVisibility,
        onSketchProfileSelect: actions.setSketchSelectedProfile,
        onSketchProfilesChange: actions.setSketchProfiles,
        onSketchRedo: actions.redoSketchDraft,
        onSketchConstraintSelectionChange: actions.setSketchSelectedConstraintId,
        onSketchSelectionChange: actions.setSketchSelectedEntityIds,
        onSketchUndo: actions.undoSketchDraft,
      }}
      controller={controller}
      model={{
        extrusionPreview,
        hiddenFeatureIds: props.hiddenFeatureIds,
        originPlaneVisibility: props.originPlaneVisibility,
        selection,
      }}
      workspace={workspace}
      sketch={{
        activeTool: activeSketchTool,
        construction: props.sketchConstruction,
        draft: props.sketchDraft,
        editorTool: props.sketchEditorTool,
        selectedConstraintId: props.sketchSelectedConstraintId,
        selectedEntityIds: props.sketchSelectedEntityIds,
        selectedProfile: props.sketchSelectedProfile,
        selectedSketch,
      }}
    />
  )
}

function EditorTaskPanel({
  onExtrusionPreviewChange,
  props,
}: {
  onExtrusionPreviewChange: (feature: FeatureRecord | null) => void
  props: EditorWorkspaceProps
}) {
  const { actions } = props
  return (
    <TaskPanel
      activeSketchId={props.activeSketchId}
      activeSketchTool={props.activeSketchTool}
      activeTool={props.activeTool}
      controller={props.controller}
      workspace={props.workspace}
      onCloseTool={actions.closeTool}
      onCreateBox={actions.createBox}
      onCreateCylinder={actions.createCylinder}
      onCreateExtrusion={actions.createExtrusion}
      onCreateSketch={actions.createSketch}
      onCreateSubtract={actions.createSubtract}
      onEditSketch={actions.editSketch}
      onExtrusionPreviewChange={onExtrusionPreviewChange}
      sketchDraft={props.sketchDraft}
      sketchFailedConstraintIds={props.sketchFailedConstraintIds}
      sketchProfiles={props.sketchProfiles}
      sketchSelectedConstraintId={props.sketchSelectedConstraintId}
      sketchSelectedEntityIds={props.sketchSelectedEntityIds}
      sketchSelectedProfile={props.sketchSelectedProfile}
      onSketchDraftChange={actions.setSketchDraft}
      onSketchSelectedConstraintChange={actions.setSketchSelectedConstraintId}
      onSketchSelectedProfileChange={actions.setSketchSelectedProfile}
      onSketchSaved={actions.sketchSaved}
      onSketchPlaneSelect={actions.selectSketchPlane}
    />
  )
}

export function EditorWorkspace(props: EditorWorkspaceProps) {
  const { extrusionPreview, setExtrusionPreviewFeature } = useEditorExtrusionPreview(
    props.controller,
    props.activeTool,
  )
  return (
    <div className="cad-workspace-grid min-h-0">
      <EditorModelTree props={props} />
      <EditorContent extrusionPreview={extrusionPreview} props={props} />
      <EditorTaskPanel onExtrusionPreviewChange={setExtrusionPreviewFeature} props={props} />
    </div>
  )
}
