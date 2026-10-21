import type { AssistantToolTargets } from "@vibeshape/automation-api/assistant"
import type {
  FeatureId,
  PartId,
  SketchConstraintId,
  SketchEntityId,
  SketchExternalReferenceId,
  SketchId,
  SketchProfileSelector,
  SketchRecord,
} from "@vibeshape/domain"
import { replaceSketchSupport, sketchIdSchema } from "@vibeshape/domain"
import {
  defaultViewerOriginPlaneVisibility,
  type ViewerOriginPlane,
  type ViewerOriginPlaneVisibility,
} from "@vibeshape/viewer/origin-planes"
import type { ViewerSelection } from "@vibeshape/viewer/three-viewport"
import type { Draft } from "immer"
import { immer } from "zustand/middleware/immer"
import { createStore } from "zustand/vanilla"
import {
  type ExtrusionDistanceRequest,
  finiteExtrusionDistance,
} from "../features/extrusion/extrusion-distance-manipulator"
import type { ModelBodySelection } from "../features/part-design/model-bodies"
import {
  type ActivePartDesignTool,
  isExtrusionPartDesignTool,
  isPrimitivePartDesignTool,
  isRevolvePartDesignTool,
} from "../features/part-design/part-design-tool"
import {
  finitePrimitivePlacement,
  type PrimitivePlacement,
  type PrimitivePlacementRequest,
} from "../features/part-design/primitive-placement"
import {
  finiteRevolveAngle,
  type RevolveAngleRequest,
} from "../features/revolve/revolve-angle-manipulator"
import type { SelectedSketchSupport } from "../features/sketch/sketch-support"
import {
  type ActiveSketchTool,
  isActiveSketchEditorTool,
  type SketchDraftChangeMode,
  type SketchEditorTool,
} from "../features/sketch/sketch-tool"
import type { ModelEdgeSelection } from "../shell/model-edge-selection"
import type { ModelTreeSelection } from "../shell/model-tree-selection"
import type { EditorWorkspaceName } from "../shell/workspace"
import type { PartVisibilityOverrides } from "./part-visibility"
import type { SketchVisibilityOverrides } from "./sketch-visibility"

function clearFeatureSelection(state: Draft<EditorSessionState>, featureId: FeatureId) {
  state.modelTreeSelection = state.modelTreeSelection.filter((item) =>
    item.kind === "body"
      ? item.featureId !== featureId
      : item.kind !== "feature" || item.id !== featureId,
  )
  for (const key of ["selection", "edgeSelection", "selectedBody", "preselectedBody"] as const) {
    if (state[key]?.featureId === featureId) state[key] = null
  }
  if (state.preselectedFeatureId === featureId) state.preselectedFeatureId = null
}

function clearHiddenSketchSelection(
  state: Draft<EditorSessionState>,
  hiddenSketchIds: ReadonlySet<SketchId>,
) {
  state.modelTreeSelection = state.modelTreeSelection.filter(
    (item) => item.kind !== "sketch" || !hiddenSketchIds.has(item.id),
  )
}

function clearTreePreselection(state: Draft<EditorSessionState>) {
  state.assistantToolPreselection = null
  state.preselectedSketchId = null
  state.preselectedBody = null
  state.preselectedFeatureId = null
}

const SKETCH_HISTORY_LIMIT = 100

export type SketchEditorSessionState = Readonly<{
  activeSketchId: SketchId | null
  activeSketchTool: ActiveSketchTool | null
  cameraMode: SketchCameraMode
  construction: boolean
  draft: SketchRecord | null
  editorTool: SketchEditorTool
  failedConstraintIds: readonly SketchConstraintId[]
  profiles: readonly SketchProfileSelector[]
  referenceDimensionLabels: Readonly<Record<string, string>>
  redoStack: readonly SketchRecord[]
  repairReferenceId: SketchExternalReferenceId | null
  selectedConstraintId: SketchConstraintId | null
  selectedEntityIds: readonly SketchEntityId[]
  selectedProfile: SketchProfileSelector | null
  showFinalContext: boolean
  undoStack: readonly SketchRecord[]
}>

export type SketchCameraMode = "normal" | "orbit" | "navigate" | "navigate-held"

export type EditorSessionState = Readonly<{
  assistantToolPreselection: Readonly<{ owner: string; targets: AssistantToolTargets }> | null
  activePartDesignTool: ActivePartDesignTool | null
  partDesignToolGeneration: number
  commandPaletteOpen: boolean
  extrusionDistanceRequest: ExtrusionDistanceRequest | null
  hiddenFeatureIds: readonly FeatureId[]
  hiddenSketchIds: readonly SketchId[]
  sketchVisibilityOverrides: SketchVisibilityOverrides
  partVisibilityOverrides: PartVisibilityOverrides
  originPlaneVisibility: ViewerOriginPlaneVisibility
  preselectedSketchId: SketchId | null
  preselectedBody: ModelBodySelection | null
  selectedBody: ModelBodySelection | null
  selectedPartId: PartId | null
  modelTreeSelection: readonly ModelTreeSelection[]
  preselectedFeatureId: FeatureId | null
  profileFeatureReturn: ProfileFeatureReturnContext | null
  primitivePlacementRequest: PrimitivePlacementRequest | null
  revolveAngleRequest: RevolveAngleRequest | null
  selectedOriginPlane: ViewerOriginPlane | null
  selection: ViewerSelection | null
  edgeSelection: ModelEdgeSelection | null
  sketch: SketchEditorSessionState
  workspace: EditorWorkspaceName
}>

type ProfileFeatureReturnContext = Readonly<{
  activeSketchId: SketchId
  profiles: readonly SketchProfileSelector[]
  selectedProfile: SketchProfileSelector | null
}>

export type EditorSessionActions = Readonly<{
  setAssistantToolPreselection: (owner: string, targets: AssistantToolTargets | null) => void
  acknowledgeExtrusionDistance: (featureId: FeatureId) => void
  acknowledgeRevolveAngle: (featureId: FeatureId) => void
  beginSketchCreate: (sketch: SketchRecord) => void
  beginSketchEdit: (sketch: SketchRecord) => void
  beginSketchSupportReplacement: () => void
  closeActiveTool: () => void
  completeActiveTool: (generation: number) => void
  redoSketchDraft: () => void
  saveSketch: (
    sketch: SketchRecord,
    presentation?: Readonly<{
      profiles: readonly SketchProfileSelector[]
      selectedProfile: SketchProfileSelector | null
    }>,
  ) => void
  selectSavedSketchProfile: (
    profile: SketchProfileSelector,
    profiles: readonly SketchProfileSelector[],
  ) => void
  selectSketchPlane: (plane: SketchRecord["plane"]) => void
  selectSketchSupport: (support: SelectedSketchSupport) => void
  setCommandPaletteOpen: (open: boolean) => void
  setFeatureVisibility: (featureId: FeatureId, visible: boolean) => void
  setPartVisibilityOverride: (partId: PartId, visible: boolean) => void
  clearPartVisibilityOverride: (partId: PartId) => void
  setOriginPlaneVisibility: (plane: ViewerOriginPlane, visible: boolean) => void
  setSelectedOriginPlane: (plane: ViewerOriginPlane | null) => void
  setSketchPreselection: (sketchId: SketchId | null) => void
  setBodyPreselection: (body: ModelBodySelection | null) => void
  setSelectedBody: (body: ModelBodySelection | null) => void
  setSelectedPart: (partId: PartId | null) => void
  setModelTreeSelection: (items: readonly ModelTreeSelection[]) => void
  setFeaturePreselection: (featureId: FeatureId | null) => void
  setExtrusionDistance: (featureId: FeatureId, distance: number, side?: "first" | "second") => void
  setPrimitivePlacement: (featureId: FeatureId, position: PrimitivePlacement) => void
  setRevolveAngle: (featureId: FeatureId, angle: number) => void
  setSketchVisibility: (sketchId: SketchId, visible: boolean) => void
  toggleAllSketchVisibility: (
    sketchIds: readonly SketchId[],
    effectiveHiddenIds?: readonly SketchId[],
  ) => void
  setModelEdgeSelection: (selection: ModelEdgeSelection | null) => void
  setSelection: (selection: ViewerSelection | null) => void
  setSketchConstruction: (construction: boolean) => void
  setSketchCameraMode: (mode: SketchCameraMode) => void
  setSketchFinalContext: (visible: boolean) => void
  setSketchDraft: (sketch: SketchRecord, mode?: SketchDraftChangeMode) => void
  setSketchEditorTool: (tool: SketchEditorTool) => void
  setSketchFailedConstraintIds: (constraintIds: readonly SketchConstraintId[]) => void
  setSketchProfiles: (profiles: readonly SketchProfileSelector[]) => void
  setSketchReferenceDimensionLabels: (labels: Readonly<Record<string, string>>) => void
  setSketchReferenceRepair: (referenceId: SketchExternalReferenceId | null) => void
  setSketchSelectedConstraintId: (constraintId: SketchConstraintId | null) => void
  setSketchSelectedEntityIds: (entityIds: readonly SketchEntityId[]) => void
  setSketchSelectedProfile: (profile: SketchProfileSelector | null) => void
  startPartDesignTool: (tool: ActivePartDesignTool) => void
  switchWorkspace: (workspace: EditorWorkspaceName) => void
  undoSketchDraft: () => void
}>

export type EditorSessionStore = EditorSessionState & Readonly<{ actions: EditorSessionActions }>

export type EditorSessionStoreApi = ReturnType<typeof createEditorSessionStore>

function createSketchState(): SketchEditorSessionState {
  return {
    activeSketchId: null,
    activeSketchTool: null,
    cameraMode: "orbit",
    construction: false,
    draft: null,
    editorTool: "select",
    failedConstraintIds: [],
    profiles: [],
    referenceDimensionLabels: {},
    redoStack: [],
    repairReferenceId: null,
    selectedConstraintId: null,
    selectedEntityIds: [],
    selectedProfile: null,
    showFinalContext: false,
    undoStack: [],
  }
}

function createEditorSessionState(overrides: SketchVisibilityOverrides): EditorSessionState {
  return {
    activePartDesignTool: null,
    partDesignToolGeneration: 0,
    commandPaletteOpen: false,
    assistantToolPreselection: null,
    extrusionDistanceRequest: null,
    hiddenFeatureIds: [],
    hiddenSketchIds: Object.keys(overrides)
      .filter((id) => !overrides[id])
      .map((id) => sketchIdSchema.parse(id)),
    sketchVisibilityOverrides: overrides,
    partVisibilityOverrides: {},
    originPlaneVisibility: { ...defaultViewerOriginPlaneVisibility },
    preselectedSketchId: null,
    preselectedBody: null,
    selectedBody: null,
    selectedPartId: null,
    modelTreeSelection: [],
    preselectedFeatureId: null,
    profileFeatureReturn: null,
    primitivePlacementRequest: null,
    revolveAngleRequest: null,
    selectedOriginPlane: null,
    selection: null,
    edgeSelection: null,
    sketch: createSketchState(),
    workspace: "model",
  }
}

function sameProfile(first: SketchProfileSelector, second: SketchProfileSelector) {
  return (
    first.sketchId === second.sketchId &&
    first.outerBoundaryEntityIds.join(":") === second.outerBoundaryEntityIds.join(":") &&
    first.holeBoundaryEntityIds.map((hole) => hole.join(":")).join("|") ===
      second.holeBoundaryEntityIds.map((hole) => hole.join(":")).join("|")
  )
}

function sameStringRecord(
  first: Readonly<Record<string, string>>,
  second: Readonly<Record<string, string>>,
) {
  const firstEntries = Object.entries(first)
  return (
    firstEntries.length === Object.keys(second).length &&
    firstEntries.every(([key, value]) => second[key] === value)
  )
}

function resetSketchPresentation(
  sketch: Draft<SketchEditorSessionState>,
  editorTool: SketchEditorTool,
) {
  // A new sketch session observes the current camera; only an explicit view command aligns it.
  sketch.cameraMode = "orbit"
  sketch.editorTool = editorTool
  sketch.failedConstraintIds = []
  sketch.profiles = []
  sketch.referenceDimensionLabels = {}
  sketch.repairReferenceId = null
  sketch.selectedConstraintId = null
  sketch.selectedEntityIds = []
  sketch.selectedProfile = null
  sketch.showFinalContext = false
}

function resetSketchDraft(sketch: Draft<SketchEditorSessionState>, draft: SketchRecord | null) {
  sketch.draft = draft
  sketch.redoStack = []
  sketch.undoStack = []
}

function closeSketch(sketch: Draft<SketchEditorSessionState>) {
  if (sketch.activeSketchTool?.kind !== "edit-sketch") sketch.activeSketchId = null
  sketch.activeSketchTool = null
  resetSketchDraft(sketch, null)
  resetSketchPresentation(sketch, "select")
}

function clearPartDesignTool(state: Draft<EditorSessionState>) {
  state.activePartDesignTool = null
  state.partDesignToolGeneration += 1
  state.extrusionDistanceRequest = null
  state.primitivePlacementRequest = null
  state.revolveAngleRequest = null
}

function profileFeatureReturnContext(state: Draft<EditorSessionState>, tool: ActivePartDesignTool) {
  if (tool.kind !== "create-extrusion" && tool.kind !== "create-revolve") return null
  const activeSketchId = state.sketch.activeSketchId
  if (!activeSketchId) return null
  const profiles = state.sketch.profiles.filter(({ sketchId }) => sketchId === activeSketchId)
  if (profiles.length === 0) return null
  const selectedProfile = state.sketch.selectedProfile
  return {
    activeSketchId,
    profiles: [...profiles],
    selectedProfile:
      selectedProfile && profiles.some((profile) => sameProfile(profile, selectedProfile))
        ? selectedProfile
        : (profiles[0] ?? null),
  }
}

function restoreProfileFeatureReturn(
  state: Draft<EditorSessionState>,
  context: ProfileFeatureReturnContext,
) {
  state.workspace = "model"
  state.selection = null
  state.edgeSelection = null
  state.sketch.activeSketchId = context.activeSketchId
  state.sketch.activeSketchTool = null
  resetSketchDraft(state.sketch, null)
  resetSketchPresentation(state.sketch, "select")
  state.sketch.profiles = [...context.profiles]
  state.sketch.selectedProfile = context.selectedProfile
}

function pushBoundedHistory(history: Draft<readonly SketchRecord[]>, sketch: SketchRecord) {
  history.push(sketch)
  if (history.length > SKETCH_HISTORY_LIMIT) {
    history.splice(0, history.length - SKETCH_HISTORY_LIMIT)
  }
}

export function createEditorSessionStore(overrides: SketchVisibilityOverrides = {}) {
  return createStore<EditorSessionStore>()(
    immer((set, get) => ({
      ...createEditorSessionState(overrides),
      actions: {
        acknowledgeExtrusionDistance: (featureId) =>
          set((state) => {
            if (state.extrusionDistanceRequest?.featureId === featureId) {
              state.extrusionDistanceRequest = null
            }
          }),
        acknowledgeRevolveAngle: (featureId) =>
          set((state) => {
            if (state.revolveAngleRequest?.featureId === featureId) {
              state.revolveAngleRequest = null
            }
          }),
        beginSketchCreate: (sketch) =>
          set((state) => {
            state.workspace = "model"
            clearPartDesignTool(state)
            state.profileFeatureReturn = null
            state.selectedOriginPlane = null
            state.selection = null
            state.edgeSelection = null
            state.selectedBody = null
            state.selectedPartId = null
            state.modelTreeSelection = []
            clearTreePreselection(state)
            state.sketch.activeSketchId = sketch.id
            state.sketch.activeSketchTool = { kind: "select-sketch-plane" }
            resetSketchDraft(state.sketch, sketch)
            resetSketchPresentation(state.sketch, "select")
          }),
        beginSketchEdit: (sketch) =>
          set((state) => {
            state.workspace = "sketch"
            clearPartDesignTool(state)
            state.profileFeatureReturn = null
            state.selectedOriginPlane = null
            state.selection = null
            state.edgeSelection = null
            state.selectedBody = null
            state.selectedPartId = null
            state.modelTreeSelection = []
            clearTreePreselection(state)
            state.sketch.activeSketchId = sketch.id
            state.sketch.activeSketchTool = { kind: "edit-sketch", sketchId: sketch.id }
            resetSketchDraft(state.sketch, sketch)
            resetSketchPresentation(state.sketch, "select")
          }),
        beginSketchSupportReplacement: () =>
          set((state) => {
            const tool = state.sketch.activeSketchTool
            if (!tool || !isActiveSketchEditorTool(tool) || !state.sketch.draft) return
            state.workspace = "model"
            state.selectedOriginPlane = null
            state.selection = null
            state.edgeSelection = null
            state.selectedBody = null
            state.selectedPartId = null
            state.modelTreeSelection = []
            state.sketch.activeSketchTool = {
              kind: "select-sketch-plane",
              returnTo: {
                showFinalContext: state.sketch.showFinalContext,
                tool,
              },
            }
            state.sketch.cameraMode = "orbit"
            state.sketch.showFinalContext = false
          }),
        closeActiveTool: () =>
          set((state) => {
            clearTreePreselection(state)
            state.modelTreeSelection = []
            if (!state.activePartDesignTool && !state.sketch.activeSketchTool) {
              state.selectedBody = null
              state.selectedPartId = null
              state.preselectedBody = null
              state.selection = null
              state.edgeSelection = null
              state.selectedOriginPlane = null
            }
            const profileFeatureReturn = state.profileFeatureReturn
            const returningFromProfileFeature =
              state.activePartDesignTool !== null && profileFeatureReturn !== null
            clearPartDesignTool(state)
            state.profileFeatureReturn = null
            if (returningFromProfileFeature) {
              restoreProfileFeatureReturn(state, profileFeatureReturn)
              return
            }
            const activeSketchTool = state.sketch.activeSketchTool
            if (activeSketchTool?.kind === "select-sketch-plane" && activeSketchTool.returnTo) {
              state.workspace = "sketch"
              state.selection = null
              state.edgeSelection = null
              state.selectedBody = null
              state.selectedPartId = null
              state.sketch.activeSketchTool = activeSketchTool.returnTo.tool
              state.sketch.cameraMode = "orbit"
              state.sketch.showFinalContext = activeSketchTool.returnTo.showFinalContext
              return
            }
            if (activeSketchTool) state.workspace = "model"
            closeSketch(state.sketch)
          }),
        completeActiveTool: (generation) =>
          set((state) => {
            if (!state.activePartDesignTool || state.partDesignToolGeneration !== generation) return
            clearPartDesignTool(state)
            state.profileFeatureReturn = null
            closeSketch(state.sketch)
          }),
        redoSketchDraft: () => {
          const { draft, redoStack } = get().sketch
          const next = redoStack.at(-1)
          if (!draft || !next) return
          set((state) => {
            const current = state.sketch.draft
            const nextDraft = state.sketch.redoStack.pop()
            if (!current || !nextDraft) return
            pushBoundedHistory(state.sketch.undoStack, current)
            state.sketch.draft = nextDraft
            state.sketch.selectedConstraintId = null
            state.sketch.selectedEntityIds = []
          })
        },
        saveSketch: (sketch, presentation) =>
          set((state) => {
            state.workspace = "model"
            state.profileFeatureReturn = null
            state.modelTreeSelection = []
            clearTreePreselection(state)
            state.sketch.activeSketchId = sketch.id
            state.sketch.activeSketchTool = null
            state.sketch.cameraMode = "orbit"
            resetSketchDraft(state.sketch, null)
            state.sketch.editorTool = "select"
            state.sketch.failedConstraintIds = []
            state.sketch.selectedConstraintId = null
            state.sketch.selectedEntityIds = []
            state.sketch.showFinalContext = false
            if (presentation) {
              state.sketch.profiles = [...presentation.profiles]
              state.sketch.selectedProfile = presentation.selectedProfile
            }
          }),
        selectSavedSketchProfile: (profile, profiles) =>
          set((state) => {
            const matchingProfile = profiles.find((candidate) => sameProfile(candidate, profile))
            if (!matchingProfile) return
            state.workspace = "model"
            clearPartDesignTool(state)
            state.profileFeatureReturn = null
            state.preselectedFeatureId = null
            state.selectedOriginPlane = null
            state.selection = null
            state.edgeSelection = null
            state.selectedBody = null
            state.selectedPartId = null
            state.modelTreeSelection = []
            state.sketch.activeSketchId = matchingProfile.sketchId
            state.sketch.activeSketchTool = null
            resetSketchDraft(state.sketch, null)
            resetSketchPresentation(state.sketch, "select")
            state.sketch.profiles = profiles.filter(
              (candidate) => candidate.sketchId === matchingProfile.sketchId,
            )
            state.sketch.selectedProfile = matchingProfile
          }),
        selectSketchPlane: (plane) => {
          const { activeSketchTool, draft } = get().sketch
          if (activeSketchTool?.kind !== "select-sketch-plane" || !draft) return
          const nextDraft = replaceSketchSupport(draft, { kind: "origin-plane", plane })
          set((state) => {
            if (!state.sketch.draft) return
            if (activeSketchTool.returnTo) {
              pushBoundedHistory(state.sketch.undoStack, state.sketch.draft)
              state.sketch.redoStack = []
              state.sketch.draft = nextDraft
              state.sketch.activeSketchTool = activeSketchTool.returnTo.tool
              resetSketchPresentation(state.sketch, "select")
            } else {
              state.sketch.draft = nextDraft
              state.sketch.activeSketchTool = { kind: "create-sketch" }
              resetSketchPresentation(state.sketch, "line")
            }
            state.workspace = "sketch"
            state.selectedOriginPlane = null
            state.selection = null
            state.edgeSelection = null
            state.selectedBody = null
            state.selectedPartId = null
            state.modelTreeSelection = []
          })
        },
        selectSketchSupport: ({ plane, support }) => {
          const { activeSketchTool, draft } = get().sketch
          if (activeSketchTool?.kind !== "select-sketch-plane" || !draft) return
          const nextDraft = replaceSketchSupport(draft, {
            kind: "feature-face",
            plane,
            support,
          })
          set((state) => {
            if (!state.sketch.draft) return
            if (activeSketchTool.returnTo) {
              pushBoundedHistory(state.sketch.undoStack, state.sketch.draft)
              state.sketch.redoStack = []
              state.sketch.draft = nextDraft
              state.sketch.activeSketchTool = activeSketchTool.returnTo.tool
              resetSketchPresentation(state.sketch, "select")
            } else {
              state.sketch.draft = nextDraft
              state.sketch.activeSketchTool = { kind: "create-sketch" }
              resetSketchPresentation(state.sketch, "line")
            }
            state.workspace = "sketch"
            state.selectedOriginPlane = null
            state.selection = null
            state.edgeSelection = null
            state.selectedBody = null
            state.selectedPartId = null
            state.modelTreeSelection = []
          })
        },
        setCommandPaletteOpen: (open) =>
          set((state) => {
            state.commandPaletteOpen = open
          }),
        setFeatureVisibility: (featureId, visible) =>
          set((state) => {
            state.hiddenFeatureIds = visible
              ? state.hiddenFeatureIds.filter((id) => id !== featureId)
              : [...new Set([...state.hiddenFeatureIds, featureId])]
            if (!visible) clearFeatureSelection(state, featureId)
          }),
        setPartVisibilityOverride: (partId, visible) =>
          set((state) => {
            state.partVisibilityOverrides[partId] = visible
            if (!visible) {
              state.modelTreeSelection = state.modelTreeSelection.filter(
                (item) => item.kind !== "part" || item.id !== partId,
              )
            }
            if (!visible && state.selectedPartId === partId) {
              state.selectedPartId = null
              state.selection = null
              state.edgeSelection = null
              state.selectedBody = null
            }
          }),
        clearPartVisibilityOverride: (partId) =>
          set((state) => {
            delete state.partVisibilityOverrides[partId]
          }),
        setAssistantToolPreselection: (owner, targets) =>
          set((state) => {
            if (targets) {
              state.preselectedFeatureId = null
              state.preselectedBody = null
              state.preselectedSketchId = null
              state.assistantToolPreselection = {
                owner,
                targets: {
                  projectId: targets.projectId,
                  featureIds: [...targets.featureIds],
                  sketchIds: [...targets.sketchIds],
                },
              }
            } else if (state.assistantToolPreselection?.owner === owner) {
              state.assistantToolPreselection = null
            }
          }),
        setSketchPreselection: (sketchId) =>
          set((state) => {
            state.assistantToolPreselection = null
            state.preselectedSketchId = sketchId
            state.preselectedBody = null
            state.preselectedFeatureId = null
          }),
        setBodyPreselection: (body) =>
          set((state) => {
            state.assistantToolPreselection = null
            state.preselectedSketchId = null
            state.preselectedBody = body
            state.preselectedFeatureId = null
          }),
        setModelTreeSelection: (items) =>
          set((state) => {
            state.modelTreeSelection = [...items]
            if (items.length) state.selectedOriginPlane = null
            const only = items.length === 1 ? items[0] : undefined
            state.selectedPartId = only?.kind === "part" ? only.id : null
            state.selectedBody =
              only?.kind === "body"
                ? {
                    featureId: only.featureId,
                    ...(only.outputRole === undefined ? {} : { outputRole: only.outputRole }),
                  }
                : null
            state.selection = null
            state.edgeSelection = null
          }),
        setSelectedBody: (body) =>
          set((state) => {
            state.modelTreeSelection = body ? [{ kind: "body", ...body }] : []
            state.selectedBody = body
            state.selectedPartId = null
            state.selection = null
            state.edgeSelection = null
            if (body) state.selectedOriginPlane = null
          }),
        setSelectedPart: (partId) =>
          set((state) => {
            state.modelTreeSelection = partId ? [{ kind: "part", id: partId }] : []
            state.selectedPartId = partId
            state.selectedBody = null
            state.selection = null
            state.edgeSelection = null
            state.selectedOriginPlane = null
          }),
        setFeaturePreselection: (featureId) =>
          set((state) => {
            state.assistantToolPreselection = null
            state.preselectedSketchId = null
            state.preselectedFeatureId = featureId
            state.preselectedBody = null
          }),
        setExtrusionDistance: (featureId, distance, side) =>
          set((state) => {
            if (!finiteExtrusionDistance(distance)) return
            if (!isExtrusionPartDesignTool(state.activePartDesignTool)) return
            state.extrusionDistanceRequest = {
              distance,
              featureId,
              sequence: (state.extrusionDistanceRequest?.sequence ?? 0) + 1,
              ...(side ? { side } : {}),
            }
          }),
        setRevolveAngle: (featureId, angle) =>
          set((state) => {
            if (!finiteRevolveAngle(angle)) return
            if (!isRevolvePartDesignTool(state.activePartDesignTool)) return
            state.revolveAngleRequest = {
              angle,
              featureId,
              sequence: (state.revolveAngleRequest?.sequence ?? 0) + 1,
            }
          }),
        setPrimitivePlacement: (featureId, position) =>
          set((state) => {
            if (!finitePrimitivePlacement(position)) return
            const tool = state.activePartDesignTool
            if (!isPrimitivePartDesignTool(tool)) return
            state.primitivePlacementRequest = {
              featureId,
              position: [...position],
              sequence: (state.primitivePlacementRequest?.sequence ?? 0) + 1,
            }
          }),
        setOriginPlaneVisibility: (plane, visible) =>
          set((state) => {
            state.originPlaneVisibility[plane] = visible
            if (!visible && state.selectedOriginPlane === plane) state.selectedOriginPlane = null
          }),
        setSelectedOriginPlane: (plane) =>
          set((state) => {
            state.selectedOriginPlane = plane
            if (plane) {
              state.selection = null
              state.edgeSelection = null
              state.selectedBody = null
              state.selectedPartId = null
              state.modelTreeSelection = []
            }
          }),
        setSketchVisibility: (sketchId, visible) =>
          set((state) => {
            state.sketchVisibilityOverrides[sketchId] = visible
            state.hiddenSketchIds = visible
              ? state.hiddenSketchIds.filter((id) => id !== sketchId)
              : [...new Set([...state.hiddenSketchIds, sketchId])]
            if (!visible) clearHiddenSketchSelection(state, new Set([sketchId]))
            if (!visible && state.sketch.activeSketchId === sketchId) {
              closeSketch(state.sketch)
            }
          }),
        toggleAllSketchVisibility: (sketchIds, effectiveHiddenIds) =>
          set((state) => {
            const currentSketchIds = [...new Set(sketchIds)]
            if (currentSketchIds.length === 0) return
            const currentSketchIdSet = new Set(currentSketchIds)
            const hiddenSketchIds = new Set(effectiveHiddenIds ?? state.hiddenSketchIds)
            const allHidden = currentSketchIds.every((id) => hiddenSketchIds.has(id))
            for (const id of currentSketchIds) state.sketchVisibilityOverrides[id] = allHidden
            state.hiddenSketchIds = allHidden
              ? state.hiddenSketchIds.filter((id) => !currentSketchIdSet.has(id))
              : [...new Set([...state.hiddenSketchIds, ...currentSketchIds])]
            if (allHidden) return
            clearHiddenSketchSelection(state, currentSketchIdSet)
            if (
              state.sketch.activeSketchId &&
              currentSketchIdSet.has(state.sketch.activeSketchId) &&
              !isActiveSketchEditorTool(state.sketch.activeSketchTool)
            ) {
              closeSketch(state.sketch)
            }
          }),
        setModelEdgeSelection: (edgeSelection) =>
          set((state) => {
            state.edgeSelection = edgeSelection
            if (!edgeSelection) return
            state.selection = null
            state.selectedBody = null
            state.selectedPartId = null
            state.selectedOriginPlane = null
            state.modelTreeSelection = []
            state.sketch.selectedProfile = null
          }),
        setSelection: (selection) =>
          set((state) => {
            state.modelTreeSelection = []
            state.selection = selection
            state.edgeSelection = null
            state.selectedBody = null
            state.selectedPartId = null
            if (selection) state.selectedOriginPlane = null
          }),
        setSketchConstruction: (construction) =>
          set((state) => {
            state.sketch.construction = construction
          }),
        setSketchCameraMode: (mode) =>
          set((state) => {
            if (
              !state.sketch.activeSketchTool ||
              state.sketch.activeSketchTool.kind === "select-sketch-plane"
            ) {
              return
            }
            state.sketch.cameraMode = mode
            if (
              mode === "normal" &&
              (state.sketch.editorTool === "intersection" || state.sketch.editorTool === "pierce")
            ) {
              state.sketch.editorTool = "select"
              state.sketch.repairReferenceId = null
            }
          }),
        setSketchFinalContext: (visible) =>
          set((state) => {
            if (state.sketch.activeSketchTool?.kind !== "edit-sketch") return
            state.sketch.showFinalContext = visible
          }),
        setSketchDraft: (sketch, mode = "record") => {
          const current = get().sketch.draft
          if (current === sketch) return
          set((state) => {
            if (mode === "record" && state.sketch.draft) {
              pushBoundedHistory(state.sketch.undoStack, state.sketch.draft)
              state.sketch.redoStack = []
            }
            state.sketch.draft = sketch
          })
        },
        setSketchEditorTool: (tool) =>
          set((state) => {
            state.sketch.editorTool = tool
            if (state.sketch.cameraMode.startsWith("navigate")) state.sketch.cameraMode = "orbit"
            state.sketch.repairReferenceId = null
            if (
              (tool === "intersection" || tool === "pierce") &&
              isActiveSketchEditorTool(state.sketch.activeSketchTool)
            ) {
              state.sketch.cameraMode = "orbit"
              state.sketch.showFinalContext = false
            }
          }),
        setSketchFailedConstraintIds: (constraintIds) =>
          set((state) => {
            state.sketch.failedConstraintIds = [...constraintIds]
          }),
        setSketchProfiles: (profiles) =>
          set((state) => {
            if (!state.sketch.activeSketchTool) return
            state.sketch.profiles = [...profiles]
            const selectedProfile = state.sketch.selectedProfile
            const matchingProfile = selectedProfile
              ? profiles.find((profile) => sameProfile(profile, selectedProfile))
              : undefined
            state.sketch.selectedProfile = matchingProfile ?? profiles[0] ?? null
          }),
        setSketchReferenceDimensionLabels: (labels) =>
          set((state) => {
            if (sameStringRecord(state.sketch.referenceDimensionLabels, labels)) return
            state.sketch.referenceDimensionLabels = { ...labels }
          }),
        setSketchReferenceRepair: (referenceId) =>
          set((state) => {
            if (!referenceId) {
              state.sketch.editorTool = "select"
              state.sketch.repairReferenceId = null
              return
            }
            const reference = state.sketch.draft?.externalReferences?.find(
              ({ id }) => id === referenceId,
            )
            if (!reference || reference.kind === "model-intersection") return
            const pierce =
              reference.kind === "pierce-point" || reference.kind === "model-pierce-point"
            state.sketch.editorTool = pierce ? "pierce" : "use"
            state.sketch.repairReferenceId = referenceId
            if (pierce) {
              state.sketch.cameraMode = "orbit"
              state.sketch.showFinalContext = false
            }
          }),
        setSketchSelectedConstraintId: (constraintId) =>
          set((state) => {
            state.sketch.selectedConstraintId = constraintId
            if (constraintId) state.sketch.selectedEntityIds = []
          }),
        setSketchSelectedEntityIds: (entityIds) =>
          set((state) => {
            state.sketch.selectedEntityIds = [...entityIds]
            state.sketch.selectedConstraintId = null
          }),
        setSketchSelectedProfile: (profile) =>
          set((state) => {
            state.sketch.selectedProfile = profile
          }),
        startPartDesignTool: (tool) =>
          set((state) => {
            clearTreePreselection(state)
            state.modelTreeSelection = []
            state.partDesignToolGeneration += 1
            if (tool.kind !== "measure" && tool.kind !== "surface-texture") {
              state.selectedBody = null
              state.selectedPartId = null
            }
            state.workspace = "model"
            state.profileFeatureReturn = profileFeatureReturnContext(state, tool)
            closeSketch(state.sketch)
            state.selectedOriginPlane = null
            state.extrusionDistanceRequest = null
            state.primitivePlacementRequest = null
            state.revolveAngleRequest = null
            state.activePartDesignTool =
              tool.kind === "create-extrusion" || tool.kind === "create-revolve"
                ? { ...tool, profiles: [...tool.profiles] }
                : tool
          }),
        switchWorkspace: (workspace) =>
          set((state) => {
            clearTreePreselection(state)
            state.workspace = workspace
            if (workspace !== "model") {
              clearPartDesignTool(state)
              state.profileFeatureReturn = null
              state.selectedOriginPlane = null
              state.selection = null
              state.edgeSelection = null
              state.selectedBody = null
              state.selectedPartId = null
              state.modelTreeSelection = []
            }
            if (workspace !== "sketch") closeSketch(state.sketch)
          }),
        undoSketchDraft: () => {
          const { draft, undoStack } = get().sketch
          const previous = undoStack.at(-1)
          if (!draft || !previous) return
          set((state) => {
            const current = state.sketch.draft
            const previousDraft = state.sketch.undoStack.pop()
            if (!current || !previousDraft) return
            pushBoundedHistory(state.sketch.redoStack, current)
            state.sketch.draft = previousDraft
            state.sketch.selectedConstraintId = null
            state.sketch.selectedEntityIds = []
          })
        },
      },
    })),
  )
}
