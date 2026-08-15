import { Toolbar as ToolbarPrimitive } from "radix-ui"
import type * as React from "react"
import { cn } from "#lib/cn"

function Toolbar({
  className,
  orientation = "horizontal",
  loop = true,
  ...props
}: React.ComponentProps<typeof ToolbarPrimitive.Root>) {
  return (
    <ToolbarPrimitive.Root
      data-slot="toolbar"
      orientation={orientation}
      loop={loop}
      className={cn("flex items-center", className)}
      {...props}
    />
  )
}

function ToolbarButton(props: React.ComponentProps<typeof ToolbarPrimitive.Button>) {
  return <ToolbarPrimitive.Button data-slot="toolbar-button" {...props} />
}

function ToolbarSeparator({
  className,
  ...props
}: React.ComponentProps<typeof ToolbarPrimitive.Separator>) {
  return (
    <ToolbarPrimitive.Separator
      data-slot="toolbar-separator"
      className={cn(
        "mx-1 bg-border data-[orientation=vertical]:h-5 data-[orientation=vertical]:w-px",
        "data-[orientation=horizontal]:h-px data-[orientation=horizontal]:w-full",
        className,
      )}
      {...props}
    />
  )
}

export { Toolbar, ToolbarButton, ToolbarSeparator }
