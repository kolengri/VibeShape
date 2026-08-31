// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { TextField } from "@vibeshape/ui/components/text-field"
import { TooltipProvider } from "@vibeshape/ui/components/tooltip"
import { afterEach, describe, expect, it, vi } from "vitest"
import { ExtrusionParameterPanel } from "./extrusion-parameter-panel"

afterEach(cleanup)

describe("ExtrusionParameterPanel", () => {
  it("keeps ordinary controls state-agnostic before form integration", async () => {
    const user = userEvent.setup()
    const onCancel = vi.fn()
    render(
      <ExtrusionParameterPanel
        copy={{
          title: "Extrude profile",
          description: "Create a new solid.",
          parameters: "Extrusion parameters",
          profile: "Selected profile",
          clearProfiles: "Clear selected profiles",
          removeProfile: (profile: string) => `Remove ${profile}`,
          cancel: "Cancel",
        }}
        profileLabels={["Sketch 1"]}
        operationField={<span>Operation</span>}
        distanceField={<TextField label="Distance" defaultValue="10 mm" />}
        symmetricField={
          <label>
            <input type="checkbox" defaultChecked={false} />
            Symmetric
          </label>
        }
        footerAction={<button type="button">Create extrusion</button>}
        onCancel={onCancel}
      />,
    )

    const distance = screen.getByRole("textbox", { name: "Distance" }) as HTMLInputElement
    await user.clear(distance)
    await user.type(distance, "#depth")
    await user.click(screen.getByRole("checkbox", { name: "Symmetric" }))
    expect(distance.value).toBe("#depth")
    expect((screen.getByRole("checkbox", { name: "Symmetric" }) as HTMLInputElement).checked).toBe(
      true,
    )
    expect(screen.getByText("Sketch 1").textContent).toBe("Sketch 1")
    await user.click(screen.getByRole("button", { name: "Cancel" }))
    expect(onCancel).toHaveBeenCalledOnce()
  })

  it("does not mutate profile selection while the panel is read-only", async () => {
    const user = userEvent.setup()
    const onProfileRemove = vi.fn()
    const onProfilesClear = vi.fn()
    render(
      <TooltipProvider>
        <ExtrusionParameterPanel
          copy={{
            title: "Extrude profile",
            description: "Inspect an existing solid.",
            parameters: "Extrusion parameters",
            profile: "Selected profiles",
            clearProfiles: "Clear selected profiles",
            removeProfile: (profile: string) => `Remove ${profile}`,
            cancel: "Cancel",
          }}
          disabled
          profileLabels={["Sketch 1 · Profile 1", "Sketch 1 · Profile 2"]}
          operationField={<span>Operation</span>}
          distanceField={<span>Distance</span>}
          symmetricField={<span>Symmetric</span>}
          footerAction={<button type="button">Update extrusion</button>}
          onCancel={vi.fn()}
          onProfileRemove={onProfileRemove}
          onProfilesClear={onProfilesClear}
        />
      </TooltipProvider>,
    )

    const clear = screen.getByRole("button", { name: "Clear selected profiles" })
    const remove = screen.getByRole("button", { name: "Remove Sketch 1 · Profile 1" })
    expect((clear as HTMLButtonElement).disabled).toBe(true)
    expect((remove as HTMLButtonElement).disabled).toBe(true)
    await user.click(clear)
    await user.click(remove)
    expect(onProfilesClear).not.toHaveBeenCalled()
    expect(onProfileRemove).not.toHaveBeenCalled()
  })
})
