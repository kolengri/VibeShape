import { useTranslations } from "@vibeshape/i18n"
import { Alert } from "@vibeshape/ui/components/alert"
import type { ReactNode } from "react"
import { TaskPanelLayout } from "../../components/task-panel-layout"
import { TaskProgress } from "../../components/task-progress"
import type { FeaturePreviewState } from "../preview/use-feature-preview"

export type ParameterPanelCopy = Readonly<{
  cancel: string
  description: string
  title: string
  previewLoading?: string
  previewProgress?: string
}>

export function ParameterPanel({
  actions,
  children,
  copy,
  disabled = false,
  legend,
  message,
  previewStatus,
  previewErrorHandled = false,
}: {
  actions: ReactNode
  children: ReactNode
  copy: ParameterPanelCopy
  disabled?: boolean
  legend: string
  message?: ReactNode
  previewStatus?: FeaturePreviewState["status"] | undefined
  previewErrorHandled?: boolean | undefined
}) {
  const t = useTranslations("app.shell.taskPanel.previewFeedback")
  const error = message ?? (previewStatus === "error" && !previewErrorHandled ? t("failed") : null)
  return (
    <TaskPanelLayout title={copy.title} description={copy.description} actions={actions}>
      {error ? <Alert>{error}</Alert> : null}
      {previewStatus === "loading" ? (
        <TaskProgress
          status={copy.previewLoading ?? t("loading")}
          label={copy.previewProgress ?? t("progress")}
        />
      ) : null}
      <fieldset disabled={disabled} className="grid min-w-0 gap-2">
        <legend className="sr-only">{legend}</legend>
        {children}
      </fieldset>
    </TaskPanelLayout>
  )
}
