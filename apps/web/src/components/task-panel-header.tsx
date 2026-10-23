import { FieldHelp } from "@vibeshape/ui/components/field-help"
import { WindowHeader, WindowTitle } from "@vibeshape/ui/components/window-header"
import { cn } from "@vibeshape/ui/lib/cn"
import type { ReactNode } from "react"

import { WindowCollapseTitle } from "./window-collapse"

export function TaskPanelHeader({
  title,
  description,
  instruction,
  className,
  children,
}: {
  title: string
  description?: ReactNode
  instruction?: ReactNode
  className?: string
  children?: ReactNode
}) {
  return (
    <WindowHeader data-slot="task-panel-header" className={cn("gap-1 px-2 py-1", className)}>
      <div className="flex min-w-0 items-start gap-2">
        <WindowTitle aria-label={title} className="flex-1 text-sm leading-5">
          <WindowCollapseTitle>{title}</WindowCollapseTitle>
        </WindowTitle>
        {description ? <FieldHelp label={title}>{description}</FieldHelp> : null}
      </div>
      {instruction ? (
        <p className="break-words text-xs leading-4 text-muted-foreground">{instruction}</p>
      ) : null}
      {children}
    </WindowHeader>
  )
}
