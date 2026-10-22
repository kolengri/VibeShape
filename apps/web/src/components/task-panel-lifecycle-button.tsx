import { Button, type ButtonProps } from "@vibeshape/ui/components/button"
import { CancelIcon, Check } from "@vibeshape/ui/components/icons"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@vibeshape/ui/components/tooltip"
import { cn } from "@vibeshape/ui/lib/cn"

export function TaskPanelLifecycleButton({
  kind,
  label,
  presentation = "icon",
  destructive = false,
  className,
  ...props
}: Omit<ButtonProps, "children" | "size" | "variant"> & {
  kind: "accept" | "cancel"
  label: string
  presentation?: "icon" | "text"
  destructive?: boolean
}) {
  const Icon = kind === "accept" ? Check : CancelIcon
  if (presentation === "text")
    return (
      <Button
        {...props}
        aria-label={label}
        size="sm"
        variant={kind === "cancel" ? "outline" : destructive ? "destructive" : "default"}
        className={cn("min-w-20 max-w-full", className)}
      >
        <span className="min-w-0 truncate">{label}</span>
      </Button>
    )
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            {...props}
            aria-label={label}
            size="icon-xs"
            variant={kind === "cancel" ? "ghost" : destructive ? "destructive" : "default"}
            className={cn(
              kind === "cancel" && "text-destructive hover:text-destructive",
              className,
            )}
          >
            <Icon aria-hidden="true" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>{label}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
