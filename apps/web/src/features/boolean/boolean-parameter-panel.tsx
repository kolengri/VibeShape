import type { ReactNode } from "react"
import { ParameterPanel, type ParameterPanelCopy } from "../part-design/parameter-panel"

export type BooleanParameterPanelCopy = ParameterPanelCopy &
  Readonly<{
    inputs: string
  }>

export function BooleanParameterPanel({
  actions,
  copy,
  disabled = false,
  fields,
  message,
}: {
  actions: ReactNode
  copy: BooleanParameterPanelCopy
  disabled?: boolean
  fields: ReactNode
  message?: ReactNode
}) {
  return (
    <ParameterPanel
      actions={actions}
      copy={copy}
      disabled={disabled}
      legend={copy.inputs}
      message={message}
    >
      {fields}
    </ParameterPanel>
  )
}
