import { submitForm, useFormContext } from "@vibeshape/ui/integrations/tanstack-form"
import { TaskPanelLifecycleActions } from "../../components/task-panel-lifecycle-actions"
import { useRegisterTaskSubmission } from "../../editor-session/editor-session-provider"
import type { FeaturePreviewState } from "../preview/use-feature-preview"

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
  useRegisterTaskSubmission(async () => {
    if (
      form.state.isSubmitting ||
      (!disabled &&
        form.state.canSubmit &&
        (previewStatus === undefined || previewStatus === "ready"))
    )
      await submitForm(form)
  })

  return (
    <form.Subscribe selector={(state) => [state.canSubmit, state.isSubmitting] as const}>
      {([canSubmit, isSubmitting]) => (
        <TaskPanelLifecycleActions
          acceptDisabled={
            disabled ||
            isSubmitting ||
            !canSubmit ||
            (previewStatus !== undefined && previewStatus !== "ready")
          }
          acceptLabel={acceptLabel}
          acceptLoading={isSubmitting}
          acceptType="submit"
          ariaLabel={ariaLabel}
          cancelLabel={cancelLabel}
          cancelDisabled={isSubmitting}
          onCancel={onCancel}
        />
      )}
    </form.Subscribe>
  )
}
