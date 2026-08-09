// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it } from "vitest"

import { NativeSelectField } from "./native-select-field"

afterEach(cleanup)

describe("NativeSelectField", () => {
  it("works as an uncontrolled native field by default", async () => {
    const user = userEvent.setup()

    render(
      <NativeSelectField
        label="Target solid"
        name="targetFeatureId"
        defaultValue="box"
        description="The solid that remains after subtraction."
      >
        <option value="box">Box 1</option>
        <option value="cylinder">Cylinder 1</option>
      </NativeSelectField>,
    )
    const select = screen.getByRole("combobox", { name: "Target solid" }) as HTMLSelectElement

    expect(select.value).toBe("box")
    await user.selectOptions(select, "cylinder")
    expect(select.value).toBe("cylinder")
  })

  it("connects validation text to the native select", () => {
    render(
      <NativeSelectField label="Tool solid" name="toolFeatureId" error="Choose another solid.">
        <option value="box">Box 1</option>
      </NativeSelectField>,
    )

    const select = screen.getByRole("combobox", { name: "Tool solid" })
    const error = screen.getByRole("alert")

    expect(select.getAttribute("aria-invalid")).toBe("true")
    expect(select.getAttribute("aria-describedby")).toContain(error.id)
    expect(error.textContent).toBe("Choose another solid.")
  })
})
