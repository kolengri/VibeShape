import { Button } from "@vibeshape/ui/components/button"
import type { ReactNode } from "react"

export type BoxParameterPanelCopy = Readonly<{
  title: string
  description: string
  dimensions: string
  centered: string
  cancel: string
}>

export function BoxParameterPanel({
  centeredField,
  copy,
  depthField,
  disabled = false,
  footerAction,
  heightField,
  message,
  onCancel,
  widthField,
}: {
  centeredField: ReactNode
  copy: BoxParameterPanelCopy
  depthField: ReactNode
  disabled?: boolean
  footerAction: ReactNode
  heightField: ReactNode
  message?: ReactNode
  onCancel: () => void
  widthField: ReactNode
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
        <legend className="mb-2 text-xs font-medium text-muted-foreground">
          {copy.dimensions}
        </legend>
        {widthField}
        {depthField}
        {heightField}
        <div className="pt-1">{centeredField}</div>
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
