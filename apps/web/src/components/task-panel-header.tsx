import { FieldHelp } from "@vibeshape/ui/components/field-help"
import { WindowHeader, WindowTitle } from "@vibeshape/ui/components/window-header"
import type { ReactNode } from "react"

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
    <WindowHeader data-slot="task-panel-header" className={className}>
      <div className="flex min-w-0 items-start gap-2">
        <WindowTitle className="flex-1">{title}</WindowTitle>
        {description ? <FieldHelp label={title}>{description}</FieldHelp> : null}
      </div>
      {instruction ? (
        <p className="break-words text-xs leading-4 text-muted-foreground">{instruction}</p>
      ) : null}
      {children}
    </WindowHeader>
  )
}
