// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from "./command"

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn()
  vi.stubGlobal(
    "ResizeObserver",
    class ResizeObserver {
      disconnect() {}
      observe() {}
      unobserve() {}
    },
  )
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe("Command", () => {
  it("filters by keywords and invokes the selected item from the keyboard", async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()

    render(
      <Command label="Search actions">
        <CommandInput aria-label="Search actions" />
        <CommandList>
          <CommandEmpty>No actions found.</CommandEmpty>
          <CommandItem keywords={["cube"]} value="Create box" onSelect={onSelect}>
            Box
          </CommandItem>
          <CommandItem value="Create cylinder">Cylinder</CommandItem>
        </CommandList>
      </Command>,
    )

    await user.type(screen.getByRole("combobox", { name: "Search actions" }), "cube")
    expect(screen.getByText("Box")).toBeTruthy()
    expect(screen.queryByText("Cylinder")).toBeNull()

    await user.keyboard("{Enter}")
    expect(onSelect).toHaveBeenCalledWith("Create box")
  })
})
