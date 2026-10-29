import { type ReactNode, useCallback, useEffect, useState } from "react"
import type { DocumentControllerState } from "../../document/document-controller"
import {
  type WorkspaceTaskPreview,
  WorkspaceTaskProvider,
} from "../../shell/workspace-task-context"
import {
  LightweightingTaskPanel,
  type LightweightingViewportInteraction,
} from "./lightweighting-dialog"
import { PrintOptimizationTaskPanel } from "./print-optimization-task-panel"
import { QuickLightweightingTaskPanel } from "./quick-lightweighting-task-panel"
import type { useLightweightingCommand } from "./use-lightweighting-command"

export function LightweightingWorkspace({
  workflow,
  controller,
  active,
  children,
}: {
  workflow: ReturnType<typeof useLightweightingCommand>
  controller: DocumentControllerState
  active: boolean
  children: ReactNode
}) {
  const [interaction, setInteraction] = useState<LightweightingViewportInteraction | null>(null)
  const [applying, setApplying] = useState(false)
  const [preview, setPreview] = useState<WorkspaceTaskPreview | null>(null)
  const close = useCallback(() => {
    if (!applying) workflow.setOpen(false)
  }, [applying, workflow.setOpen])
  useTaskDismissal(workflow.open, active, close)
  const props = {
    controller,
    blocked: workflow.blocked,
    initialPartId: workflow.initialPartId,
    onClose: close,
    onApplyingChange: setApplying,
    onPreviewChange: setPreview,
    onApplied: () => workflow.setOpen(false),
  }
  const panel =
    workflow.mode === "print" ? (
      <PrintOptimizationTaskPanel
        {...props}
        onInteractionChange={setInteraction}
        onManual={() => workflow.show("structural")}
      />
    ) : workflow.mode === "quick" ? (
      <QuickLightweightingTaskPanel {...props} />
    ) : (
      <LightweightingTaskPanel
        key={workflow.mode}
        {...props}
        generative={workflow.mode === "generative"}
        onInteractionChange={setInteraction}
      />
    )
  return (
    <WorkspaceTaskProvider
      value={
        workflow.open && active
          ? {
              activityKey: `lightweighting:${workflow.mode}`,
              panel,
              interaction: workspaceInteraction(workflow.mode, interaction),
              preview,
            }
          : null
      }
    >
      {children}
    </WorkspaceTaskProvider>
  )
}

function useTaskDismissal(open: boolean, active: boolean, close: () => void) {
  useEffect(() => {
    if (!active) close()
  }, [active, close])
  useEffect(() => {
    if (!open) return
    const cancelTask = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return
      event.preventDefault()
      close()
    }
    window.addEventListener("keydown", cancelTask)
    return () => window.removeEventListener("keydown", cancelTask)
  }, [open, close])
}

function workspaceInteraction(
  mode: "print" | "quick" | "structural" | "generative",
  interaction: LightweightingViewportInteraction | null,
) {
  if (mode === "quick" || !interaction) return null
  return {
    sourceMesh: {
      featureId: interaction.source.featureId,
      outputRole: interaction.source.outputRole,
      ...interaction.source.body.mesh,
    },
    picking: interaction.picking,
    onFacePick: interaction.onFacePick,
    overlays: interaction.overlays,
  }
}
