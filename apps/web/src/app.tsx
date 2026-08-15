import {
  createEmptySketch,
  type FeatureId,
  type SketchConstraintId,
  type SketchEntityId,
  type SketchId,
  type SketchProfileSelector,
  type SketchRecord,
} from "@vibeshape/domain"
import { useTranslations } from "@vibeshape/i18n"
import type { ViewerSelection } from "@vibeshape/viewer/three-viewport"
import { useCallback, useRef, useState } from "react"
import { resolveBuiltInEditorCommands } from "./commands/built-in-editor-commands"
import { useEditorCommandShortcuts } from "./commands/editor-command-shortcuts"
import { createBrowserSketchId, useDocumentController } from "./document/document-controller"
import {
  type ActivePartDesignTool,
  activePartDesignCommand,
  editPartDesignTool,
} from "./features/part-design/part-design-tool"
import type {
  ActiveSketchTool,
  SketchDraftChangeMode,
  SketchEditorTool,
} from "./features/sketch/sketch-tool"
import { ApplicationBar } from "./shell/application-bar"
import { EditorCommandPalette } from "./shell/command-palette"
import { CommandToolbar } from "./shell/command-toolbar"
import { EditorWorkspace, type EditorWorkspaceActions } from "./shell/editor-workspace"
import { StatusBar } from "./shell/status-bar"
import type { EditorWorkspaceName } from "./shell/workspace"

function sameProfile(first: SketchProfileSelector, second: SketchProfileSelector) {
  return (
    first.sketchId === second.sketchId &&
    first.outerBoundaryEntityIds.join(":") === second.outerBoundaryEntityIds.join(":") &&
    first.holeBoundaryEntityIds.map((hole) => hole.join(":")).join("|") ===
      second.holeBoundaryEntityIds.map((hole) => hole.join(":")).join("|")
  )
}

function useSketchPresentationState() {
  const [construction, setConstruction] = useState(false)
  const [editorTool, setEditorTool] = useState<SketchEditorTool>("select")
  const [profiles, setProfiles] = useState<readonly SketchProfileSelector[]>([])
  const [failedConstraintIds, setFailedConstraintIds] = useState<readonly SketchConstraintId[]>([])
  const [selectedEntityIds, setSelectedEntityIds] = useState<readonly SketchEntityId[]>([])
  const [selectedProfile, setSelectedProfile] = useState<SketchProfileSelector | null>(null)
  const reset = useCallback((nextEditorTool: SketchEditorTool) => {
    setEditorTool(nextEditorTool)
    setProfiles([])
    setFailedConstraintIds([])
    setSelectedEntityIds([])
    setSelectedProfile(null)
  }, [])
  const profilesChanged = useCallback((nextProfiles: readonly SketchProfileSelector[]) => {
    setProfiles(nextProfiles)
    setSelectedProfile((current) => {
      const matching = current
        ? nextProfiles.find((profile) => sameProfile(profile, current))
        : undefined
      return matching ?? nextProfiles[0] ?? null
    })
  }, [])
  return {
    construction,
    editorTool,
    failedConstraintIds,
    profiles,
    profilesChanged,
    reset,
    selectedEntityIds,
    selectedProfile,
    setConstruction,
    setEditorTool,
    setFailedConstraintIds,
    setSelectedEntityIds,
    setSelectedProfile,
  }
}

function useSketchDraftHistory(clearSelection: () => void) {
  const [draft, setDraft] = useState<SketchRecord | null>(null)
  const undoStack = useRef<SketchRecord[]>([])
  const redoStack = useRef<SketchRecord[]>([])
  const reset = useCallback((nextDraft: SketchRecord | null) => {
    setDraft(nextDraft)
    undoStack.current = []
    redoStack.current = []
  }, [])
  const update = useCallback(
    (nextDraft: SketchRecord, mode: SketchDraftChangeMode = "record") => {
      if (draft && nextDraft !== draft && mode === "record") {
        undoStack.current = [...undoStack.current.slice(-99), draft]
        redoStack.current = []
      }
      setDraft(nextDraft)
    },
    [draft],
  )
  const undo = useCallback(() => {
    const previous = undoStack.current.at(-1)
    if (!draft || !previous) return
    undoStack.current = undoStack.current.slice(0, -1)
    redoStack.current = [...redoStack.current.slice(-99), draft]
    setDraft(previous)
    clearSelection()
  }, [clearSelection, draft])
  const redo = useCallback(() => {
    const next = redoStack.current.at(-1)
    if (!draft || !next) return
    redoStack.current = redoStack.current.slice(0, -1)
    undoStack.current = [...undoStack.current.slice(-99), draft]
    setDraft(next)
    clearSelection()
  }, [clearSelection, draft])
  return {
    draft,
    redo,
    redoAvailable: redoStack.current.length > 0,
    reset,
    undo,
    undoAvailable: undoStack.current.length > 0,
    update,
  }
}

function useSketchInteraction() {
  const presentation = useSketchPresentationState()
  const {
    reset: resetPresentation,
    setEditorTool,
    setFailedConstraintIds,
    setSelectedEntityIds,
  } = presentation
  const clearSelection = useCallback(() => setSelectedEntityIds([]), [setSelectedEntityIds])
  const history = useSketchDraftHistory(clearSelection)
  const { draft: historyDraft, reset: resetHistory, update: updateHistory } = history
  const [activeSketchTool, setActiveSketchTool] = useState<ActiveSketchTool | null>(null)
  const [activeSketchId, setActiveSketchId] = useState<SketchId | null>(null)
  const beginCreate = useCallback(
    (sketch: SketchRecord) => {
      setActiveSketchId(sketch.id)
      setActiveSketchTool({ kind: "select-sketch-plane" })
      resetHistory(sketch)
      resetPresentation("select")
    },
    [resetHistory, resetPresentation],
  )
  const selectPlane = useCallback(
    (plane: SketchRecord["plane"]) => {
      if (activeSketchTool?.kind !== "select-sketch-plane" || !historyDraft) return false
      updateHistory({ ...historyDraft, plane }, "replace")
      setActiveSketchTool({ kind: "create-sketch" })
      resetPresentation("line")
      return true
    },
    [activeSketchTool, historyDraft, resetPresentation, updateHistory],
  )
  const edit = useCallback(
    (sketch: SketchRecord) => {
      setActiveSketchId(sketch.id)
      setActiveSketchTool({ kind: "edit-sketch", sketchId: sketch.id })
      resetHistory(sketch)
      resetPresentation("select")
    },
    [resetHistory, resetPresentation],
  )
  const select = useCallback(
    (sketchId: SketchId) => {
      setActiveSketchId(sketchId)
      setActiveSketchTool(null)
      resetHistory(null)
      resetPresentation("select")
    },
    [resetHistory, resetPresentation],
  )
  const close = useCallback(() => {
    if (activeSketchTool?.kind !== "edit-sketch") setActiveSketchId(null)
    setActiveSketchTool(null)
    resetHistory(null)
    resetPresentation("select")
  }, [activeSketchTool, resetHistory, resetPresentation])
  const saved = useCallback(
    (sketch: SketchRecord) => {
      setActiveSketchId(sketch.id)
      setActiveSketchTool(null)
      resetHistory(null)
      setEditorTool("select")
      setFailedConstraintIds([])
      setSelectedEntityIds([])
    },
    [resetHistory, setEditorTool, setFailedConstraintIds, setSelectedEntityIds],
  )
  return {
    activeSketchId,
    activeSketchTool,
    close,
    construction: presentation.construction,
    beginCreate,
    draft: history.draft,
    edit,
    editorTool: presentation.editorTool,
    failedConstraintIds: presentation.failedConstraintIds,
    profiles: presentation.profiles,
    profilesChanged: presentation.profilesChanged,
    redo: history.redo,
    redoAvailable: history.redoAvailable,
    saved,
    select,
    selectPlane,
    selectedEntityIds: presentation.selectedEntityIds,
    selectedProfile: presentation.selectedProfile,
    setConstruction: presentation.setConstruction,
    setEditorTool,
    setFailedConstraintIds,
    setSelectedEntityIds,
    setSelectedProfile: presentation.setSelectedProfile,
    undo: history.undo,
    undoAvailable: history.undoAvailable,
    updateDraft: history.update,
  }
}

function useModelInteraction(
  controller: ReturnType<typeof useDocumentController>,
  sketch: ReturnType<typeof useSketchInteraction>,
) {
  const {
    activeSketchId,
    close: closeSketch,
    beginCreate: beginCreateSketchInteraction,
    edit: editSketchInteraction,
    selectedProfile,
    saved: sketchSaved,
    select: selectSketchInteraction,
    selectPlane: selectSketchPlaneInteraction,
  } = sketch
  const t = useTranslations("app.shell.taskPanel.sketch")
  const [workspace, setWorkspace] = useState<EditorWorkspaceName>("model")
  const [activeTool, setActiveTool] = useState<ActivePartDesignTool | null>(null)
  const [selection, setSelection] = useState<ViewerSelection | null>(null)
  const switchWorkspace = useCallback(
    (nextWorkspace: EditorWorkspaceName) => {
      setWorkspace(nextWorkspace)
      if (nextWorkspace !== "model") {
        setActiveTool(null)
        setSelection(null)
      }
      if (nextWorkspace !== "sketch") closeSketch()
    },
    [closeSketch],
  )
  const startModelTool = useCallback(
    (tool: ActivePartDesignTool) => {
      switchWorkspace("model")
      setActiveTool(tool)
    },
    [switchWorkspace],
  )
  const createSketch = useCallback(() => {
    const report = controller.report
    if (!report) return
    setWorkspace("model")
    setActiveTool(null)
    setSelection(null)
    beginCreateSketchInteraction(
      createEmptySketch({
        id: createBrowserSketchId(),
        label: t("sketchLabel", { number: report.snapshot.sketches.length + 1 }),
        plane: "xy",
      }),
    )
  }, [beginCreateSketchInteraction, controller.report, t])
  const selectSketchPlane = useCallback(
    (plane: SketchRecord["plane"]) => {
      if (!selectSketchPlaneInteraction(plane)) return
      setWorkspace("sketch")
      setSelection(null)
    },
    [selectSketchPlaneInteraction],
  )
  const editSketch = useCallback(
    (sketchId: SketchId) => {
      const source = controller.report?.snapshot.sketches.find(({ id }) => id === sketchId)
      if (!source) return
      setWorkspace("sketch")
      setActiveTool(null)
      setSelection(null)
      editSketchInteraction(source)
    },
    [controller.report?.snapshot.sketches, editSketchInteraction],
  )
  const selectSketch = useCallback(
    (sketchId: SketchId) => {
      setWorkspace("sketch")
      setActiveTool(null)
      setSelection(null)
      selectSketchInteraction(sketchId)
    },
    [selectSketchInteraction],
  )
  const closeTool = useCallback(() => {
    setActiveTool(null)
    closeSketch()
  }, [closeSketch])

  const createExtrusion = useCallback(() => {
    if (!selectedProfile || selectedProfile.sketchId !== activeSketchId) return
    startModelTool({ kind: "create-extrusion", profile: selectedProfile })
  }, [activeSketchId, selectedProfile, startModelTool])
  const editFeature = useCallback(
    (featureId: FeatureId) => {
      const feature = controller.report?.snapshot.features.find(({ id }) => id === featureId)
      const editTool = editPartDesignTool(feature)
      if (editTool) startModelTool(editTool)
    },
    [controller.report?.snapshot.features, startModelTool],
  )
  const extrusionAvailable =
    selectedProfile !== null &&
    selectedProfile.sketchId === activeSketchId &&
    sketch.activeSketchTool === null
  return {
    actions: {
      closeTool,
      createBox: () => startModelTool({ kind: "create-box" }),
      createCylinder: () => startModelTool({ kind: "create-cylinder" }),
      createExtrusion,
      createSketch,
      createSubtract: () => startModelTool({ kind: "create-subtract" }),
      editFeature,
      editSketch,
      select: setSelection,
      selectSketch,
      selectSketchPlane,
      setSketchConstruction: sketch.setConstruction,
      redoSketchDraft: sketch.redo,
      setSketchDraft: sketch.updateDraft,
      setSketchEditorTool: sketch.setEditorTool,
      setSketchFailedConstraintIds: sketch.setFailedConstraintIds,
      setSketchProfiles: sketch.profilesChanged,
      setSketchSelectedEntityIds: sketch.setSelectedEntityIds,
      setSketchSelectedProfile: sketch.setSelectedProfile,
      sketchSaved,
      switchWorkspace,
      undoSketchDraft: sketch.undo,
    } satisfies EditorWorkspaceActions,
    activeTool,
    extrusionAvailable,
    selection,
    workspace,
  }
}

export function App() {
  const t = useTranslations("app.shell.applicationBar")
  const controller = useDocumentController(t("untitledProject"))
  const sketch = useSketchInteraction()
  const model = useModelInteraction(controller, sketch)
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false)
  const commandPaletteReturnFocusRef = useRef<HTMLElement | null>(null)
  const setCommandPaletteOpenWithFocus = useCallback(
    (open: boolean, returnFocusTarget?: HTMLElement) => {
      if (open) {
        commandPaletteReturnFocusRef.current =
          returnFocusTarget ??
          (document.activeElement instanceof HTMLElement ? document.activeElement : null)
      }
      setCommandPaletteOpen(open)
    },
    [],
  )
  const commands = resolveBuiltInEditorCommands({
    actions: {
      cancelActive: model.actions.closeTool,
      createBox: model.actions.createBox,
      createCylinder: model.actions.createCylinder,
      createExtrusion: model.actions.createExtrusion,
      createSketch: model.actions.createSketch,
      createSubtract: model.actions.createSubtract,
      redoSketch: model.actions.redoSketchDraft,
      setSketchConstruction: model.actions.setSketchConstruction,
      setSketchTool: model.actions.setSketchEditorTool,
      switchWorkspace: model.actions.switchWorkspace,
      undoSketch: model.actions.undoSketchDraft,
    },
    state: {
      activePartDesignCommand: activePartDesignCommand(model.activeTool),
      activeSketchTool: sketch.activeSketchTool,
      controller,
      extrusionAvailable: model.extrusionAvailable,
      sketchConstruction: sketch.construction,
      sketchRedoAvailable: sketch.redoAvailable,
      sketchTool: sketch.editorTool,
      sketchUndoAvailable: sketch.undoAvailable,
      workspace: model.workspace,
    },
  })
  useEditorCommandShortcuts({
    commands,
    paletteOpen: commandPaletteOpen,
    onPaletteOpenChange: setCommandPaletteOpenWithFocus,
  })

  return (
    <main className="cad-shell bg-background text-[13px] text-foreground">
      <ApplicationBar
        controller={controller}
        onOpenCommandPalette={(returnFocusTarget) =>
          setCommandPaletteOpenWithFocus(true, returnFocusTarget)
        }
      />
      <EditorCommandPalette
        commands={commands}
        open={commandPaletteOpen}
        returnFocusRef={commandPaletteReturnFocusRef}
        onOpenChange={setCommandPaletteOpenWithFocus}
      />
      <CommandToolbar commands={commands} />
      <EditorWorkspace
        actions={model.actions}
        activeSketchId={sketch.activeSketchId}
        activeSketchTool={sketch.activeSketchTool}
        activeTool={model.activeTool}
        controller={controller}
        workspace={model.workspace}
        selection={model.selection}
        sketchConstruction={sketch.construction}
        sketchDraft={sketch.draft}
        sketchEditorTool={sketch.editorTool}
        sketchFailedConstraintIds={sketch.failedConstraintIds}
        sketchProfiles={sketch.profiles}
        sketchSelectedEntityIds={sketch.selectedEntityIds}
        sketchSelectedProfile={sketch.selectedProfile}
      />
      <StatusBar controller={controller} selection={model.selection} />
    </main>
  )
}
