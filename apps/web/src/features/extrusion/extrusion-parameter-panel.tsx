import type { ReactNode } from "react"
import { ParameterPanel, type ParameterPanelCopy } from "../part-design/parameter-panel"

export type ExtrusionParameterPanelCopy = ParameterPanelCopy &
  Readonly<{
    parameters: string
    profile: string
  }>

export function ExtrusionParameterPanel({
  copy,
  disabled = false,
  distanceField,
  footerAction,
  message,
  onCancel,
  profileLabel,
  operationField,
  symmetricField,
  targetField,
}: {
  copy: ExtrusionParameterPanelCopy
  disabled?: boolean
  distanceField: ReactNode
  footerAction: ReactNode
  message?: ReactNode
  onCancel: () => void
  profileLabel: string
  operationField: ReactNode
  symmetricField: ReactNode
  targetField?: ReactNode
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
      {distanceField}
      <div className="pt-1">{symmetricField}</div>
    </ParameterPanel>
  )
}
