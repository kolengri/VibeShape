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

function lifecycleActionLayout(
  label: string | undefined,
  disabled: boolean,
  reason: string | undefined,
) {
  const showReason = Boolean(label) && disabled && Boolean(reason)
  return showReason
    ? {
        group: "w-full grid-cols-[minmax(0,1fr)_2rem_2rem]",
        cancel: "col-start-2",
        accept: "col-start-3",
      }
    : { group: "w-fit grid-flow-col auto-cols-[2rem]", cancel: undefined, accept: undefined }
}

function TaskPanelAcceptAction({
  label,
  disabled,
  reason,
  loading,
  type,
  onAccept,
  renderAccept,
  className,
}: {
  label: string
  disabled: boolean
  reason: string | undefined
  loading: boolean
  type: "button" | "submit"
  onAccept: TaskPanelLifecycleActionsProps["onAccept"]
  renderAccept: TaskPanelLifecycleActionsProps["renderAccept"]
  className: string | undefined
}) {
  return (
    <ActionAvailability
      disabledReason={disabled ? reason : undefined}
      presentation="persistent"
      reasonClassName="col-span-full"
    >
      {({ describedBy }) =>
        renderAccept ? (
          renderAccept(describedBy)
        ) : (
          <TaskPanelLifecycleButton
            kind="accept"
            label={label}
            aria-describedby={describedBy}
            disabled={disabled}
            isLoading={loading}
            type={type}
            className={className}
            {...(onAccept ? { onClick: onAccept } : {})}
          />
        )
      }
    </ActionAvailability>
  )
}

/** Compact, consistently labelled Cancel and Accept actions for task panels. */
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
  const layout = lifecycleActionLayout(acceptLabel, acceptDisabled, acceptDisabledReason)
  return (
    <fieldset className={cn("grid gap-1", layout.group, className)}>
      <legend className="sr-only">{ariaLabel}</legend>
      <TaskPanelLifecycleButton
        kind="cancel"
        label={cancelLabel}
        disabled={cancelDisabled || loading}
        className={layout.cancel}
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
          className={layout.accept}
        />
      ) : null}
    </fieldset>
  )
}
