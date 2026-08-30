import type { SketchDisplayRecord } from "@vibeshape/application/sketch-display"
import {
  type SupportFrame,
  type SupportFrameGeometryRecord,
  sketchFrame,
} from "@vibeshape/application/support-frame"
import type {
  DocumentSnapshot,
  FeatureId,
  FeatureRecord,
  SketchConstraintId,
  SketchEntityId,
  SketchExternalReferenceId,
  SketchId,
  SketchProfileSelector,
  SketchRecord,
} from "@vibeshape/domain"
import { useTranslations } from "@vibeshape/i18n"
import type { SolvedSketchWire } from "@vibeshape/protocol"
import { Button } from "@vibeshape/ui/components/button"
import { Eye, EyeOff } from "@vibeshape/ui/components/icons"
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
  applyExternalModelCandidateSelection,
  applyExternalModelIntersection,
  availableExternalModelGeometryCandidates,
  type ExternalModelGeometryCandidate,
  externalModelCurveLabelKind,
  planarFaceCanIntersectSketch,
  projectExternalModelGeometryCandidates,
  repairExternalModelGeometryCandidates,
} from "../features/sketch/external-model-geometry"
import {
  applyExternalSketchCandidateSelection,
  applyExternalSketchPierceCandidate,
  availableExternalSketchGeometryCandidates,
  availableExternalSketchPierceCandidates,
  type ExternalSketchContextGeometry,
  type ExternalSketchGeometryCandidate,
  type ExternalSketchPierceCandidate,
  earlierSketchesForDraft,
  externalSketchContextGeometry,
  externalSketchPierceCandidates,
} from "../features/sketch/external-sketch-points"
import {
  mergeSketchEditVisibility,
  type SketchEditContextVisibility,
  sketchEditContextVisibility,
} from "../features/sketch/sketch-edit-context"
import {
  SketchProjectionProvider,
  useSketchProjectionStoreApi,
} from "../features/sketch/sketch-projection-store"
import { selectedPlanarFaceReferenceFromController } from "../features/sketch/sketch-support"
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
  "create-revolve",
  "edit-revolve",
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
    onOriginPlaneSelect: (plane: ViewerOriginPlane | null) => void
    onSketchProfileSelect: (profile: SketchProfileSelector) => void
    onSketchProfilesChange: (profiles: readonly SketchProfileSelector[]) => void
    onSketchReferenceDimensionLabelsChange: (labels: Readonly<Record<string, string>>) => void
    onSketchRedo: () => void
    onSketchConstraintSelectionChange: (constraintId: SketchConstraintId | null) => void
    onSketchSelectionChange: (entityIds: readonly SketchEntityId[]) => void
    onSketchFinalContextChange: (visible: boolean) => void
    onSketchUndo: () => void
  }>
  controller: DocumentControllerState
  model: Readonly<{
    featurePreview: ReturnType<typeof useFeaturePreview>
    hiddenFeatureIds: readonly FeatureId[]
    hiddenSketchIds: readonly SketchId[]
    idleOriginPlaneSelectionAvailable: boolean
    originPlaneVisibility: ViewerOriginPlaneVisibility
    preselectedFeatureId: FeatureId | null
    selectedOriginPlane: ViewerOriginPlane | null
    selectedFeatureId: FeatureId | null
    selection: ViewerSelection | null
  }>
  sketch: Readonly<{
    activeTool: ActiveSketchTool | null
    cameraMode: SketchCameraMode
    construction: boolean
    draft: SketchRecord | null
    editorTool: SketchEditorTool
    repairReferenceId: SketchExternalReferenceId | null
    selectedConstraintId: SketchConstraintId | null
    selectedEntityIds: readonly SketchEntityId[]
    selectedProfile: SketchProfileSelector | null
    selectedSketch: SketchRecord | null
    showFinalContext: boolean
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
  pierceCandidates,
  frame,
}: Pick<WorkspaceContentProps, "actions" | "controller" | "model" | "sketch"> & {
  externalModelCandidates: readonly ExternalModelGeometryCandidate[]
  externalPointCandidates: readonly ExternalSketchGeometryCandidate[]
  pierceCandidates: readonly ExternalSketchPierceCandidate[]
  externalContextGeometry: readonly ExternalSketchContextGeometry[]
  onDisplayChange: (display: SketchDisplayRecord | null) => void
  supportFeatures: readonly FeatureRecord[]
  frame: ReturnType<typeof resolvedWorkspaceSketchFrame>
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
        pierceCandidateCount: pierceCandidates.length,
        originPlaneVisibility: model.originPlaneVisibility,
        repairReferenceId: sketch.repairReferenceId,
        selectedConstraintId: sketch.selectedConstraintId,
        selectedEntityIds: sketch.selectedEntityIds,
        selectedProfile: sketch.selectedProfile,
        sketch: sketch.selectedSketch,
        supportFeatures,
        projectionFrame: frame,
      }}
      actions={{
        onDisplayChange,
        onDraftChange: actions.onSketchDraftChange,
        onEditorToolChange: actions.onSketchEditorToolChange,
        onFailedConstraintsChange: actions.onSketchFailedConstraintsChange,
        onOriginPlaneVisibilityChange: actions.onOriginPlaneVisibilityChange,
        onProfileSelect: actions.onSketchProfileSelect,
        onProfilesChange: actions.onSketchProfilesChange,
        onReferenceDimensionLabelsChange: actions.onSketchReferenceDimensionLabelsChange,
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

function idleOriginPlaneSelection(
  model: WorkspaceContentProps["model"],
  sketch: WorkspaceContentProps["sketch"],
  actions: WorkspaceContentProps["actions"],
) {
  if (sketch.activeTool || !model.idleOriginPlaneSelectionAvailable) return undefined
  return {
    selectedPlane: model.selectedOriginPlane,
    onSelect: actions.onOriginPlaneSelect,
  }
}

function ModelingWorkspaceContent({
  actions,
  controller,
  externalContextGeometry,
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
  externalContextGeometry: readonly ExternalSketchContextGeometry[]
  sketchContext?: GeometryViewportSketchContext
}) {
  const projectedSketchIds = useMemo(
    () =>
      sketch.cameraMode === "normal"
        ? [...new Set(externalContextGeometry.map(({ sourceSketchId }) => sourceSketchId))]
        : [],
    [externalContextGeometry, sketch.cameraMode],
  )
  const hiddenSketchIds = useMemo(
    () =>
      mergeSketchEditVisibility(
        {
          featureIds: [],
          sketchIds: [...model.hiddenSketchIds, ...projectedSketchIds],
        },
        editVisibility,
      ).sketchIds,
    [editVisibility, model.hiddenSketchIds, projectedSketchIds],
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
      idleOriginPlaneSelection={idleOriginPlaneSelection(model, sketch, actions)}
      selectedFeatureId={model.selectedFeatureId}
      selection={model.selection}
      onSelectionChange={actions.onSelectionChange}
      {...(activeSketchDisplay ? { activeSketchDisplay } : {})}
      {...(sketchContext ? { sketchContext } : {})}
      {...(sketch.activeTool?.kind === "select-sketch-plane" && sketch.draft
        ? {
            originPlaneSelection: {
              mode: sketch.activeTool.returnTo ? "replace" : "create",
              selectedPlane: sketch.draft.support ? null : sketch.draft.plane,
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
  status,
}: Readonly<{
  modeling: ReactNode
  sketch: ReactNode
  sketchActive: boolean
  status?: ReactNode
}>) {
  return (
    <div className="relative grid min-h-0">
      {modeling}
      {sketchActive ? sketch : null}
      {sketchActive ? status : null}
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
    const hidden = new Set(hiddenSketchIds)
    const sources = earlierSketchesForDraft(snapshot, draftId).filter(({ id }) => !hidden.has(id))
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
  geometry: readonly SupportFrameGeometryRecord[],
) {
  return snapshot && draft
    ? sketchFrame(draft, snapshot, supportFeatures, new Set(), geometry)
    : null
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

function workspaceDisplayVisibility(
  rollbackVisibility: Readonly<{
    featureIds: readonly FeatureId[]
    sketchIds: readonly SketchId[]
  }>,
  activeSketchId: SketchId | undefined,
  showFinalContext: boolean,
) {
  if (!showFinalContext || !activeSketchId) return rollbackVisibility
  return { featureIds: [], sketchIds: [activeSketchId] }
}

function shouldOfferSketchFinalContext({
  finalModelAvailable,
  rollbackFeatureCount,
  rollbackModelCount,
  showFinalContext,
}: Readonly<{
  finalModelAvailable: boolean
  rollbackFeatureCount: number
  rollbackModelCount: number
  showFinalContext: boolean
}>) {
  return (
    !showFinalContext && finalModelAvailable && rollbackFeatureCount > 0 && rollbackModelCount === 0
  )
}

function useWorkspaceExternalGeometry(
  snapshot: DocumentSnapshot | undefined,
  draft: SketchRecord | null,
  hiddenSketchIds: readonly SketchId[],
  supportFeatures: readonly FeatureRecord[],
  solutions: ReadonlyMap<SketchId, SolvedSketchWire>,
  geometry: readonly SupportFrameGeometryRecord[],
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
      geometry,
    ).filter(({ sourceSketchId }) => !hidden.has(sourceSketchId))
  }, [draft, geometry, hiddenSketchIds, snapshot, solutions, supportFeatures, t])
}

function useWorkspacePierceCandidates(
  snapshot: DocumentSnapshot | undefined,
  draft: SketchRecord | null,
  hiddenSketchIds: readonly SketchId[],
  supportFeatures: readonly FeatureRecord[],
  solutions: ReadonlyMap<SketchId, SolvedSketchWire>,
  geometry: readonly SupportFrameGeometryRecord[],
) {
  const t = useTranslations("app.shell.viewport")
  return useMemo(() => {
    if (!snapshot || !draft) return []
    const hidden = new Set(hiddenSketchIds)
    return externalSketchPierceCandidates(
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
      geometry,
    ).filter(({ sourceSketchId }) => !hidden.has(sourceSketchId))
  }, [draft, geometry, hiddenSketchIds, snapshot, solutions, supportFeatures, t])
}

function usableExternalGeometryCandidates(
  geometry: readonly ExternalSketchContextGeometry[],
): readonly ExternalSketchGeometryCandidate[] {
  return geometry.filter(
    (item): item is ExternalSketchGeometryCandidate =>
      item.kind !== "curve" || item.projectedType !== null,
  )
}

function sketchEditContextActive(
  workspace: EditorWorkspaceName,
  activeTool: ActiveSketchTool | null,
) {
  if (workspace === "sketch") return true
  return (
    activeTool?.kind === "select-sketch-plane" && activeTool.returnTo?.tool.kind === "edit-sketch"
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
  if (candidate.kind === "model-curve") {
    return {
      candidateId: candidate.candidateId,
      featureId: candidate.featureId,
      kind: "model-curve",
      label: candidate.label,
      points: candidate.points.map(({ world }) => world),
      sourceType: candidate.sourceType,
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
  if (hit.kind === "model-point" || hit.kind === "model-line" || hit.kind === "model-curve") {
    return undefined
  }
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
  useCandidates: readonly ViewerSketchReferenceCandidate[],
  onUseSelect: (candidate: ViewerSketchReferenceCandidate) => void,
  pierceCandidates: readonly ViewerSketchReferenceCandidate[],
  onPierceSelect: (candidate: ViewerSketchReferenceCandidate) => void,
  onIntersectionSelect: (selection: ViewerSelection) => void,
  projectionStore: ReturnType<typeof useSketchProjectionStoreApi>,
) {
  return useMemo<GeometryViewportSketchContext | undefined>(() => {
    if (!active) return undefined
    return {
      frame,
      mode,
      ...(projectionStore ? { projectionStore } : {}),
      ...(editorTool === "use"
        ? {
            referenceSelection: {
              candidates: useCandidates,
              onSelect: onUseSelect,
              purpose: "use",
            },
          }
        : {}),
      ...(editorTool === "pierce"
        ? {
            referenceSelection: {
              candidates: pierceCandidates,
              onSelect: onPierceSelect,
              purpose: "pierce",
            },
          }
        : {}),
      ...(editorTool === "intersection"
        ? { faceIntersectionSelection: { onSelect: onIntersectionSelect } }
        : {}),
    }
  }, [
    active,
    editorTool,
    frame,
    mode,
    onIntersectionSelect,
    onPierceSelect,
    onUseSelect,
    pierceCandidates,
    projectionStore,
    useCandidates,
  ])
}

function useSelectModelIntersection(
  controller: DocumentControllerState,
  draft: SketchRecord | null,
  targetFrame: SupportFrame | null,
  onDraftChange: (draft: SketchRecord) => void,
  onEditorToolChange: (tool: SketchEditorTool) => void,
) {
  return useCallback(
    (selection: ViewerSelection) => {
      if (!draft || !targetFrame) return
      const reference = selectedPlanarFaceReferenceFromController(controller, selection)
      if (!reference || !planarFaceCanIntersectSketch(reference, targetFrame)) return
      onDraftChange(applyExternalModelIntersection(draft, reference))
      onEditorToolChange("select")
    },
    [controller, draft, onDraftChange, onEditorToolChange, targetFrame],
  )
}

function useSelectExternalGeometry(
  sketchCandidates: readonly ExternalSketchGeometryCandidate[],
  modelCandidates: readonly ExternalModelGeometryCandidate[],
  draft: SketchRecord | null,
  selectedEntityIds: readonly SketchEntityId[],
  onDraftChange: (draft: SketchRecord) => void,
  onEditorToolChange: (tool: SketchEditorTool) => void,
  repairReferenceId: SketchExternalReferenceId | null,
) {
  return useCallback(
    (hit: ViewerSketchReferenceCandidate) => {
      if (!draft) return
      const modelCandidate = modelCandidates.find(
        (candidate) =>
          candidate.kind === hit.kind &&
          (hit.kind === "model-point" || hit.kind === "model-line" || hit.kind === "model-curve") &&
          candidate.featureId === hit.featureId &&
          candidate.candidateId === hit.candidateId,
      )
      const sketchCandidate = matchingExternalCandidate(sketchCandidates, hit)
      const next = modelCandidate
        ? applyExternalModelCandidateSelection(
            draft,
            modelCandidate,
            selectedEntityIds,
            repairReferenceId,
          )
        : sketchCandidate
          ? applyExternalSketchCandidateSelection(
              draft,
              sketchCandidate,
              selectedEntityIds,
              repairReferenceId,
            )
          : draft
      if (next !== draft) {
        onDraftChange(next)
        if (repairReferenceId) onEditorToolChange("select")
      }
    },
    [
      draft,
      modelCandidates,
      onDraftChange,
      onEditorToolChange,
      repairReferenceId,
      selectedEntityIds,
      sketchCandidates,
    ],
  )
}

function useSelectPierce(
  candidates: readonly ExternalSketchPierceCandidate[],
  draft: SketchRecord | null,
  selectedEntityIds: readonly SketchEntityId[],
  onDraftChange: (draft: SketchRecord) => void,
  onEditorToolChange: (tool: SketchEditorTool) => void,
  repairReferenceId: SketchExternalReferenceId | null,
) {
  return useCallback(
    (hit: ViewerSketchReferenceCandidate) => {
      if (!draft || hit.kind !== "line") return
      const candidate = candidates.find(
        (value) =>
          value.sourceSketchId === hit.sourceSketchId && value.sourceLineId === hit.sourceLineId,
      )
      if (!candidate) return
      const next = repairReferenceId
        ? applyExternalSketchCandidateSelection(
            draft,
            candidate,
            selectedEntityIds,
            repairReferenceId,
          )
        : applyExternalSketchPierceCandidate(draft, candidate, selectedEntityIds)
      if (next === draft) return
      onDraftChange(next)
      onEditorToolChange("select")
    },
    [candidates, draft, onDraftChange, onEditorToolChange, repairReferenceId, selectedEntityIds],
  )
}

function SketchContextStatus({
  offerFinalContext,
  showFinalContext,
  onFinalContextChange,
}: Readonly<{
  offerFinalContext: boolean
  showFinalContext: boolean
  onFinalContextChange: (visible: boolean) => void
}>) {
  const t = useTranslations("app.shell.viewport")
  if (!showFinalContext && !offerFinalContext) return null
  return (
    <div
      className={
        showFinalContext
          ? "absolute right-3 top-3 z-30 flex items-center gap-2 rounded-md border border-border/80 bg-background/90 px-2.5 py-1.5 text-xs shadow-sm backdrop-blur"
          : "absolute bottom-3 left-1/2 z-30 flex max-w-[min(32rem,calc(100%-1.5rem))] -translate-x-1/2 items-center gap-3 rounded-md border border-border/80 bg-background/90 px-3 py-2 text-xs shadow-sm backdrop-blur"
      }
      data-testid={showFinalContext ? "sketch-final-context-status" : "sketch-rollback-guidance"}
    >
      <span className="text-muted-foreground" role="status">
        {showFinalContext ? (
          <>
            <span className="font-medium text-foreground">{t("finalContextLabel")}</span>
            <span aria-hidden="true"> · </span>
            {t("finalContextDisplayOnly")}
          </>
        ) : (
          t("rollbackContextUnavailable")
        )}
      </span>
      <Button
        className="h-7 shrink-0 gap-1.5 px-2.5 text-xs"
        size="sm"
        type="button"
        variant="secondary"
        onClick={() => onFinalContextChange(!showFinalContext)}
      >
        {showFinalContext ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
        {showFinalContext ? t("hideFinalContext") : t("showFinalContext")}
      </Button>
    </div>
  )
}

function WorkspaceContentView({
  activeSketchDisplay,
  editVisibility,
  externalContextGeometry,
  externalModelCandidates,
  externalPointCandidates,
  pierceCandidates,
  frame,
  props,
  sketchActive,
  sketchContext,
  supportFeatures,
  onDisplayChange,
  offerFinalContext,
  showFinalContext,
}: Readonly<{
  activeSketchDisplay: SketchDisplayRecord | null
  editVisibility: Readonly<{ featureIds: readonly FeatureId[]; sketchIds: readonly SketchId[] }>
  externalContextGeometry: readonly ExternalSketchContextGeometry[]
  externalModelCandidates: readonly ExternalModelGeometryCandidate[]
  externalPointCandidates: readonly ExternalSketchGeometryCandidate[]
  pierceCandidates: readonly ExternalSketchPierceCandidate[]
  props: WorkspaceContentProps
  sketchActive: boolean
  sketchContext: GeometryViewportSketchContext | undefined
  supportFeatures: readonly FeatureRecord[]
  frame: ReturnType<typeof resolvedWorkspaceSketchFrame>
  onDisplayChange: (display: SketchDisplayRecord | null) => void
  offerFinalContext: boolean
  showFinalContext: boolean
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
          externalContextGeometry={externalContextGeometry}
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
          frame={frame}
          supportFeatures={supportFeatures}
          externalContextGeometry={externalContextGeometry}
          externalModelCandidates={externalModelCandidates}
          externalPointCandidates={externalPointCandidates}
          pierceCandidates={pierceCandidates}
        />
      }
      sketchActive={sketchActive}
      status={
        <SketchContextStatus
          offerFinalContext={offerFinalContext}
          showFinalContext={showFinalContext}
          onFinalContextChange={props.actions.onSketchFinalContextChange}
        />
      }
    />
  )
}

function useProjectedWorkspaceModelCandidates(
  controller: DocumentControllerState,
  snapshot: DocumentSnapshot | undefined,
  frame: SupportFrame | null,
  visibleModelFeatureIds: readonly FeatureId[],
) {
  const t = useTranslations("app.shell.viewport")
  return useMemo(() => {
    const rebuild = controller.report?.rebuild
    if (!snapshot || !frame || !rebuild?.ok) return []
    return projectExternalModelGeometryCandidates(
      rebuild.response.geometry,
      snapshot.features,
      visibleModelFeatureIds,
      frame,
      {
        curve: (feature, kind, ordinal) =>
          t("externalModelCurveCandidate", {
            feature,
            kind: externalModelCurveLabelKind(kind),
            ordinal,
          }),
        line: (feature, ordinal) => t("externalModelLineCandidate", { feature, ordinal }),
        point: (feature, ordinal) => t("externalModelPointCandidate", { feature, ordinal }),
      },
    )
  }, [controller.report?.rebuild, frame, snapshot, t, visibleModelFeatureIds])
}

function useAvailableWorkspaceModelCandidates(
  controller: DocumentControllerState,
  draft: SketchRecord | null,
  projectedCandidates: readonly ExternalModelGeometryCandidate[],
  repairReferenceId: SketchExternalReferenceId | null,
) {
  return useMemo(() => {
    const rebuild = controller.report?.rebuild
    if (!draft || !rebuild?.ok) return []
    return repairExternalModelGeometryCandidates(
      availableExternalModelGeometryCandidates(
        projectedCandidates,
        rebuild.response.geometry,
        draft,
      ),
      draft,
      repairReferenceId,
    )
  }, [controller.report?.rebuild, draft, projectedCandidates, repairReferenceId])
}

function useWorkspaceSketchGeometry(props: WorkspaceContentProps) {
  const snapshot = props.controller.report?.snapshot
  const supportFeatures = useMemo(() => resolvedWorkspaceFeatures(snapshot), [snapshot])
  const geometry = committedGeometry(props.controller)
  const externalSketchSolutions = useExternalSketchSolutions(
    snapshot,
    props.sketch.draft?.id,
    props.model.hiddenSketchIds,
  )
  const frame = useMemo(
    () => resolvedWorkspaceSketchFrame(snapshot, props.sketch.draft, supportFeatures, geometry),
    [
      props.sketch.draft?.id,
      props.sketch.draft?.plane,
      props.sketch.draft?.support,
      snapshot,
      supportFeatures,
      geometry,
    ],
  )
  const sketchActive = props.workspace === "sketch"
  const editContextActive = sketchEditContextActive(props.workspace, props.sketch.activeTool)
  const activeSketchId = props.sketch.draft?.id
  const rollbackVisibility = useMemo(
    () => workspaceEditVisibility(snapshot, activeSketchId, editContextActive),
    [activeSketchId, editContextActive, snapshot],
  )
  const displayVisibility = useMemo(
    () =>
      workspaceDisplayVisibility(rollbackVisibility, activeSketchId, props.sketch.showFinalContext),
    [activeSketchId, props.sketch.showFinalContext, rollbackVisibility],
  )
  const externalContextGeometry = useWorkspaceExternalGeometry(
    snapshot,
    props.sketch.draft,
    props.model.hiddenSketchIds,
    supportFeatures,
    externalSketchSolutions,
    geometry,
  )
  const externalPointCandidates = useMemo(
    () => usableExternalGeometryCandidates(externalContextGeometry),
    [externalContextGeometry],
  )
  const pierceCandidates = useWorkspacePierceCandidates(
    snapshot,
    props.sketch.draft,
    props.model.hiddenSketchIds,
    supportFeatures,
    externalSketchSolutions,
    geometry,
  )
  return {
    displayVisibility,
    externalContextGeometry,
    externalPointCandidates,
    frame,
    pierceCandidates,
    rollbackVisibility,
    sketchActive,
    snapshot,
    supportFeatures,
  }
}

function useWorkspaceModelGeometry({
  frame,
  props,
  rollbackVisibility,
  snapshot,
}: Readonly<{
  frame: SupportFrame | null
  props: WorkspaceContentProps
  rollbackVisibility: SketchEditContextVisibility
  snapshot: DocumentSnapshot | undefined
}>) {
  const visibleModelFeatureIds = useMemo(
    () =>
      viewerMeshes(props.controller, props.model.hiddenFeatureIds, rollbackVisibility.featureIds)
        .filter(({ appearance }) => appearance !== "datum")
        .map(({ featureId }) => featureId as FeatureId),
    [props.controller, props.model.hiddenFeatureIds, rollbackVisibility.featureIds],
  )
  const finalModelAvailable = useMemo(
    () =>
      viewerMeshes(props.controller, props.model.hiddenFeatureIds).some(
        ({ appearance }) => appearance !== "datum",
      ),
    [props.controller, props.model.hiddenFeatureIds],
  )
  const projectedCandidates = useProjectedWorkspaceModelCandidates(
    props.controller,
    snapshot,
    frame,
    visibleModelFeatureIds,
  )
  return {
    externalModelCandidates: useAvailableWorkspaceModelCandidates(
      props.controller,
      props.sketch.draft,
      projectedCandidates,
      props.sketch.repairReferenceId,
    ),
    offerFinalContext: shouldOfferSketchFinalContext({
      finalModelAvailable,
      rollbackFeatureCount: rollbackVisibility.featureIds.length,
      rollbackModelCount: visibleModelFeatureIds.length,
      showFinalContext: props.sketch.showFinalContext,
    }),
  }
}

function useWorkspaceReferenceSelection({
  externalModelCandidates,
  externalPointCandidates,
  pierceCandidates,
  frame,
  props,
  sketchActive,
}: Readonly<{
  externalModelCandidates: readonly ExternalModelGeometryCandidate[]
  externalPointCandidates: readonly ExternalSketchGeometryCandidate[]
  pierceCandidates: readonly ExternalSketchPierceCandidate[]
  frame: SupportFrame | null
  props: WorkspaceContentProps
  sketchActive: boolean
}>) {
  const projectionStore = useSketchProjectionStoreApi()
  const viewerPointCandidates = useMemo<readonly ViewerSketchReferenceCandidate[]>(
    () => [
      ...externalPointCandidates.map(viewerReferenceCandidate),
      ...externalModelCandidates.map(viewerModelReferenceCandidate),
    ],
    [externalModelCandidates, externalPointCandidates],
  )
  const viewerPierceCandidates = useMemo<readonly ViewerSketchReferenceCandidate[]>(
    () => pierceCandidates.map(viewerReferenceCandidate),
    [pierceCandidates],
  )
  const selectExternalPoint = useSelectExternalGeometry(
    externalPointCandidates,
    externalModelCandidates,
    props.sketch.draft,
    props.sketch.selectedEntityIds,
    props.actions.onSketchDraftChange,
    props.actions.onSketchEditorToolChange,
    props.sketch.repairReferenceId,
  )
  const selectModelIntersection = useSelectModelIntersection(
    props.controller,
    props.sketch.draft,
    frame,
    props.actions.onSketchDraftChange,
    props.actions.onSketchEditorToolChange,
  )
  const selectPierce = useSelectPierce(
    pierceCandidates,
    props.sketch.draft,
    props.sketch.selectedEntityIds,
    props.actions.onSketchDraftChange,
    props.actions.onSketchEditorToolChange,
    props.sketch.repairReferenceId,
  )
  return useWorkspaceSketchContext(
    sketchActive,
    frame,
    props.sketch.cameraMode,
    props.sketch.editorTool,
    viewerPointCandidates,
    selectExternalPoint,
    viewerPierceCandidates,
    selectPierce,
    selectModelIntersection,
    projectionStore,
  )
}

function WorkspaceContent(props: WorkspaceContentProps) {
  const [activeSketchDisplay, setActiveSketchDisplay] = useState<SketchDisplayRecord | null>(null)
  const sketchGeometry = useWorkspaceSketchGeometry(props)
  const modelGeometry = useWorkspaceModelGeometry({
    frame: sketchGeometry.frame,
    props,
    rollbackVisibility: sketchGeometry.rollbackVisibility,
    snapshot: sketchGeometry.snapshot,
  })
  const externalPointCandidates = availableExternalSketchGeometryCandidates(
    sketchGeometry.externalPointCandidates,
    props.sketch.draft,
    props.sketch.repairReferenceId,
  )
  const pierceCandidates = availableExternalSketchPierceCandidates(
    sketchGeometry.pierceCandidates,
    props.sketch.draft,
  )
  const sketchContext = useWorkspaceReferenceSelection({
    externalModelCandidates: modelGeometry.externalModelCandidates,
    externalPointCandidates,
    pierceCandidates,
    frame: sketchGeometry.frame,
    props,
    sketchActive: sketchGeometry.sketchActive,
  })
  return (
    <WorkspaceContentView
      activeSketchDisplay={activeSketchDisplay}
      editVisibility={sketchGeometry.displayVisibility}
      externalContextGeometry={sketchGeometry.externalContextGeometry}
      externalModelCandidates={modelGeometry.externalModelCandidates}
      externalPointCandidates={externalPointCandidates}
      pierceCandidates={pierceCandidates}
      props={props}
      sketchActive={sketchGeometry.sketchActive}
      sketchContext={sketchContext}
      frame={sketchGeometry.frame}
      supportFeatures={sketchGeometry.supportFeatures}
      onDisplayChange={setActiveSketchDisplay}
      offerFinalContext={modelGeometry.offerFinalContext}
      showFinalContext={props.sketch.showFinalContext}
    />
  )
}

export type EditorWorkspaceActions = Readonly<{
  beginSketchSupportReplacement: () => void
  closeTool: () => void
  createBox: () => void
  createCylinder: () => void
  createDatumPlane: () => void
  createExtrusion: () => Promise<boolean>
  createRevolve: () => Promise<boolean>
  createSketch: () => void
  createSubtract: () => void
  editFeature: (featureId: FeatureId) => void
  editSketch: (sketchId: SketchId) => void
  preselectFeature: (featureId: FeatureId | null) => void
  select: (selection: ViewerSelection | null) => void
  selectOriginPlane: (plane: ViewerOriginPlane | null) => void
  selectSketchPlane: (plane: SketchRecord["plane"]) => void
  redoSketchDraft: () => void
  setFeatureVisibility: (featureId: FeatureId, visible: boolean) => void
  setOriginPlaneVisibility: (plane: ViewerOriginPlane, visible: boolean) => void
  setSketchVisibility: (sketchId: SketchId, visible: boolean) => void
  toggleAllSketchVisibility: () => void
  setSketchConstruction: (construction: boolean) => void
  setSketchDraft: (sketch: SketchRecord, mode?: SketchDraftChangeMode) => void
  setSketchEditorTool: (tool: SketchEditorTool) => void
  setSketchFailedConstraintIds: (constraintIds: readonly SketchConstraintId[]) => void
  setSketchProfiles: (profiles: readonly SketchProfileSelector[]) => void
  setSketchReferenceDimensionLabels: (labels: Readonly<Record<string, string>>) => void
  setSketchReferenceRepair: (referenceId: SketchExternalReferenceId | null) => void
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
  onSketchFinalContextChange: (visible: boolean) => void
  preselectedFeatureId: FeatureId | null
  selectedOriginPlane: ViewerOriginPlane | null
  selection: ViewerSelection | null
  sketchConstruction: boolean
  sketchCameraMode: SketchCameraMode
  sketchFinalContext: boolean
  sketchDraft: SketchRecord | null
  sketchEditorTool: SketchEditorTool
  sketchFailedConstraintIds: readonly SketchConstraintId[]
  sketchProfiles: readonly SketchProfileSelector[]
  sketchReferenceDimensionLabels: Readonly<Record<string, string>>
  sketchRepairReferenceId: SketchExternalReferenceId | null
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

function editedSketchId(activeTool: ActiveSketchTool | null) {
  if (activeTool?.kind === "edit-sketch") return activeTool.sketchId
  if (
    activeTool?.kind === "select-sketch-plane" &&
    activeTool.returnTo?.tool.kind === "edit-sketch"
  ) {
    return activeTool.returnTo.tool.sketchId
  }
  return null
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
      onAllSketchVisibilityToggle={actions.toggleAllSketchVisibility}
      onWorkspaceChange={actions.switchWorkspace}
      sketchRenameBlockedId={editedSketchId(activeSketchTool)}
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
        onOriginPlaneSelect: actions.selectOriginPlane,
        onSketchProfileSelect: actions.setSketchSelectedProfile,
        onSketchProfilesChange: actions.setSketchProfiles,
        onSketchReferenceDimensionLabelsChange: actions.setSketchReferenceDimensionLabels,
        onSketchRedo: actions.redoSketchDraft,
        onSketchConstraintSelectionChange: actions.setSketchSelectedConstraintId,
        onSketchSelectionChange: actions.setSketchSelectedEntityIds,
        onSketchFinalContextChange: props.onSketchFinalContextChange,
        onSketchUndo: actions.undoSketchDraft,
      }}
      controller={controller}
      model={{
        featurePreview,
        hiddenFeatureIds: props.hiddenFeatureIds,
        hiddenSketchIds: props.hiddenSketchIds,
        idleOriginPlaneSelectionAvailable: props.activeTool === null,
        originPlaneVisibility: props.originPlaneVisibility,
        preselectedFeatureId: props.preselectedFeatureId,
        selectedOriginPlane: props.selectedOriginPlane,
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
        repairReferenceId: props.sketchRepairReferenceId,
        selectedConstraintId: props.sketchSelectedConstraintId,
        selectedEntityIds: props.sketchSelectedEntityIds,
        selectedProfile: props.sketchSelectedProfile,
        selectedSketch,
        showFinalContext: props.sketchFinalContext,
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
      onCreateRevolve={actions.createRevolve}
      onCreateSketch={actions.createSketch}
      onCreateSubtract={actions.createSubtract}
      onEditSketch={actions.editSketch}
      onFeaturePreviewChange={onFeaturePreviewChange}
      sketchDraft={props.sketchDraft}
      sketchFailedConstraintIds={props.sketchFailedConstraintIds}
      sketchProfiles={props.sketchProfiles}
      sketchReferenceDimensionLabels={props.sketchReferenceDimensionLabels}
      sketchRepairReferenceId={props.sketchRepairReferenceId}
      sketchSelectedConstraintId={props.sketchSelectedConstraintId}
      sketchSelectedEntityIds={props.sketchSelectedEntityIds}
      sketchSelectedProfile={props.sketchSelectedProfile}
      onSketchDraftChange={actions.setSketchDraft}
      onSketchSelectedConstraintChange={actions.setSketchSelectedConstraintId}
      onSketchSelectedProfileChange={actions.setSketchSelectedProfile}
      onSketchSaved={actions.sketchSaved}
      onSketchPlaneSelect={actions.selectSketchPlane}
      onSketchReferenceRepairChange={actions.setSketchReferenceRepair}
      onSketchSupportReplace={actions.beginSketchSupportReplacement}
    />
  )
}

export function EditorWorkspace(props: EditorWorkspaceProps) {
  const { featurePreview, setPreviewFeature } = useEditorFeaturePreview(
    props.controller,
    props.activeTool,
  )
  return (
    <SketchProjectionProvider>
      <div className="cad-workspace-grid min-h-0">
        <EditorModelTree props={props} />
        <EditorContent featurePreview={featurePreview} props={props} />
        <EditorTaskPanel onFeaturePreviewChange={setPreviewFeature} props={props} />
      </div>
    </SketchProjectionProvider>
  )
}
