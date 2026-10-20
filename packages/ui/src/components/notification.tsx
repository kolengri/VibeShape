import { cva, type VariantProps } from "class-variance-authority"
import { Toast as ToastPrimitive } from "radix-ui"
import type * as React from "react"
import { cn } from "#lib/cn"

function NotificationProvider(props: React.ComponentProps<typeof ToastPrimitive.Provider>) {
  return <ToastPrimitive.Provider duration={Infinity} {...props} />
}

const notificationVariants = cva(
  "pointer-events-auto flex items-start gap-2 rounded-md border bg-popover p-3 text-popover-foreground shadow-lg",
  {
    variants: {
      tone: { error: "border-destructive", success: "border-border" },
    },
    defaultVariants: { tone: "error" },
  },
)

function Notification({
  className,
  tone = "error",
  ...props
}: React.ComponentProps<typeof ToastPrimitive.Root> & VariantProps<typeof notificationVariants>) {
  return (
    <ToastPrimitive.Root
      data-slot="notification"
      duration={Infinity}
      type="background"
      role={tone === "success" ? "status" : "alert"}
      aria-live="off"
      data-tone={tone}
      className={cn(notificationVariants({ tone }), className)}
      {...props}
    />
  )
}

function NotificationViewport({
  className,
  ...props
}: React.ComponentProps<typeof ToastPrimitive.Viewport>) {
  return (
    <ToastPrimitive.Viewport
      data-slot="notification-viewport"
      aria-live="off"
      className={cn(
        "pointer-events-none fixed right-3 bottom-3 left-3 z-50 max-h-[calc(100dvh-6rem)] space-y-2 overflow-y-auto sm:left-auto sm:w-sm",
        className,
      )}
      {...props}
    />
  )
}

function NotificationClose(props: React.ComponentProps<typeof ToastPrimitive.Close>) {
  return <ToastPrimitive.Close data-slot="notification-close" {...props} />
}

export { Notification, NotificationClose, NotificationProvider, NotificationViewport }
