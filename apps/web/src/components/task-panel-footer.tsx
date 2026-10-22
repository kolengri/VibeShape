import { cn } from "@vibeshape/ui/lib/cn"
import type { ReactNode } from "react"

export function TaskPanelFooter({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) {
  return (
    <footer
      data-slot="task-panel-footer"
      className={cn("grid min-w-0 shrink-0 gap-2 border-t p-3", className)}
    >
      {children}
    </footer>
  )
}
