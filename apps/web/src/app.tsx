import {
  createEmptySketch,
  defaultDocumentDisplayUnits,
  type FeatureId,
  type SketchId,
  type SketchProfileSelector,
  type SketchRecord,
} from "@vibeshape/domain"
import { useTranslations } from "@vibeshape/i18n"
import type { ViewerOriginPlane } from "@vibeshape/viewer/origin-planes"
import { useCallback, useMemo, useRef } from "react"
import { useShallow } from "zustand/react/shallow"
import { resolveBuiltInEditorCommands } from "./commands/built-in-editor-commands"
import { useEditorCommandShortcuts } from "./commands/editor-command-shortcuts"
import {
  addSketch,
  createBrowserSketchId,
  updateSketch,
  useDocumentController,
} from "./document/document-controller"
import { DocumentDisplayUnitsProvider } from "./document/document-display-units"
import { EditorSessionProvider, useEditorSession } from "./editor-session/editor-session-provider"
import type {
  EditorSessionActions,
  EditorSessionState,
} from "./editor-session/editor-session-store"
import {
  activePartDesignCommand,
  editPartDesignTool,
} from "./features/part-design/part-design-tool"
import { selectedSketchLineId } from "./features/sketch/sketch-constraint-tools"
import { selectedSketchSupportFromController } from "./features/sketch/sketch-support"
import type { ActiveSketchTool } from "./features/sketch/sketch-tool"
import { ApplicationBar } from "./shell/application-bar"
import { EditorCommandPalette } from "./shell/command-palette"
import { CommandToolbar } from "./shell/command-toolbar"
import { EditorWorkspace, type EditorWorkspaceActions } from "./shell/editor-workspace"
import { StatusBar } from "./shell/status-bar"

type SketchPersistenceBeforeExtrusionResult = "failed" | "saved" | "unchanged"
type SketchPersistenceBeforeRevolveResult = SketchPersistenceBeforeExtrusionResult

type OpenSketchSaveRequest =
  | Readonly<{ kind: "failed" | "unchanged" }>
  | Readonly<{
      draft: SketchRecord
      kind: "save"
      revision: number
      save: typeof addSketch
    }>

const sketchSaveByToolKind: Partial<Record<ActiveSketchTool["kind"], typeof addSketch>> = {
  "create-sketch": addSketch,
  "edit-sketch": updateSketch,
}

function sketchSaveForTool(activeSketchTool: ActiveSketchTool | null) {
  if (!activeSketchTool) return null
  return sketchSaveByToolKind[activeSketchTool.kind] ?? null
}

function writableDocumentRevision(controller: ReturnType<typeof useDocumentController>) {
  const report = controller.report
  if (!report) return null
  if (report.mode !== "read-write") return null
  return report.snapshot.revision
}

function openSketchSaveRequest(
  controller: ReturnType<typeof useDocumentController>,
  activeSketchTool: ActiveSketchTool | null,
  draft: SketchRecord | null,
): OpenSketchSaveRequest {
  if (!draft) return { kind: "unchanged" }
  const save = sketchSaveForTool(activeSketchTool)
  if (!save) return { kind: "unchanged" }
  const revision = writableDocumentRevision(controller)
  if (revision === null) return { kind: "failed" }
  return { draft, kind: "save", revision, save }
}

async function persistOpenSketchBeforeExtrusion(
  request: OpenSketchSaveRequest,
): Promise<SketchPersistenceBeforeExtrusionResult> {
  if (request.kind !== "save") return request.kind === "failed" ? "failed" : "unchanged"
  const result = await request.save(request.revision, request.draft)
  return result.ok ? "saved" : "failed"
}
const persistOpenSketchBeforeRevolve = persistOpenSketchBeforeExtrusion

function selectedExtrusionProfile(
  profile: SketchProfileSelector | null,
  activeSketchId: SketchId | null,
) {
  return profile?.sketchId === activeSketchId ? profile : null
}

function applySavedSketchToSession(
  persistence: SketchPersistenceBeforeExtrusionResult,
  request: OpenSketchSaveRequest,
  saveSketch: (sketch: SketchRecord) => void,
) {
  if (persistence !== "saved") return
  if (request.kind !== "save") return
  saveSketch(request.draft)
}

function supportFromSelection(
  controller: ReturnType<typeof useDocumentController>,
  selection: Parameters<EditorSessionActions["setSelection"]>[0],
) {
  return selection ? selectedSketchSupportFromController(controller, selection) : null
}

function createSketchDraft(
  label: string,
  selectedSupport: ReturnType<typeof selectedSketchSupportFromController>,
  selectedOriginPlane: ViewerOriginPlane | null,
) {
  if (!selectedSupport) {
    return createEmptySketch({
      id: createBrowserSketchId(),
      label,
      plane: selectedOriginPlane ?? "xy",
    })
  }
  return createEmptySketch({
    id: createBrowserSketchId(),
    label,
    plane: selectedSupport.plane,
    support: selectedSupport.support,
  })
}

function selectedSupportForPlaneTool(
  controller: ReturnType<typeof useDocumentController>,
  activeSketchTool: ActiveSketchTool | null,
  selection: Parameters<EditorSessionActions["setSelection"]>[0],
) {
  if (activeSketchTool?.kind !== "select-sketch-plane") return null
  return supportFromSelection(controller, selection)
}

function useEditorWorkspaceActions(controller: ReturnType<typeof useDocumentController>) {
  const t = useTranslations("app.shell.taskPanel.sketch")
  const sessionActions = useEditorSession((state) => state.actions)
  const {
    activeSketchId,
    activeSketchTool,
    draft,
    selectedOriginPlane,
    selectedProfile,
    selection,
  } = useEditorSession(
    useShallow((state) => ({
      activeSketchId: state.sketch.activeSketchId,
      activeSketchTool: state.sketch.activeSketchTool,
      draft: state.sketch.draft,
      selectedOriginPlane: state.selectedOriginPlane,
      selectedProfile: state.sketch.selectedProfile,
      selection: state.selection,
    })),
  )

  const createSketch = useCallback(() => {
    const report = controller.report
    if (!report) return
    const selectedSupport = supportFromSelection(controller, selection)
    const sketch = createSketchDraft(
      t("sketchLabel", { number: report.snapshot.sketches.length + 1 }),
      selectedSupport,
      selectedOriginPlane,
    )
    sessionActions.beginSketchCreate(sketch)
    if (selectedSupport) {
      sessionActions.selectSketchSupport(selectedSupport)
    } else if (selectedOriginPlane) {
      sessionActions.selectSketchPlane(selectedOriginPlane)
    }
  }, [controller, selectedOriginPlane, selection, sessionActions, t])

  const createDatumPlane = useCallback(() => {
    const selectedSupport = supportFromSelection(controller, selection)
    sessionActions.startPartDesignTool({
      kind: "create-datum-plane",
      ...(selectedSupport ? { support: selectedSupport.support } : {}),
    })
  }, [controller, selection, sessionActions])

  const select = useCallback(
    (nextSelection: Parameters<typeof sessionActions.setSelection>[0]) => {
      sessionActions.setSelection(nextSelection)
      const support = selectedSupportForPlaneTool(controller, activeSketchTool, nextSelection)
      if (support) sessionActions.selectSketchSupport(support)
    },
    [activeSketchTool?.kind, controller, sessionActions],
  )

  const editSketch = useCallback(
    (sketchId: SketchId) => {
      const source = controller.report?.snapshot.sketches.find(({ id }) => id === sketchId)
      if (source) sessionActions.beginSketchEdit(source)
    },
    [controller.report?.snapshot.sketches, sessionActions],
  )

  const createExtrusion = useCallback(async () => {
    const profile = selectedExtrusionProfile(selectedProfile, activeSketchId)
    if (!profile) return false
    const request = openSketchSaveRequest(controller, activeSketchTool, draft)
    const persistence = await persistOpenSketchBeforeExtrusion(request)
    if (persistence === "failed") return false
    applySavedSketchToSession(persistence, request, sessionActions.saveSketch)
    sessionActions.startPartDesignTool({
      kind: "create-extrusion",
      profile,
    })
    return true
  }, [activeSketchId, activeSketchTool, controller.report, draft, selectedProfile, sessionActions])
  const createRevolve = useCallback(async () => {
    const profile = selectedExtrusionProfile(selectedProfile, activeSketchId)
    if (!profile) return false
    const request = openSketchSaveRequest(controller, activeSketchTool, draft)
    const persistence: SketchPersistenceBeforeRevolveResult =
      await persistOpenSketchBeforeRevolve(request)
    if (persistence === "failed") return false
    applySavedSketchToSession(persistence, request, sessionActions.saveSketch)
    sessionActions.startPartDesignTool({ kind: "create-revolve", profile })
    return true
  }, [activeSketchId, activeSketchTool, controller.report, draft, selectedProfile, sessionActions])

  const editFeature = useCallback(
    (featureId: FeatureId) => {
      const feature = controller.report?.snapshot.features.find(({ id }) => id === featureId)
      const editTool = editPartDesignTool(feature)
      if (editTool) sessionActions.startPartDesignTool(editTool)
    },
    [controller.report?.snapshot.features, sessionActions],
  )
  const toggleAllSketchVisibility = useCallback(
    () =>
      sessionActions.toggleAllSketchVisibility(
        controller.report?.snapshot.sketches.map(({ id }) => id) ?? [],
      ),
    [controller.report?.snapshot.sketches, sessionActions],
  )

  return useMemo(
    () =>
      ({
        closeTool: sessionActions.closeActiveTool,
        beginSketchSupportReplacement: sessionActions.beginSketchSupportReplacement,
        createBox: () => sessionActions.startPartDesignTool({ kind: "create-box" }),
        createCylinder: () => sessionActions.startPartDesignTool({ kind: "create-cylinder" }),
        createDatumPlane,
        createExtrusion,
        createRevolve,
        createSketch,
        createSubtract: () => sessionActions.startPartDesignTool({ kind: "create-subtract" }),
        editFeature,
        editSketch,
        preselectFeature: sessionActions.setFeaturePreselection,
        select,
        selectOriginPlane: sessionActions.setSelectedOriginPlane,
        selectSketchPlane: sessionActions.selectSketchPlane,
        redoSketchDraft: sessionActions.redoSketchDraft,
        setSketchConstruction: sessionActions.setSketchConstruction,
        setSketchDraft: sessionActions.setSketchDraft,
        setSketchEditorTool: sessionActions.setSketchEditorTool,
        setFeatureVisibility: sessionActions.setFeatureVisibility,
        setOriginPlaneVisibility: sessionActions.setOriginPlaneVisibility,
        setSketchVisibility: sessionActions.setSketchVisibility,
        setSketchFailedConstraintIds: sessionActions.setSketchFailedConstraintIds,
        setSketchProfiles: sessionActions.setSketchProfiles,
        setSketchReferenceDimensionLabels: sessionActions.setSketchReferenceDimensionLabels,
        setSketchReferenceRepair: sessionActions.setSketchReferenceRepair,
        setSketchSelectedConstraintId: sessionActions.setSketchSelectedConstraintId,
        setSketchSelectedEntityIds: sessionActions.setSketchSelectedEntityIds,
        setSketchSelectedProfile: sessionActions.setSketchSelectedProfile,
        sketchSaved: sessionActions.saveSketch,
        switchWorkspace: sessionActions.switchWorkspace,
        toggleAllSketchVisibility,
        undoSketchDraft: sessionActions.undoSketchDraft,
      }) satisfies EditorWorkspaceActions,
    [
      createDatumPlane,
      createExtrusion,
      createRevolve,
      createSketch,
      editFeature,
      editSketch,
      select,
      sessionActions,
      toggleAllSketchVisibility,
    ],
  )
}

type EditorApplicationSession = Pick<
  EditorSessionState,
  | "activePartDesignTool"
  | "commandPaletteOpen"
  | "hiddenFeatureIds"
  | "hiddenSketchIds"
  | "originPlaneVisibility"
  | "preselectedFeatureId"
  | "selectedOriginPlane"
  | "selection"
  | "sketch"
  | "workspace"
>

function useEditorApplicationSession() {
  return useEditorSession(
    useShallow((state) => ({
      activePartDesignTool: state.activePartDesignTool,
      commandPaletteOpen: state.commandPaletteOpen,
      hiddenFeatureIds: state.hiddenFeatureIds,
      hiddenSketchIds: state.hiddenSketchIds,
      originPlaneVisibility: state.originPlaneVisibility,
      preselectedFeatureId: state.preselectedFeatureId,
      selectedOriginPlane: state.selectedOriginPlane,
      selection: state.selection,
      sketch: state.sketch,
      workspace: state.workspace,
    })),
  )
}

function sketchProfileCommandAvailable(session: EditorApplicationSession) {
  return (
    session.sketch.selectedProfile !== null &&
    session.sketch.selectedProfile.sketchId === session.sketch.activeSketchId &&
    session.activePartDesignTool === null
  )
}

function sketchLineCommandAvailable(session: EditorApplicationSession) {
  if (!session.sketch.draft) return false
  return selectedSketchLineId(session.sketch.draft, session.sketch.selectedEntityIds) !== null
}

function resolveEditorApplicationCommands(
  controller: ReturnType<typeof useDocumentController>,
  session: EditorApplicationSession,
  sessionActions: EditorSessionActions,
  workspaceActions: EditorWorkspaceActions,
) {
  const profileCommandAvailable = sketchProfileCommandAvailable(session)
  return resolveBuiltInEditorCommands({
    actions: {
      cancelActive: workspaceActions.closeTool,
      createBox: workspaceActions.createBox,
      createCylinder: workspaceActions.createCylinder,
      createDatumPlane: workspaceActions.createDatumPlane,
      createExtrusion: workspaceActions.createExtrusion,
      createRevolve: workspaceActions.createRevolve,
      createSketch: workspaceActions.createSketch,
      createSubtract: workspaceActions.createSubtract,
      redoSketch: workspaceActions.redoSketchDraft,
      setSketchCameraMode: sessionActions.setSketchCameraMode,
      setSketchConstruction: workspaceActions.setSketchConstruction,
      setSketchFinalContext: sessionActions.setSketchFinalContext,
      setSketchTool: workspaceActions.setSketchEditorTool,
      switchWorkspace: workspaceActions.switchWorkspace,
      toggleAllSketchVisibility: workspaceActions.toggleAllSketchVisibility,
      undoSketch: workspaceActions.undoSketchDraft,
    },
    state: {
      activePartDesignCommand: activePartDesignCommand(session.activePartDesignTool),
      activeSketchTool: session.sketch.activeSketchTool,
      controller,
      extrusionAvailable: profileCommandAvailable,
      hasSavedSketches: (controller.report?.snapshot.sketches.length ?? 0) > 0,
      revolveAvailable: profileCommandAvailable,
      sketchConstruction: session.sketch.construction,
      sketchCameraMode: session.sketch.cameraMode,
      sketchFinalContext: session.sketch.showFinalContext,
      sketchRedoAvailable: session.sketch.redoStack.length > 0,
      slotFromSelectionAvailable: sketchLineCommandAvailable(session),
      sketchTool: session.sketch.editorTool,
      sketchUndoAvailable: session.sketch.undoStack.length > 0,
      workspace: session.workspace,
    },
  })
}

function EditorWorkspaceComposition({
  controller,
  session,
  sessionActions,
  workspaceActions,
}: Readonly<{
  controller: ReturnType<typeof useDocumentController>
  session: EditorApplicationSession
  sessionActions: EditorSessionActions
  workspaceActions: EditorWorkspaceActions
}>) {
  return (
    <EditorWorkspace
      actions={workspaceActions}
      activeSketchId={session.sketch.activeSketchId}
      activeSketchTool={session.sketch.activeSketchTool}
      activeTool={session.activePartDesignTool}
      controller={controller}
      hiddenFeatureIds={session.hiddenFeatureIds}
      hiddenSketchIds={session.hiddenSketchIds}
      originPlaneVisibility={session.originPlaneVisibility}
      onSketchFinalContextChange={sessionActions.setSketchFinalContext}
      preselectedFeatureId={session.preselectedFeatureId}
      selectedOriginPlane={session.selectedOriginPlane}
      workspace={session.workspace}
      selection={session.selection}
      sketchConstruction={session.sketch.construction}
      sketchCameraMode={session.sketch.cameraMode}
      sketchFinalContext={session.sketch.showFinalContext}
      sketchDraft={session.sketch.draft}
      sketchEditorTool={session.sketch.editorTool}
      sketchRepairReferenceId={session.sketch.repairReferenceId}
      sketchFailedConstraintIds={session.sketch.failedConstraintIds}
      sketchProfiles={session.sketch.profiles}
      sketchReferenceDimensionLabels={session.sketch.referenceDimensionLabels}
      sketchSelectedConstraintId={session.sketch.selectedConstraintId}
      sketchSelectedEntityIds={session.sketch.selectedEntityIds}
      sketchSelectedProfile={session.sketch.selectedProfile}
    />
  )
}

function EditorApplication({
  controller,
}: Readonly<{ controller: ReturnType<typeof useDocumentController> }>) {
  const session = useEditorApplicationSession()
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
  const commands = resolveEditorApplicationCommands(
    controller,
    session,
    sessionActions,
    workspaceActions,
  )
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
      <EditorWorkspaceComposition
        controller={controller}
        session={session}
        sessionActions={sessionActions}
        workspaceActions={workspaceActions}
      />
      <StatusBar
        controller={controller}
        selectedOriginPlane={session.selectedOriginPlane}
        selection={session.selection}
      />
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
      <EditorSessionProvider key={controller.report?.snapshot.id ?? "loading"}>
        <EditorApplication controller={controller} />
      </EditorSessionProvider>
    </DocumentDisplayUnitsProvider>
  )
}
