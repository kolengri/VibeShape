import "../../../../tests/unit/support/dom"
import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { createEmptySketch, sketchIdSchema } from "@vibeshape/domain"
import type { HistoryItemRef } from "@vibeshape/domain/document-node"
import { I18nProvider } from "@vibeshape/i18n/provider"
import { TooltipProvider } from "@vibeshape/ui/components/tooltip"
import { useState } from "react"
import { vi } from "../../../../tests/unit/support/bun-test"
import type { DocumentControllerState } from "../document/document-controller"
import { i18n } from "../i18n"
import { authoredTreeFixture, authoredTestId as id } from "../test-support/authored-tree-fixture"
import { HistoryNavigationControls, HistoryNavigationProvider } from "./history-navigation"
import { HistoryTimelineCursor } from "./history-timeline-cursor"

const frames = new Map<number, FrameRequestCallback>()
let nextFrame = 0
const capture = new Map<HTMLElement, number>()
const ports = { insert: vi.fn(), end: vi.fn(), bubble: vi.fn() }
const f = authoredTreeFixture()
const sketches = [701, 702].map((value) =>
  createEmptySketch({
    id: sketchIdSchema.parse(id(value)),
    label: `Profile ${value}`,
    plane: "xy",
  }),
)
const items: HistoryItemRef[] = [
  ...f.snapshot.features.slice(0, 2).map((item) => ({ kind: "feature" as const, id: item.id })),
  ...sketches.map((item) => ({ kind: "sketch" as const, id: item.id })),
]
if (items.length !== 4) throw new Error("The cursor fixture requires four ordered operations.")
const controller = {
  status: "ready",
  saveStatus: "saved",
  diagnostic: null,
  historyInsertion: null,
  report: {
    status: "created",
    mode: "read-write",
    snapshot: { ...f.snapshot, sketches },
    historyItems: items,
    rebuild: { ok: false },
    lostRevisionCount: 0,
    corruptRecords: [],
    migration: null,
    writeAccessDiagnostic: null,
  },
} as unknown as DocumentControllerState

function rect(left: number, width: number) {
  return {
    x: left,
    y: 0,
    left,
    right: left + width,
    top: 0,
    bottom: 60,
    width,
    height: 60,
    toJSON: () => ({}),
  }
}
function rowGeometry(element: HTMLElement | null, left: number, width = 100) {
  if (element)
    element.getBoundingClientRect = () =>
      rect(
        100 + left - (element.closest<HTMLElement>("[data-history-track]")?.scrollLeft ?? 0),
        width,
      )
}
function trackGeometry(element: HTMLDivElement | null, width: number) {
  if (!element) return
  let scroll = 0
  Object.defineProperties(element, {
    clientWidth: { configurable: true, value: width },
    scrollWidth: { configurable: true, value: 440 },
    scrollLeft: {
      configurable: true,
      get: () => scroll,
      set: (value: number) => {
        scroll = Math.max(0, Math.min(440 - width, value))
      },
    },
  })
  element.getBoundingClientRect = () => rect(100, width)
}
function Harness({
  source = controller,
  initial = null,
  collapsed = false,
  width = 600,
}: {
  source?: DocumentControllerState
  initial?: number | null
  collapsed?: boolean
  width?: number
}) {
  const [position, setPosition] = useState(initial)
  const report = source.report
  if (!report) throw new Error("The cursor fixture requires a report.")
  const scoped = {
    ...source,
    historyInsertion:
      position === null
        ? null
        : {
            documentId: report.snapshot.id,
            baseRevision: report.snapshot.revision,
            historyAfter: items[position - 1] ?? null,
          },
  }
  return (
    <I18nProvider i18n={i18n} initialLocale="en">
      <TooltipProvider>
        <HistoryNavigationProvider
          controller={scoped}
          orderedRefs={items}
          onInsert={async (item, side) => {
            const moved = await ports.insert(item, side)
            if (moved)
              setPosition(
                items.findIndex(
                  (candidate) => candidate.kind === item.kind && candidate.id === item.id,
                ) + (side === "below" ? 1 : 0),
              )
            return moved
          }}
          onReturnToEnd={async () => {
            const moved = await ports.end()
            if (moved) setPosition(null)
            return moved
          }}
        >
          <HistoryNavigationControls />
          <div
            data-history-track
            data-test-width={width}
            ref={(element) => trackGeometry(element, width)}
            onPointerDown={ports.bubble}
          >
            {items.map((item, index) => {
              if (collapsed && (index === 1 || index === 2))
                return index === 1 ? (
                  <div
                    key="folder"
                    data-history-expanded="false"
                    data-history-range-start="1"
                    data-history-range-end="2"
                    data-history-range-first={`${items[1]?.kind}:${items[1]?.id}`}
                    data-history-range-last={`${items[2]?.kind}:${items[2]?.id}`}
                    ref={(element) => rowGeometry(element, 108, 200)}
                  >
                    Collapsed folder
                  </div>
                ) : null
              return (
                <div
                  key={item.id}
                  data-history-index={index}
                  data-history-kind={item.kind}
                  data-history-id={item.id}
                  ref={(element) => rowGeometry(element, 8 + index * 100)}
                >
                  Operation {index}
                </div>
              )
            })}
            <HistoryTimelineCursor />
          </div>
        </HistoryNavigationProvider>
      </TooltipProvider>
    </I18nProvider>
  )
}
function cursor() {
  return screen.getByRole("separator", { name: "History rollback divider" })
}
async function expectSettledCursor(position: number) {
  await waitFor(() => {
    expect(cursor().getAttribute("aria-valuenow")).toBe(String(position))
    expect(cursor().getAttribute("aria-busy")).toBe("false")
    expect(cursor().hasAttribute("data-history-cursor-draft")).toBe(false)
  })
}
function pointer(type: string, clientX: number, pointerType = "mouse") {
  const event = new Event(type, { bubbles: true, cancelable: true })
  Object.defineProperties(event, {
    clientX: { value: clientX },
    button: { value: 0 },
    pointerId: { value: 1 },
    isPrimary: { value: true },
    pointerType: { value: pointerType },
  })
  fireEvent(cursor(), event)
}
function flushFrames(limit = 100) {
  let count = 0
  while (frames.size && count++ < limit) {
    const entry = frames.entries().next().value
    if (!entry) break
    frames.delete(entry[0])
    entry[1](count * 16)
  }
  if (frames.size) throw new Error("The gesture must not leave an idle animation loop.")
}
beforeEach(() => {
  frames.clear()
  nextFrame = 0
  capture.clear()
  const nativeRect = HTMLElement.prototype.getBoundingClientRect
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
    this: HTMLElement,
  ) {
    return this.hasAttribute("data-history-track")
      ? rect(100, Number(this.dataset.testWidth))
      : nativeRect.call(this)
  })
  ports.insert.mockReset()
  ports.end.mockReset()
  ports.bubble.mockReset()
  ports.insert.mockResolvedValue(true)
  ports.end.mockResolvedValue(true)
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    frames.set(++nextFrame, callback)
    return nextFrame
  })
  vi.stubGlobal("cancelAnimationFrame", (frame: number) => frames.delete(frame))
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
      unobserve() {}
    },
  )
  HTMLElement.prototype.setPointerCapture = function (pointerId) {
    capture.set(this, pointerId)
  }
  HTMLElement.prototype.hasPointerCapture = function (pointerId) {
    return capture.get(this) === pointerId
  }
  HTMLElement.prototype.releasePointerCapture = function () {
    capture.delete(this)
  }
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  frames.clear()
})
describe("History rollback divider", () => {
  it("drafts a visible boundary without writes and releases one shared guarded navigation", async () => {
    render(<Harness />)
    expect(cursor().getAttribute("aria-valuenow")).toBe("4")
    pointer("pointerdown", 508)
    pointer("pointermove", 308)
    expect(cursor().getAttribute("aria-valuenow")).toBe("2")
    expect(ports.insert).not.toHaveBeenCalled()
    expect(ports.bubble).not.toHaveBeenCalled()
    expect(
      (screen.getByRole("button", { name: "Step back one item" }) as HTMLButtonElement).disabled,
    ).toBe(true)
    pointer("pointerup", 308)
    await waitFor(() => expect(ports.insert).toHaveBeenCalledTimes(1))
    expect(ports.insert.mock.calls[0]).toEqual([items[1], "below"])
    expect(cursor().getAttribute("aria-valuenow")).toBe("2")
    expect(capture.size).toBe(0)
  })
  it("locks the cursor and transport together and restores the authoritative position after a refusal", async () => {
    let finish!: (value: boolean) => void
    ports.insert.mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve
      }),
    )
    render(<Harness />)
    pointer("pointerdown", 508)
    pointer("pointermove", 108)
    pointer("pointerup", 108)
    fireEvent.keyDown(cursor(), { key: "Home" })
    fireEvent.click(screen.getByRole("button", { name: "Return to the full model" }))
    expect(ports.insert).toHaveBeenCalledTimes(1)
    expect(ports.end).not.toHaveBeenCalled()
    await act(async () => finish(false))
    expect(cursor().getAttribute("aria-valuenow")).toBe("4")
    expect(
      screen.getByText("Could not move through History. Resolve the active edit and try again."),
    ).toBeTruthy()
    fireEvent.keyDown(cursor(), { key: "Home" })
    await waitFor(() => expect(ports.insert).toHaveBeenCalledTimes(2))
  })
  it("uses Left/Right/Home/End through the same insertion and full-model actions", async () => {
    render(<Harness />)
    fireEvent.keyDown(cursor(), { key: "ArrowLeft" })
    await expectSettledCursor(3)
    expect(ports.insert.mock.calls[0]).toEqual([items[2], "below"])
    fireEvent.keyDown(cursor(), { key: "Home" })
    await expectSettledCursor(0)
    expect(ports.insert.mock.calls[1]).toEqual([items[0], "above"])
    fireEvent.keyDown(cursor(), { key: "ArrowRight" })
    await expectSettledCursor(1)
    fireEvent.keyDown(cursor(), { key: "End" })
    await expectSettledCursor(4)
    expect(ports.end).toHaveBeenCalledTimes(1)
  })
  it.each(["Escape", "pointercancel", "lostpointercapture"])(
    "cancels a touch draft with %s without navigation",
    (reason) => {
      render(<Harness />)
      pointer("pointerdown", 508, "touch")
      pointer("pointermove", 208, "touch")
      if (reason === "Escape") fireEvent.keyDown(cursor(), { key: "Escape" })
      else pointer(reason, 208, "touch")
      pointer("pointerup", 208, "touch")
      expect(cursor().getAttribute("aria-valuenow")).toBe("4")
      expect(ports.insert).not.toHaveBeenCalled()
      expect(capture.size).toBe(0)
      expect(frames.size).toBe(0)
    },
  )
  it("cancels on revision change and rejects read-only pointer and keyboard navigation", async () => {
    const view = render(<Harness />)
    pointer("pointerdown", 508)
    pointer("pointermove", 208)
    const report = controller.report
    if (!report) throw new Error("The cursor fixture requires a report.")
    view.rerender(
      <Harness
        source={{
          ...controller,
          report: {
            ...report,
            snapshot: { ...report.snapshot, revision: report.snapshot.revision + 1 },
          },
        }}
      />,
    )
    pointer("pointerup", 208)
    expect(ports.insert).not.toHaveBeenCalled()
    expect(cursor().getAttribute("aria-valuenow")).toBe("4")
    view.rerender(<Harness source={{ ...controller, report: { ...report, mode: "read-only" } }} />)
    pointer("pointerdown", 508)
    pointer("pointerup", 108)
    fireEvent.keyDown(cursor(), { key: "Home" })
    expect(cursor().getAttribute("aria-disabled")).toBe("true")
    expect(ports.insert).not.toHaveBeenCalled()
    await act(async () => flushFrames())
  })
  it("keeps the exact current value inside a collapsed folder and targets only visible folder edges", async () => {
    render(<Harness initial={2} collapsed />)
    expect(cursor().getAttribute("aria-valuenow")).toBe("2")
    expect(cursor().style.left).toBe("108px")
    pointer("pointerdown", 208)
    pointer("pointermove", 390)
    pointer("pointerup", 390)
    await waitFor(() => expect(ports.insert).toHaveBeenCalledTimes(1))
    expect(ports.insert.mock.calls[0]).toEqual([items[2], "below"])
    expect(cursor().getAttribute("aria-valuenow")).toBe("3")
  })
  it("accounts for horizontal scroll offsets and stops edge autoscroll when the drag ends", async () => {
    render(<Harness width={200} />)
    const track = cursor().parentElement
    if (!track) throw new Error("The cursor requires its track.")
    expect(track.scrollLeft).toBeGreaterThan(0)
    pointer("pointerdown", 292)
    pointer("pointermove", 115)
    await act(async () => flushFrames())
    expect(track.scrollLeft).toBe(0)
    pointer("pointermove", 208)
    pointer("pointerup", 208)
    await waitFor(() => expect(ports.insert).toHaveBeenCalledTimes(1))
    expect(ports.insert.mock.calls[0]).toEqual([items[0], "below"])
    expect(frames.size).toBe(0)
  })
  it("preserves manual scrolling during hover remeasurement and reveals explicit boundary navigation", async () => {
    let completeNavigation!: (moved: boolean) => void
    ports.end.mockReturnValue(
      new Promise<boolean>((resolve) => {
        completeNavigation = resolve
      }),
    )
    render(<Harness width={200} />)
    const track = cursor().parentElement
    const row = document.querySelector<HTMLElement>('[data-history-index="0"]')
    if (!track || !row) throw new Error("The timeline requires a track and row.")
    expect(track.scrollLeft).toBeGreaterThan(0)
    track.scrollLeft = 0
    await act(async () => {
      row.className = "bg-accent ring-1 ring-primary"
      fireEvent(row, new Event("transitionrun", { bubbles: true }))
      flushFrames()
    })
    expect(track.scrollLeft).toBe(0)
    fireEvent.keyDown(cursor(), { key: "Home" })
    await expectSettledCursor(0)
    fireEvent.keyDown(cursor(), { key: "End" })
    expect(ports.end).toHaveBeenCalledTimes(1)
    await waitFor(() => {
      expect(cursor().getAttribute("aria-valuenow")).toBe("4")
      expect(cursor().getAttribute("aria-busy")).toBe("true")
      expect(cursor().hasAttribute("data-history-cursor-draft")).toBe(true)
    })
    expect(track.scrollLeft).toBe(0)
    await act(async () => completeNavigation(true))
    await expectSettledCursor(4)
    await waitFor(() => {
      expect(track.scrollLeft).toBeGreaterThan(0)
    })
  })
  it("disposes an active drag without navigation or an idle animation frame", () => {
    const view = render(<Harness width={200} />)
    pointer("pointerdown", 292)
    pointer("pointermove", 105)
    expect(frames.size).toBe(1)
    view.unmount()
    expect(frames.size).toBe(0)
    expect(capture.size).toBe(0)
    expect(ports.insert).not.toHaveBeenCalled()
  })
  it("accepts and retains a drag while row hover styling is remeasured", async () => {
    render(<Harness />)
    const row = document.querySelector<HTMLElement>('[data-history-index="0"]')
    if (!row) throw new Error("The hover fixture requires a History row.")
    await act(async () => {
      row.className = "bg-accent ring-1 ring-primary"
      fireEvent(row, new Event("transitionrun", { bubbles: true }))
    })
    expect(frames.size).toBe(1)
    expect(cursor().getAttribute("aria-disabled")).toBe("false")
    pointer("pointerdown", 508)
    expect(capture.size).toBe(1)
    pointer("pointermove", 308)
    await act(async () => {
      row.className = ""
      fireEvent(row, new Event("transitioncancel", { bubbles: true }))
    })
    expect(capture.size).toBe(1)
    expect(cursor().getAttribute("data-history-cursor-draft")).toBe("true")
    act(() => flushFrames())
    expect(cursor().getAttribute("aria-valuenow")).toBe("2")
    pointer("pointerup", 308)
    await waitFor(() => expect(ports.insert).toHaveBeenCalledTimes(1))
    expect(ports.insert.mock.calls[0]).toEqual([items[1], "below"])
    expect(capture.size).toBe(0)
    await act(async () => flushFrames())
    expect(frames.size).toBe(0)
  })
  it.each(["finished", "cancelled"])(
    "keeps stable boundaries until a row drop animation is %s",
    async (outcome) => {
      render(<Harness />)
      const row = document.querySelector<HTMLElement>('[data-history-index="0"]')
      if (!row) throw new Error("The animation fixture requires a History row.")
      let finish!: () => void
      let cancel!: (reason: Error) => void
      const animation = {
        playState: "running",
        effect: { getComputedTiming: () => ({ endTime: 120 }) },
        finished: new Promise<void>((resolve, reject) => {
          finish = resolve
          cancel = reject
        }),
      }
      Object.defineProperty(row, "getAnimations", { value: () => [animation] })
      row.getBoundingClientRect = () => rect(-500, 30)
      await act(async () => {
        row.style.translate = "-500px"
        await Promise.resolve()
        flushFrames()
      })
      expect(cursor().getAttribute("aria-disabled")).toBe("true")
      expect(cursor().getAttribute("aria-busy")).toBe("true")
      expect(cursor().style.left).toBe("408px")
      expect(frames.size).toBe(0)
      pointer("pointerdown", 508)
      pointer("pointerup", 108)
      expect(ports.insert).not.toHaveBeenCalled()
      rowGeometry(row, 8)
      await act(async () => {
        animation.playState = outcome === "finished" ? "finished" : "idle"
        if (outcome === "finished") finish()
        else cancel(new Error("Drop animation cancelled"))
      })
      act(() => flushFrames())
      expect(cursor().getAttribute("aria-disabled")).toBe("false")
      expect(cursor().style.left).toBe("408px")
      pointer("pointerdown", 508)
      pointer("pointermove", 308)
      pointer("pointerup", 308)
      await waitFor(() => expect(ports.insert).toHaveBeenCalledTimes(1))
      expect(ports.insert.mock.calls[0]).toEqual([items[1], "below"])
    },
  )
})
