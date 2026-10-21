import "../../../../tests/unit/support/dom"
import { afterEach, describe, expect, it, mock } from "bun:test"
import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { ChoiceField } from "./choice-field"

afterEach(cleanup)

const options = [
  { value: "new", label: "New body" },
  { value: "add", label: "Add", disabled: true },
  { value: "remove", label: "Remove" },
]

describe("ChoiceField", () => {
  it("uses uncontrolled native radio selection, form submission and reset", async () => {
    const user = userEvent.setup()
    const change = mock(() => {})
    render(
      <form aria-label="Parameters">
        <ChoiceField
          label="Operation"
          name="operation"
          options={options}
          defaultValue="new"
          onValueChange={change}
        />
        <button type="reset">Reset</button>
      </form>,
    )
    const form = screen.getByRole("form", { name: "Parameters" }) as HTMLFormElement
    expect(screen.getByRole("group", { name: "Operation" })).toBeTruthy()
    expect(new FormData(form).get("operation")).toBe("new")
    await user.click(screen.getByRole("radio", { name: "Remove" }))
    expect(change).toHaveBeenCalledWith("remove")
    expect(new FormData(form).get("operation")).toBe("remove")
    await user.click(screen.getByRole("button", { name: "Reset" }))
    expect(new FormData(form).get("operation")).toBe("new")
  })

  it("preserves native arrow-key navigation, disabled choices, tab exit and blur", async () => {
    const user = userEvent.setup()
    const blur = mock(() => {})
    const change = mock(() => {})
    render(
      <>
        <ChoiceField
          label="Operation"
          name="operation"
          options={options}
          defaultValue="new"
          onValueChange={change}
          onBlur={blur}
        />
        <button type="button">Next</button>
      </>,
    )
    await user.tab()
    expect((document.activeElement as HTMLInputElement).value).toBe("new")
    await user.keyboard("{ArrowRight}")
    expect((screen.getByRole("radio", { name: "Remove" }) as HTMLInputElement).checked).toBe(true)
    expect((screen.getByRole("radio", { name: "Add" }) as HTMLInputElement).checked).toBe(false)
    expect(change).toHaveBeenCalledWith("remove")
    await user.keyboard("{ArrowLeft}")
    expect((screen.getByRole("radio", { name: "New body" }) as HTMLInputElement).checked).toBe(true)
    await user.tab()
    expect(document.activeElement?.textContent).toBe("Next")
    expect(blur).toHaveBeenCalled()
  })

  it("supports controlled values and required validation", async () => {
    const user = userEvent.setup()
    const change = mock(() => {})
    const view = render(
      <form aria-label="Parameters">
        <ChoiceField
          label="Operation"
          name="operation"
          options={options}
          value=""
          required
          onValueChange={change}
        />
      </form>,
    )
    const form = screen.getByRole("form", { name: "Parameters" }) as HTMLFormElement
    expect(form.checkValidity()).toBe(false)
    await user.click(screen.getByRole("radio", { name: "Remove" }))
    expect(change).toHaveBeenCalledWith("remove")
    expect((screen.getByRole("radio", { name: "Remove" }) as HTMLInputElement).checked).toBe(false)
    view.rerender(
      <form aria-label="Parameters">
        <ChoiceField
          label="Operation"
          name="operation"
          options={options}
          value="remove"
          required
          onValueChange={change}
        />
      </form>,
    )
    expect(form.checkValidity()).toBe(true)
    expect(new FormData(form).get("operation")).toBe("remove")
  })

  it("keeps radio groups independent without explicit names", async () => {
    const user = userEvent.setup()
    render(
      <>
        <ChoiceField label="First operation" options={options} defaultValue="new" />
        <ChoiceField label="Second operation" options={options} defaultValue="remove" />
      </>,
    )
    const radios = screen.getAllByRole("radio", { name: "New body" }) as HTMLInputElement[]
    await user.click(radios[1] as HTMLInputElement)
    expect(radios.map((radio) => radio.checked)).toEqual([true, true])
  })

  it("connects guidance and errors, and disables every radio and its form submission", async () => {
    const user = userEvent.setup()
    const change = mock(() => {})
    render(
      <form aria-label="Parameters">
        <ChoiceField
          id="operation"
          label="Operation"
          name="operation"
          options={options}
          disabled
          required
          defaultValue="new"
          description="Choose the resulting body operation."
          error="No target body is available."
          onValueChange={change}
        />
      </form>,
    )
    const group = screen.getByRole("group", { name: "Operation" })
    expect(group.getAttribute("aria-describedby")).toBe("operation-description operation-error")
    expect(group.getAttribute("aria-invalid")).toBe("true")
    expect(screen.getByRole("alert").textContent).toBe("No target body is available.")
    for (const radio of screen.getAllByRole("radio")) {
      expect((radio as HTMLInputElement).disabled).toBe(true)
      expect(radio.getAttribute("aria-describedby")).toBe("operation-description operation-error")
    }
    await user.click(screen.getByRole("radio", { name: "Remove" }))
    expect(change).not.toHaveBeenCalled()
    const form = screen.getByRole("form", { name: "Parameters" }) as HTMLFormElement
    expect(new FormData(form).has("operation")).toBe(false)
  })
})
