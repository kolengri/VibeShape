import type { SketchDisplayRecord } from "@vibeshape/application/sketch-display"
import {
  type SupportFrame,
  type SupportFrameGeometryRecord,
  sketchFrame,
} from "@vibeshape/application/support-frame"
import {
  boxFeatureParametersSchema,
  canonicalJson,
  cylinderFeatureParametersSchema,
  type DocumentSnapshot,
  type FeatureId,
  type FeatureRecord,
  readExtrusionFeatureParameters,
  readRevolveFeatureParameters,
  type revolveFeatureParametersSchema,
  type SketchConstraintId,
  type SketchEntityId,
  type SketchExternalReferenceId,
  type SketchId,
  type SketchProfileSelector,
  type SketchRecord,
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
  ViewerSketchProfileSelectionIntent,
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
import type { ExtrusionDistanceRequest } from "../features/extrusion/extrusion-distance-manipulator"
import {
  type ActivePartDesignTool,
  activeFeatureId,
  isExtrusionPartDesignTool,
  isPrimitivePartDesignTool,
  isRevolvePartDesignTool,
} from "../features/part-design/part-design-tool"
import type {
  PrimitivePlacement,
  PrimitivePlacementRequest,
} from "../features/part-design/primitive-placement"
import {
  ineligibleProfileSketchIds,
  isProfileFeatureTool,
  nextProfileFeatureSelection,
  profileFeatureToolKey,
  profileSelectorsEqual,
  profilesForFeatureTool,
  revolveAxisAfterProfileSelection,
} from "../features/part-design/profile-feature-selection"
import { useFeaturePreview } from "../features/preview/use-feature-preview"
import type { RevolveAngleRequest } from "../features/revolve/revolve-angle-manipulator"
import {
  type RevolveAxisCandidate,
  revolveModelEdgeAxisCandidates,
  revolveSketchLineAxisCandidates,
} from "../features/revolve/revolve-axis-candidates"
import {
  applyExternalModelCandidateSelection,
  applyExternalModelIntersection,
  applyExternalModelPierceCandidate,
  availableExternalModelGeometryCandidates,
  availableExternalModelPierceCandidates,
  type ExternalModelGeometryCandidate,
  type ExternalModelGeometryRecord,
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
  viewerSketchDisplay,
} from "./geometry-viewport"
import { ModelTree } from "./model-tree"
import { TaskPanel } from "./task-panel"
import type { EditorWorkspaceName } from "./workspace"

const EMPTY_GEOMETRY = [] as const
type RevolveAxis = ReturnType<typeof revolveFeatureParametersSchema.parse>["axis"]
type RevolveSelectionPurpose = "axis" | "profile"

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
  "create-box",
  "edit-box",
  "create-cylinder",
  "edit-cylinder",
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

type PrimitiveManipulator = Readonly<{
  featureId: FeatureId
  position: PrimitivePlacement
}>

type ExtrusionManipulator = Readonly<{
  direction: PrimitivePlacement
  distance: number
  distanceScale: number
  featureId: FeatureId
  origin: PrimitivePlacement
}>

type RevolveManipulator = Readonly<{
  angle: number
  axisDirection: PrimitivePlacement
  axisOrigin: PrimitivePlacement
  featureId: FeatureId
  rotationOrigin: PrimitivePlacement
}>

type RevolveAxisLine = Readonly<{
  direction: PrimitivePlacement
  origin: PrimitivePlacement
}>

function normalizedAxisLine(
  start: PrimitivePlacement,
  end: PrimitivePlacement,
): RevolveAxisLine | null {
  const direction: PrimitivePlacement = [end[0] - start[0], end[1] - start[1], end[2] - start[2]]
  const length = Math.hypot(...direction)
  return Number.isFinite(length) && length > 1e-9
    ? {
        direction: [direction[0] / length, direction[1] / length, direction[2] / length],
        origin: start,
      }
    : null
}

function revolveManipulatorAxis(
  axis: RevolveAxis,
  sketch: SketchDisplayRecord,
  candidates: readonly RevolveAxisCandidate[],
): RevolveAxisLine | null {
  if (axis.kind === "origin-axis") {
    return {
      direction: axis.axis === "x" ? sketch.frame.xAxis : sketch.frame.yAxis,
      origin: sketch.frame.origin,
    }
  }
  const candidate = candidates.find(({ axis: candidateAxis }) =>
    revolveAxisIntentsMatch(candidateAxis, axis),
  )
  return candidate ? normalizedAxisLine(candidate.start, candidate.end) : null
}

function profileRotationFrame(
  sketch: SketchDisplayRecord,
  profile: SketchProfileSelector,
  axis: RevolveAxisLine,
) {
  const displayProfile = sketch.profiles.find((candidate) =>
    profileSelectorsEqual(candidate.selector, profile),
  )
  if (!displayProfile) return null
  let best: Readonly<{
    axisOrigin: PrimitivePlacement
    distance: number
    rotationOrigin: PrimitivePlacement
  }> | null = null
  for (const segment of displayProfile.outerLoop.segments) {
    for (const [x, y] of segment.samples) {
      const point: PrimitivePlacement = [
        sketch.frame.origin[0] + sketch.frame.xAxis[0] * x + sketch.frame.yAxis[0] * y,
        sketch.frame.origin[1] + sketch.frame.xAxis[1] * x + sketch.frame.yAxis[1] * y,
        sketch.frame.origin[2] + sketch.frame.xAxis[2] * x + sketch.frame.yAxis[2] * y,
      ]
      const relative: PrimitivePlacement = [
        point[0] - axis.origin[0],
        point[1] - axis.origin[1],
        point[2] - axis.origin[2],
      ]
      const along =
        relative[0] * axis.direction[0] +
        relative[1] * axis.direction[1] +
        relative[2] * axis.direction[2]
      const axisOrigin: PrimitivePlacement = [
        axis.origin[0] + axis.direction[0] * along,
        axis.origin[1] + axis.direction[1] * along,
        axis.origin[2] + axis.direction[2] * along,
      ]
      const distance = Math.hypot(
        point[0] - axisOrigin[0],
        point[1] - axisOrigin[1],
        point[2] - axisOrigin[2],
      )
      if (!Number.isFinite(distance) || distance <= (best?.distance ?? 1e-6)) continue
      best = { axisOrigin, distance, rotationOrigin: point }
    }
  }
  return best
}

function activeRevolveCandidate(
  activeTool: ActivePartDesignTool | null,
  candidate: FeatureRecord | null,
  readOnly: boolean,
) {
  return !readOnly && candidate && isRevolvePartDesignTool(activeTool) ? candidate : null
}

function revolveManipulatorGeometry(
  candidate: FeatureRecord,
  axisCandidates: readonly RevolveAxisCandidate[],
  sketches: readonly SketchDisplayRecord[],
) {
  const parameters = readRevolveFeatureParameters(candidate)
  if (!parameters) return null
  const sketch = sketches.find(({ sketchId }) => sketchId === parameters.profile.sketchId)
  if (!sketch) return null
  const axis = revolveManipulatorAxis(parameters.axis, sketch, axisCandidates)
  const frame = axis ? profileRotationFrame(sketch, parameters.profile, axis) : null
  return axis && frame ? { axis, frame, parameters } : null
}

function requestedRevolveAngle(
  candidate: FeatureRecord,
  parameterAngle: number,
  angleRequest: RevolveAngleRequest | null,
) {
  const angle = angleRequest?.featureId === candidate.id ? angleRequest.angle : parameterAngle
  return Number.isFinite(angle) && angle > 0 && angle <= Math.PI * 2 ? angle : null
}

function revolveManipulator(
  activeTool: ActivePartDesignTool | null,
  candidate: FeatureRecord | null,
  angleRequest: RevolveAngleRequest | null,
  axisCandidates: readonly RevolveAxisCandidate[],
  sketches: readonly SketchDisplayRecord[],
  readOnly: boolean,
): RevolveManipulator | null {
  const activeCandidate = activeRevolveCandidate(activeTool, candidate, readOnly)
  if (!activeCandidate) return null
  const geometry = revolveManipulatorGeometry(activeCandidate, axisCandidates, sketches)
  if (!geometry) return null
  const angle = requestedRevolveAngle(
    activeCandidate,
    geometry.parameters.angle.value,
    angleRequest,
  )
  if (angle === null) return null
  return {
    angle,
    axisDirection: geometry.axis.direction,
    axisOrigin: geometry.frame.axisOrigin,
    featureId: activeCandidate.id,
    rotationOrigin: geometry.frame.rotationOrigin,
  }
}

function extrusionManipulatorParameters(
  activeTool: ActivePartDesignTool | null,
  candidate: FeatureRecord | null,
  readOnly: boolean,
) {
  if (readOnly || !candidate || !isExtrusionPartDesignTool(activeTool)) return null
  return readExtrusionFeatureParameters(candidate)
}

function extrusionManipulatorDistance(
  featureId: FeatureId,
  parameterDistance: number,
  distanceRequest: ExtrusionDistanceRequest | null,
) {
  return distanceRequest?.featureId === featureId ? distanceRequest.distance : parameterDistance
}

function extrusionManipulator(
  activeTool: ActivePartDesignTool | null,
  candidate: FeatureRecord | null,
  distanceRequest: ExtrusionDistanceRequest | null,
  sketches: readonly SketchDisplayRecord[],
  readOnly: boolean,
): ExtrusionManipulator | null {
  const parameters = extrusionManipulatorParameters(activeTool, candidate, readOnly)
  if (!parameters || !candidate) return null
  const sketch = sketches.find(({ sketchId }) => sketchId === parameters.profile.sketchId)
  if (!sketch) return null
  const distance = extrusionManipulatorDistance(
    candidate.id,
    parameters.distance.value,
    distanceRequest,
  )
  if (!Number.isFinite(distance) || distance <= 0) return null
  const distanceScale = parameters.symmetric ? 2 : 1
  return {
    direction: sketch.frame.normal,
    distance: distance / distanceScale,
    distanceScale,
    featureId: candidate.id,
    origin: sketch.frame.origin,
  }
}

function primitiveManipulator(
  activeTool: ActivePartDesignTool | null,
  candidate: FeatureRecord | null,
  placementRequest: PrimitivePlacementRequest | null,
  readOnly: boolean,
): PrimitiveManipulator | null {
  if (!isPrimitivePartDesignTool(activeTool) || !candidate || readOnly) return null
  const schema = activeTool.kind.endsWith("box")
    ? boxFeatureParametersSchema
    : cylinderFeatureParametersSchema
  const parameters = schema.safeParse(candidate.parameters)
  if (!parameters.success) return null
  const { origin } = parameters.data
  return {
    featureId: candidate.id,
    position:
      placementRequest?.featureId === candidate.id
        ? placementRequest.position
        : [origin.x.value, origin.y.value, origin.z.value],
  }
}

function primitiveTranslationGizmoProps(
  manipulator: PrimitiveManipulator | null,
  onPositionChange: (featureId: FeatureId, position: PrimitivePlacement) => void,
) {
  if (!manipulator) return {}
  return {
    translationGizmo: {
      ...manipulator,
      onPositionChange: (position: PrimitivePlacement) =>
        onPositionChange(manipulator.featureId, position),
    },
  }
}

function extrusionAxialGizmoProps(
  manipulator: ExtrusionManipulator | null,
  onDistanceChange: (featureId: FeatureId, distance: number) => void,
) {
  if (!manipulator) return {}
  return {
    axialGizmo: {
      direction: manipulator.direction,
      distance: manipulator.distance,
      featureId: manipulator.featureId,
      onDistanceChange: (distance: number) =>
        onDistanceChange(manipulator.featureId, distance * manipulator.distanceScale),
      origin: manipulator.origin,
    },
  }
}

function revolveAngularGizmoProps(
  manipulator: RevolveManipulator | null,
  onAngleChange: (featureId: FeatureId, angle: number) => void,
) {
  if (!manipulator) return {}
  return {
    angularGizmo: {
      ...manipulator,
      maxAngle: Math.PI * 2,
      minAngle: Math.PI / 180,
      onAngleChange: (angle: number) => onAngleChange(manipulator.featureId, angle),
    },
  }
}

type WorkspaceContentProps = Readonly<{
  actions: Readonly<{
    onSelectionChange: (selection: ViewerSelection | null) => void
    onSavedSketchProfileSelect: (
      profile: SketchProfileSelector | null,
      profiles: readonly SketchProfileSelector[],
      intent: ViewerSketchProfileSelectionIntent,
    ) => void
    onExtrusionDistanceChange: (featureId: FeatureId, distance: number) => void
    onRevolveAngleChange: (featureId: FeatureId, angle: number) => void
    onRevolveAxisChange: (axis: RevolveAxis) => void
    onPrimitivePlacementChange: (featureId: FeatureId, position: PrimitivePlacement) => void
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
    extrusionManipulator: ExtrusionManipulator | null
    featurePreview: ReturnType<typeof useFeaturePreview>
    primitiveManipulator: PrimitiveManipulator | null
    revolveManipulator: RevolveManipulator | null
    hiddenFeatureIds: readonly FeatureId[]
    hiddenSketchIds: readonly SketchId[]
    idleOriginPlaneSelectionAvailable: boolean
    originPlaneVisibility: ViewerOriginPlaneVisibility
    preselectedFeatureId: FeatureId | null
    selectedOriginPlane: ViewerOriginPlane | null
    selectedFeatureId: FeatureId | null
    selection: ViewerSelection | null
    revolveAxisCandidates: readonly RevolveAxisCandidate[]
    revolveAxisSelectionActive: boolean
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
    selectedProfiles: readonly SketchProfileSelector[]
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
  modelPierceCandidateCount,
  frame,
}: Pick<WorkspaceContentProps, "actions" | "controller" | "model" | "sketch"> & {
  externalModelCandidates: readonly ExternalModelGeometryCandidate[]
  externalPointCandidates: readonly ExternalSketchGeometryCandidate[]
  pierceCandidates: readonly ExternalSketchPierceCandidate[]
  modelPierceCandidateCount: number
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
        pierceCandidateCount: pierceCandidates.length + modelPierceCandidateCount,
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
      {...extrusionAxialGizmoProps(model.extrusionManipulator, actions.onExtrusionDistanceChange)}
      {...revolveAngularGizmoProps(model.revolveManipulator, actions.onRevolveAngleChange)}
      {...primitiveTranslationGizmoProps(
        model.primitiveManipulator,
        actions.onPrimitivePlacementChange,
      )}
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
      sketchProfileSelection={{
        selectedProfiles: sketch.activeTool ? [] : sketch.selectedProfiles,
        onSelect: actions.onSavedSketchProfileSelect,
      }}
      {...(activeSketchDisplay
        ? { activeSketchDisplay: viewerSketchDisplay(activeSketchDisplay) }
        : {})}
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

function selectedModelPierceDraft(
  modelCandidates: readonly ExternalModelGeometryCandidate[],
  modelGeometryRecords: readonly ExternalModelGeometryRecord[],
  draft: SketchRecord,
  hit: Extract<ViewerSketchReferenceCandidate, { kind: "model-line" }>,
  selectedEntityIds: readonly SketchEntityId[],
  repairReferenceId: SketchExternalReferenceId | null,
) {
  const candidate = modelCandidates.find(
    (value): value is Extract<ExternalModelGeometryCandidate, { kind: "model-line" }> =>
      value.kind === "model-line" &&
      value.candidateId === hit.candidateId &&
      value.featureId === hit.featureId,
  )
  if (!candidate?.piercePoint) return draft
  return repairReferenceId
    ? applyExternalModelCandidateSelection(draft, candidate, selectedEntityIds, repairReferenceId)
    : applyExternalModelPierceCandidate(draft, candidate, selectedEntityIds, modelGeometryRecords)
}

function selectedSketchPierceDraft(
  candidates: readonly ExternalSketchPierceCandidate[],
  draft: SketchRecord,
  hit: Extract<ViewerSketchReferenceCandidate, { kind: "line" }>,
  selectedEntityIds: readonly SketchEntityId[],
  repairReferenceId: SketchExternalReferenceId | null,
) {
  const candidate = candidates.find(
    (value) =>
      value.sourceSketchId === hit.sourceSketchId && value.sourceLineId === hit.sourceLineId,
  )
  if (!candidate) return draft
  return repairReferenceId
    ? applyExternalSketchCandidateSelection(draft, candidate, selectedEntityIds, repairReferenceId)
    : applyExternalSketchPierceCandidate(draft, candidate, selectedEntityIds)
}

function useSelectPierce(
  candidates: readonly ExternalSketchPierceCandidate[],
  modelCandidates: readonly ExternalModelGeometryCandidate[],
  modelGeometryRecords: readonly ExternalModelGeometryRecord[],
  draft: SketchRecord | null,
  selectedEntityIds: readonly SketchEntityId[],
  onDraftChange: (draft: SketchRecord) => void,
  onEditorToolChange: (tool: SketchEditorTool) => void,
  repairReferenceId: SketchExternalReferenceId | null,
) {
  return useCallback(
    (hit: ViewerSketchReferenceCandidate) => {
      if (!draft) return
      const next =
        hit.kind === "model-line"
          ? selectedModelPierceDraft(
              modelCandidates,
              modelGeometryRecords,
              draft,
              hit,
              selectedEntityIds,
              repairReferenceId,
            )
          : hit.kind === "line"
            ? selectedSketchPierceDraft(
                candidates,
                draft,
                hit,
                selectedEntityIds,
                repairReferenceId,
              )
            : draft
      if (next === draft) return
      onDraftChange(next)
      onEditorToolChange("select")
    },
    [
      candidates,
      draft,
      modelCandidates,
      modelGeometryRecords,
      onDraftChange,
      onEditorToolChange,
      repairReferenceId,
      selectedEntityIds,
    ],
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
  modelPierceCandidateCount,
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
  modelPierceCandidateCount: number
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
          modelPierceCandidateCount={modelPierceCandidateCount}
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
  const modelGeometryRecords = props.controller.report?.rebuild.ok
    ? props.controller.report.rebuild.response.geometry
    : []
  const modelPierceCandidates = useMemo(
    () =>
      frame && props.sketch.draft
        ? availableExternalModelPierceCandidates(
            projectedCandidates,
            props.sketch.draft,
            props.sketch.repairReferenceId,
            frame,
          )
        : [],
    [frame, projectedCandidates, props.sketch.draft, props.sketch.repairReferenceId],
  )
  return {
    externalModelCandidates: useAvailableWorkspaceModelCandidates(
      props.controller,
      props.sketch.draft,
      projectedCandidates,
      props.sketch.repairReferenceId,
    ),
    modelGeometryRecords,
    modelPierceCandidates,
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
  modelGeometryRecords,
  modelPierceCandidates,
  externalPointCandidates,
  pierceCandidates,
  frame,
  props,
  sketchActive,
}: Readonly<{
  externalModelCandidates: readonly ExternalModelGeometryCandidate[]
  modelGeometryRecords: readonly ExternalModelGeometryRecord[]
  modelPierceCandidates: readonly ExternalModelGeometryCandidate[]
  externalPointCandidates: readonly ExternalSketchGeometryCandidate[]
  pierceCandidates: readonly ExternalSketchPierceCandidate[]
  frame: SupportFrame | null
  props: WorkspaceContentProps
  sketchActive: boolean
}>) {
  const modelUseCandidates = useMemo(
    () =>
      externalModelCandidates.filter(
        (candidate) => candidate.kind !== "model-line" || candidate.projectable !== false,
      ),
    [externalModelCandidates],
  )
  const projectionStore = useSketchProjectionStoreApi()
  const viewerPointCandidates = useMemo<readonly ViewerSketchReferenceCandidate[]>(
    () => [
      ...externalPointCandidates.map(viewerReferenceCandidate),
      ...modelUseCandidates.map(viewerModelReferenceCandidate),
    ],
    [externalPointCandidates, modelUseCandidates],
  )
  const viewerPierceCandidates = useMemo<readonly ViewerSketchReferenceCandidate[]>(
    () => [
      ...pierceCandidates.map(viewerReferenceCandidate),
      ...modelPierceCandidates.map(viewerModelReferenceCandidate),
    ],
    [modelPierceCandidates, pierceCandidates],
  )
  const selectExternalPoint = useSelectExternalGeometry(
    externalPointCandidates,
    modelUseCandidates,
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
    modelPierceCandidates,
    modelGeometryRecords,
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

function useRevolveAxisReferenceSelection(props: WorkspaceContentProps) {
  return useMemo<GeometryViewportSketchContext | undefined>(() => {
    if (!props.model.revolveAxisSelectionActive) return undefined
    return {
      frame: null,
      mode: "orbit",
      referenceSelection: {
        candidates: props.model.revolveAxisCandidates,
        onSelect: (candidate) => {
          const match = props.model.revolveAxisCandidates.find((axisCandidate) =>
            candidate.kind === "line" && axisCandidate.kind === "line"
              ? axisCandidate.sourceSketchId === candidate.sourceSketchId &&
                axisCandidate.sourceLineId === candidate.sourceLineId
              : candidate.kind === "model-line" && axisCandidate.kind === "model-line"
                ? axisCandidate.featureId === candidate.featureId &&
                  axisCandidate.candidateId === candidate.candidateId
                : false,
          )
          if (match) props.actions.onRevolveAxisChange(match.axis)
        },
        purpose: "revolve-axis",
      },
    }
  }, [
    props.actions.onRevolveAxisChange,
    props.model.revolveAxisCandidates,
    props.model.revolveAxisSelectionActive,
  ])
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
    props.sketch.repairReferenceId,
  )
  const externalModelUseCandidates = modelGeometry.externalModelCandidates.filter(
    (candidate) => candidate.kind !== "model-line" || candidate.projectable !== false,
  )
  const modelPierceCandidateCount = sketchGeometry.frame
    ? modelGeometry.modelPierceCandidates.length
    : 0
  const sketchReferenceContext = useWorkspaceReferenceSelection({
    externalModelCandidates: modelGeometry.externalModelCandidates,
    modelGeometryRecords: modelGeometry.modelGeometryRecords,
    modelPierceCandidates: modelGeometry.modelPierceCandidates,
    externalPointCandidates,
    pierceCandidates,
    frame: sketchGeometry.frame,
    props,
    sketchActive: sketchGeometry.sketchActive,
  })
  const revolveAxisContext = useRevolveAxisReferenceSelection(props)
  const sketchContext = sketchReferenceContext ?? revolveAxisContext
  return (
    <WorkspaceContentView
      activeSketchDisplay={activeSketchDisplay}
      editVisibility={sketchGeometry.displayVisibility}
      externalContextGeometry={sketchGeometry.externalContextGeometry}
      externalModelCandidates={externalModelUseCandidates}
      externalPointCandidates={externalPointCandidates}
      pierceCandidates={pierceCandidates}
      modelPierceCandidateCount={modelPierceCandidateCount}
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
  acknowledgeExtrusionDistance: (featureId: FeatureId) => void
  acknowledgeRevolveAngle: (featureId: FeatureId) => void
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
  selectSavedSketchProfile: (
    profile: SketchProfileSelector,
    profiles: readonly SketchProfileSelector[],
  ) => void
  selectOriginPlane: (plane: ViewerOriginPlane | null) => void
  selectSketchPlane: (plane: SketchRecord["plane"]) => void
  redoSketchDraft: () => void
  setFeatureVisibility: (featureId: FeatureId, visible: boolean) => void
  setExtrusionDistance: (featureId: FeatureId, distance: number) => void
  setOriginPlaneVisibility: (plane: ViewerOriginPlane, visible: boolean) => void
  setPrimitivePlacement: (featureId: FeatureId, position: PrimitivePlacement) => void
  setRevolveAngle: (featureId: FeatureId, angle: number) => void
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
  extrusionDistanceRequest: ExtrusionDistanceRequest | null
  primitivePlacementRequest: PrimitivePlacementRequest | null
  revolveAngleRequest: RevolveAngleRequest | null
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
  return { featurePreview, previewFeature, setPreviewFeature }
}

function useRevolveAxisCandidates(
  controller: DocumentControllerState,
  activeTool: ActivePartDesignTool | null,
  profile: SketchProfileSelector | null,
  hiddenFeatureIds: readonly FeatureId[],
  selectedAxis: RevolveAxis | null,
) {
  const t = useTranslations("app.shell.viewport")
  const snapshot = controller.report?.snapshot
  const sketchId =
    activeTool?.kind === "create-revolve" || activeTool?.kind === "edit-revolve"
      ? profile?.sketchId
      : null
  const [candidates, setCandidates] = useState<readonly RevolveAxisCandidate[]>([])
  useEffect(() => {
    const sketch = snapshot?.sketches.find(({ id }) => id === sketchId)
    const rebuild = controller.report?.rebuild
    if (!snapshot || !sketch || !rebuild?.ok) {
      setCandidates([])
      return
    }
    let active = true
    void solveActiveSketch(snapshot.revision, sketch.id).then((result) => {
      if (!active) return
      if (!result.ok) {
        setCandidates([])
        return
      }
      const features = resolveDocumentFeatureParameters(snapshot)
      const frame = sketchFrame(sketch, snapshot, features, new Set(), rebuild.response.geometry)
      const editedFeatureIndex =
        activeTool?.kind === "edit-revolve"
          ? snapshot.features.findIndex(({ id }) => id === activeTool.featureId)
          : snapshot.features.length
      const earlierFeatures = snapshot.features.slice(0, Math.max(0, editedFeatureIndex))
      const selectedSourceId =
        selectedAxis?.kind === "model-edge" ? selectedAxis.reference.featureId : null
      const hidden = new Set(hiddenFeatureIds)
      const visibleAxisSourceIds = earlierFeatures.flatMap(({ id }) =>
        !hidden.has(id) || id === selectedSourceId ? [id] : [],
      )
      const modelCandidates = frame
        ? projectExternalModelGeometryCandidates(
            rebuild.response.geometry,
            snapshot.features,
            visibleAxisSourceIds,
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
          ).filter((candidate) => candidate.kind === "model-line")
        : []
      setCandidates([
        ...revolveSketchLineAxisCandidates(
          snapshot,
          sketch,
          result.response.solution,
          features,
          rebuild.response.geometry,
          (sketchLabel, ordinal) => t("revolveAxisLineCandidate", { sketch: sketchLabel, ordinal }),
        ),
        ...revolveModelEdgeAxisCandidates(modelCandidates),
      ])
    })
    return () => {
      active = false
    }
  }, [
    activeTool,
    controller.report?.rebuild,
    hiddenFeatureIds,
    selectedAxis,
    sketchId,
    snapshot,
    t,
  ])
  return candidates
}

function defaultRevolveAxis(
  activeTool: ActivePartDesignTool | null,
  snapshot: DocumentSnapshot | undefined,
): RevolveAxis | null {
  if (activeTool?.kind === "create-revolve") return { kind: "origin-axis", axis: "x" }
  if (activeTool?.kind !== "edit-revolve") return null
  const feature = snapshot?.features.find(({ id }) => id === activeTool.featureId)
  return feature ? (readRevolveFeatureParameters(feature)?.axis ?? null) : null
}

function revolveToolKey(activeTool: ActivePartDesignTool | null) {
  if (activeTool?.kind === "create-revolve") return profileFeatureToolKey(activeTool)
  if (activeTool?.kind === "edit-revolve") return `edit:${activeTool.featureId}`
  return "inactive"
}

function useRevolveAxisSelection(
  activeTool: ActivePartDesignTool | null,
  snapshot: DocumentSnapshot | undefined,
) {
  const key = revolveToolKey(activeTool)
  const fallback = useMemo(() => defaultRevolveAxis(activeTool, snapshot), [activeTool, snapshot])
  const [state, setState] = useState<Readonly<{ key: string; value: RevolveAxis | null }>>(() => ({
    key,
    value: fallback,
  }))
  useEffect(() => {
    if (key !== "inactive") return
    setState((current) => (current.key === "inactive" ? current : { key: "inactive", value: null }))
  }, [key])
  const value = state.key === key ? state.value : fallback
  const setValue = useCallback((axis: RevolveAxis) => setState({ key, value: axis }), [key])
  return { value, setValue }
}

function useRevolveSelectionPurpose(activeTool: ActivePartDesignTool | null) {
  const key = revolveToolKey(activeTool)
  const [state, setState] = useState<Readonly<{ key: string; value: RevolveSelectionPurpose }>>(
    () => ({ key, value: "axis" }),
  )
  useEffect(() => {
    if (key !== "inactive") return
    setState((current) =>
      current.key === "inactive" ? current : { key: "inactive", value: "axis" },
    )
  }, [key])
  const value = state.key === key ? state.value : "axis"
  const setValue = useCallback(
    (purpose: RevolveSelectionPurpose) => setState({ key, value: purpose }),
    [key],
  )
  return { value, setValue }
}

function useProfileFeatureSelection(
  activeTool: ActivePartDesignTool | null,
  snapshot: DocumentSnapshot | undefined,
) {
  const key = profileFeatureToolKey(activeTool)
  const fallback = useMemo(
    () => profilesForFeatureTool(activeTool, snapshot),
    [activeTool, snapshot],
  )
  const [state, setState] = useState<
    Readonly<{ key: string; value: readonly SketchProfileSelector[] }>
  >(() => ({ key, value: fallback }))
  useEffect(() => {
    if (key !== "inactive") return
    setState((current) => (current.key === "inactive" ? current : { key: "inactive", value: [] }))
  }, [key])
  const value = state.key === key ? state.value : fallback
  const setValue = useCallback(
    (profiles: readonly SketchProfileSelector[]) => setState({ key, value: profiles }),
    [key],
  )
  return { value, setValue }
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
  const repairSketchSupport = (sketchId: SketchId) => {
    actions.editSketch(sketchId)
    actions.beginSketchSupportReplacement()
  }
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
      onSketchSupportRepair={repairSketchSupport}
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

function savedProfileSelectionAction(
  props: EditorWorkspaceProps,
  onFeatureProfileChange: (
    profile: SketchProfileSelector,
    intent: ViewerSketchProfileSelectionIntent,
  ) => void,
) {
  return (
    profile: SketchProfileSelector | null,
    profiles: readonly SketchProfileSelector[],
    intent: ViewerSketchProfileSelectionIntent,
  ) => {
    if (isProfileFeatureTool(props.activeTool)) {
      if (profile) onFeatureProfileChange(profile, intent)
      return
    }
    if (profile) props.actions.selectSavedSketchProfile(profile, profiles)
    else props.actions.setSketchSelectedProfile(null)
  }
}

function editorSketchProfileSelection(
  activeTool: ActivePartDesignTool | null,
  featureProfiles: readonly SketchProfileSelector[],
  selectedProfile: SketchProfileSelector | null,
) {
  if (isProfileFeatureTool(activeTool)) {
    return { selectedProfile: featureProfiles[0] ?? null, selectedProfiles: featureProfiles }
  }
  return {
    selectedProfile,
    selectedProfiles: selectedProfile ? [selectedProfile] : [],
  }
}

function rebuiltSketchDisplays(controller: DocumentControllerState) {
  const rebuild = controller.report?.rebuild
  return rebuild?.ok ? rebuild.response.sketches : []
}

function EditorContent({
  featureProfileSelections,
  featureProfileHiddenSketchIds,
  featurePreview,
  previewFeature,
  onFeatureProfileChange,
  revolveAxisCandidates,
  revolveAxisSelection,
  revolveSelectionPurpose,
  onRevolveAxisChange,
  props,
}: {
  featureProfileSelections: readonly SketchProfileSelector[]
  featureProfileHiddenSketchIds: readonly SketchId[]
  featurePreview: ReturnType<typeof useFeaturePreview>
  previewFeature: FeatureRecord | null
  onFeatureProfileChange: (
    profile: SketchProfileSelector,
    intent: ViewerSketchProfileSelectionIntent,
  ) => void
  revolveAxisCandidates: readonly RevolveAxisCandidate[]
  revolveAxisSelection: RevolveAxis | null
  revolveSelectionPurpose: RevolveSelectionPurpose
  onRevolveAxisChange: (axis: RevolveAxis) => void
  props: EditorWorkspaceProps
}) {
  const { actions, activeSketchId, activeSketchTool, controller, selection, workspace } = props
  const selectedSketch =
    controller.report?.snapshot.sketches.find(({ id }) => id === activeSketchId) ?? null
  const profileSelection = editorSketchProfileSelection(
    props.activeTool,
    featureProfileSelections,
    props.sketchSelectedProfile,
  )
  return (
    <WorkspaceContent
      actions={{
        onExtrusionDistanceChange: actions.setExtrusionDistance,
        onRevolveAngleChange: actions.setRevolveAngle,
        onSelectionChange: actions.select,
        onSavedSketchProfileSelect: savedProfileSelectionAction(props, onFeatureProfileChange),
        onRevolveAxisChange,
        onPrimitivePlacementChange: actions.setPrimitivePlacement,
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
        extrusionManipulator: extrusionManipulator(
          props.activeTool,
          previewFeature,
          props.extrusionDistanceRequest,
          rebuiltSketchDisplays(props.controller),
          props.controller.report?.mode === "read-only",
        ),
        featurePreview,
        primitiveManipulator: primitiveManipulator(
          props.activeTool,
          previewFeature,
          props.primitivePlacementRequest,
          props.controller.report?.mode === "read-only",
        ),
        revolveManipulator: revolveManipulator(
          props.activeTool,
          previewFeature,
          props.revolveAngleRequest,
          revolveAxisCandidates,
          rebuiltSketchDisplays(props.controller),
          props.controller.report?.mode === "read-only",
        ),
        hiddenFeatureIds: props.hiddenFeatureIds,
        hiddenSketchIds: [...props.hiddenSketchIds, ...featureProfileHiddenSketchIds],
        idleOriginPlaneSelectionAvailable: props.activeTool === null,
        originPlaneVisibility: props.originPlaneVisibility,
        preselectedFeatureId: props.preselectedFeatureId,
        selectedOriginPlane: props.selectedOriginPlane,
        selectedFeatureId: activeFeatureId(props.activeTool),
        selection,
        revolveAxisCandidates,
        revolveAxisSelectionActive:
          revolveAxisSelection !== null && revolveSelectionPurpose === "axis",
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
        selectedProfile: profileSelection.selectedProfile,
        selectedProfiles: profileSelection.selectedProfiles,
        selectedSketch,
        showFinalContext: props.sketchFinalContext,
      }}
    />
  )
}

function EditorTaskPanel({
  featurePreviewStatus,
  featureProfileSelections,
  onFeatureProfileRemove,
  onFeatureProfilesClear,
  onFeaturePreviewChange,
  onRevolveAxisChange,
  onRevolveSelectionPurposeChange,
  props,
  revolveAxisCandidates,
  revolveAxisSelection,
  revolveSelectionPurpose,
}: {
  featurePreviewStatus: ReturnType<typeof useFeaturePreview>["status"]
  featureProfileSelections: readonly SketchProfileSelector[]
  onFeatureProfileRemove: (profile: SketchProfileSelector) => void
  onFeatureProfilesClear: () => void
  onFeaturePreviewChange: (feature: FeatureRecord | null) => void
  onRevolveAxisChange: (axis: RevolveAxis) => void
  onRevolveSelectionPurposeChange: (purpose: RevolveSelectionPurpose) => void
  props: EditorWorkspaceProps
  revolveAxisCandidates: readonly RevolveAxisCandidate[]
  revolveAxisSelection: RevolveAxis | null
  revolveSelectionPurpose: RevolveSelectionPurpose
}) {
  const { actions } = props
  const selectedAxisLabel = revolveAxisSelection
    ? revolveAxisCandidates.find(({ axis }) => revolveAxisIntentsMatch(axis, revolveAxisSelection))
        ?.label
    : undefined
  return (
    <TaskPanel
      activeSketchId={props.activeSketchId}
      activeSketchTool={props.activeSketchTool}
      activeTool={props.activeTool}
      controller={props.controller}
      featurePreviewStatus={featurePreviewStatus}
      featureProfileSelections={featureProfileSelections}
      onFeatureProfileRemove={onFeatureProfileRemove}
      onFeatureProfilesClear={onFeatureProfilesClear}
      workspace={props.workspace}
      onCloseTool={actions.closeTool}
      onCreateBox={actions.createBox}
      onCreateCylinder={actions.createCylinder}
      onCreateExtrusion={actions.createExtrusion}
      onCreateRevolve={actions.createRevolve}
      onCreateSketch={actions.createSketch}
      onCreateSubtract={actions.createSubtract}
      onEditSketch={actions.editSketch}
      extrusionDistanceRequest={props.extrusionDistanceRequest}
      onFeaturePreviewChange={onFeaturePreviewChange}
      primitivePlacementRequest={props.primitivePlacementRequest}
      revolveAngleRequest={props.revolveAngleRequest}
      onRevolveAxisChange={onRevolveAxisChange}
      onRevolveAxisSelectionRequest={() => onRevolveSelectionPurposeChange("axis")}
      onRevolveProfileSelectionRequest={() => onRevolveSelectionPurposeChange("profile")}
      revolveAxisLineLabel={selectedAxisLabel}
      revolveAxisSelection={revolveAxisSelection ?? undefined}
      revolveProfileSelectionActive={revolveSelectionPurpose === "profile"}
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

function revolveAxisIntentsMatch(left: RevolveAxis, right: RevolveAxis) {
  if (left.kind !== right.kind) return false
  if (left.kind === "origin-axis") return right.kind === "origin-axis" && left.axis === right.axis
  if (left.kind === "sketch-line") {
    return right.kind === "sketch-line" && sketchLineAxesMatch(left, right)
  }
  return right.kind === "model-edge" && modelEdgeAxesMatch(left, right)
}

function sketchLineAxesMatch(
  left: Extract<RevolveAxis, { kind: "sketch-line" }>,
  right: Extract<RevolveAxis, { kind: "sketch-line" }>,
) {
  return left.sketchId === right.sketchId && left.entityId === right.entityId
}

function modelEdgeAxesMatch(
  left: Extract<RevolveAxis, { kind: "model-edge" }>,
  right: Extract<RevolveAxis, { kind: "model-edge" }>,
) {
  if (left.reference.featureId !== right.reference.featureId) return false
  if (left.reference.semanticRole && right.reference.semanticRole) {
    return left.reference.semanticRole === right.reference.semanticRole
  }
  if (left.reference.lineageToken && right.reference.lineageToken) {
    return left.reference.lineageToken === right.reference.lineageToken
  }
  return canonicalJson(left.reference.signature) === canonicalJson(right.reference.signature)
}

export function EditorWorkspace(props: EditorWorkspaceProps) {
  const { featurePreview, previewFeature, setPreviewFeature } = useEditorFeaturePreview(
    props.controller,
    props.activeTool,
  )
  const snapshot = props.controller.report?.snapshot
  const featureProfileSelection = useProfileFeatureSelection(props.activeTool, snapshot)
  const acknowledgeExtrusionDistance = props.actions.acknowledgeExtrusionDistance
  const acknowledgeRevolveAngle = props.actions.acknowledgeRevolveAngle
  const onFeaturePreviewChange = useCallback(
    (feature: FeatureRecord | null) => {
      setPreviewFeature(feature)
      if (feature) {
        acknowledgeExtrusionDistance(feature.id)
        acknowledgeRevolveAngle(feature.id)
      }
    },
    [acknowledgeExtrusionDistance, acknowledgeRevolveAngle, setPreviewFeature],
  )
  const revolveAxisSelection = useRevolveAxisSelection(props.activeTool, snapshot)
  const revolveSelectionPurpose = useRevolveSelectionPurpose(props.activeTool)
  const revolveAxisCandidates = useRevolveAxisCandidates(
    props.controller,
    props.activeTool,
    featureProfileSelection.value[0] ?? null,
    props.hiddenFeatureIds,
    revolveAxisSelection.value,
  )
  const featureProfileHiddenSketchIds = useMemo(
    () => (snapshot ? ineligibleProfileSketchIds(snapshot, props.activeTool) : []),
    [props.activeTool, snapshot],
  )
  const selectFeatureProfile = useCallback(
    (profile: SketchProfileSelector, intent: ViewerSketchProfileSelectionIntent) => {
      const previousProfile = featureProfileSelection.value[0] ?? null
      const nextProfiles = nextProfileFeatureSelection(
        featureProfileSelection.value,
        profile,
        intent,
      )
      featureProfileSelection.setValue(nextProfiles)
      if (props.activeTool?.kind !== "create-revolve" && props.activeTool?.kind !== "edit-revolve")
        return
      const nextAxis = revolveAxisAfterProfileSelection(
        revolveAxisSelection.value,
        previousProfile,
        nextProfiles[0] ?? profile,
      )
      if (nextAxis) revolveAxisSelection.setValue(nextAxis)
      revolveSelectionPurpose.setValue("axis")
    },
    [featureProfileSelection, props.activeTool, revolveAxisSelection, revolveSelectionPurpose],
  )
  const removeFeatureProfile = useCallback(
    (profile: SketchProfileSelector) => {
      featureProfileSelection.setValue(
        nextProfileFeatureSelection(featureProfileSelection.value, profile, "toggle"),
      )
    },
    [featureProfileSelection],
  )
  const clearFeatureProfiles = useCallback(
    () => featureProfileSelection.setValue([]),
    [featureProfileSelection],
  )
  return (
    <SketchProjectionProvider>
      <div className="cad-workspace-grid min-h-0">
        <EditorModelTree props={props} />
        <EditorContent
          featureProfileHiddenSketchIds={featureProfileHiddenSketchIds}
          featureProfileSelections={featureProfileSelection.value}
          featurePreview={featurePreview}
          previewFeature={previewFeature}
          onFeatureProfileChange={selectFeatureProfile}
          onRevolveAxisChange={revolveAxisSelection.setValue}
          props={props}
          revolveAxisCandidates={revolveAxisCandidates}
          revolveAxisSelection={revolveAxisSelection.value}
          revolveSelectionPurpose={revolveSelectionPurpose.value}
        />
        <EditorTaskPanel
          featurePreviewStatus={featurePreview.status}
          featureProfileSelections={featureProfileSelection.value}
          onFeatureProfileRemove={removeFeatureProfile}
          onFeatureProfilesClear={clearFeatureProfiles}
          onFeaturePreviewChange={onFeaturePreviewChange}
          onRevolveAxisChange={revolveAxisSelection.setValue}
          onRevolveSelectionPurposeChange={revolveSelectionPurpose.setValue}
          props={props}
          revolveAxisCandidates={revolveAxisCandidates}
          revolveAxisSelection={revolveAxisSelection.value}
          revolveSelectionPurpose={revolveSelectionPurpose.value}
        />
      </div>
    </SketchProjectionProvider>
  )
}
