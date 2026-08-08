import { Label as LabelPrimitive } from "radix-ui"
import type * as React from "react"

import { cn } from "#lib/cn"

function Label({ className, ...props }: React.ComponentProps<typeof LabelPrimitive.Root>) {
  return (
    <LabelPrimitive.Root
      data-slot="label"
      {...props}
      className={cn(
        "flex items-center gap-2 text-sm font-medium leading-none select-none",
        "peer-disabled:cursor-not-allowed peer-disabled:opacity-50",
        className,
      )}
    />
  )
}

export { Label }
