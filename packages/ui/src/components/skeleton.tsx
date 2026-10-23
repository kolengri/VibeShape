import type { ComponentProps } from "react"
import { cn } from "#lib/cn"

export function Skeleton({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      {...props}
      aria-hidden="true"
      data-slot="skeleton"
      className={cn("animate-pulse rounded-md bg-muted motion-reduce:animate-none", className)}
    />
  )
}
