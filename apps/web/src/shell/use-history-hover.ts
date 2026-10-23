import { type PointerEvent, useCallback, useEffect, useRef } from "react"

const dwellDelay = 200
const scrollIdleDelay = 150

export function useHistoryHover(onPreselect: (target: HTMLElement | null) => void) {
  const pending = useRef<ReturnType<typeof setTimeout> | null>(null)
  const candidate = useRef<HTMLElement | null>(null)
  const active = useRef(false)
  const blockedUntil = useRef(0)

  const cancel = useCallback(() => {
    if (pending.current !== null) clearTimeout(pending.current)
    pending.current = null
    candidate.current = null
    if (active.current) onPreselect(null)
    active.current = false
  }, [onPreselect])

  // The owner replaces this callback when the available History rows change.
  useEffect(() => cancel, [cancel])

  const rowAt = (target: EventTarget | null) =>
    target instanceof Element
      ? target.closest<HTMLElement>("[data-history-profile-index], [data-history-id]")
      : null

  const schedule = (event: PointerEvent<HTMLElement>) => {
    if (event.pointerType === "touch" || event.buttons !== 0) return
    const row = rowAt(event.target)
    if (!row || !event.currentTarget.contains(row) || candidate.current === row) return
    cancel()
    if (Date.now() < blockedUntil.current) return
    candidate.current = row
    pending.current = setTimeout(() => {
      pending.current = null
      if (!row.isConnected) return
      active.current = true
      onPreselect(row)
    }, dwellDelay)
  }

  const scroll = () => {
    blockedUntil.current = Date.now() + scrollIdleDelay
    cancel()
  }

  return {
    onPointerOver: schedule,
    onPointerMove: schedule,
    onPointerOut: (event: PointerEvent<HTMLElement>) => {
      if (rowAt(event.relatedTarget) !== candidate.current) cancel()
    },
    onPointerLeave: cancel,
    onPointerCancel: cancel,
    onPointerDownCapture: cancel,
    onFocusCapture: cancel,
    onKeyDownCapture: cancel,
    onWheelCapture: scroll,
    onScrollCapture: scroll,
  }
}
