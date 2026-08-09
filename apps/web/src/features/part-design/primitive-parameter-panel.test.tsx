// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { TextField } from "@vibeshape/ui/components/text-field"
import { afterEach, describe, expect, it, vi } from "vitest"
import {
  PrimitiveParameterPanel,
  type PrimitiveParameterPanelCopy,
} from "./primitive-parameter-panel"

const copy: PrimitiveParameterPanelCopy = {
  title: "Create primitive",
  description: "Create a primitive solid.",
  dimensions: "Required dimensions",
  centered: "Center on the origin",
  cancel: "Cancel",
}

afterEach(cleanup)

describe("PrimitiveParameterPanel", () => {
  it("keeps parameter fields uncontrolled and exposes ordinary form controls", async () => {
    const user = userEvent.setup()
    const onCancel = vi.fn()

    render(
      <PrimitiveParameterPanel
        copy={copy}
        fields={
          <>
            <TextField label="Radius" defaultValue="10 mm" />
            <TextField label="Height" defaultValue="20 mm" />
          </>
        }
        centeredField={
          <label>
            <input type="checkbox" defaultChecked />
            {copy.centered}
          </label>
        }
        footerAction={<button type="button">Create primitive</button>}
        onCancel={onCancel}
      />,
    )

    const radius = screen.getByRole("textbox", { name: "Radius" }) as HTMLInputElement
    await user.clear(radius)
    await user.type(radius, "#radius")
    expect(radius.value).toBe("#radius")
    expect(
      (screen.getByRole("checkbox", { name: copy.centered }) as HTMLInputElement).checked,
    ).toBe(true)

    await user.click(screen.getByRole("button", { name: copy.cancel }))
    expect(onCancel).toHaveBeenCalledOnce()
  })
})
