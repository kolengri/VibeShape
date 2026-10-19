import { describe, expect, it, mock } from "bun:test"
import { PerspectiveCamera, Vector2 } from "three"
import { OrientationInsetInteraction } from "./orientation-inset-interaction"
import { OrientationMarker, type OrientationMarkerAxis } from "./orientation-marker"

function pointer(
  type: string,
  x: number,
  y: number,
  options: { pointerId?: number; isPrimary?: boolean; button?: number; buttons?: number } = {},
) {
  return Object.assign(new Event(type, { cancelable: true }), {
    clientX: x,
    clientY: y,
    pointerId: 7,
    isPrimary: true,
    button: 0,
    buttons: type === "pointerup" ? 0 : 1,
    ...options,
  }) as PointerEvent
}

function setup({
  enabled = true,
  captureFails = false,
  pickAxis = (_point: Readonly<{ x: number; y: number }>): OrientationMarkerAxis | null => "Z",
} = {}) {
  const window = new EventTarget()
  const captures = new Set<number>()
  const canvas = Object.assign(new EventTarget(), {
    clientWidth: 800,
    clientHeight: 600,
    ownerDocument: { defaultView: window },
    style: { cursor: "" },
    getBoundingClientRect: () => ({ left: 100, top: 50, width: 400, height: 300 }),
    setPointerCapture: (id: number) => {
      if (captureFails) throw new Error("The pointer has already ended.")
      captures.add(id)
    },
    hasPointerCapture: (id: number) => captures.has(id),
    releasePointerCapture: (id: number) => captures.delete(id),
  })
  const navigation = { enabled }
  const overlay = new EventTarget()
  const otherOverlay = new EventTarget()
  let inputElement: EventTarget | null = overlay
  const rotate = mock((_dx: number, _dy: number) => {})
  const activate = mock((_axis: OrientationMarkerAxis) => {})
  const axisAt = mock(pickAxis)
  const start = mock(() => {})
  const navigationStart = mock(() => {})
  const interaction = new OrientationInsetInteraction({
    canvas: canvas as unknown as HTMLCanvasElement,
    placement: () => ({ x: 256, y: 8, size: 80 }),
    inputElement: () => inputElement as SVGSVGElement | null,
    navigationEnabled: () => navigation.enabled,
    setNavigationEnabled: (value) => {
      navigation.enabled = value
    },
    onStart: start,
    onNavigationStart: navigationStart,
    rotate,
    axisAt,
    activate,
  })
  function input(event: PointerEvent, target: EventTarget = canvas) {
    Object.defineProperty(event, "composedPath", { value: () => [target, window] })
    window.dispatchEvent(event)
    if (!event.defaultPrevented) target.dispatchEvent(event)
  }
  return {
    canvas,
    window,
    overlay,
    otherOverlay,
    captures,
    navigation,
    rotate,
    axisAt,
    activate,
    start,
    navigationStart,
    interaction,
    input,
    setInputElement: (element: EventTarget | null) => {
      inputElement = element
    },
  }
}

describe("orientation inset navigation", () => {
  it("claims the rendered inset after canvas scaling and reserved panel offset", () => {
    const state = setup()
    try {
      const underlying = mock(() => {})
      state.canvas.addEventListener("pointerdown", underlying)
      const outside = pointer("pointerdown", 220, 326)
      state.input(outside)
      expect(outside.defaultPrevented).toBe(false)
      expect(state.navigation.enabled).toBe(true)
      expect(underlying).toHaveBeenCalledTimes(1)

      const down = pointer("pointerdown", 248, 326)
      state.input(down)
      expect(down.defaultPrevented).toBe(true)
      expect(underlying).toHaveBeenCalledTimes(1)
      expect(state.captures.has(7)).toBe(true)
      expect(state.navigation.enabled).toBe(false)

      const move = pointer("pointermove", 298, 306)
      const otherGizmo = mock(() => {})
      state.window.addEventListener("pointermove", otherGizmo)
      state.window.dispatchEvent(move)
      expect(move.defaultPrevented).toBe(true)
      expect(otherGizmo).not.toHaveBeenCalled()
      expect(state.rotate).toHaveBeenCalledWith(100, -40)
      state.window.dispatchEvent(pointer("pointerup", 308, 301))
      expect(state.rotate).toHaveBeenLastCalledWith(20, -10)
      expect(state.activate).not.toHaveBeenCalled()
      expect(state.navigation.enabled).toBe(true)
      expect(state.captures.size).toBe(0)
    } finally {
      state.interaction.dispose()
    }
  })

  it("keeps a short click separate from an orbit and activates in inset coordinates", () => {
    const state = setup()
    try {
      state.input(pointer("pointerdown", 248, 326))
      state.window.dispatchEvent(pointer("pointermove", 249, 326))
      state.window.dispatchEvent(pointer("pointerup", 249, 326))
      expect(state.rotate).not.toHaveBeenCalled()
      expect(state.navigationStart).toHaveBeenCalledTimes(1)
      expect(state.activate).toHaveBeenCalledTimes(1)
      expect(state.axisAt.mock.calls[0]?.[0].x).toBeCloseTo(0.05, 12)
      expect(state.axisAt.mock.calls[0]?.[0].y).toBe(0)
      expect(state.navigation.enabled).toBe(true)
    } finally {
      state.interaction.dispose()
    }
  })

  it("starts normal-sketch navigation before snapping a raycast axis on a captured short click", () => {
    const marker = new OrientationMarker()
    const camera = new PerspectiveCamera(35, 1, 0.1, 10)
    camera.position.set(2, -2, 2)
    camera.up.set(0, 0, 1)
    camera.lookAt(0, 0, 0)
    camera.updateMatrixWorld()
    marker.alignLabels(camera.quaternion)
    const state = setup({
      enabled: false,
      pickAxis: ({ x, y }) => marker.axisAt(new Vector2(x, y), camera),
    })
    const sequence: string[] = []
    state.navigationStart.mockImplementation(() => sequence.push("orbit"))
    state.activate.mockImplementation((axis) => sequence.push(axis))
    try {
      const endpoint = marker.group.getObjectByName("X")
      if (!endpoint) throw new Error("The orientation marker must contain its X endpoint.")
      const point = endpoint.position.clone().project(camera)
      const x = 248 + point.x * 20
      const y = 326 - point.y * 20
      state.input(pointer("pointerdown", x, y), state.overlay)
      expect(sequence).toEqual([])
      expect(state.captures.has(7)).toBe(true)
      state.window.dispatchEvent(pointer("pointerup", x, y))
      expect(sequence).toEqual(["orbit", "X"])
      expect(state.rotate).not.toHaveBeenCalled()
      expect(state.navigation.enabled).toBe(false)
      expect(state.captures.size).toBe(0)
    } finally {
      state.interaction.dispose()
      marker.dispose()
    }
  })

  it("keeps a blank short click from changing the sketch camera mode or standard view", () => {
    const state = setup({ enabled: false, pickAxis: () => null })
    try {
      state.input(pointer("pointerdown", 248, 326), state.overlay)
      state.window.dispatchEvent(pointer("pointerup", 248, 326))
      expect(state.axisAt).toHaveBeenCalledTimes(1)
      expect(state.navigationStart).not.toHaveBeenCalled()
      expect(state.activate).not.toHaveBeenCalled()
      expect(state.rotate).not.toHaveBeenCalled()
      expect(state.navigation.enabled).toBe(false)
      expect(state.captures.size).toBe(0)
    } finally {
      state.interaction.dispose()
    }
  })

  it("does not turn a drag returning to its starting point into an axis click", () => {
    const state = setup()
    try {
      state.input(pointer("pointerdown", 248, 326))
      state.window.dispatchEvent(pointer("pointermove", 258, 326))
      state.window.dispatchEvent(pointer("pointerup", 248, 326))
      expect(state.activate).not.toHaveBeenCalled()
      expect(state.rotate).toHaveBeenCalledTimes(2)
    } finally {
      state.interaction.dispose()
    }
  })

  it("claims the entire rectangle above a sketch overlay before authoring starts", () => {
    const state = setup({ enabled: false })
    const draw = mock(() => {})
    state.overlay.addEventListener("pointerdown", draw)
    try {
      for (const [x, y] of [
        [228, 306],
        [268, 306],
        [228, 346],
        [268, 346],
      ] as const) {
        state.input(pointer("pointerdown", x, y), state.overlay)
        state.window.dispatchEvent(pointer("pointermove", x + 5, y - 5))
        state.window.dispatchEvent(pointer("pointerup", x + 5, y - 5))
        expect(state.navigation.enabled).toBe(false)
        expect(state.captures.size).toBe(0)
      }
      expect(draw).not.toHaveBeenCalled()
      expect(state.start).toHaveBeenCalledTimes(4)
      expect(state.navigationStart).toHaveBeenCalledTimes(4)
      expect(state.rotate).toHaveBeenCalledWith(10, -10)
      expect(state.activate).not.toHaveBeenCalled()
    } finally {
      state.interaction.dispose()
    }
  })

  it("retains capture across the drawing input replacement during a drag", () => {
    const state = setup()
    try {
      state.input(pointer("pointerdown", 248, 326), state.overlay)
      state.window.dispatchEvent(pointer("pointermove", 249, 326))
      expect(state.navigationStart).not.toHaveBeenCalled()
      state.window.dispatchEvent(pointer("pointermove", 250, 326))
      expect(state.navigationStart).toHaveBeenCalledTimes(1)
      state.setInputElement(null)
      state.window.dispatchEvent(pointer("pointermove", 260, 326))
      state.setInputElement(state.otherOverlay)
      state.window.dispatchEvent(pointer("pointerup", 270, 326))
      expect(state.rotate).toHaveBeenCalledTimes(3)
      expect(state.navigationStart).toHaveBeenCalledTimes(1)
      expect(state.navigation.enabled).toBe(true)
      expect(state.captures.size).toBe(0)
    } finally {
      state.interaction.dispose()
    }
  })

  it("leaves unrelated viewport overlays and drawing outside the rectangle interactive", () => {
    const state = setup()
    try {
      const unrelated = pointer("pointerdown", 248, 326)
      state.input(unrelated, state.otherOverlay)
      const outside = pointer("pointerdown", 220, 326)
      state.input(outside, state.overlay)
      const hover = pointer("pointermove", 248, 326, { buttons: 0 })
      state.input(hover, state.overlay)
      expect(unrelated.defaultPrevented).toBe(false)
      expect(outside.defaultPrevented).toBe(false)
      expect(hover.defaultPrevented).toBe(true)
      expect(state.start).not.toHaveBeenCalled()
      expect(state.navigationStart).not.toHaveBeenCalled()
    } finally {
      state.interaction.dispose()
    }
  })

  for (const enabled of [true, false]) {
    for (const end of ["pointercancel", "lostpointercapture", "blur"] as const) {
      it(`releases its lock after ${end} with prior navigation ${enabled} without activating a view`, () => {
        const state = setup({ enabled })
        try {
          state.input(pointer("pointerdown", 248, 326))
          if (end === "lostpointercapture") state.canvas.dispatchEvent(pointer(end, 248, 326))
          else if (end === "blur") state.window.dispatchEvent(new Event(end))
          else state.window.dispatchEvent(pointer(end, 248, 326))
          expect(state.navigation.enabled).toBe(enabled)
          expect(state.captures.size).toBe(0)
          state.window.dispatchEvent(pointer("pointerup", 248, 326))
          expect(state.activate).not.toHaveBeenCalled()
          state.input(pointer("pointerdown", 248, 326))
          state.window.dispatchEvent(pointer("pointerup", 248, 326))
          expect(state.activate).toHaveBeenCalledTimes(1)
        } finally {
          state.interaction.dispose()
        }
      })
    }
  }

  for (const enabled of [true, false]) {
    it(`rotates with prior navigation ${enabled} and restores that state`, () => {
      const state = setup({ enabled })
      try {
        state.canvas.style.cursor = "crosshair"
        const down = pointer("pointerdown", 248, 326)
        state.input(down)
        expect(state.canvas.style.cursor).toBe("grabbing")
        state.window.dispatchEvent(pointer("pointermove", 258, 326))
        state.window.dispatchEvent(pointer("pointerup", 248, 326))
        expect(down.defaultPrevented).toBe(true)
        expect(state.navigationStart).toHaveBeenCalledTimes(1)
        expect(state.rotate).toHaveBeenCalledTimes(2)
        expect(state.activate).not.toHaveBeenCalled()
        expect(state.navigation.enabled).toBe(enabled)
        expect(state.canvas.style.cursor).toBe("crosshair")
      } finally {
        state.interaction.dispose()
      }
    })
  }

  it("starts axis navigation without dragging and restores disabled controls", () => {
    const state = setup({ enabled: false })
    try {
      state.input(pointer("pointerdown", 248, 326), state.overlay)
      state.window.dispatchEvent(pointer("pointerup", 248, 326))
      expect(state.activate).toHaveBeenCalledTimes(1)
      expect(state.navigationStart).toHaveBeenCalledTimes(1)
      expect(state.rotate).not.toHaveBeenCalled()
      expect(state.navigation.enabled).toBe(false)
      expect(state.captures.size).toBe(0)
    } finally {
      state.interaction.dispose()
    }
  })

  it("ignores secondary and nonprimary pointers and keeps one owner during a drag", () => {
    const state = setup()
    try {
      state.input(pointer("pointerdown", 248, 326, { button: 2 }))
      state.input(pointer("pointerdown", 248, 326, { isPrimary: false }))
      expect(state.start).not.toHaveBeenCalled()
      state.input(pointer("pointerdown", 248, 326))
      state.input(pointer("pointerdown", 248, 326, { pointerId: 8 }))
      state.window.dispatchEvent(pointer("pointerup", 248, 326, { pointerId: 8 }))
      expect(state.navigation.enabled).toBe(false)
      expect(state.start).toHaveBeenCalledTimes(1)
      state.window.dispatchEvent(pointer("pointerup", 248, 326))
      expect(state.navigation.enabled).toBe(true)
    } finally {
      state.interaction.dispose()
    }
  })

  it("does not leak a navigation lock when pointer capture fails", () => {
    const state = setup({ captureFails: true })
    try {
      state.input(pointer("pointerdown", 248, 326))
      state.window.dispatchEvent(pointer("pointermove", 258, 326))
      state.window.dispatchEvent(pointer("pointerup", 248, 326))
      expect(state.navigation.enabled).toBe(true)
      expect(state.rotate).not.toHaveBeenCalled()
      expect(state.activate).not.toHaveBeenCalled()
    } finally {
      state.interaction.dispose()
    }
  })

  it("restores an active gesture and removes its input hooks on disposal", () => {
    const state = setup()
    state.input(pointer("pointerdown", 248, 326))
    state.interaction.dispose()
    expect(state.navigation.enabled).toBe(true)
    expect(state.captures.size).toBe(0)
    const down = pointer("pointerdown", 248, 326)
    state.input(down)
    state.window.dispatchEvent(pointer("pointermove", 258, 326))
    state.window.dispatchEvent(pointer("pointerup", 248, 326))
    expect(down.defaultPrevented).toBe(false)
    expect(state.rotate).not.toHaveBeenCalled()
    expect(state.activate).not.toHaveBeenCalled()
  })
})
