import { Button } from "@vibeshape/ui/components/button"
import type { ReactNode } from "react"

export type BooleanParameterPanelCopy = Readonly<{
  title: string
  description: string
  inputs: string
  cancel: string
}>

export function BooleanParameterPanel({
  copy,
  disabled = false,
  fields,
  footerAction,
  message,
  onCancel,
}: {
  copy: BooleanParameterPanelCopy
  disabled?: boolean
  fields: ReactNode
  footerAction: ReactNode
  message?: ReactNode
  onCancel: () => void
}) {
  return (
    <div className="grid gap-4">
      <div>
        <h2 className="text-sm font-medium">{copy.title}</h2>
        <p className="mt-1 text-xs leading-4 text-muted-foreground">{copy.description}</p>
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
        <legend className="mb-2 text-xs font-medium text-muted-foreground">{copy.inputs}</legend>
        {fields}
      </fieldset>
      <div className="flex items-center justify-end gap-2 border-t pt-3">
        <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
          {copy.cancel}
        </Button>
        {footerAction}
      </div>
    </div>
  )
}
