import { cn } from "@vibeshape/ui/lib/cn"
import { type MouseEvent, type ReactElement, useRef, useState } from "react"
import { ActionAvailability } from "./action-availability"
import { TaskPanelLifecycleButton } from "./task-panel-lifecycle-button"

export type TaskPanelLifecycleActionsProps = Readonly<{
  acceptDisabled?: boolean
  acceptDisabledReason?: string | undefined
  acceptLabel?: string
  acceptLoading?: boolean
  acceptType?: "button" | "submit"
  ariaLabel: string
  cancelDisabled?: boolean
  cancelLabel: string
  className?: string
  onAccept?: (event: MouseEvent<HTMLButtonElement>) => unknown
  onCancel: () => void
  renderAccept?: (describedBy: string | undefined) => ReactElement
}>

function useLifecycleAcceptance(
  onAccept: TaskPanelLifecycleActionsProps["onAccept"],
  onCancel: () => void,
) {
  const pending = useRef(false)
  const [loading, setLoading] = useState(false)
  const accept = async (event: MouseEvent<HTMLButtonElement>) => {
    if (pending.current) return
    pending.current = true
    setLoading(true)
    try {
      return await onAccept?.(event)
    } finally {
      pending.current = false
      setLoading(false)
    }
  }
  return {
    loading,
    accept,
    cancel: () => {
      if (!pending.current) return onCancel()
    },
  }
}

function TaskPanelAcceptAction({
  label,
  disabled,
  reason,
  loading,
  type,
  onAccept,
  renderAccept,
}: {
  label: string
  disabled: boolean
  reason: string | undefined
  loading: boolean
  type: "button" | "submit"
  onAccept: TaskPanelLifecycleActionsProps["onAccept"]
  renderAccept: TaskPanelLifecycleActionsProps["renderAccept"]
}) {
  return (
    <ActionAvailability
      disabledReason={disabled ? reason : undefined}
      presentation="persistent"
      reasonClassName="basis-full break-words"
    >
      {({ describedBy }) =>
        renderAccept ? (
          renderAccept(describedBy)
        ) : (
          <TaskPanelLifecycleButton
            kind="accept"
            label={label}
            presentation="text"
            aria-describedby={describedBy}
            disabled={disabled}
            isLoading={loading}
            type={type}
            {...(onAccept ? { onClick: onAccept } : {})}
          />
        )
      }
    </ActionAvailability>
  )
}

/** Text-labelled lifecycle controls for the task footer. */
export function TaskPanelLifecycleActions({
  acceptDisabled = false,
  acceptDisabledReason,
  acceptLabel,
  acceptLoading = false,
  acceptType = "button",
  ariaLabel,
  cancelDisabled = false,
  cancelLabel,
  className,
  onAccept,
  onCancel,
  renderAccept,
}: TaskPanelLifecycleActionsProps) {
  const acceptance = useLifecycleAcceptance(onAccept, onCancel)
  const loading = acceptLoading || acceptance.loading
  return (
    <fieldset className={cn("flex min-w-0 flex-1 flex-wrap justify-end gap-2", className)}>
      <legend className="sr-only">{ariaLabel}</legend>
      <TaskPanelLifecycleButton
        kind="cancel"
        label={cancelLabel}
        presentation="text"
        disabled={cancelDisabled || loading}
        type="button"
        onClick={acceptance.cancel}
      />
      {acceptLabel ? (
        <TaskPanelAcceptAction
          label={acceptLabel}
          disabled={acceptDisabled}
          reason={acceptDisabledReason}
          loading={loading}
          type={acceptType}
          onAccept={onAccept ? acceptance.accept : undefined}
          renderAccept={renderAccept}
        />
      ) : null}
    </fieldset>
  )
}
