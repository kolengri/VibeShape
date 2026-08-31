import { useFormContext } from "@vibeshape/ui/integrations/tanstack-form"
import { TaskPanelLifecycleActions } from "../../components/task-panel-lifecycle-actions"

export function TaskPanelFormActions({
  acceptLabel,
  ariaLabel,
  cancelLabel,
  disabled = false,
  onCancel,
}: Readonly<{
  acceptLabel: string
  ariaLabel: string
  cancelLabel: string
  disabled?: boolean
  onCancel: () => void
}>) {
  const form = useFormContext()

  return (
    <form.Subscribe selector={(state) => [state.canSubmit, state.isSubmitting] as const}>
      {([canSubmit, isSubmitting]) => (
        <TaskPanelLifecycleActions
          acceptDisabled={disabled || isSubmitting || !canSubmit}
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
