import "../../../../tests/unit/support/dom"
import { afterAll, afterEach, beforeAll, describe, expect, it } from "bun:test"
import { resolve } from "node:path"
import { cleanup, render, screen } from "@testing-library/react"
import { vi } from "../../../../tests/unit/support/bun-test"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "./tooltip"

class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}

beforeAll(() => vi.stubGlobal("ResizeObserver", ResizeObserverMock))
afterAll(() => vi.unstubAllGlobals())
afterEach(cleanup)

describe("Tooltip", () => {
  it("describes an icon-only control without adding visible button text", () => {
    render(
      <TooltipProvider>
        <Tooltip open>
          <TooltipTrigger asChild>
            <button type="button" aria-label="Create sketch">
              <svg aria-hidden="true" />
            </button>
          </TooltipTrigger>
          <TooltipContent>Create sketch</TooltipContent>
        </Tooltip>
      </TooltipProvider>,
    )

    const button = screen.getByRole("button", { name: "Create sketch" })
    expect(button.textContent).toBe("")
    expect(screen.getByRole("tooltip").textContent).toContain("Create sketch")
  })

  it("keeps the open tooltip and its positioning wrapper transparent to pointer input", async () => {
    // jsdom applies the stylesheet's plain rules and ignores Tailwind's layered at-rules.
    const style = document.createElement("style")
    style.textContent = await Bun.file(resolve(import.meta.dir, "../styles/globals.css")).text()
    document.head.append(style)
    try {
      render(
        <TooltipProvider>
          <Tooltip open>
            <TooltipTrigger asChild>
              <button type="button" aria-label="Rename part Box 1">
                <svg aria-hidden="true" />
              </button>
            </TooltipTrigger>
            <TooltipContent>Rename part Box 1</TooltipContent>
          </Tooltip>
        </TooltipProvider>,
      )

      const content = screen
        .getAllByText("Rename part Box 1")
        .map((element) => element.closest<HTMLElement>('[data-slot="tooltip-content"]'))
        .find((element) => element !== null)
      const wrapper = content?.parentElement
      if (!content || !wrapper) throw new Error("Expected rendered tooltip content.")
      expect(wrapper.hasAttribute("data-radix-popper-content-wrapper")).toBe(true)
      expect(getComputedStyle(wrapper).pointerEvents).toBe("none")
      expect(content.classList.contains("pointer-events-none")).toBe(true)
    } finally {
      style.remove()
    }
  })
})
