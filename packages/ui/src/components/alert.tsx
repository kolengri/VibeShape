import type { ComponentProps } from "react"
import { ErrorIcon } from "#components/icons"
import { cn } from "#lib/cn"

/** Persistent contextual errors share one surface; field errors retain their field association. */
export function Alert({ className, children, ...props }: ComponentProps<"div">) {
  return (
    <div
      role="alert"
      data-slot="alert"
      className={cn(
        "flex min-w-0 items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-foreground",
        className,
      )}
      {...props}
    >
      <ErrorIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
      <div className="min-w-0 flex-1 space-y-2 break-words">{children}</div>
    </div>
  )
}
