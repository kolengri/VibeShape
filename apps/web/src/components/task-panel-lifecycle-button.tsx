import { Button, type ButtonProps } from "@vibeshape/ui/components/button"
import { Check, X } from "@vibeshape/ui/components/icons"
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
  destructive = false,
  className,
  ...props
}: Omit<ButtonProps, "children" | "size" | "variant"> & {
  kind: "accept" | "cancel"
  label: string
  destructive?: boolean
}) {
  const Icon = kind === "accept" ? Check : X
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            {...props}
            aria-label={label}
            size="icon-sm"
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
