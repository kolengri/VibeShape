import type { ReactNode } from "react"
import { ParameterPanel, type ParameterPanelCopy } from "../part-design/parameter-panel"

export type BooleanParameterPanelCopy = ParameterPanelCopy &
  Readonly<{
    inputs: string
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
    <ParameterPanel
      copy={copy}
      disabled={disabled}
      footerAction={footerAction}
      legend={copy.inputs}
      message={message}
      onCancel={onCancel}
    >
      {fields}
    </ParameterPanel>
  )
}
