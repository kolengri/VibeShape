// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { TooltipProvider } from "@vibeshape/ui/components/tooltip"
import { afterEach, describe, expect, it, vi } from "vitest"
import { RevolveParameterPanel } from "./revolve-parameter-panel"

afterEach(cleanup)

describe("RevolveParameterPanel", () => {
  it("does not mutate profile selection while the panel is read-only", async () => {
    const user = userEvent.setup()
    const onProfileRemove = vi.fn()
    const onProfilesClear = vi.fn()
    const onProfileSelectionRequest = vi.fn()
    render(
      <TooltipProvider>
        <RevolveParameterPanel
          actions={<button type="button">Cancel</button>}
          copy={{
            title: "Revolve profile",
            description: "Inspect an existing solid.",
            parameters: "Revolve parameters",
            profile: "Selected profiles",
            profileSelectAriaLabel: "Select profiles in the viewport",
            profileSelectHint: "Select profiles in the viewport",
            clearProfiles: "Clear selected profiles",
            removeProfile: (profile: string) => `Remove ${profile}`,
            cancel: "Cancel",
          }}
          disabled
          profileLabels={["Sketch 1 · Profile 1", "Sketch 1 · Profile 2"]}
          operationField={<span>Operation</span>}
          targetField={<span>Target</span>}
          axisField={<span>Axis</span>}
          angleField={<span>Angle</span>}
          onProfileRemove={onProfileRemove}
          onProfilesClear={onProfilesClear}
          onProfileSelectionRequest={onProfileSelectionRequest}
        />
      </TooltipProvider>,
    )

    const clear = screen.getByRole("button", { name: "Clear selected profiles" })
    const remove = screen.getByRole("button", { name: "Remove Sketch 1 · Profile 1" })
    const select = screen.getByRole("button", { name: "Select profiles in the viewport" })
    expect((clear as HTMLButtonElement).disabled).toBe(true)
    expect((remove as HTMLButtonElement).disabled).toBe(true)
    expect((select as HTMLButtonElement).disabled).toBe(true)
    await user.click(clear)
    await user.click(remove)
    await user.click(select)
    expect(onProfilesClear).not.toHaveBeenCalled()
    expect(onProfileRemove).not.toHaveBeenCalled()
    expect(onProfileSelectionRequest).not.toHaveBeenCalled()
  })
})
