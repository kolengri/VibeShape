import "../../../../tests/unit/support/dom"
import { afterEach, expect, it } from "bun:test"
import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { CheckboxField } from "./checkbox-field"
import { TextareaField } from "./textarea-field"

afterEach(cleanup)

it("preserves uncontrolled checkbox and textarea values and native form names", async () => {
  const user = userEvent.setup()
  render(
    <form aria-label="Native controls">
      <CheckboxField name="enabled" label="Enabled" defaultChecked />
      <TextareaField name="notes" label="Notes" defaultValue="Initial notes" />
    </form>,
  )
  const checkbox = screen.getByRole("checkbox", { name: "Enabled" }) as HTMLInputElement
  const textarea = screen.getByRole("textbox", { name: "Notes" }) as HTMLTextAreaElement
  expect(checkbox.checked).toBe(true)
  await user.click(screen.getByText("Enabled"))
  await user.clear(textarea)
  await user.type(textarea, "Revised notes")
  expect(checkbox.checked).toBe(false)
  expect(textarea.value).toBe("Revised notes")
  expect(checkbox.name).toBe("enabled")
  expect(textarea.name).toBe("notes")
})

it("associates validation and guidance with native controls", () => {
  render(
    <>
      <CheckboxField label="Enabled" description="Enable previews" error="Choose this option" />
      <TextareaField
        label="Notes"
        description="Describe the model"
        error="Notes are required"
        disabled
      />
    </>,
  )
  for (const [role, name, message] of [
    ["checkbox", "Enabled", "Choose this option"],
    ["textbox", "Notes", "Notes are required"],
  ] as const) {
    const input = screen.getByRole(role, { name })
    expect(input.getAttribute("aria-invalid")).toBe("true")
    const error = screen.getByText(message)
    expect(input.getAttribute("aria-describedby")?.split(" ")).toContain(error.id)
  }
  expect((screen.getByRole("textbox", { name: "Notes" }) as HTMLTextAreaElement).disabled).toBe(
    true,
  )
})
