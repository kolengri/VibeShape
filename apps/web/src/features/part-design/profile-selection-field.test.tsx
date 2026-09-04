// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { TooltipProvider } from "@vibeshape/ui/components/tooltip"
import { afterEach, describe, expect, it, vi } from "vitest"
import { ProfileSelectionField } from "./profile-selection-field"

afterEach(cleanup)

const copy = {
  clear: "Clear selected profiles",
  label: "Selected profiles",
  remove: (profile: string) => `Remove ${profile}`,
  select: "Select profiles in the 3D viewport",
}

describe("ProfileSelectionField", () => {
  it("shows each selected profile once and keeps graphical selection explicit", async () => {
    const user = userEvent.setup()
    const onRemove = vi.fn()
    const onSelectionRequest = vi.fn()
    render(
      <TooltipProvider>
        <ProfileSelectionField
          copy={copy}
          labels={["Sketch 1 · Profile 1"]}
          onClear={vi.fn()}
          onRemove={onRemove}
          onSelectionRequest={onSelectionRequest}
          selectionActive
        />
      </TooltipProvider>,
    )

    expect(screen.getAllByText("Sketch 1 · Profile 1")).toHaveLength(1)
    expect(screen.queryByRole("button", { name: copy.clear })).toBeNull()
    const select = screen.getByRole("button", { name: copy.select })
    expect(select.getAttribute("aria-pressed")).toBe("true")

    await user.click(select)
    await user.click(screen.getByRole("button", { name: "Remove Sketch 1 · Profile 1" }))
    expect(onSelectionRequest).toHaveBeenCalledOnce()
    expect(onRemove).toHaveBeenCalledWith(0)
  })

  it("offers one clear-all action only when several profiles are selected", async () => {
    const user = userEvent.setup()
    const onClear = vi.fn()
    render(
      <TooltipProvider>
        <ProfileSelectionField
          copy={copy}
          labels={["Sketch 1 · Profile 1", "Sketch 1 · Profile 2"]}
          onClear={onClear}
        />
      </TooltipProvider>,
    )

    await user.click(screen.getByRole("button", { name: copy.clear }))
    expect(onClear).toHaveBeenCalledOnce()
  })
})
