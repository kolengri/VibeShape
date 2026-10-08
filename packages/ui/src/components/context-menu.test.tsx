import "../../../../tests/unit/support/dom"
import { afterEach, describe, expect, it } from "bun:test"
import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { vi } from "../../../../tests/unit/support/bun-test"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "./context-menu"

afterEach(cleanup)

describe("ContextMenu", () => {
  it("renders an open menu with semantic items and invokes item selection", async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()

    render(
      <ContextMenu open>
        <ContextMenuTrigger>Canvas</ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuLabel>Model actions</ContextMenuLabel>
          <ContextMenuSeparator />
          <ContextMenuItem onSelect={onSelect}>Create sketch</ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>,
    )

    expect(screen.getByRole("menu").className).toContain(
      "max-h-[var(--radix-context-menu-content-available-height)]",
    )
    expect(screen.getByText("Model actions")).toBeTruthy()

    await user.click(screen.getByRole("menuitem", { name: "Create sketch" }))
    expect(onSelect).toHaveBeenCalledTimes(1)
  })
})
