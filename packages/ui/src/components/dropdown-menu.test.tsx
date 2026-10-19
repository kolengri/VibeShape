import "../../../../tests/unit/support/dom"
import { afterEach, expect, it } from "bun:test"
import { cleanup, render, screen } from "@testing-library/react"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSections,
  DropdownMenuTrigger,
} from "./dropdown-menu"

afterEach(cleanup)

it("separates only the remaining sections when the first, middle or last group is removed", () => {
  const menu = (visible: readonly boolean[]) => (
    <DropdownMenu open>
      <DropdownMenuTrigger>Application</DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuSections>
          {["project", "workspace", "help"].map((section, index) =>
            visible[index] ? (
              <DropdownMenuGroup key={section}>
                <DropdownMenuItem>{section}</DropdownMenuItem>
              </DropdownMenuGroup>
            ) : null,
          )}
        </DropdownMenuSections>
      </DropdownMenuContent>
    </DropdownMenu>
  )
  const view = render(menu([true, true, true]))
  for (const [visible, expected] of [
    [
      [true, true, true],
      ["group", "separator", "group", "separator", "group"],
    ],
    [
      [false, true, true],
      ["group", "separator", "group"],
    ],
    [
      [true, false, true],
      ["group", "separator", "group"],
    ],
    [[true, false, false], ["group"]],
    [[false, false, false], []],
  ] as const) {
    view.rerender(menu(visible))
    expect(
      Array.from(screen.getByRole("menu").children).map((element) => element.getAttribute("role")),
    ).toEqual([...expected])
  }
})
