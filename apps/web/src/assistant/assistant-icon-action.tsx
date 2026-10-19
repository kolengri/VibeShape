import { Button } from "@vibeshape/ui/components/button"
import { Tooltip, TooltipContent, TooltipTrigger } from "@vibeshape/ui/components/tooltip"
import type { ReactNode } from "react"

export function AssistantIconAction({
  label,
  children,
  disabled = false,
  expanded,
  onAction,
  primary = false,
}: {
  label: string
  children: ReactNode
  disabled?: boolean
  expanded?: boolean
  onAction: () => void | Promise<void>
  primary?: boolean
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          size="icon-sm"
          variant={primary ? "default" : "ghost"}
          aria-label={label}
          aria-expanded={expanded}
          disabled={disabled}
          onClick={onAction}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}
