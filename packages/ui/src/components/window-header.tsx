import { Slot } from "radix-ui"
import type { ComponentProps } from "react"
import { cn } from "#lib/cn"

function WindowHeader({ className, ...props }: ComponentProps<"header">) {
  return (
    <header
      data-slot="window-header"
      className={cn("grid min-w-0 shrink-0 gap-2 border-b p-3", className)}
      {...props}
    />
  )
}

function WindowTitle({
  asChild = false,
  className,
  ...props
}: ComponentProps<"h2"> & { asChild?: boolean }) {
  const Component = asChild ? Slot.Root : "h2"
  return (
    <Component
      data-window-title=""
      className={cn("min-w-0 break-words text-base leading-6 font-semibold", className)}
      {...props}
    />
  )
}

export { WindowHeader, WindowTitle }
