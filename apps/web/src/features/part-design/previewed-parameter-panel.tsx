import type { ReactNode } from "react"
import type { FeaturePreviewState } from "../preview/use-feature-preview"
import { ParameterPanel, type ParameterPanelCopy } from "./parameter-panel"
import { TaskPanelFormActions } from "./task-panel-form-actions"

export type PreviewedParameterPanelCopy = ParameterPanelCopy &
  Readonly<{ parameters: string; submit: string; previewFailed: string }>

/** Parameter panel whose Apply waits for the latest exact preview and explains a failed one. */
export function PreviewedParameterPanel({
  acceptDisabled = false,
  children,
  copy,
  disabled,
  message,
  onCancel,
  pending,
  previewDiagnostic,
  previewStatus,
}: Readonly<{
  acceptDisabled?: boolean
  children: ReactNode
  copy: PreviewedParameterPanelCopy
  disabled: boolean
  message: string | null
  onCancel: () => void
  pending: boolean
  previewDiagnostic?: string | undefined
  previewStatus?: FeaturePreviewState["status"] | undefined
}>) {
  return (
    <ParameterPanel
      previewStatus={previewStatus}
      copy={copy}
      legend={copy.parameters}
      disabled={disabled || pending}
      message={
        message ?? (previewStatus === "error" ? (previewDiagnostic ?? copy.previewFailed) : null)
      }
      actions={
        <TaskPanelFormActions
          acceptLabel={copy.submit}
          ariaLabel={copy.title}
          cancelLabel={copy.cancel}
          disabled={disabled || acceptDisabled}
          onCancel={onCancel}
          previewStatus={previewStatus}
        />
      }
    >
      {children}
    </ParameterPanel>
  )
}
