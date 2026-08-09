import type { SketchId, SketchRecord } from "@vibeshape/domain"
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
import { EditorWorkspace } from "./shell/editor-workspace"
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

export function App() {
  const t = useTranslations("app.shell.applicationBar")
  const controller = useDocumentController(t("untitledProject"))
  const [workspace, setWorkspace] = useState<EditorWorkspaceName>("model")
  const [activeTool, setActiveTool] = useState<ActivePartDesignTool | null>(null)
  const [activeSketchTool, setActiveSketchTool] = useState<ActiveSketchTool | null>(null)
  const [activeSketchId, setActiveSketchId] = useState<SketchId | null>(null)
  const [sketchPreview, setSketchPreview] = useState<RectangleSketchPreview | null>(null)
  const [selection, setSelection] = useState<ViewerSelection | null>(null)

  const changeWorkspace = useCallback((nextWorkspace: EditorWorkspaceName) => {
    setWorkspace(nextWorkspace)
    if (nextWorkspace !== "model") {
      setActiveTool(null)
      setSelection(null)
    }
    if (nextWorkspace !== "sketch") {
      setActiveSketchTool(null)
      setSketchPreview(null)
    }
  }, [])

  const createSketch = useCallback(() => {
    setWorkspace("sketch")
    setActiveTool(null)
    setSelection(null)
    setActiveSketchId(null)
    setActiveSketchTool({ kind: "create-rectangle-sketch" })
  }, [])

  const editSketch = useCallback((sketchId: SketchId) => {
    setWorkspace("sketch")
    setActiveTool(null)
    setSelection(null)
    setActiveSketchId(sketchId)
    setActiveSketchTool({ kind: "edit-rectangle-sketch", sketchId })
  }, [])

  const closeTool = useCallback(() => {
    setActiveTool(null)
    setActiveSketchTool(null)
    setSketchPreview(null)
  }, [])

  const sketchSaved = useCallback((sketch: SketchRecord) => {
    setActiveSketchId(sketch.id)
    setActiveSketchTool(null)
    setSketchPreview(null)
  }, [])

  const updateSketchPreview = useCallback((preview: RectangleSketchPreview | null) => {
    setSketchPreview((current) => (sameSketchPreview(current, preview) ? current : preview))
  }, [])

  return (
    <main className="cad-shell bg-background text-[13px] text-foreground">
      <ApplicationBar controller={controller} />
      <CommandToolbar
        activeCommand={activePartDesignCommand(activeTool)}
        controller={controller}
        workspace={workspace}
        onWorkspaceChange={changeWorkspace}
        onCreateSketch={createSketch}
        onCreateBox={() => {
          changeWorkspace("model")
          setActiveTool({ kind: "create-box" })
        }}
        onCreateCylinder={() => {
          changeWorkspace("model")
          setActiveTool({ kind: "create-cylinder" })
        }}
        onCreateSubtract={() => {
          changeWorkspace("model")
          setActiveTool({ kind: "create-subtract" })
        }}
      />
      <EditorWorkspace
        activeSketchId={activeSketchId}
        activeSketchTool={activeSketchTool}
        activeTool={activeTool}
        controller={controller}
        workspace={workspace}
        onCloseTool={closeTool}
        onCreateBox={() => setActiveTool({ kind: "create-box" })}
        onCreateCylinder={() => setActiveTool({ kind: "create-cylinder" })}
        onCreateSketch={createSketch}
        onCreateSubtract={() => setActiveTool({ kind: "create-subtract" })}
        onEditFeature={(featureId) => {
          const feature = controller.report?.snapshot.features.find(({ id }) => id === featureId)
          const editTool = editPartDesignTool(feature)
          if (!editTool) return
          changeWorkspace("model")
          setActiveTool(editTool)
        }}
        onEditSketch={editSketch}
        onSelectionChange={setSelection}
        onSketchPreview={updateSketchPreview}
        onSketchSaved={sketchSaved}
        onWorkspaceChange={changeWorkspace}
        selection={selection}
        sketchPreview={sketchPreview}
      />
      <StatusBar controller={controller} selection={selection} />
    </main>
  )
}
