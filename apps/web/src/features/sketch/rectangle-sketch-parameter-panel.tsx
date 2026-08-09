import type { ReactNode } from "react"
import { ParameterPanel, type ParameterPanelCopy } from "../part-design/parameter-panel"

export type RectangleSketchParameterPanelCopy = ParameterPanelCopy &
  Readonly<{
    dimensions: string
  }>

export function RectangleSketchParameterPanel({
  copy,
  disabled = false,
  fields,
  footerAction,
  message,
  onCancel,
  planeField,
}: {
  copy: RectangleSketchParameterPanelCopy
  disabled?: boolean
  fields: ReactNode
  footerAction: ReactNode
  message?: ReactNode
  onCancel: () => void
  planeField: ReactNode
}) {
  return (
    <ParameterPanel
      copy={copy}
      disabled={disabled}
      footerAction={footerAction}
      legend={copy.dimensions}
      message={message}
      onCancel={onCancel}
    >
      {planeField}
      {fields}
    </ParameterPanel>
  )
}
