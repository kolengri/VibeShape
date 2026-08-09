import { ApplicationBar } from "./shell/application-bar"
import { CommandToolbar } from "./shell/command-toolbar"
import { EditorWorkspace } from "./shell/editor-workspace"
import { StatusBar } from "./shell/status-bar"

export function App() {
  const t = useTranslations("app.shell.applicationBar")
  const controller = useDocumentController(t("untitledProject"))
  const [workspace, setWorkspace] = useState<"model" | "variables">("model")
  const [activeTool, setActiveTool] = useState<"box" | null>(null)

  const changeWorkspace = (nextWorkspace: "model" | "variables") => {
    setWorkspace(nextWorkspace)
    if (nextWorkspace === "variables") setActiveTool(null)
  }

  return (
    <main className="cad-shell bg-background text-[13px] text-foreground">
      <ApplicationBar controller={controller} />
      <CommandToolbar
        activeTool={activeTool}
        controller={controller}
        onCreateBox={() => {
          setWorkspace("model")
          setActiveTool("box")
        }}
      />
      <EditorWorkspace
        activeTool={activeTool}
        controller={controller}
        workspace={workspace}
        onCloseTool={() => setActiveTool(null)}
        onCreateBox={() => setActiveTool("box")}
        onWorkspaceChange={changeWorkspace}
      />
      <StatusBar />
    </main>
  )
}
import { useTranslations } from "@vibeshape/i18n"
import { useState } from "react"
import { useDocumentController } from "./document/document-controller"
