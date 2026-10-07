import { Button } from "@vibeshape/ui/components/button"
import { Check, X } from "@vibeshape/ui/components/icons"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@vibeshape/ui/components/tooltip"
import { cn } from "@vibeshape/ui/lib/cn"
import type { MouseEvent } from "react"
import { ActionAvailability } from "./action-availability"

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
}>

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
}: TaskPanelLifecycleActionsProps) {
  return (
    <TooltipProvider>
      <fieldset
        className={cn(
          "grid gap-1",
          acceptDisabled && acceptDisabledReason
            ? "w-full grid-cols-[2rem_2rem_1fr]"
            : "w-fit grid-flow-col auto-cols-[2rem]",
          className,
        )}
      >
        <legend className="sr-only">{ariaLabel}</legend>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              aria-label={cancelLabel}
              disabled={cancelDisabled}
              className="text-destructive hover:text-destructive"
              size="icon-sm"
              type="button"
              variant="ghost"
              onClick={onCancel}
            >
              <X aria-hidden="true" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{cancelLabel}</TooltipContent>
        </Tooltip>
        {acceptLabel ? (
          <ActionAvailability
            disabledReason={acceptDisabled ? acceptDisabledReason : undefined}
            presentation="persistent"
            reasonClassName="col-span-full"
          >
            {({ describedBy }) => (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    aria-label={acceptLabel}
                    aria-describedby={describedBy}
                    disabled={acceptDisabled}
                    isLoading={acceptLoading}
                    size="icon-sm"
                    type={acceptType}
                    {...(onAccept ? { onClick: onAccept } : {})}
                  >
                    <Check aria-hidden="true" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{acceptLabel}</TooltipContent>
              </Tooltip>
            )}
          </ActionAvailability>
        ) : null}
      </fieldset>
    </TooltipProvider>
  )
}
