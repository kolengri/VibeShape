import { Button } from "@vibeshape/ui/components/button"
import { Check, X } from "@vibeshape/ui/components/icons"
import { Tooltip, TooltipContent, TooltipTrigger } from "@vibeshape/ui/components/tooltip"
import { cn } from "@vibeshape/ui/lib/cn"
import type { MouseEvent } from "react"

export type TaskPanelLifecycleActionsProps = Readonly<{
  acceptDisabled?: boolean
  acceptLabel: string
  ariaLabel: string
  cancelLabel: string
  className?: string
  onAccept: (event: MouseEvent<HTMLButtonElement>) => unknown
  onCancel: () => void
}>

/** Compact, consistently labelled Cancel and Accept actions for task panels. */
export function TaskPanelLifecycleActions({
  acceptDisabled = false,
  acceptLabel,
  ariaLabel,
  cancelLabel,
  className,
  onAccept,
  onCancel,
}: TaskPanelLifecycleActionsProps) {
  return (
    <fieldset className={cn("grid w-fit grid-cols-[repeat(2,2rem)] gap-1", className)}>
      <legend className="sr-only">{ariaLabel}</legend>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            aria-label={cancelLabel}
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
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            aria-label={acceptLabel}
            disabled={acceptDisabled}
            size="icon-sm"
            type="button"
            onClick={onAccept}
          >
            <Check aria-hidden="true" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>{acceptLabel}</TooltipContent>
      </Tooltip>
    </fieldset>
  )
}
