// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react"
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest"
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
})
