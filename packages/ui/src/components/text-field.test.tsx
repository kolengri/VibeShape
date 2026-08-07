// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it } from "vitest"

import { TextField } from "./text-field"

afterEach(cleanup)

describe("TextField", () => {
  it("works as an uncontrolled native field by default", async () => {
    const user = userEvent.setup()

    render(
      <TextField
        label="Feature name"
        name="featureName"
        defaultValue="Bracket"
        description="Used in the model tree."
      />,
    )
    const input = screen.getByRole("textbox", { name: "Feature name" }) as HTMLInputElement

    expect(input.value).toBe("Bracket")

    await user.clear(input)
    await user.type(input, "Mounting bracket")

    expect(input.value).toBe("Mounting bracket")
  })

  it("connects validation text to the native input", () => {
    render(<TextField label="Width" name="width" error="Width must be greater than zero." />)

    const input = screen.getByRole("textbox", { name: "Width" })
    const error = screen.getByRole("alert")

    expect(input.getAttribute("aria-invalid")).toBe("true")
    expect(input.getAttribute("aria-describedby")).toContain(error.id)
    expect(error.textContent).toBe("Width must be greater than zero.")
  })
})
