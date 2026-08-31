// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { NativeSelectField } from "@vibeshape/ui/components/native-select-field"
import { afterEach, describe, expect, it, vi } from "vitest"
import { BooleanParameterPanel, type BooleanParameterPanelCopy } from "./boolean-parameter-panel"

const copy: BooleanParameterPanelCopy = {
  title: "Subtract solids",
  description: "Remove one solid from another.",
  inputs: "Ordered inputs",
  cancel: "Cancel",
}

afterEach(cleanup)

describe("BooleanParameterPanel", () => {
  it("keeps input selectors uncontrolled and exposes ordinary form controls", async () => {
    const user = userEvent.setup()
    const onCancel = vi.fn()

    render(
      <BooleanParameterPanel
        actions={
          <button type="button" onClick={onCancel}>
            {copy.cancel}
          </button>
        }
        copy={copy}
        fields={
          <>
            <NativeSelectField label="Target solid" defaultValue="box">
              <option value="box">Box 1</option>
              <option value="cylinder">Cylinder 1</option>
            </NativeSelectField>
            <NativeSelectField label="Tool solid" defaultValue="cylinder">
              <option value="box">Box 1</option>
              <option value="cylinder">Cylinder 1</option>
            </NativeSelectField>
          </>
        }
      />,
    )

    const target = screen.getByRole("combobox", { name: "Target solid" }) as HTMLSelectElement
    expect(target.value).toBe("box")
    await user.selectOptions(target, "cylinder")
    expect(target.value).toBe("cylinder")

    await user.click(screen.getByRole("button", { name: copy.cancel }))
    expect(onCancel).toHaveBeenCalledOnce()
  })
})
