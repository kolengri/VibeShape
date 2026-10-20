import type { OrientationMarkerAxis } from "./orientation-marker"

type InsetPlacement = Readonly<{ x: number; y: number; size: number }>
type InsetPoint = Readonly<{ x: number; y: number }>

type OrientationInsetInteractionOptions = Readonly<{
  canvas: HTMLCanvasElement
  placement: () => InsetPlacement
  inputElement?: () => HTMLElement | SVGSVGElement | null
  navigationEnabled: () => boolean
  setNavigationEnabled: (enabled: boolean) => void
  onStart: () => void
  onNavigationStart: () => void
  rotate: (dx: number, dy: number) => void
  axisAt: (point: InsetPoint) => OrientationMarkerAxis | null
  activate: (axis: OrientationMarkerAxis) => void
}>

type InsetGesture = {
  pointerId: number
  start: InsetPoint
  previous: InsetPoint
  dragged: boolean
  navigationEnabled: boolean
  cursor: string
}

/** Owns inset gestures before camera controls, picking, and modeling gizmos see them. */
export class OrientationInsetInteraction {
  readonly #options: OrientationInsetInteractionOptions
  readonly #window: Window
  #gesture: InsetGesture | null = null

  constructor(options: OrientationInsetInteractionOptions) {
    this.#options = options
    const window = options.canvas.ownerDocument.defaultView
    if (!window) throw new Error("Orientation navigation requires a connected browser window.")
    this.#window = window
    options.canvas.addEventListener("lostpointercapture", this.#pointerCancel, true)
    window.addEventListener("pointerdown", this.#pointerDown, true)
    window.addEventListener("pointermove", this.#pointerHover, true)
    window.addEventListener("pointermove", this.#pointerMove, true)
    window.addEventListener("pointerup", this.#pointerUp, true)
    window.addEventListener("pointercancel", this.#pointerCancel, true)
    window.addEventListener("blur", this.cancel)
  }

  #point(event: PointerEvent): InsetPoint {
    const { canvas } = this.#options
    const rect = canvas.getBoundingClientRect()
    return {
      x: ((event.clientX - rect.left) * canvas.clientWidth) / Math.max(rect.width, 1),
      y: ((event.clientY - rect.top) * canvas.clientHeight) / Math.max(rect.height, 1),
    }
  }

  #insetPoint(point: InsetPoint): InsetPoint | null {
    const { x, y, size } = this.#options.placement()
    const top = this.#options.canvas.clientHeight - y - size
    if (size <= 0 || point.x < x || point.x > x + size || point.y < top || point.y > top + size) {
      return null
    }
    return { x: ((point.x - x) / size) * 2 - 1, y: 1 - ((point.y - top) / size) * 2 }
  }

  #consume(event: PointerEvent) {
    event.preventDefault()
    event.stopImmediatePropagation()
  }

  #isDrawingInput(event: PointerEvent) {
    const path = event.composedPath()
    const input = this.#options.inputElement?.()
    return path.includes(this.#options.canvas) || (input != null && path.includes(input))
  }

  #pointerDown = (event: PointerEvent) => {
    if (this.#gesture) {
      this.#consume(event)
      return
    }
    if (!event.isPrimary || event.button !== 0 || !this.#isDrawingInput(event)) return
    const point = this.#point(event)
    if (!this.#insetPoint(point)) return
    this.#consume(event)
    const { canvas } = this.#options
    try {
      canvas.setPointerCapture(event.pointerId)
    } catch {
      // A pointer that already ended must not leave navigation locked.
      return
    }
    this.#gesture = {
      pointerId: event.pointerId,
      start: point,
      previous: point,
      dragged: false,
      navigationEnabled: this.#options.navigationEnabled(),
      cursor: canvas.style.cursor,
    }
    this.#options.setNavigationEnabled(false)
    this.#options.onStart()
    canvas.style.cursor = "grabbing"
  }

  #pointerHover = (event: PointerEvent) => {
    if (this.#gesture) return
    if (!event.buttons && this.#isDrawingInput(event) && this.#insetPoint(this.#point(event))) {
      this.#consume(event)
    }
  }

  #move(event: PointerEvent) {
    const gesture = this.#gesture
    if (!gesture || event.pointerId !== gesture.pointerId) return
    const point = this.#point(event)
    if (!gesture.dragged && Math.hypot(point.x - gesture.start.x, point.y - gesture.start.y) > 3) {
      gesture.dragged = true
      this.#options.onNavigationStart()
    }
    if (gesture.dragged) {
      this.#options.rotate(point.x - gesture.previous.x, point.y - gesture.previous.y)
      gesture.previous = point
    }
  }

  #pointerMove = (event: PointerEvent) => {
    if (!this.#gesture || event.pointerId !== this.#gesture.pointerId) return
    this.#consume(event)
    this.#move(event)
  }

  #pointerUp = (event: PointerEvent) => {
    const gesture = this.#gesture
    if (!gesture || event.pointerId !== gesture.pointerId) return
    this.#consume(event)
    this.#move(event)
    const point = this.#insetPoint(this.#point(event))
    this.cancel()
    if (gesture.dragged || !point) return
    const axis = this.#options.axisAt(point)
    if (!axis) return
    this.#options.onNavigationStart()
    this.#options.activate(axis)
  }

  #pointerCancel = (event: PointerEvent) => {
    if (!this.#gesture || event.pointerId !== this.#gesture.pointerId) return
    this.#consume(event)
    this.cancel()
  }

  cancel = () => {
    const gesture = this.#gesture
    if (!gesture) return
    this.#gesture = null
    const { canvas } = this.#options
    this.#options.setNavigationEnabled(gesture.navigationEnabled)
    canvas.style.cursor = gesture.cursor
    if (canvas.hasPointerCapture(gesture.pointerId)) canvas.releasePointerCapture(gesture.pointerId)
  }

  dispose() {
    this.cancel()
    const { canvas } = this.#options
    canvas.removeEventListener("lostpointercapture", this.#pointerCancel, true)
    this.#window.removeEventListener("pointerdown", this.#pointerDown, true)
    this.#window.removeEventListener("pointermove", this.#pointerHover, true)
    this.#window.removeEventListener("pointermove", this.#pointerMove, true)
    this.#window.removeEventListener("pointerup", this.#pointerUp, true)
    this.#window.removeEventListener("pointercancel", this.#pointerCancel, true)
    this.#window.removeEventListener("blur", this.cancel)
  }
}
