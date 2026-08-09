// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { TextField } from "@vibeshape/ui/components/text-field"
import { afterEach, describe, expect, it, vi } from "vitest"
import { BoxParameterPanel, type BoxParameterPanelCopy } from "./box-parameter-panel"

const copy: BoxParameterPanelCopy = {
  title: "Create box",
  description: "Create a primitive solid.",
  dimensions: "Required dimensions",
  centered: "Center on the origin",
  cancel: "Cancel",
}

afterEach(cleanup)

describe("BoxParameterPanel", () => {
  it("keeps the base parameter fields uncontrolled and exposes ordinary form controls", async () => {
    const user = userEvent.setup()
    const onCancel = vi.fn()

    render(
      <BoxParameterPanel
        copy={copy}
        widthField={<TextField label="Width" defaultValue="20 mm" />}
        depthField={<TextField label="Depth" defaultValue="20 mm" />}
        heightField={<TextField label="Height" defaultValue="20 mm" />}
        centeredField={
          <label>
            <input type="checkbox" defaultChecked />
            {copy.centered}
          </label>
        }
        footerAction={<button type="button">Create box</button>}
        onCancel={onCancel}
      />,
    )

    const width = screen.getByRole("textbox", { name: "Width" }) as HTMLInputElement
    await user.clear(width)
    await user.type(width, "#width")
    expect(width.value).toBe("#width")
    expect(
      (screen.getByRole("checkbox", { name: copy.centered }) as HTMLInputElement).checked,
    ).toBe(true)

    await user.click(screen.getByRole("button", { name: copy.cancel }))
    expect(onCancel).toHaveBeenCalledOnce()
  })
})
