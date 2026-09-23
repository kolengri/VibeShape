import type * as React from "react"
import {
  Separator as ResizableHandlePrimitive,
  Group as ResizablePanelGroupPrimitive,
  Panel as ResizablePanelPrimitive,
} from "react-resizable-panels"
import { cn } from "#lib/cn"

function ResizablePanelGroup({
  className,
  orientation = "horizontal",
  resizeTargetMinimumSize = { coarse: 8, fine: 8 },
  ...props
}: React.ComponentProps<typeof ResizablePanelGroupPrimitive>) {
  return (
    <ResizablePanelGroupPrimitive
      data-slot="resizable-panel-group"
      data-orientation={orientation}
      orientation={orientation}
      resizeTargetMinimumSize={resizeTargetMinimumSize}
      className={cn(
        "group/resizable flex h-full w-full",
        orientation === "vertical" && "flex-col",
        className,
      )}
      {...props}
    />
  )
}

function ResizablePanel({
  className,
  ...props
}: React.ComponentProps<typeof ResizablePanelPrimitive>) {
  return (
    <ResizablePanelPrimitive
      data-slot="resizable-panel"
      className={cn("min-h-0 min-w-0", className)}
      {...props}
    />
  )
}

function ResizableHandle({
  className,
  ...props
}: React.ComponentProps<typeof ResizableHandlePrimitive>) {
  return (
    <ResizableHandlePrimitive
      data-slot="resizable-handle"
      className={cn(
        "z-10 flex-shrink-0 bg-border/50 transition-colors",
        "hover:bg-primary/40 data-[separator=active]:bg-primary/60",
        "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
        "group-data-[orientation=horizontal]/resizable:h-full group-data-[orientation=horizontal]/resizable:w-2",
        "group-data-[orientation=vertical]/resizable:h-2 group-data-[orientation=vertical]/resizable:w-full",
        className,
      )}
      {...props}
    />
  )
}

export type { PanelImperativeHandle } from "react-resizable-panels"
export { ResizableHandle, ResizablePanel, ResizablePanelGroup }
