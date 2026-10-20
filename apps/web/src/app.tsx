import {
  appendSketchConstraint,
  createEmptySketch,
  defaultDocumentDisplayUnits,
  type FeatureId,
  featureIdSchema,
  type SketchId,
  type SketchProfileSelector,
  type SketchRecord,
} from "@vibeshape/domain"
import type { HistoryItemRef } from "@vibeshape/domain/document-node"
import type { PartId } from "@vibeshape/domain/identifiers"
import { useTranslations } from "@vibeshape/i18n"
import { Button } from "@vibeshape/ui/components/button"
import type { ViewerOriginPlane } from "@vibeshape/viewer/origin-planes"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useShallow } from "zustand/react/shallow"
import { ApiAssistantProvider } from "./assistant/api-assistant-provider"
import { BrowserProjectAssistant } from "./assistant/browser-project-assistant"
import { getNativeAssistant } from "./assistant/native-assistant-bridge"
import { NativeProjectAssistant } from "./assistant/native-project-assistant"
import { resolveBuiltInEditorCommands } from "./commands/built-in-editor-commands"
import { editorCommandIds, type ResolvedEditorCommand } from "./commands/editor-command"
import { useEditorCommandShortcuts } from "./commands/editor-command-shortcuts"
import { getDesktopHost } from "./desktop/desktop-host"
import {
  addSketch,
  createBrowserSketchConstraintId,
  createBrowserSketchId,
  getDocumentControllerState,
  redoDocument,
  saveSketchEdits,
  setHistoryInsertionPoint,
  showProjectLibrary,
  undoDocument,
  useDocumentController,
} from "./document/document-controller"
import { DocumentDisplayUnitsProvider } from "./document/document-display-units"
import { DocumentProjectPage } from "./document/document-project-page"
import { ProjectNavigationNotice } from "./document/project-navigation-notice"
import {
  EditorSessionProvider,
  useEditorSession,
  useEditorSessionStoreApi,
  useHistoryNavigation,
} from "./editor-session/editor-session-provider"
import type {
  EditorSessionActions,
  EditorSessionState,
} from "./editor-session/editor-session-store"
import { effectiveHiddenSketchIds } from "./editor-session/sketch-visibility"
import {
  AssemblyContent,
  AssemblyModeSwitch,
  assemblyModeCommands,
  useAssemblyMode,
} from "./features/assembly/assembly-mode"
import { edgeTreatmentCreateTool } from "./features/edge-treatment/edge-treatment-activation"
import { LightweightingWorkspace } from "./features/lightweighting/lightweighting-workspace"
import { useLightweightingCommand } from "./features/lightweighting/use-lightweighting-command"
import {
  authoredPlacementTarget,
  selectedPlacementPart,
} from "./features/part-design/authored-part-selection"
import {
  activePartDesignCommand,
  editPartDesignTool,
  modifyingSolidTargetFeatures,
} from "./features/part-design/part-design-tool"
import { initialProfileFeatureSelection } from "./features/part-design/profile-feature-selection"
import {
  compatibleSketchConstraintToolsForSelection,
  selectedSketchLineId,
} from "./features/sketch/sketch-constraint-tools"
import { selectedSketchSupportFromController } from "./features/sketch/sketch-support"
import {
  type ActiveSketchTool,
  isActiveSketchEditorTool,
  type SketchEditorTool,
  sketchConstraintToolKind,
} from "./features/sketch/sketch-tool"
import { SketchToolbarPortalsProvider } from "./features/sketch/sketch-toolbar-portals"
import { useSketchTextApplication } from "./features/sketch/text/text-application"
import { SketchTextActionsProvider } from "./features/sketch/text/text-context"
import { SketchTextDialog } from "./features/sketch/text/text-dialog"
import { PROJECT_EDITOR_PANEL_ID, ProjectTabs, projectTabId } from "./project-tabs/project-tabs"
import { ProjectTabsProvider } from "./project-tabs/project-tabs-provider"
import { ApplicationBar } from "./shell/application-bar"
import { ApplicationChromeProvider } from "./shell/application-header"
import { currentAuthoredParts, selectedAuthoredBody } from "./shell/authored-tree-state"
import { AutomationConnectionsProvider, AutomationEditorScope } from "./shell/automation-status"
import { EditorCommandPalette, useCommandPaletteFocus } from "./shell/command-palette"
import { CommandToolbar } from "./shell/command-toolbar"
import { EditorWorkspace, type EditorWorkspaceActions } from "./shell/editor-workspace"
import { historyInsertionAnchor, historyInsertionContext } from "./shell/history-insertion-context"
import { historyFeatureForEditing, historySketchForEditing } from "./shell/history-repair-context"
import { partForModelBody } from "./shell/model-tree-selection"
import { ShortcutHelpDialog, useShortcutHelp } from "./shell/shortcut-help-dialog"
import { SketchNavigationControl } from "./shell/sketch-navigation-control"
import {
  SketchShortcutToolbar,
  type SketchShortcutToolbarAnchor,
} from "./shell/sketch-shortcut-toolbar"
import { StatusBar } from "./shell/status-bar"
import { useViewerPreferences, ViewerPreferencesProvider } from "./shell/viewer-preferences"
import { WorkspaceLayoutPreferencesProvider } from "./shell/workspace-layout-preferences"

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
  "edit-sketch": saveSketchEdits,
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

function profileFeatureSelectionForCommand(
  profiles: readonly SketchProfileSelector[],
  selectedProfile: SketchProfileSelector | null,
  activeSketchId: SketchId | null,
  activeSketchTool: ActiveSketchTool | null,
) {
  const candidates = sketchSaveForTool(activeSketchTool)
    ? profiles
    : selectedProfile
      ? [selectedProfile]
      : profiles
  return initialProfileFeatureSelection(candidates, activeSketchId)
}

function canStartProfileFeature(
  profiles: readonly SketchProfileSelector[],
  activeSketchTool: ActiveSketchTool | null,
  hasSavedSketches: boolean,
) {
  return profiles.length > 0 || (!activeSketchTool && hasSavedSketches)
}

function preselectedConstraintForTool(
  tool: SketchEditorTool,
  sketch: EditorSessionState["sketch"],
) {
  const constraintKind = sketchConstraintToolKind(tool)
  if (!constraintKind) return null
  const draft = sketch.draft
  if (!draft) return null
  const compatible = compatibleSketchConstraintToolsForSelection(
    draft,
    sketch.selectedEntityIds,
  ).find(({ kind }) => kind === constraintKind)
  return compatible ? compatible.definition : null
}

function useToggleAllSketchVisibility(controller: ReturnType<typeof useDocumentController>) {
  const autoHideConsumedSketches = useViewerPreferences((state) => state.autoHideConsumedSketches)
  const sessionActions = useEditorSession((state) => state.actions)
  const sessionStore = useEditorSessionStoreApi()
  return useCallback(
    () =>
      sessionActions.toggleAllSketchVisibility(
        controller.report?.snapshot.sketches.map(({ id }) => id) ?? [],
        effectiveHiddenSketchIds(
          controller.report,
          sessionStore.getState().sketchVisibilityOverrides,
          autoHideConsumedSketches,
          null,
        ),
      ),
    [controller.report, sessionActions, sessionStore, autoHideConsumedSketches],
  )
}

function useFeatureActivationActions(
  controller: ReturnType<typeof useDocumentController>,
  sessionActions: EditorSessionActions,
) {
  const navigation = useHistoryNavigation()
  const sessionStore = useEditorSessionStoreApi()
  const startBodyOperation = useCallback(
    (
      partId: PartId,
      kind:
        | "create-placement"
        | "create-mirror"
        | "create-shell"
        | "create-split"
        | "create-pattern"
        | "create-thread",
    ) => {
      const resolved = currentAuthoredParts(historyInsertionContext(controller)).find(
        ({ part }) => part.id === partId,
      )
      const targetBody = authoredPlacementTarget(resolved)
      if (targetBody) sessionActions.startPartDesignTool({ kind, partId, targetBody })
    },
    [controller, sessionActions],
  )
  const placePart = useCallback(
    (partId: PartId) => startBodyOperation(partId, "create-placement"),
    [startBodyOperation],
  )
  const mirrorPart = useCallback(
    (partId: PartId) => startBodyOperation(partId, "create-mirror"),
    [startBodyOperation],
  )
  const shellPart = useCallback(
    (partId: PartId) => startBodyOperation(partId, "create-shell"),
    [startBodyOperation],
  )

  const splitPart = useCallback(
    (partId: PartId) => startBodyOperation(partId, "create-split"),
    [startBodyOperation],
  )

  const patternPart = useCallback(
    (partId: PartId) => startBodyOperation(partId, "create-pattern"),
    [startBodyOperation],
  )

  const threadPart = useCallback(
    (partId: PartId) => startBodyOperation(partId, "create-thread"),
    [startBodyOperation],
  )

  const editFeature = useCallback(
    (featureId: FeatureId) => {
      const active = sessionStore.getState().activePartDesignTool
      const alreadyActive = Boolean(
        active?.kind.startsWith("edit-") && "featureId" in active && active.featureId === featureId,
      )
      void navigation.navigate(() => {
        setHistoryInsertionPoint(undefined)
        const feature = historyFeatureForEditing(getDocumentControllerState(), featureId)
        const editTool = editPartDesignTool(feature)
        if (editTool) sessionActions.startPartDesignTool(editTool)
      }, alreadyActive)
    },
    [navigation, sessionActions, sessionStore],
  )
  return { placePart, mirrorPart, shellPart, splitPart, patternPart, threadPart, editFeature }
}

function useSketchCreationActions(
  controller: ReturnType<typeof useDocumentController>,
  selection: EditorSessionState["selection"],
  selectedOriginPlane: ViewerOriginPlane | null,
) {
  const t = useTranslations("app.shell.taskPanel.sketch")
  const sessionActions = useEditorSession((state) => state.actions)
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

  return { createSketch, createDatumPlane }
}

function selectedEdgeTreatmentSource(
  parts: Parameters<typeof selectedPlacementPart>[0],
  current: Pick<EditorSessionState, "selectedBody" | "selectedPartId" | "selection">,
) {
  const body = current.selectedBody ?? current.selection
  return selectedPlacementPart(parts, current.selectedPartId, body)?.body ?? body
}

function useEditorWorkspaceActions(controller: ReturnType<typeof useDocumentController>) {
  const sessionStore = useEditorSessionStoreApi()
  const historyInsertionActions = useHistoryInsertionActions()
  const toggleAllSketchVisibility = useToggleAllSketchVisibility(controller)
  const hasSavedSketches = Boolean(controller.report?.snapshot.sketches.length)
  const sessionActions = useEditorSession((state) => state.actions)
  const {
    activeSketchId,
    activeSketchTool,
    draft,
    partDesignToolGeneration,
    profiles,
    selectedOriginPlane,
    selectedProfile,
    selection,
  } = useEditorSession(
    useShallow((state) => ({
      activeSketchId: state.sketch.activeSketchId,
      activeSketchTool: state.sketch.activeSketchTool,
      draft: state.sketch.draft,
      partDesignToolGeneration: state.partDesignToolGeneration,
      profiles: state.sketch.profiles,
      selectedOriginPlane: state.selectedOriginPlane,
      selectedProfile: state.sketch.selectedProfile,
      selection: state.selection,
    })),
  )

  const { createSketch, createDatumPlane } = useSketchCreationActions(
    controller,
    selection,
    selectedOriginPlane,
  )

  const select = useCallback(
    (nextSelection: Parameters<typeof sessionActions.setSelection>[0]) => {
      sessionActions.setSelection(nextSelection)
      const support = selectedSupportForPlaneTool(controller, activeSketchTool, nextSelection)
      if (support) sessionActions.selectSketchSupport(support)
    },
    [activeSketchTool?.kind, controller, sessionActions],
  )

  const editSketch = useSketchHistoryActivation(sessionActions)

  const createExtrusion = useCallback(async () => {
    const initialProfiles = profileFeatureSelectionForCommand(
      profiles,
      selectedProfile,
      activeSketchId,
      activeSketchTool,
    )
    if (!canStartProfileFeature(initialProfiles, activeSketchTool, hasSavedSketches)) return false
    const request = openSketchSaveRequest(controller, activeSketchTool, draft)
    const persistence = await persistOpenSketchBeforeExtrusion(request)
    if (persistence === "failed") return false
    applySavedSketchToSession(persistence, request, sessionActions.saveSketch)
    sessionActions.startPartDesignTool({
      kind: "create-extrusion",
      profiles: initialProfiles,
    })
    return true
  }, [
    activeSketchId,
    activeSketchTool,
    controller.report,
    draft,
    hasSavedSketches,
    profiles,
    selectedProfile,
    sessionActions,
  ])
  const createRevolve = useCallback(async () => {
    const initialProfiles = profileFeatureSelectionForCommand(
      profiles,
      selectedProfile,
      activeSketchId,
      activeSketchTool,
    )
    if (!canStartProfileFeature(initialProfiles, activeSketchTool, hasSavedSketches)) return false
    const request = openSketchSaveRequest(controller, activeSketchTool, draft)
    const persistence: SketchPersistenceBeforeRevolveResult =
      await persistOpenSketchBeforeRevolve(request)
    if (persistence === "failed") return false
    applySavedSketchToSession(persistence, request, sessionActions.saveSketch)
    sessionActions.startPartDesignTool({ kind: "create-revolve", profiles: initialProfiles })
    return true
  }, [
    activeSketchId,
    activeSketchTool,
    controller.report,
    draft,
    hasSavedSketches,
    profiles,
    selectedProfile,
    sessionActions,
  ])

  const { placePart, mirrorPart, shellPart, splitPart, patternPart, threadPart, editFeature } =
    useFeatureActivationActions(controller, sessionActions)
  const setSketchEditorTool = useSketchEditorToolActivation(sessionActions)
  const createEdgeTreatment = useCallback(
    (kind: "create-fillet" | "create-chamfer") => {
      const current = sessionStore.getState()
      const context = historyInsertionContext(controller)
      const selected = selectedEdgeTreatmentSource(currentAuthoredParts(context), current)
      const report = context.report
      const targets = report
        ? modifyingSolidTargetFeatures(report.snapshot.features, undefined, report.rebuild)
        : []
      sessionActions.startPartDesignTool(edgeTreatmentCreateTool(kind, selected, targets))
    },
    [controller, sessionActions, sessionStore],
  )

  return useMemo(
    () =>
      ({
        ...historyInsertionActions,
        acknowledgeExtrusionDistance: sessionActions.acknowledgeExtrusionDistance,
        acknowledgeRevolveAngle: sessionActions.acknowledgeRevolveAngle,
        closeTool: sessionActions.closeActiveTool,
        completeTool: () => sessionActions.completeActiveTool(partDesignToolGeneration),
        beginSketchSupportReplacement: sessionActions.beginSketchSupportReplacement,
        createFdm: () => sessionActions.startPartDesignTool({ kind: "create-fdm" }),
        createHole: () => sessionActions.startPartDesignTool({ kind: "create-hole" }),
        createFillet: () => createEdgeTreatment("create-fillet"),
        createChamfer: () => createEdgeTreatment("create-chamfer"),
        createBox: () => sessionActions.startPartDesignTool({ kind: "create-box" }),
        createCylinder: () => sessionActions.startPartDesignTool({ kind: "create-cylinder" }),
        createSphere: () => sessionActions.startPartDesignTool({ kind: "create-sphere" }),
        createCone: () => sessionActions.startPartDesignTool({ kind: "create-cone" }),
        createPyramid: () => sessionActions.startPartDesignTool({ kind: "create-pyramid" }),
        createTorus: () => sessionActions.startPartDesignTool({ kind: "create-torus" }),
        createDatumPlane,
        createExtrusion,
        createRevolve,
        createLoft: () => sessionActions.startPartDesignTool({ kind: "create-loft" }),
        createSweep: () => sessionActions.startPartDesignTool({ kind: "create-sweep" }),
        createSketch,
        createSubtract: () => sessionActions.startPartDesignTool({ kind: "create-subtract" }),
        combineParts: (operation: "compound" | "union") =>
          sessionActions.startPartDesignTool({
            kind: operation === "compound" ? "create-compound" : "create-union",
          }),
        measure: () => sessionActions.startPartDesignTool({ kind: "measure" }),
        surfaceTexture: (featureId, outputRole) =>
          sessionActions.startPartDesignTool({
            kind: "surface-texture",
            ...(featureId ? { featureId } : {}),
            ...(outputRole ? { outputRole } : {}),
          }),
        editFeature,
        editSketch,
        preselectSketch: sessionActions.setSketchPreselection,
        preselectFeature: sessionActions.setFeaturePreselection,
        preselectBody: sessionActions.setBodyPreselection,
        selectBody: sessionActions.setSelectedBody,
        selectPart: sessionActions.setSelectedPart,
        selectModelTreeItems: sessionActions.setModelTreeSelection,
        placePart,
        mirrorPart,
        shellPart,
        splitPart,
        patternPart,
        threadPart,
        setPrimitivePlacement: sessionActions.setPrimitivePlacement,
        setRevolveAngle: sessionActions.setRevolveAngle,
        select,
        selectSavedSketchProfile: sessionActions.selectSavedSketchProfile,
        selectOriginPlane: sessionActions.setSelectedOriginPlane,
        selectSketchPlane: sessionActions.selectSketchPlane,
        redoSketchDraft: sessionActions.redoSketchDraft,
        setSketchConstruction: sessionActions.setSketchConstruction,
        setSketchDraft: sessionActions.setSketchDraft,
        setSketchEditorTool,
        setFeatureVisibility: sessionActions.setFeatureVisibility,
        setExtrusionDistance: sessionActions.setExtrusionDistance,
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
        switchWorkspace: (workspace) => {
          if (workspace === "sketch" && !sessionStore.getState().sketch.activeSketchId)
            createSketch()
          else sessionActions.switchWorkspace(workspace)
        },
        toggleAllSketchVisibility,
        undoSketchDraft: sessionActions.undoSketchDraft,
      }) satisfies EditorWorkspaceActions,
    [
      historyInsertionActions,
      createEdgeTreatment,
      createDatumPlane,
      createExtrusion,
      createRevolve,
      createSketch,
      editFeature,
      editSketch,
      partDesignToolGeneration,
      placePart,
      mirrorPart,
      shellPart,
      splitPart,
      patternPart,
      threadPart,
      select,
      sessionActions,
      setSketchEditorTool,
      toggleAllSketchVisibility,
      sessionStore,
    ],
  )
}

function useSketchEditorToolActivation(sessionActions: EditorSessionActions) {
  const sessionStore = useEditorSessionStoreApi()
  const setSketchEditorTool = useCallback(
    (tool: SketchEditorTool) => {
      const currentSketch = sessionStore.getState().sketch
      const definition = preselectedConstraintForTool(tool, currentSketch)
      if (definition && currentSketch.draft) {
        sessionActions.setSketchDraft(
          appendSketchConstraint(currentSketch.draft, definition, createBrowserSketchConstraintId),
        )
        sessionActions.setSketchSelectedEntityIds([])
      }
      sessionActions.setSketchEditorTool(tool)
    },
    [sessionActions, sessionStore],
  )

  return setSketchEditorTool
}

function useSketchHistoryActivation(sessionActions: EditorSessionActions) {
  const sessionStore = useEditorSessionStoreApi()
  const navigation = useHistoryNavigation()
  const editSketch = useCallback(
    async (sketchId: SketchId) => {
      const currentDraft = sessionStore.getState().sketch.draft
      return navigation.navigate(() => {
        setHistoryInsertionPoint(undefined)
        const source = historySketchForEditing(getDocumentControllerState(), sketchId)
        if (source) sessionActions.beginSketchEdit(source)
      }, currentDraft?.id === sketchId)
    },
    [navigation, sessionStore, sessionActions],
  )

  return editSketch
}

function useHistoryInsertionActions() {
  const navigation = useHistoryNavigation()
  const actions = useEditorSession((state) => state.actions)
  const insertHistoryAt = useCallback(
    (item: HistoryItemRef, side: "above" | "below") =>
      navigation.navigate(() => {
        const insertion = historyInsertionAnchor(getDocumentControllerState(), item, side)
        if (!insertion.found) return
        actions.switchWorkspace("model")
        actions.setSelection(null)
        actions.setSelectedBody(null)
        actions.setSelectedPart(null)
        setHistoryInsertionPoint(insertion.anchor)
      }),
    [navigation, actions],
  )
  const returnHistoryToEnd = useCallback(
    () => navigation.navigate(() => setHistoryInsertionPoint(undefined)),
    [navigation],
  )
  return useMemo(
    () => ({ insertHistoryAt, returnHistoryToEnd }),
    [insertHistoryAt, returnHistoryToEnd],
  )
}

type EditorApplicationSession = Pick<
  EditorSessionState,
  | "activePartDesignTool"
  | "commandPaletteOpen"
  | "extrusionDistanceRequest"
  | "hiddenFeatureIds"
  | "partVisibilityOverrides"
  | "sketchVisibilityOverrides"
  | "originPlaneVisibility"
  | "preselectedSketchId"
  | "preselectedBody"
  | "selectedBody"
  | "selectedPartId"
  | "modelTreeSelection"
  | "preselectedFeatureId"
  | "primitivePlacementRequest"
  | "revolveAngleRequest"
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
      extrusionDistanceRequest: state.extrusionDistanceRequest,
      hiddenFeatureIds: state.hiddenFeatureIds,
      partVisibilityOverrides: state.partVisibilityOverrides,
      sketchVisibilityOverrides: state.sketchVisibilityOverrides,
      originPlaneVisibility: state.originPlaneVisibility,
      preselectedFeatureId: state.preselectedFeatureId,
      preselectedSketchId: state.preselectedSketchId,
      preselectedBody: state.preselectedBody,
      selectedBody: state.selectedBody,
      selectedPartId: state.selectedPartId,
      modelTreeSelection: state.modelTreeSelection,
      primitivePlacementRequest: state.primitivePlacementRequest,
      revolveAngleRequest: state.revolveAngleRequest,
      selectedOriginPlane: state.selectedOriginPlane,
      selection: state.selection,
      sketch: state.sketch,
      workspace: state.workspace,
    })),
  )
}

function sketchProfileCommandAvailable(
  session: EditorApplicationSession,
  hasSavedSketches: boolean,
) {
  if (session.activePartDesignTool) return false
  return canStartProfileFeature(
    profileFeatureSelectionForCommand(
      session.sketch.profiles,
      session.sketch.selectedProfile,
      session.sketch.activeSketchId,
      session.sketch.activeSketchTool,
    ),
    session.sketch.activeSketchTool,
    hasSavedSketches,
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
  dialogs: {
    openShortcutHelp: () => void
    openSketchText: () => void
    lightweighting: () => void
    quickLightweighting: () => void
    generativeDesign: () => void
  },
) {
  const profileCommandAvailable = sketchProfileCommandAvailable(
    session,
    Boolean(controller.report?.snapshot.sketches.length),
  )
  const undoCommittedDocument = async (baseRevision: number) => {
    const result = await undoDocument(baseRevision)
    if (result.ok) {
      sessionActions.setSelection(null)
      sessionActions.setFeaturePreselection(null)
    }
    return result
  }
  const redoCommittedDocument = async (baseRevision: number) => {
    const result = await redoDocument(baseRevision)
    if (result.ok) {
      sessionActions.setSelection(null)
      sessionActions.setFeaturePreselection(null)
    }
    return result
  }
  const parts = currentAuthoredParts(historyInsertionContext(controller))
  const selectedPart = selectedPlacementPart(
    parts,
    session.selectedPartId,
    session.selectedBody ?? session.selection,
  )
  const combinationBodies = new Set(
    parts.flatMap((part) => {
      const body = authoredPlacementTarget(part)
      return body ? [`${body.featureId}:${body.outputRole}`] : []
    }),
  )
  return resolveBuiltInEditorCommands({
    actions: {
      ...dialogs,
      cancelActive: workspaceActions.closeTool,
      documentRedo: redoCommittedDocument,
      documentUndo: undoCommittedDocument,
      placePart: workspaceActions.placePart,
      mirrorPart: workspaceActions.mirrorPart,
      shellPart: workspaceActions.shellPart,
      splitPart: workspaceActions.splitPart,
      patternPart: workspaceActions.patternPart,
      threadPart: workspaceActions.threadPart,
      combineParts: workspaceActions.combineParts,
      createFdm: workspaceActions.createFdm,
      createHole: workspaceActions.createHole,
      createFillet: workspaceActions.createFillet,
      createChamfer: workspaceActions.createChamfer,
      createBox: workspaceActions.createBox,
      createCylinder: workspaceActions.createCylinder,
      createSphere: workspaceActions.createSphere,
      createCone: workspaceActions.createCone,
      createPyramid: workspaceActions.createPyramid,
      createTorus: workspaceActions.createTorus,
      createDatumPlane: workspaceActions.createDatumPlane,
      createExtrusion: workspaceActions.createExtrusion,
      createRevolve: workspaceActions.createRevolve,
      createLoft: workspaceActions.createLoft,
      createSweep: workspaceActions.createSweep,
      createSketch: workspaceActions.createSketch,
      createSubtract: workspaceActions.createSubtract,
      measure: workspaceActions.measure,
      surfaceTexture: () => workspaceActions.surfaceTexture(),
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
      selectedExactPartId: selectedPart?.part.id ?? null,
      partCombinationAvailable: combinationBodies.size >= 2,
      selectionAvailable: [
        session.selectedPartId,
        session.selectedBody,
        session.selection,
        session.selectedOriginPlane,
      ].some(Boolean),
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
  navigationCommand,
  controller,
  session,
  sessionActions,
  workspaceActions,
}: Readonly<{
  controller: ReturnType<typeof useDocumentController>
  session: EditorApplicationSession
  sessionActions: EditorSessionActions
  workspaceActions: EditorWorkspaceActions
  navigationCommand: ResolvedEditorCommand | undefined
}>) {
  const autoHideConsumedSketches = useViewerPreferences((state) => state.autoHideConsumedSketches)
  const hiddenSketchIds = effectiveHiddenSketchIds(
    controller.report,
    session.sketchVisibilityOverrides,
    autoHideConsumedSketches,
    isActiveSketchEditorTool(session.sketch.activeSketchTool)
      ? session.sketch.activeSketchId
      : null,
  )
  return (
    <EditorWorkspace
      viewControls={
        isActiveSketchEditorTool(session.sketch.activeSketchTool) && navigationCommand ? (
          <SketchNavigationControl command={navigationCommand} />
        ) : null
      }
      actions={workspaceActions}
      activeSketchId={session.sketch.activeSketchId}
      activeSketchTool={session.sketch.activeSketchTool}
      activeTool={session.activePartDesignTool}
      controller={controller}
      extrusionDistanceRequest={session.extrusionDistanceRequest}
      hiddenFeatureIds={session.hiddenFeatureIds}
      partVisibility={{
        overrides: session.partVisibilityOverrides,
        setOverride: sessionActions.setPartVisibilityOverride,
        clearOverride: sessionActions.clearPartVisibilityOverride,
      }}
      hiddenSketchIds={hiddenSketchIds}
      originPlaneVisibility={session.originPlaneVisibility}
      onSketchFinalContextChange={sessionActions.setSketchFinalContext}
      onSketchOrbitStart={() => sessionActions.setSketchCameraMode("orbit")}
      preselectedFeatureId={session.preselectedFeatureId}
      preselectedSketchId={session.preselectedSketchId}
      preselectedBody={session.preselectedBody}
      selectedBody={session.selectedBody}
      selectedPartId={session.selectedPartId}
      modelTreeSelection={session.modelTreeSelection}
      primitivePlacementRequest={session.primitivePlacementRequest}
      revolveAngleRequest={session.revolveAngleRequest}
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

function sketchShortcutAnchorAtPointer(event: PointerEvent): SketchShortcutToolbarAnchor | null {
  const target = event.target
  if (!(target instanceof Element) || !target.closest("[data-sketch-shortcut-surface]")) return null
  return { x: event.clientX, y: event.clientY }
}

function useAuthoredEditorSession(controller: ReturnType<typeof useDocumentController>) {
  const storedSession = useEditorApplicationSession()
  const authoredParts = useMemo(
    () => currentAuthoredParts(historyInsertionContext(controller)),
    [controller.authoredSnapshot, controller.report, controller.historyInsertion],
  )
  return resolveAuthoredEditorSession(storedSession, authoredParts)
}

function resolveAuthoredEditorSession(
  storedSession: EditorApplicationSession,
  authoredParts: ReturnType<typeof currentAuthoredParts>,
) {
  if (storedSession.selectedPartId)
    return {
      ...storedSession,
      selectedBody: selectedAuthoredBody(
        authoredParts,
        storedSession.selectedPartId,
        storedSession.partVisibilityOverrides,
      ),
    }
  if (!storedSession.selection) return storedSession
  return sessionFromBodySelection(storedSession, authoredParts, storedSession.selection)
}

function sessionFromBodySelection(
  storedSession: EditorApplicationSession,
  authoredParts: ReturnType<typeof currentAuthoredParts>,
  selection: NonNullable<EditorApplicationSession["selection"]>,
) {
  const selectedBody = {
    featureId: featureIdSchema.parse(selection.featureId),
    ...(selection.outputRole === undefined ? {} : { outputRole: selection.outputRole }),
  }
  const part = partForModelBody(authoredParts, selectedBody)
  return {
    ...storedSession,
    selectedBody,
    selectedPartId: part?.part.id ?? null,
    modelTreeSelection: part
      ? [{ kind: "part" as const, id: part.part.id }]
      : [{ kind: "body" as const, ...selectedBody }],
  }
}

function useSketchShortcutToolbar(sketchShortcutToolbarAvailable: boolean) {
  const sketchShortcutReturnFocusRef = useRef<HTMLElement | null>(null)
  const lastSketchPointerRef = useRef<SketchShortcutToolbarAnchor | null>(null)
  const [sketchShortcutAnchor, setSketchShortcutAnchor] = useState<SketchShortcutToolbarAnchor>({
    x: 0,
    y: 0,
  })
  const [sketchShortcutToolbarOpen, setSketchShortcutToolbarOpen] = useState(false)
  useEffect(() => {
    const trackSketchPointer = (event: PointerEvent) => {
      lastSketchPointerRef.current = sketchShortcutAnchorAtPointer(event)
    }
    document.addEventListener("pointermove", trackSketchPointer, { passive: true })
    return () => document.removeEventListener("pointermove", trackSketchPointer)
  }, [])
  useEffect(() => {
    if (!sketchShortcutToolbarAvailable) setSketchShortcutToolbarOpen(false)
  }, [sketchShortcutToolbarAvailable])
  const closeSketchShortcutToolbar = useCallback(() => setSketchShortcutToolbarOpen(false), [])
  const openSketchShortcutToolbar = useCallback(() => {
    const surface = document.querySelector<HTMLElement>("[data-sketch-shortcut-surface]")
    if (!surface) return
    sketchShortcutReturnFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null
    const bounds = surface.getBoundingClientRect()
    setSketchShortcutAnchor(
      lastSketchPointerRef.current ?? {
        x: bounds.left + bounds.width / 2,
        y: bounds.top + bounds.height / 2,
      },
    )
    setSketchShortcutToolbarOpen(true)
  }, [])
  const setSketchShortcutToolbarOpenWithAnchor = useCallback(
    (open: boolean) => (open ? openSketchShortcutToolbar() : closeSketchShortcutToolbar()),
    [closeSketchShortcutToolbar, openSketchShortcutToolbar],
  )
  return {
    sketchShortcutAnchor,
    sketchShortcutToolbarOpen,
    sketchShortcutReturnFocusRef,
    setSketchShortcutToolbarOpenWithAnchor,
  }
}

function lightweightingWorkspaceActive(session: EditorApplicationSession) {
  return (
    session.workspace === "model" &&
    !session.activePartDesignTool &&
    !session.sketch.activeSketchTool
  )
}

function useProjectAssistant(controller: ReturnType<typeof useDocumentController>) {
  const t = useTranslations("app.assistant")
  const [open, setOpen] = useState(false)
  const bridge = getNativeAssistant()
  const close = () => setOpen(false)
  return {
    toggle: (
      <Button size="sm" variant="ghost" aria-expanded={open} onClick={() => setOpen(!open)}>
        {t("title")}
      </Button>
    ),
    panel: bridge ? (
      <NativeProjectAssistant bridge={bridge} controller={controller} open={open} onClose={close} />
    ) : (
      <BrowserProjectAssistant controller={controller} open={open} onClose={close} />
    ),
  }
}

function assemblySwitchDisabled(
  controller: ReturnType<typeof useDocumentController>,
  session: ReturnType<typeof useAuthoredEditorSession>,
) {
  return (
    controller.status !== "ready" ||
    controller.saveStatus === "saving" ||
    Boolean(session.activePartDesignTool || session.sketch.activeSketchTool)
  )
}

function EditorApplication({
  controller,
}: Readonly<{ controller: ReturnType<typeof useDocumentController> }>) {
  const assistant = useProjectAssistant(controller)
  const session = useAuthoredEditorSession(controller)
  const sessionActions = useEditorSession((state) => state.actions)
  const workspaceActions = useEditorWorkspaceActions(controller)
  const textDialog = useSketchTextApplication(controller)
  const assemblyMode = useAssemblyMode(workspaceActions.switchWorkspace)
  const lightweighting = useLightweightingCommand({
    controller,
    selectedPartId: session.selectedPartId,
    selectedBody: session.selectedBody,
    selection: session.selection,
    assemblyActive: assemblyMode.active,
  })
  const commandPaletteFocus = useCommandPaletteFocus(sessionActions.setCommandPaletteOpen)
  const shortcutHelp = useShortcutHelp()
  const sketchShortcutToolbarAvailable = isActiveSketchEditorTool(session.sketch.activeSketchTool)
  const {
    sketchShortcutAnchor,
    sketchShortcutToolbarOpen,
    sketchShortcutReturnFocusRef,
    setSketchShortcutToolbarOpenWithAnchor,
  } = useSketchShortcutToolbar(sketchShortcutToolbarAvailable)
  const modelCommands = resolveEditorApplicationCommands(
    controller,
    session,
    sessionActions,
    workspaceActions,
    {
      openShortcutHelp: shortcutHelp.show,
      openSketchText: textDialog.actions.create,
      lightweighting: () => {
        workspaceActions.closeTool()
        lightweighting.show()
      },
      quickLightweighting: () => {
        workspaceActions.closeTool()
        lightweighting.show("quick")
      },
      generativeDesign: () => {
        workspaceActions.closeTool()
        lightweighting.show("generative")
      },
    },
  )
  const commands = assemblyModeCommands(modelCommands, assemblyMode.active)
  useEditorCommandShortcuts({
    commands,
    paletteOpen: session.commandPaletteOpen,
    sketchShortcutToolbarAvailable,
    sketchShortcutToolbarOpen,
    onPaletteOpenChange: commandPaletteFocus.setOpen,
    onSketchShortcutToolbarOpenChange: setSketchShortcutToolbarOpenWithAnchor,
    onSketchNavigationHoldStart: () => sessionActions.setSketchCameraMode("navigate-held"),
  })

  const navigationCommand = commands.find(
    ({ descriptor }) => descriptor.id === editorCommandIds.sketchNavigateView,
  )
  const modelWorkspace = (
    <LightweightingWorkspace
      workflow={lightweighting}
      controller={historyInsertionContext(controller)}
      active={lightweightingWorkspaceActive(session)}
    >
      <EditorWorkspaceComposition
        navigationCommand={navigationCommand}
        controller={controller}
        session={session}
        sessionActions={sessionActions}
        workspaceActions={workspaceActions}
      />
    </LightweightingWorkspace>
  )
  return (
    <main
      className="cad-shell bg-background text-[13px] text-foreground"
      data-window-chrome={getDesktopHost()?.windowChrome}
    >
      <ApplicationBar
        controller={controller}
        projectNavigation={<LocalizedProjectTabs controller={controller} />}
        hideModelExport={assemblyMode.active}
        onOpenShortcutHelp={shortcutHelp.show}
        onOpenCommandPalette={(returnFocusTarget) =>
          commandPaletteFocus.setOpen(true, returnFocusTarget)
        }
      >
        {assistant.toggle}
        <AssemblyModeSwitch
          active={assemblyMode.active}
          disabled={assemblySwitchDisabled(controller, session)}
          onChange={assemblyMode.onChange}
        />
      </ApplicationBar>
      {assistant.panel}
      <ShortcutHelpDialog
        commands={commands}
        open={shortcutHelp.open}
        onOpenChange={shortcutHelp.setOpen}
        returnFocusRef={shortcutHelp.returnFocusRef}
      />
      <EditorCommandPalette
        commands={commands}
        open={session.commandPaletteOpen}
        returnFocusRef={commandPaletteFocus.returnFocusRef}
        onOpenChange={commandPaletteFocus.setOpen}
      />
      <SketchShortcutToolbar
        anchor={sketchShortcutAnchor}
        commands={commands}
        open={sketchShortcutToolbarOpen}
        returnFocusRef={sketchShortcutReturnFocusRef}
        onOpenChange={setSketchShortcutToolbarOpenWithAnchor}
      />
      <div
        className="contents"
        id={PROJECT_EDITOR_PANEL_ID}
        role="tabpanel"
        aria-labelledby={
          controller.report ? projectTabId(controller.report.snapshot.id) : undefined
        }
      >
        <SketchTextActionsProvider actions={textDialog.actions}>
          <SketchToolbarPortalsProvider>
            <CommandToolbar commands={commands} />
            <div className="editor-model-area grid min-h-0 min-w-0 grid-rows-[minmax(0,1fr)]">
              <AssemblyContent
                active={assemblyMode.active}
                controller={controller}
                selectedPartId={session.selectedPartId}
              >
                {modelWorkspace}
              </AssemblyContent>
            </div>
          </SketchToolbarPortalsProvider>
          <SketchTextDialog
            target={textDialog.target}
            getDraft={textDialog.getDraft}
            onDraftChange={textDialog.commitDraft}
            onClose={textDialog.close}
          />
        </SketchTextActionsProvider>
      </div>
      <StatusBar
        selectedBody={session.selectedBody}
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
    <ApplicationChromeProvider>
      <DocumentDisplayUnitsProvider
        displayUnits={controller.report?.snapshot.displayUnits ?? defaultDocumentDisplayUnits}
      >
        <ProjectNavigationNotice controller={controller} />
        <ViewerPreferencesProvider>
          <WorkspaceLayoutPreferencesProvider>
            <AutomationConnectionsProvider controller={controller}>
              <ApiAssistantProvider>
                <ProjectTabsProvider>
                  {controller.status === "ready" ? (
                    <EditorSessionProvider
                      key={controller.report?.snapshot.id ?? "loading"}
                      documentId={controller.report?.snapshot.id}
                    >
                      <AutomationEditorScope />
                      <EditorApplication controller={controller} />
                    </EditorSessionProvider>
                  ) : (
                    <DocumentProjectPage controller={controller} />
                  )}
                </ProjectTabsProvider>
              </ApiAssistantProvider>
            </AutomationConnectionsProvider>
          </WorkspaceLayoutPreferencesProvider>
        </ViewerPreferencesProvider>
      </DocumentDisplayUnitsProvider>
    </ApplicationChromeProvider>
  )
}

function LocalizedProjectTabs({
  controller,
}: {
  controller: ReturnType<typeof useDocumentController>
}) {
  const t = useTranslations("app.projectTabs")
  return (
    <ProjectTabs
      controller={controller}
      onOpenProjects={showProjectLibrary}
      className="min-w-0 flex-1"
      copy={{
        label: t("label"),
        newProject: t("newProject"),
        openProjects: t("openProjects"),
        closeProject: (name) => t("closeProject", { name }),
        blocked: t("blocked"),
        switchFailed: t("switchFailed"),
        listFailed: t("listFailed"),
        storageFailed: t("storageFailed"),
      }}
    />
  )
}
