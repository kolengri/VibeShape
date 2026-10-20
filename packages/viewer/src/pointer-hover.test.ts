import { describe, expect, it, mock } from "bun:test"
import { PointerHoverPicking } from "./pointer-hover"

function fixture() {
  const callbacks = new Map<number, FrameRequestCallback>()
  let handle = 0
  const pick = mock((_event: PointerEvent) => {})
  const hover = new PointerHoverPicking(
    pick,
    (callback) => {
      callbacks.set(++handle, callback)
      return handle
    },
    (id) => {
      callbacks.delete(id)
    },
  )
  const event = (x: number) => ({ clientX: x }) as PointerEvent
  return { hover, callbacks, pick, event }
}

describe("replaceable ordinary pointer hover", () => {
  it("picks the latest ordinary event once per frame", () => {
    const { hover, callbacks, pick, event } = fixture()
    hover.update(event(1), true)
    hover.update(event(2), true)
    const latest = event(3)
    hover.update(latest, true)
    expect(callbacks.size).toBe(1)
    expect(pick).not.toHaveBeenCalled()
    callbacks.values().next().value?.(0)
    expect(pick).toHaveBeenCalledTimes(1)
    expect(pick).toHaveBeenCalledWith(latest)
    expect(callbacks.size).toBe(0)
  })

  it("picks tool events immediately and cancels pending ordinary hover", () => {
    const { hover, callbacks, pick, event } = fixture()
    hover.update(event(1), true)
    const stale = callbacks.values().next().value
    const tool = event(2)
    hover.update(tool, false)
    expect(pick).toHaveBeenCalledTimes(1)
    expect(pick).toHaveBeenCalledWith(tool)
    stale?.(0)
    expect(pick).toHaveBeenCalledTimes(1)
    expect(callbacks.size).toBe(0)
  })

  it("invalidates cancelled callbacks without letting an old frame consume a later hover", () => {
    const { hover, callbacks, pick, event } = fixture()
    hover.update(event(1), true)
    const old = callbacks.values().next().value
    hover.cancel()
    const later = event(2)
    hover.update(later, true)
    const current = callbacks.values().next().value
    old?.(0)
    expect(pick).not.toHaveBeenCalled()
    current?.(0)
    expect(pick).toHaveBeenCalledTimes(1)
    expect(pick).toHaveBeenCalledWith(later)
    hover.update(event(3), true)
    const disposed = callbacks.values().next().value
    hover.cancel()
    hover.cancel()
    disposed?.(0)
    expect(pick).toHaveBeenCalledTimes(1)
  })
})
