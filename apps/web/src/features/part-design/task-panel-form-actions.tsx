import { useTranslations } from "@vibeshape/i18n"
import { submitForm, useFormContext } from "@vibeshape/ui/integrations/tanstack-form"
import { TaskPanelLifecycleActions } from "../../components/task-panel-lifecycle-actions"
import { useRegisterTaskSubmission } from "../../editor-session/editor-session-provider"
import type { FeaturePreviewState } from "../preview/use-feature-preview"
import { isFeaturePreviewReady } from "./feature-preview-readiness"

export function TaskPanelFormActions({
  acceptLabel,
  ariaLabel,
  cancelLabel,
  disabled = false,
  onCancel,
  previewStatus,
}: Readonly<{
  acceptLabel: string
  ariaLabel: string
  cancelLabel: string
  disabled?: boolean
  onCancel: () => void
  previewStatus?: FeaturePreviewState["status"] | undefined
}>) {
  const form = useFormContext()
  const t = useTranslations("app.shell.taskPanel.previewFeedback")
  const previewReady = isFeaturePreviewReady(previewStatus)
  const reasonKeys = { idle: "idleReason", loading: "loadingReason", error: "errorReason" } as const
  const previewReason = previewReady ? undefined : t(reasonKeys[previewStatus ?? "idle"])
  useRegisterTaskSubmission(async () => {
    if (
      form.state.isSubmitting ||
      (!disabled && form.state.canSubmit && isFeaturePreviewReady(previewStatus))
    )
      await submitForm(form)
  })

  return (
    <form.Subscribe selector={(state) => [state.canSubmit, state.isSubmitting] as const}>
      {([canSubmit, isSubmitting]) => {
        const blocked = disabled || isSubmitting || !canSubmit
        return (
          <TaskPanelLifecycleActions
            acceptDisabled={blocked || !previewReady}
            acceptDisabledReason={blocked ? undefined : previewReason}
            acceptLabel={acceptLabel}
            acceptLoading={isSubmitting}
            acceptType="submit"
            ariaLabel={ariaLabel}
            cancelLabel={cancelLabel}
            cancelDisabled={isSubmitting}
            onCancel={onCancel}
          />
        )
      }}
    </form.Subscribe>
  )
}
