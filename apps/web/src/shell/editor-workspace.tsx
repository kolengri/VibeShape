import { ModelTree } from "./model-tree"
import { TaskPanel } from "./task-panel"
import { ViewportPlaceholder } from "./viewport-placeholder"

export function EditorWorkspace() {
  return (
    <div className="cad-workspace-grid min-h-0">
      <ModelTree />
      <ViewportPlaceholder />
      <TaskPanel />
    </div>
  )
}
