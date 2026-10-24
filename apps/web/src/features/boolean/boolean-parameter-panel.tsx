import type { ReactNode } from "react"
import { ParameterPanel, type ParameterPanelCopy } from "../part-design/parameter-panel"
import type { FeaturePreviewState } from "../preview/use-feature-preview"

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
  previewStatus,
}: {
  actions: ReactNode
  copy: BooleanParameterPanelCopy
  disabled?: boolean
  fields: ReactNode
  message?: ReactNode
  previewStatus?: FeaturePreviewState["status"] | undefined
}) {
  return (
    <ParameterPanel
      actions={actions}
      copy={copy}
      disabled={disabled}
      legend={copy.inputs}
      message={message}
      previewStatus={previewStatus}
    >
      {fields}
    </ParameterPanel>
  )
}
