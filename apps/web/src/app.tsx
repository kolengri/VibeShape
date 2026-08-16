import {
  createEmptySketch,
  defaultDocumentDisplayUnits,
  type FeatureId,
  type SketchId,
} from "@vibeshape/domain"
import { useTranslations } from "@vibeshape/i18n"
import { useCallback, useMemo, useRef } from "react"
import { useShallow } from "zustand/react/shallow"
import { resolveBuiltInEditorCommands } from "./commands/built-in-editor-commands"
import { useEditorCommandShortcuts } from "./commands/editor-command-shortcuts"
import { createBrowserSketchId, useDocumentController } from "./document/document-controller"
import { DocumentDisplayUnitsProvider } from "./document/document-display-units"
import { EditorSessionProvider, useEditorSession } from "./editor-session/editor-session-provider"
import {
  activePartDesignCommand,
  editPartDesignTool,
} from "./features/part-design/part-design-tool"
import { selectedSketchLineId } from "./features/sketch/sketch-constraint-tools"
import { ApplicationBar } from "./shell/application-bar"
import { EditorCommandPalette } from "./shell/command-palette"
import { CommandToolbar } from "./shell/command-toolbar"
import { EditorWorkspace, type EditorWorkspaceActions } from "./shell/editor-workspace"
import { StatusBar } from "./shell/status-bar"

function useEditorWorkspaceActions(controller: ReturnType<typeof useDocumentController>) {
  const t = useTranslations("app.shell.taskPanel.sketch")
  const sessionActions = useEditorSession((state) => state.actions)
  const { activeSketchId, selectedProfile } = useEditorSession(
    useShallow((state) => ({
      activeSketchId: state.sketch.activeSketchId,
      selectedProfile: state.sketch.selectedProfile,
    })),
  )

  const createSketch = useCallback(() => {
    const report = controller.report
    if (!report) return
    sessionActions.beginSketchCreate(
      createEmptySketch({
        id: createBrowserSketchId(),
        label: t("sketchLabel", { number: report.snapshot.sketches.length + 1 }),
        plane: "xy",
      }),
    )
  }, [controller.report, sessionActions, t])

  const editSketch = useCallback(
    (sketchId: SketchId) => {
      const source = controller.report?.snapshot.sketches.find(({ id }) => id === sketchId)
      if (source) sessionActions.beginSketchEdit(source)
    },
    [controller.report?.snapshot.sketches, sessionActions],
  )

  const createExtrusion = useCallback(() => {
    if (!selectedProfile || selectedProfile.sketchId !== activeSketchId) return
    sessionActions.startPartDesignTool({
      kind: "create-extrusion",
      profile: selectedProfile,
    })
  }, [activeSketchId, selectedProfile, sessionActions])

  const editFeature = useCallback(
    (featureId: FeatureId) => {
      const feature = controller.report?.snapshot.features.find(({ id }) => id === featureId)
      const editTool = editPartDesignTool(feature)
      if (editTool) sessionActions.startPartDesignTool(editTool)
    },
    [controller.report?.snapshot.features, sessionActions],
  )

  return useMemo(
    () =>
      ({
        closeTool: sessionActions.closeActiveTool,
        createBox: () => sessionActions.startPartDesignTool({ kind: "create-box" }),
        createCylinder: () => sessionActions.startPartDesignTool({ kind: "create-cylinder" }),
        createExtrusion,
        createSketch,
        createSubtract: () => sessionActions.startPartDesignTool({ kind: "create-subtract" }),
        editFeature,
        editSketch,
        select: sessionActions.setSelection,
        selectSketch: sessionActions.selectSketch,
        selectSketchPlane: sessionActions.selectSketchPlane,
        redoSketchDraft: sessionActions.redoSketchDraft,
        setSketchConstruction: sessionActions.setSketchConstruction,
        setSketchDraft: sessionActions.setSketchDraft,
        setSketchEditorTool: sessionActions.setSketchEditorTool,
        setSketchFailedConstraintIds: sessionActions.setSketchFailedConstraintIds,
        setSketchProfiles: sessionActions.setSketchProfiles,
        setSketchSelectedConstraintId: sessionActions.setSketchSelectedConstraintId,
        setSketchSelectedEntityIds: sessionActions.setSketchSelectedEntityIds,
        setSketchSelectedProfile: sessionActions.setSketchSelectedProfile,
        sketchSaved: sessionActions.saveSketch,
        switchWorkspace: sessionActions.switchWorkspace,
        undoSketchDraft: sessionActions.undoSketchDraft,
      }) satisfies EditorWorkspaceActions,
    [createExtrusion, createSketch, editFeature, editSketch, sessionActions],
  )
}

function EditorApplication({
  controller,
}: Readonly<{ controller: ReturnType<typeof useDocumentController> }>) {
  const session = useEditorSession(
    useShallow((state) => ({
      activePartDesignTool: state.activePartDesignTool,
      commandPaletteOpen: state.commandPaletteOpen,
      selection: state.selection,
      sketch: state.sketch,
      workspace: state.workspace,
    })),
  )
  const sessionActions = useEditorSession((state) => state.actions)
  const workspaceActions = useEditorWorkspaceActions(controller)
  const commandPaletteReturnFocusRef = useRef<HTMLElement | null>(null)
  const setCommandPaletteOpenWithFocus = useCallback(
    (open: boolean, returnFocusTarget?: HTMLElement) => {
      if (open) {
        commandPaletteReturnFocusRef.current =
          returnFocusTarget ??
          (document.activeElement instanceof HTMLElement ? document.activeElement : null)
      }
      sessionActions.setCommandPaletteOpen(open)
    },
    [sessionActions],
  )
  const extrusionAvailable =
    session.sketch.selectedProfile !== null &&
    session.sketch.selectedProfile.sketchId === session.sketch.activeSketchId &&
    session.sketch.activeSketchTool === null
  const slotFromSelectionAvailable =
    session.sketch.draft !== null &&
    selectedSketchLineId(session.sketch.draft, session.sketch.selectedEntityIds) !== null
  const commands = resolveBuiltInEditorCommands({
    actions: {
      cancelActive: workspaceActions.closeTool,
      createBox: workspaceActions.createBox,
      createCylinder: workspaceActions.createCylinder,
      createExtrusion: workspaceActions.createExtrusion,
      createSketch: workspaceActions.createSketch,
      createSubtract: workspaceActions.createSubtract,
      redoSketch: workspaceActions.redoSketchDraft,
      setSketchConstruction: workspaceActions.setSketchConstruction,
      setSketchTool: workspaceActions.setSketchEditorTool,
      switchWorkspace: workspaceActions.switchWorkspace,
      undoSketch: workspaceActions.undoSketchDraft,
    },
    state: {
      activePartDesignCommand: activePartDesignCommand(session.activePartDesignTool),
      activeSketchTool: session.sketch.activeSketchTool,
      controller,
      extrusionAvailable,
      sketchConstruction: session.sketch.construction,
      sketchRedoAvailable: session.sketch.redoStack.length > 0,
      slotFromSelectionAvailable,
      sketchTool: session.sketch.editorTool,
      sketchUndoAvailable: session.sketch.undoStack.length > 0,
      workspace: session.workspace,
    },
  })
  useEditorCommandShortcuts({
    commands,
    paletteOpen: session.commandPaletteOpen,
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
        open={session.commandPaletteOpen}
        returnFocusRef={commandPaletteReturnFocusRef}
        onOpenChange={setCommandPaletteOpenWithFocus}
      />
      <CommandToolbar commands={commands} />
      <EditorWorkspace
        actions={workspaceActions}
        activeSketchId={session.sketch.activeSketchId}
        activeSketchTool={session.sketch.activeSketchTool}
        activeTool={session.activePartDesignTool}
        controller={controller}
        workspace={session.workspace}
        selection={session.selection}
        sketchConstruction={session.sketch.construction}
        sketchDraft={session.sketch.draft}
        sketchEditorTool={session.sketch.editorTool}
        sketchFailedConstraintIds={session.sketch.failedConstraintIds}
        sketchProfiles={session.sketch.profiles}
        sketchSelectedConstraintId={session.sketch.selectedConstraintId}
        sketchSelectedEntityIds={session.sketch.selectedEntityIds}
        sketchSelectedProfile={session.sketch.selectedProfile}
      />
      <StatusBar controller={controller} selection={session.selection} />
    </main>
  )
}

export function App() {
  const t = useTranslations("app.shell.applicationBar")
  const controller = useDocumentController(t("untitledProject"))

  return (
    <DocumentDisplayUnitsProvider
      displayUnits={controller.report?.snapshot.displayUnits ?? defaultDocumentDisplayUnits}
    >
      <EditorSessionProvider>
        <EditorApplication controller={controller} />
      </EditorSessionProvider>
    </DocumentDisplayUnitsProvider>
  )
}
