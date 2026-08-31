import type {
  FeatureId,
  SketchConstraintId,
  SketchEntityId,
  SketchExternalReferenceId,
  SketchId,
  SketchProfileSelector,
  SketchRecord,
} from "@vibeshape/domain"
import { replaceSketchSupport } from "@vibeshape/domain"
import {
  defaultViewerOriginPlaneVisibility,
  type ViewerOriginPlane,
  type ViewerOriginPlaneVisibility,
} from "@vibeshape/viewer/origin-planes"
import type { ViewerSelection } from "@vibeshape/viewer/three-viewport"
import type { Draft } from "immer"
import { immer } from "zustand/middleware/immer"
import { createStore } from "zustand/vanilla"
import type { ActivePartDesignTool } from "../features/part-design/part-design-tool"
import type { SelectedSketchSupport } from "../features/sketch/sketch-support"
import {
  type ActiveSketchTool,
  isActiveSketchEditorTool,
  type SketchDraftChangeMode,
  type SketchEditorTool,
} from "../features/sketch/sketch-tool"
import type { EditorWorkspaceName } from "../shell/workspace"

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

export type SketchCameraMode = "normal" | "orbit"

export type EditorSessionState = Readonly<{
  activePartDesignTool: ActivePartDesignTool | null
  commandPaletteOpen: boolean
  hiddenFeatureIds: readonly FeatureId[]
  hiddenSketchIds: readonly SketchId[]
  originPlaneVisibility: ViewerOriginPlaneVisibility
  preselectedFeatureId: FeatureId | null
  selectedOriginPlane: ViewerOriginPlane | null
  selection: ViewerSelection | null
  sketch: SketchEditorSessionState
  workspace: EditorWorkspaceName
}>

export type EditorSessionActions = Readonly<{
  beginSketchCreate: (sketch: SketchRecord) => void
  beginSketchEdit: (sketch: SketchRecord) => void
  beginSketchSupportReplacement: () => void
  closeActiveTool: () => void
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
  setOriginPlaneVisibility: (plane: ViewerOriginPlane, visible: boolean) => void
  setSelectedOriginPlane: (plane: ViewerOriginPlane | null) => void
  setFeaturePreselection: (featureId: FeatureId | null) => void
  setSketchVisibility: (sketchId: SketchId, visible: boolean) => void
  toggleAllSketchVisibility: (sketchIds: readonly SketchId[]) => void
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
    cameraMode: "normal",
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

function createEditorSessionState(): EditorSessionState {
  return {
    activePartDesignTool: null,
    commandPaletteOpen: false,
    hiddenFeatureIds: [],
    hiddenSketchIds: [],
    originPlaneVisibility: { ...defaultViewerOriginPlaneVisibility },
    preselectedFeatureId: null,
    selectedOriginPlane: null,
    selection: null,
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
  sketch.cameraMode = "normal"
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

function pushBoundedHistory(history: Draft<readonly SketchRecord[]>, sketch: SketchRecord) {
  history.push(sketch)
  if (history.length > SKETCH_HISTORY_LIMIT) {
    history.splice(0, history.length - SKETCH_HISTORY_LIMIT)
  }
}

export function createEditorSessionStore() {
  return createStore<EditorSessionStore>()(
    immer((set, get) => ({
      ...createEditorSessionState(),
      actions: {
        beginSketchCreate: (sketch) =>
          set((state) => {
            state.workspace = "model"
            state.activePartDesignTool = null
            state.selectedOriginPlane = null
            state.selection = null
            state.sketch.activeSketchId = sketch.id
            state.sketch.activeSketchTool = { kind: "select-sketch-plane" }
            resetSketchDraft(state.sketch, sketch)
            resetSketchPresentation(state.sketch, "select")
          }),
        beginSketchEdit: (sketch) =>
          set((state) => {
            state.workspace = "sketch"
            state.activePartDesignTool = null
            state.selectedOriginPlane = null
            state.selection = null
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
            state.sketch.activeSketchTool = {
              kind: "select-sketch-plane",
              returnTo: {
                cameraMode: state.sketch.cameraMode,
                showFinalContext: state.sketch.showFinalContext,
                tool,
              },
            }
            state.sketch.cameraMode = "normal"
            state.sketch.showFinalContext = false
          }),
        closeActiveTool: () =>
          set((state) => {
            state.activePartDesignTool = null
            const activeSketchTool = state.sketch.activeSketchTool
            if (activeSketchTool?.kind === "select-sketch-plane" && activeSketchTool.returnTo) {
              state.workspace = "sketch"
              state.selection = null
              state.sketch.activeSketchTool = activeSketchTool.returnTo.tool
              state.sketch.cameraMode = activeSketchTool.returnTo.cameraMode
              state.sketch.showFinalContext = activeSketchTool.returnTo.showFinalContext
              return
            }
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
            state.sketch.activeSketchId = sketch.id
            state.sketch.activeSketchTool = null
            state.sketch.cameraMode = "normal"
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
            state.activePartDesignTool = null
            state.preselectedFeatureId = null
            state.selectedOriginPlane = null
            state.selection = null
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
            if (!visible && state.selection?.featureId === featureId) state.selection = null
            if (!visible && state.preselectedFeatureId === featureId) {
              state.preselectedFeatureId = null
            }
          }),
        setFeaturePreselection: (featureId) =>
          set((state) => {
            state.preselectedFeatureId = featureId
          }),
        setOriginPlaneVisibility: (plane, visible) =>
          set((state) => {
            state.originPlaneVisibility[plane] = visible
            if (!visible && state.selectedOriginPlane === plane) state.selectedOriginPlane = null
          }),
        setSelectedOriginPlane: (plane) =>
          set((state) => {
            state.selectedOriginPlane = plane
            if (plane) state.selection = null
          }),
        setSketchVisibility: (sketchId, visible) =>
          set((state) => {
            state.hiddenSketchIds = visible
              ? state.hiddenSketchIds.filter((id) => id !== sketchId)
              : [...new Set([...state.hiddenSketchIds, sketchId])]
            if (!visible && state.sketch.activeSketchId === sketchId) {
              closeSketch(state.sketch)
            }
          }),
        toggleAllSketchVisibility: (sketchIds) =>
          set((state) => {
            const currentSketchIds = [...new Set(sketchIds)]
            if (currentSketchIds.length === 0) return
            const currentSketchIdSet = new Set(currentSketchIds)
            const hiddenSketchIds = new Set(state.hiddenSketchIds)
            const allHidden = currentSketchIds.every((id) => hiddenSketchIds.has(id))
            state.hiddenSketchIds = allHidden
              ? state.hiddenSketchIds.filter((id) => !currentSketchIdSet.has(id))
              : [...new Set([...state.hiddenSketchIds, ...currentSketchIds])]
            if (
              !allHidden &&
              state.sketch.activeSketchId &&
              currentSketchIdSet.has(state.sketch.activeSketchId)
            ) {
              closeSketch(state.sketch)
            }
          }),
        setSelection: (selection) =>
          set((state) => {
            state.selection = selection
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
            state.workspace = "model"
            closeSketch(state.sketch)
            state.selectedOriginPlane = null
            state.activePartDesignTool = tool
          }),
        switchWorkspace: (workspace) =>
          set((state) => {
            state.workspace = workspace
            if (workspace !== "model") {
              state.activePartDesignTool = null
              state.selectedOriginPlane = null
              state.selection = null
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
