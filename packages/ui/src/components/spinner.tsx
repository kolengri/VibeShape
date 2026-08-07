import { LoaderIcon } from "lucide-react"
import type * as React from "react"

import { cn } from "#lib/cn"

function Spinner({
  className,
  role = "status",
  "aria-hidden": ariaHidden,
  "aria-label": ariaLabel = "Loading",
  ...props
}: React.ComponentProps<typeof LoaderIcon>) {
  const isHidden = ariaHidden === true || ariaHidden === "true"

  return (
    <LoaderIcon
      {...props}
      data-slot="spinner"
      role={isHidden ? undefined : role}
      aria-hidden={ariaHidden}
      aria-label={isHidden ? undefined : ariaLabel}
      className={cn("size-4 animate-spin motion-reduce:animate-none", className)}
    />
  )
}

export { Spinner }
