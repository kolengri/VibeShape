import type { GeometryViewport, ViewerStandardView } from "@vibeshape/viewer/three-viewport"
import { type RefObject, useCallback, useEffect, useRef, useState } from "react"

type NavigationOptions = {
  canvas: HTMLCanvasElement
  host: HTMLDivElement
  viewport: RefObject<GeometryViewport | null>
  onOrbit: () => void
  onEngagement: (engaged: boolean) => void
}

type TouchGesture = {
  pointerId: number
  x: number
  y: number
  moved: boolean
  provisional: boolean
}

class WorkflowModelNavigation {
  readonly #options: NavigationOptions
  readonly #listeners = new AbortController()
  #mouseDrag: { pointerId: number; buttonMask: number } | null = null
  #touch: TouchGesture | null = null
  #engaged = false

  constructor(options: NavigationOptions) {
    this.#options = options
    const { canvas, host } = options
    const { signal } = this.#listeners
    canvas.addEventListener("pointerdown", this.#onPointerDown, { capture: true, signal })
    canvas.addEventListener("pointermove", this.#onPointerMove, { capture: true, signal })
    canvas.addEventListener("pointerup", this.#onPointerUp, { capture: true, signal })
    canvas.addEventListener("pointercancel", this.#onPointerCancel, { capture: true, signal })
    canvas.addEventListener("lostpointercapture", this.#onPointerCancel, { signal })
    canvas.addEventListener("focus", this.#onFocus, { signal })
    canvas.addEventListener("blur", this.#onBlur, { signal })
    canvas.addEventListener("keydown", this.#onKeyDown, { signal })
    host.addEventListener("wheel", this.#onWheel, { capture: true, passive: true, signal })
    window.addEventListener("blur", this.#onWindowBlur, { signal })
    this.syncTouchAction()
  }

  #setPointerOrbit(enabled: boolean) {
    this.#options.viewport.current?.setPointerOrbit(enabled)
  }

  #stopMouseDrag() {
    const drag = this.#mouseDrag
    this.#mouseDrag = null
    this.#setPointerOrbit(false)
    // Native middle-button capture remains owned by OrbitControls.
    if (drag?.buttonMask !== 1) return
    const { canvas } = this.#options
    if (canvas.hasPointerCapture(drag.pointerId)) canvas.releasePointerCapture(drag.pointerId)
  }

  #startMouseDrag(event: PointerEvent) {
    if (!event.isPrimary) return
    const buttonMask = [1, 4][event.button]
    if (!buttonMask) return
    this.#mouseDrag = { pointerId: event.pointerId, buttonMask }
    if (event.button !== 0) return
    this.#options.canvas.setPointerCapture(event.pointerId)
    this.#setPointerOrbit(true)
  }

  #startTouch(event: PointerEvent) {
    this.#stopMouseDrag()
    if (!event.isPrimary) return
    this.#touch = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      moved: false,
      provisional: !this.#engaged,
    }
  }

  #onPointerDown = (event: PointerEvent) => {
    if (!this.#options.viewport.current) return
    if (event.pointerType !== "mouse") {
      this.#startTouch(event)
      return
    }
    this.#options.canvas.focus({ preventScroll: true })
    this.#startMouseDrag(event)
  }

  #moveMouse(event: PointerEvent) {
    const drag = this.#mouseDrag
    if (drag?.pointerId !== event.pointerId) return
    if (!(event.buttons & drag.buttonMask)) {
      this.#stopMouseDrag()
      return
    }
    this.#options.onOrbit()
  }

  #moveTouch(event: PointerEvent) {
    const touch = this.#touch
    if (touch?.pointerId !== event.pointerId) return
    touch.moved ||= Math.hypot(event.clientX - touch.x, event.clientY - touch.y) > 6
    this.#options.onOrbit()
  }

  #onPointerMove = (event: PointerEvent) => {
    if (event.pointerType === "mouse") this.#moveMouse(event)
    else this.#moveTouch(event)
  }

  #finishMouse(event: PointerEvent) {
    if (this.#mouseDrag?.pointerId === event.pointerId) this.#stopMouseDrag()
  }

  #takeTouch(pointerId: number) {
    const touch = this.#touch
    if (touch?.pointerId !== pointerId) return null
    this.#touch = null
    return touch
  }

  #releaseTouchFocus() {
    this.#options.canvas.blur()
    this.#setEngaged(false)
  }

  #completeProvisionalTouch(touch: TouchGesture) {
    if (touch.moved) {
      this.#releaseTouchFocus()
      return
    }
    this.#options.canvas.focus({ preventScroll: true })
    this.#setEngaged(true)
  }

  #onPointerUp = (event: PointerEvent) => {
    this.#finishMouse(event)
    const touch = this.#takeTouch(event.pointerId)
    if (!touch) return
    if (touch.provisional) this.#completeProvisionalTouch(touch)
  }

  #onPointerCancel = (event: PointerEvent) => {
    this.#finishMouse(event)
    const touch = this.#takeTouch(event.pointerId)
    if (touch?.provisional) this.#releaseTouchFocus()
  }

  #setEngaged(engaged: boolean) {
    this.#engaged = engaged
    this.syncTouchAction()
    this.#options.onEngagement(engaged)
  }

  #onFocus = () => {
    // Browser focus during a touch-down does not turn a page swipe into canvas navigation.
    if (this.#touch?.provisional) return
    this.#setEngaged(true)
  }

  #onBlur = () => {
    this.#stopMouseDrag()
    this.#touch = null
    this.#setEngaged(false)
  }

  #onWindowBlur = () => {
    this.#options.canvas.blur()
    this.#onBlur()
  }

  #onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape") this.#options.canvas.blur()
  }

  #onWheel = (event: WheelEvent) => {
    // Stop OrbitControls' wheel listener without preventing the browser's page scroll.
    if (!this.#engaged) event.stopPropagation()
  }

  syncTouchAction() {
    this.#options.canvas.style.touchAction = this.#engaged ? "none" : "pan-y"
  }

  dispose() {
    this.#listeners.abort()
    this.#stopMouseDrag()
    this.#touch = null
    this.#options.canvas.style.touchAction = "pan-y"
  }
}

export function useWorkflowModelNavigation({
  canvasRef,
  hostRef,
  viewportRef,
}: {
  canvasRef: RefObject<HTMLCanvasElement | null>
  hostRef: RefObject<HTMLDivElement | null>
  viewportRef: RefObject<GeometryViewport | null>
}) {
  const navigationRef = useRef<WorkflowModelNavigation | null>(null)
  const [engaged, setEngaged] = useState(false)
  const [view, setView] = useState<ViewerStandardView | "orbit">("isometric")
  const onOrbit = useCallback(() => setView("orbit"), [])
  useEffect(() => {
    const canvas = canvasRef.current
    const host = hostRef.current
    if (!canvas || !host) return
    const navigation = new WorkflowModelNavigation({
      canvas,
      host,
      viewport: viewportRef,
      onOrbit,
      onEngagement: setEngaged,
    })
    navigationRef.current = navigation
    return () => {
      navigation.dispose()
      navigationRef.current = null
    }
  }, [canvasRef, hostRef, viewportRef, onOrbit])
  const setStandardView = useCallback(
    (nextView: ViewerStandardView) => {
      viewportRef.current?.setStandardView(nextView)
      navigationRef.current?.syncTouchAction()
      setView(nextView)
    },
    [viewportRef],
  )
  const fit = useCallback(() => {
    viewportRef.current?.fit()
    // Fit repositions the camera; explicitly restore the isometric up vector and preset.
    setStandardView("isometric")
  }, [viewportRef, setStandardView])
  return { engaged, view, setStandardView, fit }
}
