import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@vibeshape/ui/components/dialog"
import { type ReactNode, useCallback, useRef, useState } from "react"
import { createPortal } from "react-dom"

export function useAssistantSettings(chatOpen: boolean) {
  const [open, setOpen] = useState(false)
  const [mounted, setMounted] = useState(false)
  const trigger = useRef<HTMLElement | null>(null)
  return {
    open,
    show() {
      trigger.current =
        document.activeElement instanceof HTMLElement ? document.activeElement : null
      setMounted(true)
      setOpen(true)
    },
    dialog: {
      open: chatOpen && open,
      mounted,
      onOpenChange: setOpen,
      returnFocus() {
        if (chatOpen) trigger.current?.focus()
      },
    },
  }
}

export function AssistantSettingsDialog({
  open,
  mounted,
  onOpenChange,
  title,
  description,
  closeLabel,
  returnFocus,
  children,
}: {
  open: boolean
  mounted: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description: string
  closeLabel: string
  returnFocus: () => void
  children: ReactNode
}) {
  const [container] = useState(() => document.createElement("div"))
  const parking = useRef<HTMLDivElement | null>(null)
  const dialog = useRef<HTMLDivElement | null>(null)
  // Keep connection controls and unsent credentials mounted when Radix closes its portal.
  const park = useCallback(
    (node: HTMLDivElement | null) => {
      parking.current = node
      if (node && !dialog.current) node.append(container)
    },
    [container],
  )
  const dock = useCallback(
    (node: HTMLDivElement | null) => {
      dialog.current = node
      ;(node ?? parking.current)?.append(container)
    },
    [container],
  )
  if (!mounted) return null
  return (
    <>
      <div hidden ref={park} />
      {createPortal(children, container)}
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent
          aria-modal="true"
          closeLabel={closeLabel}
          onCloseAutoFocus={(event) => {
            event.preventDefault()
            returnFocus()
          }}
        >
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </DialogHeader>
          <div ref={dock} />
        </DialogContent>
      </Dialog>
    </>
  )
}
