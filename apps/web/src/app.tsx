import {
  type FeatureId,
  rectangleSketchProfileSelector,
  type SketchId,
  type SketchRecord,
} from "@vibeshape/domain"
import { useTranslations } from "@vibeshape/i18n"
import type { ViewerSelection } from "@vibeshape/viewer/three-viewport"
import { useCallback, useState } from "react"
import { useDocumentController } from "./document/document-controller"
import {
  type ActivePartDesignTool,
  activePartDesignCommand,
  editPartDesignTool,
} from "./features/part-design/part-design-tool"
import type { RectangleSketchPreview } from "./features/sketch/rectangle-sketch-form"
import type { ActiveSketchTool } from "./features/sketch/sketch-tool"
import { ApplicationBar } from "./shell/application-bar"
import { CommandToolbar } from "./shell/command-toolbar"
import { EditorWorkspace, type EditorWorkspaceActions } from "./shell/editor-workspace"
import { StatusBar } from "./shell/status-bar"
import type { EditorWorkspaceName } from "./shell/workspace"

function sketchPreviewKey(preview: RectangleSketchPreview | null) {
  return preview ? `${preview.width}\u0000${preview.height}\u0000${preview.plane}` : "none"
}

function sameSketchPreview(
  current: RectangleSketchPreview | null,
  next: RectangleSketchPreview | null,
) {
  return sketchPreviewKey(current) === sketchPreviewKey(next)
}

function useSketchInteraction() {
  const [activeSketchTool, setActiveSketchTool] = useState<ActiveSketchTool | null>(null)
  const [activeSketchId, setActiveSketchId] = useState<SketchId | null>(null)
  const [sketchPreview, setSketchPreview] = useState<RectangleSketchPreview | null>(null)
  const create = useCallback(() => {
    setActiveSketchId(null)
    setActiveSketchTool({ kind: "create-rectangle-sketch" })
  }, [])
  const edit = useCallback((sketchId: SketchId) => {
    setActiveSketchId(sketchId)
    setActiveSketchTool({ kind: "edit-rectangle-sketch", sketchId })
  }, [])
  const close = useCallback(() => {
    setActiveSketchTool(null)
    setSketchPreview(null)
  }, [])
  const saved = useCallback((sketch: SketchRecord) => {
    setActiveSketchId(sketch.id)
    setActiveSketchTool(null)
    setSketchPreview(null)
  }, [])
  const updatePreview = useCallback((preview: RectangleSketchPreview | null) => {
    setSketchPreview((current) => (sameSketchPreview(current, preview) ? current : preview))
  }, [])
  return {
    activeSketchId,
    activeSketchTool,
    close,
    create,
    edit,
    saved,
    sketchPreview,
    updatePreview,
  }
}

function useModelInteraction(
  controller: ReturnType<typeof useDocumentController>,
  sketch: ReturnType<typeof useSketchInteraction>,
) {
  const {
    activeSketchId,
    close: closeSketch,
    create: createSketchInteraction,
    edit: editSketchInteraction,
    saved: sketchSaved,
    updatePreview: setSketchPreview,
  } = sketch
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
    setWorkspace("sketch")
    setActiveTool(null)
    setSelection(null)
    createSketchInteraction()
  }, [createSketchInteraction])
  const editSketch = useCallback(
    (sketchId: SketchId) => {
      setWorkspace("sketch")
      setActiveTool(null)
      setSelection(null)
      editSketchInteraction(sketchId)
    },
    [editSketchInteraction],
  )
  const closeTool = useCallback(() => {
    setActiveTool(null)
    closeSketch()
  }, [closeSketch])

  const createExtrusion = useCallback(() => {
    const source = controller.report?.snapshot.sketches.find(({ id }) => id === activeSketchId)
    const profile = source ? rectangleSketchProfileSelector(source) : null
    if (!profile) return
    startModelTool({ kind: "create-extrusion", profile })
  }, [activeSketchId, controller.report?.snapshot.sketches, startModelTool])
  const editFeature = useCallback(
    (featureId: FeatureId) => {
      const feature = controller.report?.snapshot.features.find(({ id }) => id === featureId)
      const editTool = editPartDesignTool(feature)
      if (editTool) startModelTool(editTool)
    },
    [controller.report?.snapshot.features, startModelTool],
  )
  const selectedSketch = controller.report?.snapshot.sketches.find(
    ({ id }) => id === activeSketchId,
  )
  const extrusionAvailable = selectedSketch
    ? rectangleSketchProfileSelector(selectedSketch) !== null
    : false
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
      setSketchPreview,
      sketchSaved,
      switchWorkspace,
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

  return (
    <main className="cad-shell bg-background text-[13px] text-foreground">
      <ApplicationBar controller={controller} />
      <CommandToolbar
        activeCommand={activePartDesignCommand(model.activeTool)}
        controller={controller}
        workspace={model.workspace}
        onWorkspaceChange={model.actions.switchWorkspace}
        onCreateSketch={model.actions.createSketch}
        onCreateBox={model.actions.createBox}
        onCreateCylinder={model.actions.createCylinder}
        onCreateExtrusion={model.actions.createExtrusion}
        extrusionAvailable={model.extrusionAvailable}
        onCreateSubtract={model.actions.createSubtract}
      />
      <EditorWorkspace
        actions={model.actions}
        activeSketchId={sketch.activeSketchId}
        activeSketchTool={sketch.activeSketchTool}
        activeTool={model.activeTool}
        controller={controller}
        workspace={model.workspace}
        selection={model.selection}
        sketchPreview={sketch.sketchPreview}
      />
      <StatusBar controller={controller} selection={model.selection} />
    </main>
  )
}
