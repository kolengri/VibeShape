import type {
  SketchConstraintId,
  SketchEntityId,
  SketchId,
  SketchProfileSelector,
  SketchRecord,
} from "@vibeshape/domain"
import type { ViewerSelection } from "@vibeshape/viewer/three-viewport"
import type { Draft } from "immer"
import { immer } from "zustand/middleware/immer"
import { createStore } from "zustand/vanilla"
import type { ActivePartDesignTool } from "../features/part-design/part-design-tool"
import type {
  ActiveSketchTool,
  SketchDraftChangeMode,
  SketchEditorTool,
} from "../features/sketch/sketch-tool"
import type { EditorWorkspaceName } from "../shell/workspace"

const SKETCH_HISTORY_LIMIT = 100

export type SketchEditorSessionState = Readonly<{
  activeSketchId: SketchId | null
  activeSketchTool: ActiveSketchTool | null
  construction: boolean
  draft: SketchRecord | null
  editorTool: SketchEditorTool
  failedConstraintIds: readonly SketchConstraintId[]
  profiles: readonly SketchProfileSelector[]
  redoStack: readonly SketchRecord[]
  selectedEntityIds: readonly SketchEntityId[]
  selectedProfile: SketchProfileSelector | null
  undoStack: readonly SketchRecord[]
}>

export type EditorSessionState = Readonly<{
  activePartDesignTool: ActivePartDesignTool | null
  commandPaletteOpen: boolean
  selection: ViewerSelection | null
  sketch: SketchEditorSessionState
  workspace: EditorWorkspaceName
}>

export type EditorSessionActions = Readonly<{
  beginSketchCreate: (sketch: SketchRecord) => void
  beginSketchEdit: (sketch: SketchRecord) => void
  closeActiveTool: () => void
  redoSketchDraft: () => void
  saveSketch: (sketch: SketchRecord) => void
  selectSketch: (sketchId: SketchId) => void
  selectSketchPlane: (plane: SketchRecord["plane"]) => void
  setCommandPaletteOpen: (open: boolean) => void
  setSelection: (selection: ViewerSelection | null) => void
  setSketchConstruction: (construction: boolean) => void
  setSketchDraft: (sketch: SketchRecord, mode?: SketchDraftChangeMode) => void
  setSketchEditorTool: (tool: SketchEditorTool) => void
  setSketchFailedConstraintIds: (constraintIds: readonly SketchConstraintId[]) => void
  setSketchProfiles: (profiles: readonly SketchProfileSelector[]) => void
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
    construction: false,
    draft: null,
    editorTool: "select",
    failedConstraintIds: [],
    profiles: [],
    redoStack: [],
    selectedEntityIds: [],
    selectedProfile: null,
    undoStack: [],
  }
}

function createEditorSessionState(): EditorSessionState {
  return {
    activePartDesignTool: null,
    commandPaletteOpen: false,
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

function resetSketchPresentation(
  sketch: Draft<SketchEditorSessionState>,
  editorTool: SketchEditorTool,
) {
  sketch.editorTool = editorTool
  sketch.failedConstraintIds = []
  sketch.profiles = []
  sketch.selectedEntityIds = []
  sketch.selectedProfile = null
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
            state.selection = null
            state.sketch.activeSketchId = sketch.id
            state.sketch.activeSketchTool = { kind: "edit-sketch", sketchId: sketch.id }
            resetSketchDraft(state.sketch, sketch)
            resetSketchPresentation(state.sketch, "select")
          }),
        closeActiveTool: () =>
          set((state) => {
            state.activePartDesignTool = null
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
            state.sketch.selectedEntityIds = []
          })
        },
        saveSketch: (sketch) =>
          set((state) => {
            state.sketch.activeSketchId = sketch.id
            state.sketch.activeSketchTool = null
            resetSketchDraft(state.sketch, null)
            state.sketch.editorTool = "select"
            state.sketch.failedConstraintIds = []
            state.sketch.selectedEntityIds = []
          }),
        selectSketch: (sketchId) =>
          set((state) => {
            state.workspace = "sketch"
            state.activePartDesignTool = null
            state.selection = null
            state.sketch.activeSketchId = sketchId
            state.sketch.activeSketchTool = null
            resetSketchDraft(state.sketch, null)
            resetSketchPresentation(state.sketch, "select")
          }),
        selectSketchPlane: (plane) => {
          const { activeSketchTool, draft } = get().sketch
          if (activeSketchTool?.kind !== "select-sketch-plane" || !draft) return
          set((state) => {
            if (!state.sketch.draft) return
            state.sketch.draft.plane = plane
            state.sketch.activeSketchTool = { kind: "create-sketch" }
            resetSketchPresentation(state.sketch, "line")
            state.workspace = "sketch"
            state.selection = null
          })
        },
        setCommandPaletteOpen: (open) =>
          set((state) => {
            state.commandPaletteOpen = open
          }),
        setSelection: (selection) =>
          set((state) => {
            state.selection = selection
          }),
        setSketchConstruction: (construction) =>
          set((state) => {
            state.sketch.construction = construction
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
          }),
        setSketchFailedConstraintIds: (constraintIds) =>
          set((state) => {
            state.sketch.failedConstraintIds = [...constraintIds]
          }),
        setSketchProfiles: (profiles) =>
          set((state) => {
            state.sketch.profiles = [...profiles]
            const selectedProfile = state.sketch.selectedProfile
            const matchingProfile = selectedProfile
              ? profiles.find((profile) => sameProfile(profile, selectedProfile))
              : undefined
            state.sketch.selectedProfile = matchingProfile ?? profiles[0] ?? null
          }),
        setSketchSelectedEntityIds: (entityIds) =>
          set((state) => {
            state.sketch.selectedEntityIds = [...entityIds]
          }),
        setSketchSelectedProfile: (profile) =>
          set((state) => {
            state.sketch.selectedProfile = profile
          }),
        startPartDesignTool: (tool) =>
          set((state) => {
            state.workspace = "model"
            closeSketch(state.sketch)
            state.activePartDesignTool = tool
          }),
        switchWorkspace: (workspace) =>
          set((state) => {
            state.workspace = workspace
            if (workspace !== "model") {
              state.activePartDesignTool = null
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
            state.sketch.selectedEntityIds = []
          })
        },
      },
    })),
  )
}
