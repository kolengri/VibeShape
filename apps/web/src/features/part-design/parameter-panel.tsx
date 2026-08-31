import type { ReactNode } from "react"

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
    <div className="grid gap-4">
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3">
        <div className="min-w-0">
          <h2 className="truncate text-sm font-medium">{copy.title}</h2>
          <p className="mt-1 text-xs leading-4 text-muted-foreground">{copy.description}</p>
        </div>
        {actions}
      </div>
      {message ? (
        <p
          className="rounded-md border border-destructive/40 bg-panel-muted p-2 text-xs text-destructive"
          role="alert"
        >
          {message}
        </p>
      ) : null}
      <fieldset disabled={disabled} className="grid gap-3">
        <legend className="mb-2 text-xs font-medium text-muted-foreground">{legend}</legend>
        {children}
      </fieldset>
    </div>
  )
}
