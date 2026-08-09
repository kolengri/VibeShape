import { useTranslations } from "@vibeshape/i18n"
import type { ViewerSelection } from "@vibeshape/viewer/three-viewport"
import { useState } from "react"
import { useDocumentController } from "./document/document-controller"
import {
  type ActivePartDesignTool,
  activePrimitiveCommand,
  isBoxFeature,
  isCylinderFeature,
} from "./features/part-design/part-design-tool"
import { ApplicationBar } from "./shell/application-bar"
import { CommandToolbar } from "./shell/command-toolbar"
import { EditorWorkspace } from "./shell/editor-workspace"
import { StatusBar } from "./shell/status-bar"

export function App() {
  const t = useTranslations("app.shell.applicationBar")
  const controller = useDocumentController(t("untitledProject"))
  const [workspace, setWorkspace] = useState<"model" | "variables">("model")
  const [activeTool, setActiveTool] = useState<ActivePartDesignTool | null>(null)
  const [selection, setSelection] = useState<ViewerSelection | null>(null)

  const changeWorkspace = (nextWorkspace: "model" | "variables") => {
    setWorkspace(nextWorkspace)
    if (nextWorkspace === "variables") {
      setActiveTool(null)
      setSelection(null)
    }
  }

  return (
    <main className="cad-shell bg-background text-[13px] text-foreground">
      <ApplicationBar controller={controller} />
      <CommandToolbar
        activeCommand={activePrimitiveCommand(activeTool)}
        controller={controller}
        onCreateBox={() => {
          setWorkspace("model")
          setActiveTool({ kind: "create-box" })
        }}
        onCreateCylinder={() => {
          setWorkspace("model")
          setActiveTool({ kind: "create-cylinder" })
        }}
      />
      <EditorWorkspace
        activeTool={activeTool}
        controller={controller}
        workspace={workspace}
        onCloseTool={() => setActiveTool(null)}
        onCreateBox={() => setActiveTool({ kind: "create-box" })}
        onCreateCylinder={() => setActiveTool({ kind: "create-cylinder" })}
        onEditFeature={(featureId) => {
          const feature = controller.report?.snapshot.features.find(({ id }) => id === featureId)
          if (!feature) return
          setWorkspace("model")
          if (isBoxFeature(feature)) setActiveTool({ kind: "edit-box", featureId })
          if (isCylinderFeature(feature)) setActiveTool({ kind: "edit-cylinder", featureId })
        }}
        onSelectionChange={setSelection}
        onWorkspaceChange={changeWorkspace}
        selection={selection}
      />
      <StatusBar controller={controller} selection={selection} />
    </main>
  )
}
