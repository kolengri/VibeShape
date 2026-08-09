import { ApplicationBar } from "./shell/application-bar"
import { CommandToolbar } from "./shell/command-toolbar"
import { EditorWorkspace } from "./shell/editor-workspace"
import { StatusBar } from "./shell/status-bar"

export function App() {
  const t = useTranslations("app.shell.applicationBar")
  const controller = useDocumentController(t("untitledProject"))
  const [workspace, setWorkspace] = useState<"model" | "variables">("model")

  return (
    <main className="cad-shell bg-background text-[13px] text-foreground">
      <ApplicationBar controller={controller} />
      <CommandToolbar />
      <EditorWorkspace
        controller={controller}
        workspace={workspace}
        onWorkspaceChange={setWorkspace}
      />
      <StatusBar />
    </main>
  )
}
import { useTranslations } from "@vibeshape/i18n"
import { useState } from "react"
import { useDocumentController } from "./document/document-controller"
