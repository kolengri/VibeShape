// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { TextField } from "@vibeshape/ui/components/text-field"
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
          cancel: "Cancel",
        }}
        profileLabel="Sketch 1"
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
})
