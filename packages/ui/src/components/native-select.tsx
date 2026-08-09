import { ChevronDownIcon } from "lucide-react"
import type * as React from "react"

import { cn } from "#lib/cn"

function NativeSelect({ className, children, ...props }: React.ComponentProps<"select">) {
  return (
    <div data-slot="native-select-wrapper" className="relative">
      <select
        {...props}
        data-slot="native-select"
        className={cn(
          "flex h-8 w-full min-w-0 appearance-none rounded-md border border-input bg-transparent px-3 py-1 pr-8 text-sm outline-none",
          "transition-colors focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50",
          "aria-invalid:border-destructive aria-invalid:ring-[3px] aria-invalid:ring-destructive/20",
          "disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50",
          "dark:bg-input/30 dark:aria-invalid:ring-destructive/40",
          className,
        )}
      >
        {children}
      </select>
      <ChevronDownIcon
        className="pointer-events-none absolute top-1/2 right-2 size-4 -translate-y-1/2 text-muted-foreground"
        aria-hidden="true"
      />
    </div>
  )
}

export { NativeSelect }
