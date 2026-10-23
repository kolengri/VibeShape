import "../../../../../tests/unit/support/dom"
import { afterEach, describe, expect, it } from "bun:test"
import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { I18nProvider } from "@vibeshape/i18n/provider"
import { TextField } from "@vibeshape/ui/components/text-field"
import { vi } from "../../../../../tests/unit/support/bun-test"
import { i18n } from "../../i18n"
import {
  PrimitiveParameterPanel,
  type PrimitiveParameterPanelCopy,
} from "./primitive-parameter-panel"

const copy: PrimitiveParameterPanelCopy = {
  title: "Create primitive",
  description: "Create a primitive solid.",
  parameters: "Primitive definition",
  dimensions: "Required dimensions",
  placement: "Placement origin",
  centered: "Center height about placement origin",
  cancel: "Cancel",
}

afterEach(cleanup)

describe("PrimitiveParameterPanel", () => {
  it("keeps parameter fields uncontrolled and exposes ordinary form controls", async () => {
    const user = userEvent.setup()
    const onCancel = vi.fn()

    render(
      <PrimitiveParameterPanel
        actions={
          <button type="button" onClick={onCancel}>
            {copy.cancel}
          </button>
        }
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
        placementFields={<TextField label="Origin X" defaultValue="0 mm" />}
      />,
      { wrapper: ({ children }) => <I18nProvider i18n={i18n}>{children}</I18nProvider> },
    )

    const radius = screen.getByRole("textbox", { name: "Radius" }) as HTMLInputElement
    await user.clear(radius)
    await user.type(radius, "#radius")
    expect(radius.value).toBe("#radius")
    expect(
      (screen.getByRole("checkbox", { name: copy.centered }) as HTMLInputElement).checked,
    ).toBe(true)

    await user.click(screen.getByRole("button", { name: copy.cancel }))
    expect(onCancel).toHaveBeenCalledTimes(1)
  })
})
