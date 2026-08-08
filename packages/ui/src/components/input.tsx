import type * as React from "react"

import { cn } from "#lib/cn"

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      {...props}
      data-slot="input"
      type={type}
      className={cn(
        "flex h-8 w-full min-w-0 rounded-md border border-input bg-transparent px-3 py-1 text-sm outline-none",
        "transition-colors placeholder:text-muted-foreground selection:bg-primary selection:text-primary-foreground",
        "focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50",
        "aria-invalid:border-destructive aria-invalid:ring-[3px] aria-invalid:ring-destructive/20",
        "disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50",
        "dark:bg-input/30 dark:aria-invalid:ring-destructive/40",
        type === "number" && "tabular-nums",
        className,
      )}
    />
  )
}

export { Input }
