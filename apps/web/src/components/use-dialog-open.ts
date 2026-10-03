import { useState } from "react"

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
