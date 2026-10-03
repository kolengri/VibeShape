// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"
import { SelectField, SelectOption } from "./select-field"

beforeAll(() => {
  HTMLElement.prototype.scrollIntoView = vi.fn()
})
afterEach(cleanup)

function options() {
  return (
    <>
      <SelectOption value="new">New body</SelectOption>
      <SelectOption value="add" disabled>
        Add to body
      </SelectOption>
      <SelectOption value="remove">Remove from body</SelectOption>
    </>
  )
}

describe("SelectField", () => {
  it("supports an uncontrolled labeled field and skips disabled options with the keyboard", async () => {
    const user = userEvent.setup()
    const change = vi.fn()
    render(
      <form aria-label="Parameters">
        <SelectField
          label="Result operation"
          name="operation"
          defaultValue="new"
          onValueChange={change}
        >
          {options()}
        </SelectField>
      </form>,
    )
    const trigger = screen.getByRole("combobox", { name: "Result operation" })
    fireEvent.keyDown(trigger, { key: "Enter" })
    expect(screen.getByRole("option", { name: "Add to body" }).getAttribute("aria-disabled")).toBe(
      "true",
    )
    await user.keyboard("{ArrowDown}{Enter}")
    expect(trigger.textContent).toBe("Remove from body")
    expect(change).toHaveBeenCalledExactlyOnceWith("remove")
    const form = screen.getByRole("form", { name: "Parameters" }) as HTMLFormElement
    expect(new FormData(form).get("operation")).toBe("remove")
  })

  it("publishes pointer selection while leaving controlled value ownership to its caller", async () => {
    const user = userEvent.setup()
    const change = vi.fn()
    const view = (value: string) => (
      <SelectField label="Result operation" value={value} onValueChange={change}>
        {options()}
      </SelectField>
    )
    const { rerender } = render(view("new"))
    const trigger = screen.getByRole("combobox", { name: "Result operation" })
    fireEvent.keyDown(trigger, { key: "Enter" })
    await user.click(screen.getByRole("option", { name: "Remove from body" }))
    expect(change).toHaveBeenCalledExactlyOnceWith("remove")
    expect(trigger.textContent).toBe("New body")
    rerender(view("remove"))
    expect(trigger.textContent).toBe("Remove from body")
  })

  it("keeps a disabled parameter unavailable", () => {
    render(
      <SelectField label="Result operation" defaultValue="new" disabled>
        {options()}
      </SelectField>,
    )
    expect(
      (screen.getByRole("combobox", { name: "Result operation" }) as HTMLButtonElement).disabled,
    ).toBe(true)
  })
})
