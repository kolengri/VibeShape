import { useId } from "react"
import { WorkflowModelCanvas } from "./workflow-model-canvas"
import { WorkflowModelControls } from "./workflow-model-controls"
import { useWorkflowModelNavigation } from "./workflow-model-navigation"
import { useWorkflowModelRenderer } from "./workflow-model-renderer"

type WorkflowModelLabels = Readonly<{
  title: string
  hint: string
  fit: string
  isometric: string
  front: string
  top: string
  right: string
  loading: string
  unavailable: string
}>

export default function WorkflowModel({ labels }: { labels: WorkflowModelLabels }) {
  const renderer = useWorkflowModelRenderer()
  const navigation = useWorkflowModelNavigation(renderer)
  const hintId = useId()
  return (
    <div
      className="flex min-w-0 flex-col gap-3"
      data-workflow-model=""
      data-state={renderer.state}
      data-ready={renderer.state === "ready"}
      data-engaged={navigation.engaged}
      data-view={navigation.view}
    >
      <WorkflowModelCanvas
        canvasRef={renderer.canvasRef}
        hostRef={renderer.hostRef}
        state={renderer.state}
        labels={labels}
        hintId={hintId}
      />
      <WorkflowModelControls
        labels={labels}
        disabled={renderer.state !== "ready"}
        view={navigation.view}
        onFit={navigation.fit}
        onStandardView={navigation.setStandardView}
      />
      <p id={hintId} className="text-xs leading-relaxed text-muted-foreground">
        {labels.hint}
      </p>
    </div>
  )
}
