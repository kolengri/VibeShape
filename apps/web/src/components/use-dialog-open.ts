import { useState } from "react"

export type DialogOpenProps = Readonly<{
  showTrigger?: boolean
  open?: boolean
  onOpenChange?: (open: boolean) => void
  onCloseAutoFocus?: (event: Event) => void
}>

export function useDialogOpen(controlled: boolean | undefined, onChange?: (open: boolean) => void) {
  const [local, setLocal] = useState(false)
  return [
    controlled ?? local,
    (next: boolean) => {
      if (controlled === undefined) setLocal(next)
      onChange?.(next)
    },
  ] as const
}
