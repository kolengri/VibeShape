import {
  appendSketchConstraint,
  createEmptySketch,
  defaultDocumentDisplayUnits,
  type FeatureId,
  type SketchId,
  type SketchProfileSelector,
  type SketchRecord,
} from "@vibeshape/domain"
import type { PartId } from "@vibeshape/domain/identifiers"
import { useTranslations } from "@vibeshape/i18n"
import type { ViewerOriginPlane } from "@vibeshape/viewer/origin-planes"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useShallow } from "zustand/react/shallow"
import { resolveBuiltInEditorCommands } from "./commands/built-in-editor-commands"
import { useEditorCommandShortcuts } from "./commands/editor-command-shortcuts"
import {
  addSketch,
  createBrowserSketchConstraintId,
  createBrowserSketchId,
  redoDocument,
  undoDocument,
  updateSketch,
  useDocumentController,
} from "./document/document-controller"
import { DocumentDisplayUnitsProvider } from "./document/document-display-units"
import {
  EditorSessionProvider,
  useEditorSession,
  useEditorSessionStoreApi,
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
import {
  authoredPlacementTarget,
  selectedPlacementPart,
} from "./features/part-design/authored-part-selection"
import {
  activePartDesignCommand,
  editPartDesignTool,
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
import { ApplicationBar } from "./shell/application-bar"
import { currentAuthoredParts, selectedAuthoredBody } from "./shell/authored-tree-state"
import { EditorCommandPalette, useCommandPaletteFocus } from "./shell/command-palette"
import { CommandToolbar } from "./shell/command-toolbar"
import { EditorWorkspace, type EditorWorkspaceActions } from "./shell/editor-workspace"
import { ShortcutHelpDialog, useShortcutHelp } from "./shell/shortcut-help-dialog"
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
      const resolved = currentAuthoredParts(controller).find(({ part }) => part.id === partId)
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
      const feature = controller.report?.snapshot.features.find(({ id }) => id === featureId)
      const editTool = editPartDesignTool(feature)
      if (editTool) sessionActions.startPartDesignTool(editTool)
    },
    [controller.report?.snapshot.features, sessionActions],
  )
  return { placePart, mirrorPart, shellPart, splitPart, patternPart, threadPart, editFeature }
}

function useEditorWorkspaceActions(controller: ReturnType<typeof useDocumentController>) {
  const toggleAllSketchVisibility = useToggleAllSketchVisibility(controller)
  const hasSavedSketches = Boolean(controller.report?.snapshot.sketches.length)
  const t = useTranslations("app.shell.taskPanel.sketch")
  const sessionActions = useEditorSession((state) => state.actions)
  const sessionStore = useEditorSessionStoreApi()
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

  return useMemo(
    () =>
      ({
        acknowledgeExtrusionDistance: sessionActions.acknowledgeExtrusionDistance,
        acknowledgeRevolveAngle: sessionActions.acknowledgeRevolveAngle,
        closeTool: sessionActions.closeActiveTool,
        completeTool: () => sessionActions.completeActiveTool(partDesignToolGeneration),
        beginSketchSupportReplacement: sessionActions.beginSketchSupportReplacement,
        createHole: () => sessionActions.startPartDesignTool({ kind: "create-hole" }),
        createFillet: () => sessionActions.startPartDesignTool({ kind: "create-fillet" }),
        createChamfer: () => sessionActions.startPartDesignTool({ kind: "create-chamfer" }),
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
        preselectFeature: sessionActions.setFeaturePreselection,
        preselectBody: sessionActions.setBodyPreselection,
        selectBody: sessionActions.setSelectedBody,
        selectPart: sessionActions.setSelectedPart,
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
    ],
  )
}

type EditorApplicationSession = Pick<
  EditorSessionState,
  | "activePartDesignTool"
  | "commandPaletteOpen"
  | "extrusionDistanceRequest"
  | "hiddenFeatureIds"
  | "sketchVisibilityOverrides"
  | "originPlaneVisibility"
  | "preselectedBody"
  | "selectedBody"
  | "selectedPartId"
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
      sketchVisibilityOverrides: state.sketchVisibilityOverrides,
      originPlaneVisibility: state.originPlaneVisibility,
      preselectedFeatureId: state.preselectedFeatureId,
      preselectedBody: state.preselectedBody,
      selectedBody: state.selectedBody,
      selectedPartId: state.selectedPartId,
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
  dialogs: { openShortcutHelp: () => void; openSketchText: () => void },
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
  const parts = currentAuthoredParts(controller)
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
      actions={workspaceActions}
      activeSketchId={session.sketch.activeSketchId}
      activeSketchTool={session.sketch.activeSketchTool}
      activeTool={session.activePartDesignTool}
      controller={controller}
      extrusionDistanceRequest={session.extrusionDistanceRequest}
      hiddenFeatureIds={session.hiddenFeatureIds}
      hiddenSketchIds={hiddenSketchIds}
      originPlaneVisibility={session.originPlaneVisibility}
      onSketchFinalContextChange={sessionActions.setSketchFinalContext}
      preselectedFeatureId={session.preselectedFeatureId}
      preselectedBody={session.preselectedBody}
      selectedBody={session.selectedBody}
      selectedPartId={session.selectedPartId}
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
    () => currentAuthoredParts(controller),
    [controller.authoredSnapshot, controller.report],
  )
  return storedSession.selectedPartId
    ? {
        ...storedSession,
        selectedBody: selectedAuthoredBody(authoredParts, storedSession.selectedPartId),
      }
    : storedSession
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

function EditorApplication({
  controller,
}: Readonly<{ controller: ReturnType<typeof useDocumentController> }>) {
  const session = useAuthoredEditorSession(controller)
  const sessionActions = useEditorSession((state) => state.actions)
  const workspaceActions = useEditorWorkspaceActions(controller)
  const textDialog = useSketchTextApplication(controller)
  const assemblyMode = useAssemblyMode(workspaceActions.switchWorkspace)
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
  })

  const modelWorkspace = (
    <EditorWorkspaceComposition
      controller={controller}
      session={session}
      sessionActions={sessionActions}
      workspaceActions={workspaceActions}
    />
  )
  return (
    <main className="cad-shell bg-background text-[13px] text-foreground">
      <ApplicationBar
        controller={controller}
        hideModelExport={assemblyMode.active}
        onOpenShortcutHelp={shortcutHelp.show}
        onOpenCommandPalette={(returnFocusTarget) =>
          commandPaletteFocus.setOpen(true, returnFocusTarget)
        }
      >
        <AssemblyModeSwitch
          active={assemblyMode.active}
          disabled={
            controller.status !== "ready" ||
            controller.saveStatus === "saving" ||
            Boolean(session.activePartDesignTool || session.sketch.activeSketchTool)
          }
          onChange={assemblyMode.onChange}
        />
      </ApplicationBar>
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
      <SketchTextActionsProvider actions={textDialog.actions}>
        <SketchToolbarPortalsProvider>
          <CommandToolbar commands={commands} />
          <AssemblyContent
            active={assemblyMode.active}
            controller={controller}
            selectedPartId={session.selectedPartId}
          >
            {modelWorkspace}
          </AssemblyContent>
        </SketchToolbarPortalsProvider>
        <SketchTextDialog
          target={textDialog.target}
          getDraft={textDialog.getDraft}
          onDraftChange={textDialog.commitDraft}
          onClose={textDialog.close}
        />
      </SketchTextActionsProvider>
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
    <DocumentDisplayUnitsProvider
      displayUnits={controller.report?.snapshot.displayUnits ?? defaultDocumentDisplayUnits}
    >
      <ViewerPreferencesProvider>
        <WorkspaceLayoutPreferencesProvider>
          <EditorSessionProvider
            key={controller.report?.snapshot.id ?? "loading"}
            documentId={controller.report?.snapshot.id}
          >
            <EditorApplication controller={controller} />
          </EditorSessionProvider>
        </WorkspaceLayoutPreferencesProvider>
      </ViewerPreferencesProvider>
    </DocumentDisplayUnitsProvider>
  )
}
