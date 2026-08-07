import { LoaderIcon } from "lucide-react"
import type * as React from "react"

import { cn } from "#lib/cn"

type SpinnerBaseProps = Omit<React.ComponentProps<typeof LoaderIcon>, "aria-hidden" | "aria-label">

export type SpinnerProps = SpinnerBaseProps &
  (
    | { "aria-hidden": true | "true"; "aria-label"?: never }
    | { "aria-hidden"?: false | "false"; "aria-label": string }
  )

function Spinner({
  className,
  role = "status",
  "aria-hidden": ariaHidden,
  "aria-label": ariaLabel,
  ...props
}: SpinnerProps) {
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
