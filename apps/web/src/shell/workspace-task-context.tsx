import type {
  ViewerAnalysisOverlay,
  ViewerMesh,
  ViewerSelection,
} from "@vibeshape/viewer/three-viewport"
import { createContext, type ReactNode, useContext } from "react"
import { ResponsiveTaskPanel, type ResponsiveTaskPanelProps } from "./responsive-task-panel"

type WorkspaceTaskInteraction = Readonly<{
  sourceMesh: ViewerMesh
  picking: boolean
  onFacePick: (selection: ViewerSelection | null) => boolean
  overlays: readonly ViewerAnalysisOverlay[]
}>

export type WorkspaceTaskPreview = Readonly<{
  meshes: readonly ViewerMesh[]
  onReady?: (ready: boolean) => void
}>

type WorkspaceTask = Readonly<{
  activityKey: string
  panel: ReactNode
  interaction: WorkspaceTaskInteraction | null
  preview?: WorkspaceTaskPreview | null
}>

const WorkspaceTaskContext = createContext<WorkspaceTask | null>(null)

export function WorkspaceTaskProvider({
  value,
  children,
}: {
  value: WorkspaceTask | null
  children: ReactNode
}) {
  return <WorkspaceTaskContext.Provider value={value}>{children}</WorkspaceTaskContext.Provider>
}

export function useWorkspaceTask() {
  return useContext(WorkspaceTaskContext)
}

export function WorkspaceTaskPanel(props: ResponsiveTaskPanelProps) {
  const task = useWorkspaceTask()
  return (
    <ResponsiveTaskPanel
      {...props}
      activeTaskKey={task?.activityKey ?? props.activeTaskKey}
      autoExpandActiveTask={
        task ? !task.interaction?.picking : (props.autoExpandActiveTask ?? true)
      }
    >
      {task?.panel ?? props.children}
    </ResponsiveTaskPanel>
  )
}
