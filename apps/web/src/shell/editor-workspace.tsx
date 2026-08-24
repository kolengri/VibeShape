import type { SketchDisplayRecord } from "@vibeshape/application/sketch-display"
import { sketchFrame } from "@vibeshape/application/support-frame"
import type {
  FeatureId,
  FeatureRecord,
  SketchConstraintId,
  SketchEntityId,
  SketchId,
  SketchProfileSelector,
  SketchRecord,
} from "@vibeshape/domain"
import { useTranslations } from "@vibeshape/i18n"
import type {
  ViewerOriginPlane,
  ViewerOriginPlaneVisibility,
} from "@vibeshape/viewer/origin-planes"
import type {
  ViewerSelection,
  ViewerSketchReferenceCandidate,
} from "@vibeshape/viewer/three-viewport"
import { type ReactNode, useCallback, useMemo, useState } from "react"
import {
  type DocumentControllerState,
  removeSketch,
  resolveDocumentFeatureParameters,
  updateFeature,
  updateSketch,
} from "../document/document-controller"
import type { SketchCameraMode } from "../editor-session/editor-session-store"
import {
  type ActivePartDesignTool,
  activeFeatureId,
} from "../features/part-design/part-design-tool"
import { useFeaturePreview } from "../features/preview/use-feature-preview"
import {
  applyExternalSketchCandidate,
  type ExternalSketchGeometryCandidate,
  externalSketchGeometryCandidates,
} from "../features/sketch/external-sketch-points"
import type {
  ActiveSketchTool,
  SketchDraftChangeMode,
  SketchEditorTool,
} from "../features/sketch/sketch-tool"
import { SketchViewport } from "../features/sketch/sketch-viewport"
import { VariablesPanel } from "../features/variables/variables-panel"
import { GeometryViewport, type GeometryViewportSketchContext } from "./geometry-viewport"
import { ModelTree } from "./model-tree"
import { TaskPanel } from "./task-panel"
import type { EditorWorkspaceName } from "./workspace"

const EMPTY_GEOMETRY = [] as const

function committedGeometry(controller: DocumentControllerState) {
  const rebuild = controller.report?.rebuild
  return rebuild?.ok ? rebuild.response.geometry : EMPTY_GEOMETRY
}

const PREVIEWED_FEATURE_TOOL_KINDS: ReadonlySet<ActivePartDesignTool["kind"]> = new Set([
  "create-extrusion",
  "edit-extrusion",
  "create-datum-plane",
  "edit-datum-plane",
])

function isPreviewedFeatureToolActive(activeTool: ActivePartDesignTool | null) {
  return activeTool ? PREVIEWED_FEATURE_TOOL_KINDS.has(activeTool.kind) : false
}

function featurePreviewCandidate(
  activeTool: ActivePartDesignTool | null,
  candidate: FeatureRecord | null,
) {
  return isPreviewedFeatureToolActive(activeTool) ? candidate : null
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
    featurePreview: ReturnType<typeof useFeaturePreview>
    hiddenFeatureIds: readonly FeatureId[]
    hiddenSketchIds: readonly SketchId[]
    originPlaneVisibility: ViewerOriginPlaneVisibility
    preselectedFeatureId: FeatureId | null
    selectedFeatureId: FeatureId | null
    selection: ViewerSelection | null
  }>
  sketch: Readonly<{
    activeTool: ActiveSketchTool | null
    cameraMode: SketchCameraMode
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
  onDisplayChange,
  sketch,
  supportFeatures,
  externalPointCandidates,
}: Pick<WorkspaceContentProps, "actions" | "controller" | "model" | "sketch"> & {
  externalPointCandidates: readonly ExternalSketchGeometryCandidate[]
  onDisplayChange: (display: SketchDisplayRecord | null) => void
  supportFeatures: readonly FeatureRecord[]
}) {
  return (
    <SketchViewport
      state={{
        construction: sketch.construction,
        controller,
        draft: sketch.draft,
        editorTool: sketch.editorTool,
        externalPointCandidates,
        originPlaneVisibility: model.originPlaneVisibility,
        selectedConstraintId: sketch.selectedConstraintId,
        selectedEntityIds: sketch.selectedEntityIds,
        selectedProfile: sketch.selectedProfile,
        sketch: sketch.selectedSketch,
        supportFeatures,
      }}
      actions={{
        onDisplayChange,
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
      interactive={sketch.cameraMode === "normal"}
      overlay
    />
  )
}

function ModelingWorkspaceContent({
  actions,
  controller,
  model,
  sketch,
  sketchContext,
  activeSketchDisplay,
}: Pick<WorkspaceContentProps, "actions" | "controller" | "model" | "sketch"> & {
  activeSketchDisplay?: SketchDisplayRecord | null
  sketchContext?: GeometryViewportSketchContext
}) {
  return (
    <GeometryViewport
      controller={controller}
      featurePreview={model.featurePreview}
      hiddenFeatureIds={model.hiddenFeatureIds}
      hiddenSketchIds={model.hiddenSketchIds}
      originPlaneVisibility={{
        visibility: model.originPlaneVisibility,
        onChange: actions.onOriginPlaneVisibilityChange,
      }}
      preselectedFeatureId={model.preselectedFeatureId}
      selectedFeatureId={model.selectedFeatureId}
      selection={model.selection}
      onSelectionChange={actions.onSelectionChange}
      {...(activeSketchDisplay ? { activeSketchDisplay } : {})}
      {...(sketchContext ? { sketchContext } : {})}
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

export function ModelingSketchViewportStack({
  modeling,
  sketch,
  sketchActive,
}: Readonly<{
  modeling: ReactNode
  sketch: ReactNode
  sketchActive: boolean
}>) {
  return (
    <div className="relative grid min-h-0">
      {modeling}
      {sketchActive ? sketch : null}
    </div>
  )
}

function WorkspaceContent(props: WorkspaceContentProps) {
  const viewportT = useTranslations("app.shell.viewport")
  const [activeSketchDisplay, setActiveSketchDisplay] = useState<SketchDisplayRecord | null>(null)
  const snapshot = props.controller.report?.snapshot
  const supportFeatures = useMemo(
    () => (snapshot ? resolveDocumentFeatureParameters(snapshot) : EMPTY_GEOMETRY),
    [snapshot],
  )
  const frame = useMemo(
    () =>
      snapshot && props.sketch.draft
        ? sketchFrame(props.sketch.draft, snapshot, supportFeatures)
        : null,
    [
      props.sketch.draft?.id,
      props.sketch.draft?.plane,
      props.sketch.draft?.support,
      snapshot,
      supportFeatures,
    ],
  )
  const sketchActive = props.workspace === "sketch"
  const externalPointCandidates = useMemo(
    () =>
      snapshot && props.sketch.draft
        ? externalSketchGeometryCandidates(
            snapshot,
            props.sketch.draft,
            {
              line: (sketch, ordinal) => viewportT("externalLineCandidate", { sketch, ordinal }),
              point: (sketch, ordinal) => viewportT("externalPointCandidate", { sketch, ordinal }),
            },
            supportFeatures,
          )
        : [],
    [props.sketch.draft, snapshot, supportFeatures, viewportT],
  )
  const viewerPointCandidates = useMemo<readonly ViewerSketchReferenceCandidate[]>(
    () =>
      externalPointCandidates.map(
        (candidate): ViewerSketchReferenceCandidate =>
          candidate.kind === "line"
            ? {
                kind: "line",
                label: candidate.label,
                start: candidate.start.world,
                end: candidate.end.world,
                sourceLineId: candidate.sourceLineId,
                sourceSketchId: candidate.sourceSketchId,
              }
            : {
                kind: "point",
                label: candidate.label,
                position: candidate.world,
                sourcePointId: candidate.sourcePointId,
                sourceSketchId: candidate.sourceSketchId,
              },
      ),
    [externalPointCandidates],
  )
  const selectExternalPoint = useCallback(
    (hit: ViewerSketchReferenceCandidate) => {
      const draft = props.sketch.draft
      if (!draft) return
      const candidate = externalPointCandidates.find((item) => {
        if (item.sourceSketchId !== hit.sourceSketchId || item.kind !== hit.kind) return false
        return item.kind === "line"
          ? hit.kind === "line" && item.sourceLineId === hit.sourceLineId
          : hit.kind !== "line" && item.sourcePointId === hit.sourcePointId
      })
      if (!candidate) return
      const next = applyExternalSketchCandidate(draft, candidate, props.sketch.selectedEntityIds)
      if (next !== draft) props.actions.onSketchDraftChange(next)
    },
    [
      externalPointCandidates,
      props.actions.onSketchDraftChange,
      props.sketch.draft,
      props.sketch.selectedEntityIds,
    ],
  )
  const sketchContext = useMemo(
    () =>
      sketchActive
        ? {
            frame,
            mode: props.sketch.cameraMode,
            ...(props.sketch.editorTool === "use"
              ? {
                  referenceSelection: {
                    candidates: viewerPointCandidates,
                    onSelect: selectExternalPoint,
                  },
                }
              : {}),
          }
        : undefined,
    [
      frame,
      props.sketch.cameraMode,
      props.sketch.editorTool,
      selectExternalPoint,
      sketchActive,
      viewerPointCandidates,
    ],
  )
  if (props.workspace === "variables") {
    return <VariablesPanel controller={props.controller} />
  }
  return (
    <ModelingSketchViewportStack
      modeling={
        <ModelingWorkspaceContent
          actions={props.actions}
          controller={props.controller}
          model={props.model}
          sketch={props.sketch}
          {...(activeSketchDisplay ? { activeSketchDisplay } : {})}
          {...(sketchContext ? { sketchContext } : {})}
        />
      }
      sketch={
        <SketchWorkspaceContent
          actions={props.actions}
          controller={props.controller}
          model={props.model}
          onDisplayChange={setActiveSketchDisplay}
          sketch={props.sketch}
          supportFeatures={supportFeatures}
          externalPointCandidates={externalPointCandidates}
        />
      }
      sketchActive={sketchActive}
    />
  )
}

export type EditorWorkspaceActions = Readonly<{
  closeTool: () => void
  createBox: () => void
  createCylinder: () => void
  createDatumPlane: () => void
  createExtrusion: () => Promise<boolean>
  createSketch: () => void
  createSubtract: () => void
  editFeature: (featureId: FeatureId) => void
  editSketch: (sketchId: SketchId) => void
  preselectFeature: (featureId: FeatureId | null) => void
  select: (selection: ViewerSelection | null) => void
  selectSketchPlane: (plane: SketchRecord["plane"]) => void
  redoSketchDraft: () => void
  setFeatureVisibility: (featureId: FeatureId, visible: boolean) => void
  setOriginPlaneVisibility: (plane: ViewerOriginPlane, visible: boolean) => void
  setSketchVisibility: (sketchId: SketchId, visible: boolean) => void
  setSketchConstruction: (construction: boolean) => void
  setSketchDraft: (sketch: SketchRecord, mode?: SketchDraftChangeMode) => void
  setSketchEditorTool: (tool: SketchEditorTool) => void
  setSketchFailedConstraintIds: (constraintIds: readonly SketchConstraintId[]) => void
  setSketchProfiles: (profiles: readonly SketchProfileSelector[]) => void
  setSketchSelectedConstraintId: (constraintId: SketchConstraintId | null) => void
  setSketchSelectedEntityIds: (entityIds: readonly SketchEntityId[]) => void
  setSketchSelectedProfile: (profile: SketchProfileSelector | null) => void
  sketchSaved: (
    sketch: SketchRecord,
    presentation?: Readonly<{
      profiles: readonly SketchProfileSelector[]
      selectedProfile: SketchProfileSelector | null
    }>,
  ) => void
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
  hiddenSketchIds: readonly SketchId[]
  originPlaneVisibility: ViewerOriginPlaneVisibility
  preselectedFeatureId: FeatureId | null
  selection: ViewerSelection | null
  sketchConstruction: boolean
  sketchCameraMode: SketchCameraMode
  sketchDraft: SketchRecord | null
  sketchEditorTool: SketchEditorTool
  sketchFailedConstraintIds: readonly SketchConstraintId[]
  sketchProfiles: readonly SketchProfileSelector[]
  sketchSelectedConstraintId: SketchConstraintId | null
  sketchSelectedEntityIds: readonly SketchEntityId[]
  sketchSelectedProfile: SketchProfileSelector | null
  workspace: EditorWorkspaceName
}>

function useEditorFeaturePreview(
  controller: DocumentControllerState,
  activeTool: ActivePartDesignTool | null,
) {
  const [previewFeature, setPreviewFeature] = useState<FeatureRecord | null>(null)
  const featurePreview = useFeaturePreview(
    controller.report?.snapshot ?? null,
    featurePreviewCandidate(activeTool, previewFeature),
    committedGeometry(controller),
  )
  return { featurePreview, setPreviewFeature }
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
      hiddenSketchIds={props.hiddenSketchIds}
      onFeatureActivate={actions.editFeature}
      onFeatureRename={updateFeature}
      onFeaturePreselectionChange={actions.preselectFeature}
      onFeatureVisibilityChange={actions.setFeatureVisibility}
      onSketchActivate={actions.editSketch}
      onSketchDeleted={actions.closeTool}
      onSketchRemove={removeSketch}
      onSketchRename={updateSketch}
      onSketchVisibilityChange={actions.setSketchVisibility}
      onWorkspaceChange={actions.switchWorkspace}
      sketchRenameBlockedId={
        activeSketchTool?.kind === "edit-sketch" ? activeSketchTool.sketchId : null
      }
    />
  )
}

function EditorContent({
  featurePreview,
  props,
}: {
  featurePreview: ReturnType<typeof useFeaturePreview>
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
        featurePreview,
        hiddenFeatureIds: props.hiddenFeatureIds,
        hiddenSketchIds: props.hiddenSketchIds,
        originPlaneVisibility: props.originPlaneVisibility,
        preselectedFeatureId: props.preselectedFeatureId,
        selectedFeatureId: activeFeatureId(props.activeTool),
        selection,
      }}
      workspace={workspace}
      sketch={{
        activeTool: activeSketchTool,
        cameraMode: props.sketchCameraMode,
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
  onFeaturePreviewChange,
  props,
}: {
  onFeaturePreviewChange: (feature: FeatureRecord | null) => void
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
      onFeaturePreviewChange={onFeaturePreviewChange}
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
  const { featurePreview, setPreviewFeature } = useEditorFeaturePreview(
    props.controller,
    props.activeTool,
  )
  return (
    <div className="cad-workspace-grid min-h-0">
      <EditorModelTree props={props} />
      <EditorContent featurePreview={featurePreview} props={props} />
      <EditorTaskPanel onFeaturePreviewChange={setPreviewFeature} props={props} />
    </div>
  )
}
