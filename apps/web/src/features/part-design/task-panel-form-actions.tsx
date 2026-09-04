import { useFormContext } from "@vibeshape/ui/integrations/tanstack-form"
import { TaskPanelLifecycleActions } from "../../components/task-panel-lifecycle-actions"
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
          onCancel={onCancel}
        />
      )}
    </form.Subscribe>
  )
}
