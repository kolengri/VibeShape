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
  actions,
  centeredField,
  copy,
  disabled = false,
  fields,
  message,
  placementFields,
}: {
  actions: ReactNode
  centeredField?: ReactNode
  copy: PrimitiveParameterPanelCopy
  disabled?: boolean
  fields: ReactNode
  message?: ReactNode
  placementFields: ReactNode
}) {
  return (
    <ParameterPanel
      actions={actions}
      copy={copy}
      disabled={disabled}
      legend={copy.parameters}
      message={message}
    >
      <fieldset className="grid min-w-0 gap-2">
        <legend className="sr-only">{copy.dimensions}</legend>
        {fields}
      </fieldset>
      <fieldset className="grid min-w-0 gap-2 border-t border-border pt-2">
        <legend className="sr-only">{copy.placement}</legend>
        {placementFields}
        {centeredField ? <div className="pt-1">{centeredField}</div> : null}
      </fieldset>
    </ParameterPanel>
  )
}
