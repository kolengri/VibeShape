import { Dialog as DialogPrimitive } from "radix-ui"
import { useRef } from "react"
import { LoadingIcon } from "#components/icons"

/** A controlled modal; operation settlement owns dismissal and focus restoration. */
export function BlockingLoader({ label }: { label: string | null }) {
  const returnFocus = useRef<HTMLElement | null>(null)
  return (
    <DialogPrimitive.Root open={label !== null}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay
          data-slot="blocking-loader-overlay"
          className="fixed inset-0 z-70 bg-black/50 backdrop-blur-xs"
        />
        <DialogPrimitive.Content
          data-slot="blocking-loader"
          aria-modal="true"
          aria-describedby={undefined}
          className="fixed top-1/2 left-1/2 z-70 flex w-[calc(100%-2rem)] max-w-xs -translate-x-1/2 -translate-y-1/2 items-center gap-3 rounded-lg border bg-popover p-5 text-popover-foreground shadow-lg outline-none"
          onEscapeKeyDown={(event) => event.preventDefault()}
          onInteractOutside={(event) => event.preventDefault()}
          onKeyDown={(event) => event.stopPropagation()}
          onOpenAutoFocus={() => {
            returnFocus.current =
              document.activeElement instanceof HTMLElement ? document.activeElement : null
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault()
            if (returnFocus.current?.isConnected) returnFocus.current.focus({ preventScroll: true })
          }}
        >
          <LoadingIcon
            aria-hidden="true"
            className="size-6 shrink-0 animate-spin motion-reduce:animate-none"
          />
          <DialogPrimitive.Title className="text-sm font-medium" aria-live="polite">
            {label}
          </DialogPrimitive.Title>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}
