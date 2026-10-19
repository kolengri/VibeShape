import { describe, expect, it, mock } from "bun:test"
import { OrientationInsetInteraction } from "./orientation-inset-interaction"

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

function setup({ enabled = true, allowed = true, captureFails = false } = {}) {
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
  const rotate = mock((_dx: number, _dy: number) => {})
  const activate = mock((_point: Readonly<{ x: number; y: number }>) => {})
  const start = mock(() => {})
  const interaction = new OrientationInsetInteraction({
    canvas: canvas as unknown as HTMLCanvasElement,
    placement: () => ({ x: 256, y: 8, size: 80 }),
    canInteract: () => allowed,
    navigationEnabled: () => navigation.enabled,
    setNavigationEnabled: (value) => {
      navigation.enabled = value
    },
    onStart: start,
    rotate,
    activate,
  })
  return { canvas, window, captures, navigation, rotate, activate, start, interaction }
}

describe("orientation inset navigation", () => {
  it("claims the rendered inset after canvas scaling and reserved panel offset", () => {
    const state = setup()
    try {
      const underlying = mock(() => {})
      state.canvas.addEventListener("pointerdown", underlying)
      const outside = pointer("pointerdown", 220, 326)
      state.canvas.dispatchEvent(outside)
      expect(outside.defaultPrevented).toBe(false)
      expect(state.navigation.enabled).toBe(true)
      expect(underlying).toHaveBeenCalledTimes(1)

      const down = pointer("pointerdown", 248, 326)
      state.canvas.dispatchEvent(down)
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
      state.canvas.dispatchEvent(pointer("pointerdown", 248, 326))
      state.window.dispatchEvent(pointer("pointermove", 249, 326))
      state.window.dispatchEvent(pointer("pointerup", 249, 326))
      expect(state.rotate).not.toHaveBeenCalled()
      expect(state.activate).toHaveBeenCalledTimes(1)
      expect(state.activate.mock.calls[0]?.[0].x).toBeCloseTo(0.05, 12)
      expect(state.activate.mock.calls[0]?.[0].y).toBe(0)
      expect(state.navigation.enabled).toBe(true)
    } finally {
      state.interaction.dispose()
    }
  })

  it("does not turn a drag returning to its starting point into an axis click", () => {
    const state = setup()
    try {
      state.canvas.dispatchEvent(pointer("pointerdown", 248, 326))
      state.window.dispatchEvent(pointer("pointermove", 258, 326))
      state.window.dispatchEvent(pointer("pointerup", 248, 326))
      expect(state.activate).not.toHaveBeenCalled()
      expect(state.rotate).toHaveBeenCalledTimes(2)
    } finally {
      state.interaction.dispose()
    }
  })

  for (const end of ["pointercancel", "lostpointercapture", "blur"] as const) {
    it(`releases its lock after ${end} without activating a view`, () => {
      const state = setup()
      try {
        state.canvas.dispatchEvent(pointer("pointerdown", 248, 326))
        if (end === "lostpointercapture") state.canvas.dispatchEvent(pointer(end, 248, 326))
        else if (end === "blur") state.window.dispatchEvent(new Event(end))
        else state.window.dispatchEvent(pointer(end, 248, 326))
        expect(state.navigation.enabled).toBe(true)
        expect(state.captures.size).toBe(0)
        state.window.dispatchEvent(pointer("pointerup", 248, 326))
        expect(state.activate).not.toHaveBeenCalled()
        state.canvas.dispatchEvent(pointer("pointerdown", 248, 326))
        state.window.dispatchEvent(pointer("pointerup", 248, 326))
        expect(state.activate).toHaveBeenCalledTimes(1)
      } finally {
        state.interaction.dispose()
      }
    })
  }

  it("preserves disabled navigation and the normal sketch policy while consuming inset clicks", () => {
    for (const options of [{ enabled: false }, { allowed: false }]) {
      const state = setup(options)
      try {
        const down = pointer("pointerdown", 248, 326)
        state.canvas.dispatchEvent(down)
        state.window.dispatchEvent(pointer("pointermove", 258, 326))
        state.window.dispatchEvent(pointer("pointerup", 248, 326))
        expect(down.defaultPrevented).toBe(true)
        expect(state.rotate).not.toHaveBeenCalled()
        expect(state.activate).not.toHaveBeenCalled()
        expect(state.navigation.enabled).toBe(options.enabled !== false)
      } finally {
        state.interaction.dispose()
      }
    }
  })

  it("ignores secondary and nonprimary pointers and keeps one owner during a drag", () => {
    const state = setup()
    try {
      state.canvas.dispatchEvent(pointer("pointerdown", 248, 326, { button: 2 }))
      state.canvas.dispatchEvent(pointer("pointerdown", 248, 326, { isPrimary: false }))
      expect(state.start).not.toHaveBeenCalled()
      state.canvas.dispatchEvent(pointer("pointerdown", 248, 326))
      state.canvas.dispatchEvent(pointer("pointerdown", 248, 326, { pointerId: 8 }))
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
      state.canvas.dispatchEvent(pointer("pointerdown", 248, 326))
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
    state.canvas.dispatchEvent(pointer("pointerdown", 248, 326))
    state.interaction.dispose()
    expect(state.navigation.enabled).toBe(true)
    expect(state.captures.size).toBe(0)
    const down = pointer("pointerdown", 248, 326)
    state.canvas.dispatchEvent(down)
    state.window.dispatchEvent(pointer("pointermove", 258, 326))
    state.window.dispatchEvent(pointer("pointerup", 248, 326))
    expect(down.defaultPrevented).toBe(false)
    expect(state.rotate).not.toHaveBeenCalled()
    expect(state.activate).not.toHaveBeenCalled()
  })
})
