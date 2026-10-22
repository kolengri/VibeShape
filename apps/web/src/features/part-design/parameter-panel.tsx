import type { ReactNode } from "react"
import { TaskPanelHeader } from "../../components/task-panel-header"

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
    <div className="grid min-w-0 gap-2">
      <TaskPanelHeader title={copy.title} description={copy.description} actions={actions} />
      {message ? (
        <p
          className="rounded-md border border-destructive/40 bg-panel-muted p-2 text-xs text-destructive"
          role="alert"
        >
          {message}
        </p>
      ) : null}
      <fieldset disabled={disabled} className="grid min-w-0 gap-3">
        <legend className="mb-2 text-xs font-medium text-muted-foreground">{legend}</legend>
        {children}
      </fieldset>
    </div>
  )
}
