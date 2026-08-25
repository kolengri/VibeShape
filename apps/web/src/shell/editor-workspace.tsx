import type { SketchDisplayRecord } from "@vibeshape/application/sketch-display"
import { sketchFrame } from "@vibeshape/application/support-frame"
import type {
  DocumentSnapshot,
  FeatureId,
  FeatureRecord,
  SketchConstraintId,
  SketchEntityId,
  SketchId,
  SketchProfileSelector,
  SketchRecord,
} from "@vibeshape/domain"
import { useTranslations } from "@vibeshape/i18n"
import type { SolvedSketchWire } from "@vibeshape/protocol"
import type {
  ViewerOriginPlane,
  ViewerOriginPlaneVisibility,
} from "@vibeshape/viewer/origin-planes"
import type {
  ViewerSelection,
  ViewerSketchReferenceCandidate,
} from "@vibeshape/viewer/three-viewport"
import { type ReactNode, useCallback, useEffect, useMemo, useState } from "react"
import {
  type DocumentControllerState,
  removeSketch,
  resolveDocumentFeatureParameters,
  solveActiveSketch,
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
  applyExternalModelCandidate,
  type ExternalModelGeometryCandidate,
  externalModelGeometryCandidates,
} from "../features/sketch/external-model-geometry"
import {
  applyExternalSketchCandidate,
  type ExternalSketchContextGeometry,
  type ExternalSketchGeometryCandidate,
  externalSketchContextGeometry,
} from "../features/sketch/external-sketch-points"
import {
  mergeSketchEditVisibility,
  sketchEditContextVisibility,
} from "../features/sketch/sketch-edit-context"
import type {
  ActiveSketchTool,
  SketchDraftChangeMode,
  SketchEditorTool,
} from "../features/sketch/sketch-tool"
import { SketchViewport } from "../features/sketch/sketch-viewport"
import { VariablesPanel } from "../features/variables/variables-panel"
import {
  GeometryViewport,
  type GeometryViewportSketchContext,
  viewerMeshes,
} from "./geometry-viewport"
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
  externalContextGeometry,
  externalModelCandidates,
  externalPointCandidates,
}: Pick<WorkspaceContentProps, "actions" | "controller" | "model" | "sketch"> & {
  externalModelCandidates: readonly ExternalModelGeometryCandidate[]
  externalPointCandidates: readonly ExternalSketchGeometryCandidate[]
  externalContextGeometry: readonly ExternalSketchContextGeometry[]
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
        externalContextGeometry,
        externalModelCandidates,
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
  editVisibility,
}: Pick<WorkspaceContentProps, "actions" | "controller" | "model" | "sketch"> & {
  activeSketchDisplay?: SketchDisplayRecord | null
  editVisibility: Readonly<{
    featureIds: readonly FeatureId[]
    sketchIds: readonly SketchId[]
  }>
  sketchContext?: GeometryViewportSketchContext
}) {
  const hiddenSketchIds = useMemo(
    () =>
      mergeSketchEditVisibility(
        { featureIds: [], sketchIds: model.hiddenSketchIds },
        editVisibility,
      ).sketchIds,
    [editVisibility, model.hiddenSketchIds],
  )
  return (
    <GeometryViewport
      controller={controller}
      featurePreview={model.featurePreview}
      contextualHiddenFeatureIds={editVisibility.featureIds}
      hiddenFeatureIds={model.hiddenFeatureIds}
      hiddenSketchIds={hiddenSketchIds}
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

function useExternalSketchSolutions(
  snapshot: DocumentSnapshot | undefined,
  draftId: SketchId | undefined,
  hiddenSketchIds: readonly SketchId[],
) {
  const [solutions, setSolutions] = useState<ReadonlyMap<SketchId, SolvedSketchWire>>(new Map())
  useEffect(() => {
    if (!snapshot || !draftId) {
      setSolutions(new Map())
      return
    }
    const draftIndex = snapshot.sketches.findIndex(({ id }) => id === draftId)
    const hidden = new Set(hiddenSketchIds)
    const sources = snapshot.sketches
      .slice(0, draftIndex >= 0 ? draftIndex : undefined)
      .filter(({ id }) => !hidden.has(id))
    let active = true
    void Promise.all(
      sources.map(async (source) => {
        const result = await solveActiveSketch(snapshot.revision, source.id)
        return result.ok ? ([source.id, result.response.solution] as const) : null
      }),
    ).then((entries) => {
      if (!active) return
      setSolutions(
        new Map(entries.filter((entry): entry is NonNullable<typeof entry> => entry !== null)),
      )
    })
    return () => {
      active = false
    }
  }, [draftId, hiddenSketchIds, snapshot])
  return solutions
}

function resolvedWorkspaceSketchFrame(
  snapshot: DocumentSnapshot | undefined,
  draft: SketchRecord | null,
  supportFeatures: readonly FeatureRecord[],
) {
  return snapshot && draft ? sketchFrame(draft, snapshot, supportFeatures) : null
}

function resolvedWorkspaceFeatures(snapshot: DocumentSnapshot | undefined) {
  return snapshot ? resolveDocumentFeatureParameters(snapshot) : EMPTY_GEOMETRY
}

function workspaceEditVisibility(
  snapshot: DocumentSnapshot | undefined,
  activeSketchId: SketchId | undefined,
  sketchActive: boolean,
) {
  return sketchActive && snapshot && activeSketchId
    ? sketchEditContextVisibility(snapshot, activeSketchId)
    : { featureIds: [], sketchIds: [] }
}

function useWorkspaceExternalGeometry(
  snapshot: DocumentSnapshot | undefined,
  draft: SketchRecord | null,
  hiddenSketchIds: readonly SketchId[],
  supportFeatures: readonly FeatureRecord[],
  solutions: ReadonlyMap<SketchId, SolvedSketchWire>,
) {
  const t = useTranslations("app.shell.viewport")
  return useMemo(() => {
    if (!snapshot || !draft) return []
    const hidden = new Set(hiddenSketchIds)
    return externalSketchContextGeometry(
      snapshot,
      draft,
      {
        curve: (sketch, kind, ordinal) =>
          t("externalCurveContext", {
            kind: kind === "elliptical-arc" ? "ellipticalArc" : kind,
            ordinal,
            sketch,
          }),
        line: (sketch, ordinal) => t("externalLineCandidate", { sketch, ordinal }),
        point: (sketch, ordinal) => t("externalPointCandidate", { sketch, ordinal }),
      },
      supportFeatures,
      solutions,
    ).filter(({ sourceSketchId }) => !hidden.has(sourceSketchId))
  }, [draft, hiddenSketchIds, snapshot, solutions, supportFeatures, t])
}

function usableExternalGeometryCandidates(
  geometry: readonly ExternalSketchContextGeometry[],
): readonly ExternalSketchGeometryCandidate[] {
  return geometry.filter(
    (item): item is ExternalSketchGeometryCandidate =>
      item.kind !== "curve" || item.projectedType !== null,
  )
}

function viewerReferenceCandidate(
  candidate: ExternalSketchGeometryCandidate,
): ViewerSketchReferenceCandidate {
  if (candidate.kind === "line") {
    return {
      kind: "line",
      label: candidate.label,
      start: candidate.start.world,
      end: candidate.end.world,
      sourceLineId: candidate.sourceLineId,
      sourceSketchId: candidate.sourceSketchId,
    }
  }
  if (candidate.kind === "curve") {
    return {
      kind: "curve",
      label: candidate.label,
      points: candidate.points.map(({ world }) => world),
      sourceEntityId: candidate.sourceEntityId,
      sourceSketchId: candidate.sourceSketchId,
      sourceType: candidate.sourceType,
    }
  }
  return {
    kind: "point",
    label: candidate.label,
    position: candidate.world,
    sourcePointId: candidate.sourcePointId,
    sourceSketchId: candidate.sourceSketchId,
  }
}

function viewerModelReferenceCandidate(
  candidate: ExternalModelGeometryCandidate,
): ViewerSketchReferenceCandidate {
  if (candidate.kind === "model-line") {
    return {
      candidateId: candidate.candidateId,
      end: candidate.end.world,
      featureId: candidate.featureId,
      kind: "model-line",
      label: candidate.label,
      start: candidate.start.world,
    }
  }
  return {
    candidateId: candidate.candidateId,
    featureId: candidate.featureId,
    kind: "model-point",
    label: candidate.label,
    position: candidate.position,
  }
}

function matchingExternalCandidate(
  candidates: readonly ExternalSketchGeometryCandidate[],
  hit: ViewerSketchReferenceCandidate,
) {
  if (hit.kind === "model-point" || hit.kind === "model-line") return undefined
  return candidates.find((candidate) => {
    if (candidate.sourceSketchId !== hit.sourceSketchId || candidate.kind !== hit.kind) return false
    if (candidate.kind === "line") {
      return hit.kind === "line" && candidate.sourceLineId === hit.sourceLineId
    }
    if (candidate.kind === "curve") {
      return hit.kind === "curve" && candidate.sourceEntityId === hit.sourceEntityId
    }
    return hit.kind === "point" && candidate.sourcePointId === hit.sourcePointId
  })
}

function useWorkspaceSketchContext(
  active: boolean,
  frame: ReturnType<typeof resolvedWorkspaceSketchFrame>,
  mode: SketchCameraMode,
  editorTool: SketchEditorTool,
  candidates: readonly ViewerSketchReferenceCandidate[],
  onSelect: (candidate: ViewerSketchReferenceCandidate) => void,
) {
  return useMemo<GeometryViewportSketchContext | undefined>(() => {
    if (!active) return undefined
    return {
      frame,
      mode,
      ...(editorTool === "use" ? { referenceSelection: { candidates, onSelect } } : {}),
    }
  }, [active, candidates, editorTool, frame, mode, onSelect])
}

function useSelectExternalGeometry(
  sketchCandidates: readonly ExternalSketchGeometryCandidate[],
  modelCandidates: readonly ExternalModelGeometryCandidate[],
  draft: SketchRecord | null,
  selectedEntityIds: readonly SketchEntityId[],
  onDraftChange: (draft: SketchRecord) => void,
) {
  return useCallback(
    (hit: ViewerSketchReferenceCandidate) => {
      if (!draft) return
      const modelCandidate = modelCandidates.find(
        (candidate) =>
          candidate.kind === hit.kind &&
          (hit.kind === "model-point" || hit.kind === "model-line") &&
          candidate.featureId === hit.featureId &&
          candidate.candidateId === hit.candidateId,
      )
      const sketchCandidate = matchingExternalCandidate(sketchCandidates, hit)
      const next = modelCandidate
        ? applyExternalModelCandidate(draft, modelCandidate, selectedEntityIds)
        : sketchCandidate
          ? applyExternalSketchCandidate(draft, sketchCandidate, selectedEntityIds)
          : draft
      if (next !== draft) onDraftChange(next)
    },
    [draft, modelCandidates, onDraftChange, selectedEntityIds, sketchCandidates],
  )
}

function WorkspaceContentView({
  activeSketchDisplay,
  editVisibility,
  externalContextGeometry,
  externalModelCandidates,
  externalPointCandidates,
  props,
  sketchActive,
  sketchContext,
  supportFeatures,
  onDisplayChange,
}: Readonly<{
  activeSketchDisplay: SketchDisplayRecord | null
  editVisibility: Readonly<{ featureIds: readonly FeatureId[]; sketchIds: readonly SketchId[] }>
  externalContextGeometry: readonly ExternalSketchContextGeometry[]
  externalModelCandidates: readonly ExternalModelGeometryCandidate[]
  externalPointCandidates: readonly ExternalSketchGeometryCandidate[]
  props: WorkspaceContentProps
  sketchActive: boolean
  sketchContext: GeometryViewportSketchContext | undefined
  supportFeatures: readonly FeatureRecord[]
  onDisplayChange: (display: SketchDisplayRecord | null) => void
}>) {
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
          editVisibility={editVisibility}
          {...(activeSketchDisplay ? { activeSketchDisplay } : {})}
          {...(sketchContext ? { sketchContext } : {})}
        />
      }
      sketch={
        <SketchWorkspaceContent
          actions={props.actions}
          controller={props.controller}
          model={props.model}
          onDisplayChange={onDisplayChange}
          sketch={props.sketch}
          supportFeatures={supportFeatures}
          externalContextGeometry={externalContextGeometry}
          externalModelCandidates={externalModelCandidates}
          externalPointCandidates={externalPointCandidates}
        />
      }
      sketchActive={sketchActive}
    />
  )
}

function WorkspaceContent(props: WorkspaceContentProps) {
  const [activeSketchDisplay, setActiveSketchDisplay] = useState<SketchDisplayRecord | null>(null)
  const snapshot = props.controller.report?.snapshot
  const supportFeatures = useMemo(() => resolvedWorkspaceFeatures(snapshot), [snapshot])
  const externalSketchSolutions = useExternalSketchSolutions(
    snapshot,
    props.sketch.draft?.id,
    props.model.hiddenSketchIds,
  )
  const frame = useMemo(
    () => resolvedWorkspaceSketchFrame(snapshot, props.sketch.draft, supportFeatures),
    [
      props.sketch.draft?.id,
      props.sketch.draft?.plane,
      props.sketch.draft?.support,
      snapshot,
      supportFeatures,
    ],
  )
  const sketchActive = props.workspace === "sketch"
  const activeSketchId = props.sketch.draft?.id
  const editVisibility = useMemo(
    () => workspaceEditVisibility(snapshot, activeSketchId, sketchActive),
    [activeSketchId, sketchActive, snapshot],
  )
  const externalContextGeometry = useWorkspaceExternalGeometry(
    snapshot,
    props.sketch.draft,
    props.model.hiddenSketchIds,
    supportFeatures,
    externalSketchSolutions,
  )
  const externalPointCandidates = useMemo(
    () => usableExternalGeometryCandidates(externalContextGeometry),
    [externalContextGeometry],
  )
  const visibleModelFeatureIds = useMemo(
    () =>
      viewerMeshes(props.controller, props.model.hiddenFeatureIds, editVisibility.featureIds)
        .filter(({ appearance }) => appearance !== "datum")
        .map(({ featureId }) => featureId as FeatureId),
    [editVisibility.featureIds, props.controller, props.model.hiddenFeatureIds],
  )
  const t = useTranslations("app.shell.viewport")
  const externalModelCandidates = useMemo(() => {
    const rebuild = props.controller.report?.rebuild
    if (!snapshot || !props.sketch.draft || !frame || !rebuild?.ok) return []
    return externalModelGeometryCandidates(
      rebuild.response.geometry,
      snapshot.features,
      visibleModelFeatureIds,
      props.sketch.draft,
      frame,
      {
        line: (feature, ordinal) => t("externalModelLineCandidate", { feature, ordinal }),
        point: (feature, ordinal) => t("externalModelPointCandidate", { feature, ordinal }),
      },
    )
  }, [
    frame,
    props.controller.report?.rebuild,
    props.sketch.draft,
    snapshot,
    t,
    visibleModelFeatureIds,
  ])
  const viewerPointCandidates = useMemo<readonly ViewerSketchReferenceCandidate[]>(
    () => [
      ...externalPointCandidates.map(viewerReferenceCandidate),
      ...externalModelCandidates.map(viewerModelReferenceCandidate),
    ],
    [externalModelCandidates, externalPointCandidates],
  )
  const selectExternalPoint = useSelectExternalGeometry(
    externalPointCandidates,
    externalModelCandidates,
    props.sketch.draft,
    props.sketch.selectedEntityIds,
    props.actions.onSketchDraftChange,
  )
  const sketchContext = useWorkspaceSketchContext(
    sketchActive,
    frame,
    props.sketch.cameraMode,
    props.sketch.editorTool,
    viewerPointCandidates,
    selectExternalPoint,
  )
  return (
    <WorkspaceContentView
      activeSketchDisplay={activeSketchDisplay}
      editVisibility={editVisibility}
      externalContextGeometry={externalContextGeometry}
      externalModelCandidates={externalModelCandidates}
      externalPointCandidates={externalPointCandidates}
      props={props}
      sketchActive={sketchActive}
      sketchContext={sketchContext}
      supportFeatures={supportFeatures}
      onDisplayChange={setActiveSketchDisplay}
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
