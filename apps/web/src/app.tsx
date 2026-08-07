import { ApplicationBar } from "./shell/application-bar"
import { CommandToolbar } from "./shell/command-toolbar"
import { EditorWorkspace } from "./shell/editor-workspace"
import { StatusBar } from "./shell/status-bar"

export function App() {
  return (
    <main className="cad-shell bg-background text-[13px] text-foreground">
      <ApplicationBar />
      <CommandToolbar />
      <EditorWorkspace />
      <StatusBar />
    </main>
  )
}
