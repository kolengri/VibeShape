import type { ReactNode } from "react"
import { createPortal } from "react-dom"

export type ActionContainer = HTMLElement | null | undefined

export function OptionalActionPortal({
  children,
  container,
}: {
  children: ReactNode
  container: ActionContainer
}) {
  // Undefined keeps standalone actions inline; null waits for a dialog footer to mount.
  if (container === undefined) return children
  if (container === null) return null
  return createPortal(children, container)
}
