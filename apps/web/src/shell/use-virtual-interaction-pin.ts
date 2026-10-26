import { useEffect, useState } from "react"

// Portaled menus/dialogs retain their trigger until they close, even after a manual scroll.
export function useVirtualInteractionPin() {
  const [key, setKey] = useState<string | null>(null)
  useEffect(() => {
    if (key === null) return
    let frame = 0
    const check = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        if (!document.querySelector('[role="dialog"], [role="alertdialog"], [role="menu"]'))
          setKey(null)
      })
    }
    const observer = new MutationObserver(check)
    observer.observe(document.body, { childList: true, subtree: true })
    check()
    return () => {
      observer.disconnect()
      cancelAnimationFrame(frame)
    }
  }, [key])
  return [key, setKey] as const
}
