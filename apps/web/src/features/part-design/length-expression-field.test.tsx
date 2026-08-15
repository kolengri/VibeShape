// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { I18nProvider } from "@vibeshape/i18n/provider"
import { afterEach, describe, expect, it } from "vitest"
import { i18n } from "../../i18n"
import { LengthExpressionField } from "./length-expression-field"

afterEach(cleanup)

describe("LengthExpressionField", () => {
  it("preserves uncontrolled raw expressions and exposes its description", async () => {
    const user = userEvent.setup()
    render(
      <I18nProvider i18n={i18n} initialLocale="en">
        <LengthExpressionField
          id="test-length"
          label="Width"
          description="Enter a length or #variable."
          defaultValue="40 mm"
          suggestions={[]}
        />
      </I18nProvider>,
    )
    const input = screen.getByRole("combobox", { name: "Width" }) as HTMLInputElement
    await user.clear(input)
    await user.type(input, "#width")
    expect(input.value).toBe("#width")
    expect(input.getAttribute("aria-describedby")).toContain("test-length-description")
  })

  it("connects an adjacent error without replacing the raw value", () => {
    render(
      <I18nProvider i18n={i18n} initialLocale="en">
        <LengthExpressionField
          id="invalid-length"
          label="Height"
          description="Enter a length."
          defaultValue="#missing"
          error="The variable does not exist."
          suggestions={[]}
        />
      </I18nProvider>,
    )
    const input = screen.getByRole("combobox", { name: "Height" }) as HTMLInputElement
    expect(input.value).toBe("#missing")
    expect(input.getAttribute("aria-invalid")).toBe("true")
    expect(screen.getByText("The variable does not exist.")).toBeTruthy()
  })
})
