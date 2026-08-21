import type { ReactNode } from "react"
import { ParameterPanel, type ParameterPanelCopy } from "./parameter-panel"

export type PrimitiveParameterPanelCopy = ParameterPanelCopy &
  Readonly<{
    dimensions: string
    parameters: string
    placement: string
    centered: string
  }>

export function PrimitiveParameterPanel({
  centeredField,
  copy,
  disabled = false,
  fields,
  footerAction,
  message,
  onCancel,
  placementFields,
}: {
  centeredField: ReactNode
  copy: PrimitiveParameterPanelCopy
  disabled?: boolean
  fields: ReactNode
  footerAction: ReactNode
  message?: ReactNode
  onCancel: () => void
  placementFields: ReactNode
}) {
  return (
    <ParameterPanel
      copy={copy}
      disabled={disabled}
      footerAction={footerAction}
      legend={copy.parameters}
      message={message}
      onCancel={onCancel}
    >
      <fieldset className="grid gap-3">
        <legend className="text-xs font-medium text-muted-foreground">{copy.dimensions}</legend>
        {fields}
      </fieldset>
      <fieldset className="grid gap-3 border-t border-border pt-3">
        <legend className="text-xs font-medium text-muted-foreground">{copy.placement}</legend>
        {placementFields}
        <div className="pt-1">{centeredField}</div>
      </fieldset>
    </ParameterPanel>
  )
}
