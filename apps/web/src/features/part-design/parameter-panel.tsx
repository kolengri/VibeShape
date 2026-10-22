import { Alert } from "@vibeshape/ui/components/alert"
import type { ReactNode } from "react"
import { TaskPanelLayout } from "../../components/task-panel-layout"

export type ParameterPanelCopy = Readonly<{
  cancel: string
  description: string
  title: string
}>

export function ParameterPanel({
  actions,
  children,
  copy,
  disabled = false,
  legend,
  message,
}: {
  actions: ReactNode
  children: ReactNode
  copy: ParameterPanelCopy
  disabled?: boolean
  legend: string
  message?: ReactNode
}) {
  return (
    <TaskPanelLayout title={copy.title} description={copy.description} actions={actions}>
      {message ? <Alert>{message}</Alert> : null}
      <fieldset disabled={disabled} className="grid min-w-0 gap-2">
        <legend className="sr-only">{legend}</legend>
        {children}
      </fieldset>
    </TaskPanelLayout>
  )
}
