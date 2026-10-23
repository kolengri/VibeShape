import "../../../../tests/unit/support/dom"
import { afterEach, beforeEach, expect, it } from "bun:test"
import { cleanup, render, screen } from "@testing-library/react"
import { vi } from "../../../../tests/unit/support/bun-test"
import { ViewportGridItem } from "./viewport-grid"
import { WorkspaceWorkbench } from "./workspace-width"

beforeEach(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  )
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

it("retains arbitrary right-slot content and the viewport while rearranging the overlay grid", () => {
  const layout = (open: boolean) => (
    <WorkspaceWorkbench>
      <ViewportGridItem id="arbitrary-panel" area="right" visible={open}>
        <input aria-label="Panel draft" defaultValue="12" />
      </ViewportGridItem>
      <button type="button">Viewport</button>
    </WorkspaceWorkbench>
  )
  const view = render(layout(true))
  const viewport = screen.getByRole("button", { name: "Viewport" })
  const draft = screen.getByRole<HTMLInputElement>("textbox", { name: "Panel draft" })
  draft.value = "28"
  view.rerender(layout(false))
  expect(screen.queryByRole("textbox", { name: "Panel draft" })).toBeNull()
  expect(draft.isConnected).toBe(true)
  expect(screen.getByRole("button", { name: "Viewport" })).toBe(viewport)
  view.rerender(layout(true))
  expect(screen.getByRole("textbox", { name: "Panel draft" })).toBe(draft)
  expect(draft.value).toBe("28")
  expect(screen.getByRole("button", { name: "Viewport" })).toBe(viewport)
})
