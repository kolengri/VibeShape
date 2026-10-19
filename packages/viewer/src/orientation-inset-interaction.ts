type InsetPlacement = Readonly<{ x: number; y: number; size: number }>
type InsetPoint = Readonly<{ x: number; y: number }>

type OrientationInsetInteractionOptions = Readonly<{
  canvas: HTMLCanvasElement
  placement: () => InsetPlacement
  canInteract: () => boolean
  navigationEnabled: () => boolean
  setNavigationEnabled: (enabled: boolean) => void
  onStart: () => void
  rotate: (dx: number, dy: number) => void
  activate: (point: InsetPoint) => void
}>

type InsetGesture = {
  pointerId: number
  start: InsetPoint
  previous: InsetPoint
  dragged: boolean
  enabled: boolean
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
    options.canvas.addEventListener("pointerdown", this.#pointerDown, true)
    options.canvas.addEventListener("pointermove", this.#pointerHover, true)
    options.canvas.addEventListener("lostpointercapture", this.#pointerCancel, true)
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

  #pointerDown = (event: PointerEvent) => {
    if (this.#gesture) {
      this.#consume(event)
      return
    }
    if (!event.isPrimary || event.button !== 0) return
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
    const enabled = this.#options.canInteract() && this.#options.navigationEnabled()
    this.#options.onStart()
    this.#gesture = {
      pointerId: event.pointerId,
      start: point,
      previous: point,
      dragged: false,
      enabled,
      cursor: canvas.style.cursor,
    }
    if (enabled) {
      this.#options.setNavigationEnabled(false)
      canvas.style.cursor = "grabbing"
    }
  }

  #pointerHover = (event: PointerEvent) => {
    if (!event.buttons && this.#insetPoint(this.#point(event))) this.#consume(event)
  }

  #move(event: PointerEvent) {
    const gesture = this.#gesture
    if (!gesture || event.pointerId !== gesture.pointerId) return
    const point = this.#point(event)
    if (Math.hypot(point.x - gesture.start.x, point.y - gesture.start.y) > 3) {
      gesture.dragged = true
    }
    if (gesture.dragged && gesture.enabled) {
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
    if (gesture.enabled && !gesture.dragged && point) this.#options.activate(point)
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
    if (gesture.enabled) this.#options.setNavigationEnabled(true)
    canvas.style.cursor = gesture.cursor
    if (canvas.hasPointerCapture(gesture.pointerId)) canvas.releasePointerCapture(gesture.pointerId)
  }

  dispose() {
    this.cancel()
    const { canvas } = this.#options
    canvas.removeEventListener("pointerdown", this.#pointerDown, true)
    canvas.removeEventListener("pointermove", this.#pointerHover, true)
    canvas.removeEventListener("lostpointercapture", this.#pointerCancel, true)
    this.#window.removeEventListener("pointermove", this.#pointerMove, true)
    this.#window.removeEventListener("pointerup", this.#pointerUp, true)
    this.#window.removeEventListener("pointercancel", this.#pointerCancel, true)
    this.#window.removeEventListener("blur", this.cancel)
  }
}
