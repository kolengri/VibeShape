// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it } from "vitest"
import { LengthExpressionField } from "./length-expression-field"

afterEach(cleanup)

describe("LengthExpressionField", () => {
  it("preserves uncontrolled raw expressions and exposes its description", async () => {
    const user = userEvent.setup()
    render(
      <LengthExpressionField
        id="test-length"
        label="Width"
        description="Enter a length or #variable."
        defaultValue="40 mm"
      />,
    )
    const input = screen.getByRole("textbox", { name: "Width" }) as HTMLInputElement
    await user.clear(input)
    await user.type(input, "#width")
    expect(input.value).toBe("#width")
    expect(input.getAttribute("aria-describedby")).toContain("test-length-description")
  })

  it("connects an adjacent error without replacing the raw value", () => {
    render(
      <LengthExpressionField
        id="invalid-length"
        label="Height"
        description="Enter a length."
        defaultValue="#missing"
        error="The variable does not exist."
      />,
    )
    const input = screen.getByRole("textbox", { name: "Height" }) as HTMLInputElement
    expect(input.value).toBe("#missing")
    expect(input.getAttribute("aria-invalid")).toBe("true")
    expect(screen.getByText("The variable does not exist.")).toBeTruthy()
  })
})
