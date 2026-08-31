import type { ReactNode } from "react"
import { ParameterPanel, type ParameterPanelCopy } from "../part-design/parameter-panel"

export type RevolveParameterPanelCopy = ParameterPanelCopy &
  Readonly<{
    parameters: string
    profile: string
  }>

export function RevolveParameterPanel({
  copy,
  disabled = false,
  axisField,
  angleField,
  operationField,
  targetField,
  footerAction,
  message,
  onCancel,
  profileLabel,
}: {
  copy: RevolveParameterPanelCopy
  disabled?: boolean
  axisField: ReactNode
  angleField: ReactNode
  operationField: ReactNode
  targetField?: ReactNode
  footerAction: ReactNode
  message?: ReactNode
  onCancel: () => void
  profileLabel: string
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
      <div className="grid gap-1 rounded-md border bg-panel-muted px-3 py-2">
        <span className="text-xs font-medium text-muted-foreground">{copy.profile}</span>
        <output className="text-sm">{profileLabel}</output>
      </div>
      {operationField}
      {targetField}
      {axisField}
      {angleField}
    </ParameterPanel>
  )
}
