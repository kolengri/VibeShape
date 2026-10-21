import "../../../../../tests/unit/support/dom"
import { afterEach, describe, expect, it, mock } from "bun:test"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { type ComponentProps, useState } from "react"
import { AssemblyMotionKeyTimeline } from "./assembly-motion-key-timeline"

type TimelineProps = ComponentProps<typeof AssemblyMotionKeyTimeline>
const initialKeys = Object.freeze([
  Object.freeze({ time: 0, value: -12 }),
  Object.freeze({ time: 2, value: 37 }),
  Object.freeze({ time: 10, value: 8 }),
])
const defaults = {
  keys: initialKeys,
  duration: 10,
  disabled: false,
  label: "Joint key times",
  keyLabel: (index: number, time: number) => `Key ${index + 1} at ${time}`,
}

function Harness(props: TimelineProps) {
  const [keys, setKeys] = useState(props.keys)
  return (
    <AssemblyMotionKeyTimeline
      {...props}
      keys={keys}
      onChange={(next) => {
        props.onChange(next)
        setKeys(next)
      }}
    />
  )
}

function setup(overrides: Partial<Omit<TimelineProps, "onChange">> = {}) {
  const onChange = mock((_keys: { time: number; value: number }[]) => {})
  const view = render(<Harness {...defaults} {...overrides} onChange={onChange} />)
  return { ...view, onChange }
}

function marker(index = 1) {
  return screen.getAllByRole("slider")[index] as HTMLButtonElement
}

function time(element: HTMLElement) {
  return Number(element.getAttribute("aria-valuenow"))
}

function pointer(element: HTMLElement, type: string, clientX: number, pointerId = 7) {
  return fireEvent(
    element,
    new PointerEvent(type, { bubbles: true, pointerId, clientX, button: 0, isPrimary: true }),
  )
}

function preparePointer(element: HTMLButtonElement) {
  const lane = element.parentElement
  if (!lane) throw new Error("The marker requires a time lane.")
  lane.getBoundingClientRect = () => new DOMRect(0, 0, 200, 32)
  const captured = new Set<number>()
  element.setPointerCapture = (id) => {
    captured.add(id)
  }
  element.hasPointerCapture = (id) => captured.has(id)
  element.releasePointerCapture = (id) => {
    captured.delete(id)
  }
  return captured
}

afterEach(cleanup)

describe("Assembly motion key timeline", () => {
  it("edits time with small and shifted keyboard steps while preserving values and focus", () => {
    const { onChange } = setup()
    const key = marker()
    key.focus()
    fireEvent.keyDown(key, { key: "ArrowRight" })
    expect(time(key)).toBeCloseTo(2.1)
    fireEvent.keyDown(key, { key: "ArrowRight", shiftKey: true })
    expect(time(key)).toBeCloseTo(3.1)
    fireEvent.keyDown(key, { key: "ArrowLeft", shiftKey: true })
    expect(time(key)).toBeCloseTo(2.1)
    fireEvent.keyDown(key, { key: "ArrowLeft" })
    expect(time(key)).toBeCloseTo(2)
    expect(onChange).toHaveBeenCalledTimes(4)
    const changed = onChange.mock.calls[0]?.[0]
    expect(changed).toEqual([
      { time: 0, value: -12 },
      { time: 2.1, value: 37 },
      { time: 10, value: 8 },
    ])
    expect(changed).not.toBe(initialKeys)
    expect(changed?.[0]).toBe(initialKeys[0])
    expect(changed?.[2]).toBe(initialKeys[2])
    expect(initialKeys[1]).toEqual({ time: 2, value: 37 })
    expect(marker()).toBe(key)
    expect(document.activeElement).toBe(key)
    expect(key.getAttribute("aria-label")).toBe("Key 2 at 2")
  })

  it("keeps Home, End and arrow edits strictly between neighbors and within the duration", () => {
    const keys = [
      { time: 1, value: 3 },
      { time: 2, value: 4 },
      { time: 3, value: 5 },
    ]
    const { onChange } = setup({ keys, duration: 4 })
    const key = marker()
    fireEvent.keyDown(key, { key: "Home" })
    expect(time(key)).toBeGreaterThan(1)
    expect(time(key)).toBeLessThan(2)
    fireEvent.keyDown(key, { key: "ArrowLeft", shiftKey: true })
    expect(time(key)).toBeGreaterThan(1)
    fireEvent.keyDown(key, { key: "End" })
    expect(time(key)).toBeGreaterThan(2)
    expect(time(key)).toBeLessThan(3)
    fireEvent.keyDown(key, { key: "ArrowRight", shiftKey: true })
    expect(time(key)).toBeLessThan(3)
    fireEvent.keyDown(marker(0), { key: "Home" })
    fireEvent.keyDown(marker(2), { key: "End" })
    expect(time(marker(0))).toBe(0)
    expect(time(marker(2))).toBe(4)
    for (const [changed] of onChange.mock.calls) {
      expect(
        changed.every((item, index) => index === 0 || item.time > (changed[index - 1]?.time ?? 0)),
      ).toBe(true)
      expect(changed.map((item) => item.value)).toEqual([3, 4, 5])
    }
  })

  it("keeps a Home-edited key representable when a study is shortened", () => {
    setup()
    fireEvent.keyDown(marker(), { key: "Home" })
    expect(time(marker())).toBeGreaterThan(0)
    expect(time(marker()) / 10000).toBeGreaterThan(0)
  })

  it("does not collide when neighboring times are adjacent representable numbers", () => {
    const keys = [1, 1 + Number.EPSILON, 1 + 2 * Number.EPSILON].map((time) => ({ time, value: 0 }))
    const { onChange } = setup({ keys, duration: 2 })
    for (const key of ["Home", "End", "ArrowLeft", "ArrowRight"])
      fireEvent.keyDown(marker(), { key })
    expect(onChange).not.toHaveBeenCalled()
    expect(time(marker())).toBe(1 + Number.EPSILON)
  })

  it("contains application shortcuts while allowing Tab and browser modifier defaults", () => {
    const bubbled = mock(() => {})
    const { onChange } = setup()
    window.addEventListener("keydown", bubbled)
    window.addEventListener("keyup", bubbled)
    try {
      expect(fireEvent.keyDown(marker(), { key: "r" })).toBe(true)
      expect(fireEvent.keyDown(marker(), { key: "Tab" })).toBe(true)
      expect(fireEvent.keyDown(marker(), { key: "ArrowRight", metaKey: true })).toBe(true)
      fireEvent.keyUp(marker(), { key: "r" })
      expect(bubbled).not.toHaveBeenCalled()
      expect(onChange).not.toHaveBeenCalled()
    } finally {
      window.removeEventListener("keydown", bubbled)
      window.removeEventListener("keyup", bubbled)
    }
  })

  it("previews a captured pointer drag and commits once on pointer release", () => {
    const { onChange } = setup()
    const key = marker()
    const captured = preparePointer(key)
    pointer(key, "pointerdown", 40)
    expect(captured.has(7)).toBe(true)
    pointer(key, "pointermove", 100)
    expect(time(key)).toBe(5)
    expect(onChange).not.toHaveBeenCalled()
    pointer(key, "pointerup", 120)
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange.mock.calls[0]?.[0]).toEqual([
      { time: 0, value: -12 },
      { time: 6, value: 37 },
      { time: 10, value: 8 },
    ])
    expect(time(key)).toBe(6)
    expect(captured.size).toBe(0)
    expect(document.activeElement).toBe(key)
  })

  it.each(["Escape", "pointercancel", "lostpointercapture"])(
    "rolls back a pointer drag on %s",
    (cancellation) => {
      const { onChange } = setup()
      const key = marker()
      preparePointer(key)
      pointer(key, "pointerdown", 40)
      pointer(key, "pointermove", 100)
      expect(time(key)).toBe(5)
      if (cancellation === "Escape") fireEvent.keyDown(key, { key: "Escape" })
      else pointer(key, cancellation, 100)
      expect(time(key)).toBe(2)
      pointer(key, "pointerup", 100)
      expect(onChange).not.toHaveBeenCalled()
      expect(document.activeElement).toBe(key)
    },
  )

  it("clamps pointer movement to strict neighbor bounds and ignores another pointer", () => {
    const { onChange } = setup()
    const key = marker()
    preparePointer(key)
    pointer(key, "pointerdown", 40)
    pointer(key, "pointermove", 80, 8)
    pointer(key, "pointerup", 80, 8)
    expect(time(key)).toBe(2)
    pointer(key, "pointermove", 1000)
    expect(time(key)).toBeLessThan(10)
    pointer(key, "pointerup", -1000)
    expect(time(key)).toBeGreaterThan(0)
    expect(time(key)).toBeLessThan(2)
    expect(onChange).toHaveBeenCalledTimes(1)
  })

  it("disables keyboard and pointer edits", () => {
    const { onChange } = setup({ disabled: true })
    const key = marker()
    preparePointer(key)
    expect(key.disabled).toBe(true)
    fireEvent.keyDown(key, { key: "ArrowRight" })
    pointer(key, "pointerdown", 40)
    pointer(key, "pointermove", 100)
    pointer(key, "pointerup", 100)
    expect(time(key)).toBe(2)
    expect(onChange).not.toHaveBeenCalled()
  })

  it.each([
    { duration: 0 },
    { duration: -1 },
    { duration: Number.NaN },
    { duration: Number.POSITIVE_INFINITY },
    { keys: [{ time: Number.NaN, value: 1 }] },
    { keys: [{ time: 2, value: Number.POSITIVE_INFINITY }] },
    { keys: [{ time: -1, value: 1 }] },
    { keys: [{ time: 11, value: 1 }] },
    {
      keys: [
        { time: 2, value: 1 },
        { time: 2, value: 2 },
      ],
    },
    {
      keys: [
        { time: 3, value: 1 },
        { time: 2, value: 2 },
      ],
    },
  ])("fails closed for invalid timeline input %j", (overrides) => {
    const { onChange } = setup(overrides)
    expect(screen.queryAllByRole("slider")).toHaveLength(0)
    expect(
      (screen.getByRole("group", { name: defaults.label }) as HTMLFieldSetElement).disabled,
    ).toBe(true)
    expect(onChange).not.toHaveBeenCalled()
  })

  it("discards a pending drag when current props change or editing becomes disabled", () => {
    const onChange = mock((_keys: { time: number; value: number }[]) => {})
    const { rerender } = render(<AssemblyMotionKeyTimeline {...defaults} onChange={onChange} />)
    const key = marker()
    preparePointer(key)
    pointer(key, "pointerdown", 40)
    pointer(key, "pointermove", 100)
    const changedKeys = [
      { time: 0, value: -12 },
      { time: 3, value: 38 },
      { time: 10, value: 8 },
    ]
    rerender(<AssemblyMotionKeyTimeline {...defaults} keys={changedKeys} onChange={onChange} />)
    expect(time(key)).toBe(3)
    pointer(key, "pointerup", 120)
    expect(onChange).not.toHaveBeenCalled()
    pointer(key, "pointerdown", 60)
    pointer(key, "pointermove", 120)
    rerender(
      <AssemblyMotionKeyTimeline {...defaults} keys={changedKeys} disabled onChange={onChange} />,
    )
    expect(time(key)).toBe(3)
    rerender(<AssemblyMotionKeyTimeline {...defaults} keys={changedKeys} onChange={onChange} />)
    pointer(key, "pointerup", 140)
    expect(onChange).not.toHaveBeenCalled()
  })
})
