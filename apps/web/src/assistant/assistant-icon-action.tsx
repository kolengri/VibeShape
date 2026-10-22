import { Button } from "@vibeshape/ui/components/button"
import { Tooltip, TooltipContent, TooltipTrigger } from "@vibeshape/ui/components/tooltip"
import type { ReactNode } from "react"

export function AssistantIconAction({
  label,
  children,
  disabled = false,
  expanded,
  pressed,
  onAction,
  primary = false,
  size = "icon-sm",
}: {
  label: string
  children: ReactNode
  disabled?: boolean
  expanded?: boolean
  pressed?: boolean
  onAction: () => unknown
  primary?: boolean
  size?: "icon-xs" | "icon-sm"
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          size={size}
          variant={primary ? "default" : pressed ? "secondary" : "ghost"}
          aria-label={label}
          aria-expanded={expanded}
          aria-pressed={pressed}
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
