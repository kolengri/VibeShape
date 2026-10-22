import { Dialog as DialogPrimitive } from "radix-ui"
import type * as React from "react"
import { Button } from "#components/button"
import { X as XIcon } from "#components/icons"
import { WindowHeader, WindowTitle } from "#components/window-header"
import { cn } from "#lib/cn"

function Dialog(props: React.ComponentProps<typeof DialogPrimitive.Root>) {
  return <DialogPrimitive.Root data-slot="dialog" {...props} />
}

function DialogTrigger(props: React.ComponentProps<typeof DialogPrimitive.Trigger>) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />
}

function DialogClose(props: React.ComponentProps<typeof DialogPrimitive.Close>) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />
}

function DialogPortal(props: React.ComponentProps<typeof DialogPrimitive.Portal>) {
  return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />
}

function DialogOverlay({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Overlay>) {
  return (
    <DialogPrimitive.Overlay
      data-slot="dialog-overlay"
      className={cn("fixed inset-0 z-50 bg-black/50", className)}
      {...props}
    />
  )
}

type DialogContentProps = React.ComponentProps<typeof DialogPrimitive.Content> & {
  closeLabel: string
  showCloseButton?: boolean
}

function DialogContent({
  className,
  children,
  closeLabel,
  showCloseButton = true,
  onOpenAutoFocus,
  ...props
}: DialogContentProps) {
  return (
    <DialogPortal>
      <DialogOverlay />
      <DialogPrimitive.Content
        data-slot="dialog-content"
        className={cn(
          "fixed top-1/2 left-1/2 z-50 flex max-h-[calc(100svh-2rem)] min-w-0 w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-lg border bg-background text-sm shadow-lg outline-none",
          "focus-visible:ring-[3px] focus-visible:ring-ring/50",
          className,
        )}
        {...props}
        onOpenAutoFocus={(event) => {
          onOpenAutoFocus?.(event)
          if (event.defaultPrevented || !(event.target instanceof HTMLElement)) return
          const input = event.target.querySelector<HTMLInputElement>(
            'input[data-autofocus="true"]:not(:disabled)',
          )
          if (!input) return
          input.focus()
          if (input.ownerDocument.activeElement === input) event.preventDefault()
        }}
      >
        {children}
        {showCloseButton ? (
          <DialogPrimitive.Close asChild>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="absolute top-2 right-2 text-muted-foreground"
              aria-label={closeLabel}
            >
              <XIcon aria-hidden="true" />
            </Button>
          </DialogPrimitive.Close>
        ) : null}
      </DialogPrimitive.Content>
    </DialogPortal>
  )
}

function DialogHeader({ className, ...props }: React.ComponentProps<typeof WindowHeader>) {
  return (
    <WindowHeader
      data-slot="dialog-header"
      className={cn("gap-1.5 pr-14 text-left", className)}
      {...props}
    />
  )
}

function DialogBody({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-body"
      className={cn(
        "grid min-h-0 min-w-0 flex-1 gap-4 overflow-y-auto overscroll-contain p-4",
        className,
      )}
      {...props}
    />
  )
}

function DialogFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn(
        "flex shrink-0 flex-wrap items-center justify-end gap-2 border-t bg-muted/30 px-4 py-3",
        "[&>[data-slot=button]]:min-w-20",
        className,
      )}
      {...props}
    />
  )
}

function DialogTitle({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <WindowTitle asChild className={className}>
      <DialogPrimitive.Title data-slot="dialog-title" {...props} />
    </WindowTitle>
  )
}

function DialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn("text-sm text-muted-foreground", className)}
      {...props}
    />
  )
}

export {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
}
