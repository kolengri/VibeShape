// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react"
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest"
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "./resizable"

afterEach(cleanup)

class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}

beforeAll(() => vi.stubGlobal("ResizeObserver", ResizeObserverMock))
afterAll(() => vi.unstubAllGlobals())

describe("ResizablePanelGroup", () => {
  it("keeps panels and separator accessible while exposing an 8px resize target", () => {
    render(
      <ResizablePanelGroup aria-label="Editor panels" defaultLayout={{ left: 30, right: 70 }}>
        <ResizablePanel id="left" minSize="20%" maxSize="40%" defaultSize="30%">
          Left panel
        </ResizablePanel>
        <ResizableHandle aria-label="Resize editor panels" />
        <ResizablePanel id="right" minSize="60%" defaultSize="70%">
          Right panel
        </ResizablePanel>
      </ResizablePanelGroup>,
    )

    expect(screen.getByLabelText("Editor panels").getAttribute("data-slot")).toBe(
      "resizable-panel-group",
    )
    expect(screen.getByText("Left panel").closest("[data-panel]")?.getAttribute("data-panel")).toBe(
      "true",
    )
    const separator = screen.getByRole("separator", { name: "Resize editor panels" })
    expect(separator.getAttribute("aria-orientation")).toBe("vertical")
    expect(separator.getAttribute("tabindex")).toBe("0")
    expect(separator.getAttribute("data-slot")).toBe("resizable-handle")
    expect(separator.className).toContain("group-data-[orientation=horizontal]/resizable:w-2")
    expect(separator.className).toContain("hover:bg-primary/40")
    expect(separator.className).toContain("focus-visible:ring-[3px]")
  })

  it("supports vertical layouts and caller class overrides", () => {
    render(
      <ResizablePanelGroup orientation="vertical" className="custom-group">
        <ResizablePanel>Top panel</ResizablePanel>
        <ResizableHandle className="custom-handle" />
        <ResizablePanel>Bottom panel</ResizablePanel>
      </ResizablePanelGroup>,
    )

    const group = screen.getByText("Top panel").closest("[data-group]")
    const separator = screen.getByRole("separator")
    expect(group?.getAttribute("data-orientation")).toBe("vertical")
    expect(group?.className).toContain("flex-col")
    expect(group?.className).toContain("custom-group")
    expect(separator.className).toContain("group-data-[orientation=vertical]/resizable:h-2")
    expect(separator.className).toContain("custom-handle")
  })
})
