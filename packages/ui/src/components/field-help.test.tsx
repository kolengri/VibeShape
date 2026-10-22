import "../../../../tests/unit/support/dom"
import { afterEach, describe, expect, it, mock } from "bun:test"
import { cleanup, render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { FieldHelpProvider } from "./field-help"
import { TextField } from "./text-field"

afterEach(cleanup)

describe("Field help", () => {
  it("keeps help beside its label and reveals it without submitting or changing the field", async () => {
    const user = userEvent.setup()
    const submit = mock((event: React.FormEvent) => event.preventDefault())
    render(
      <form onSubmit={submit}>
        <TextField label="Width" defaultValue="10 mm" description="Enter a length or #variable." />
      </form>,
    )
    const input = screen.getByRole("textbox", { name: "Width" }) as HTMLInputElement
    const help = screen.getByRole("button", { name: "Help for Width" })
    const description = document.getElementById(input.getAttribute("aria-describedby") ?? "")
    expect(description?.textContent).toBe("Enter a length or #variable.")
    expect(description?.classList.contains("sr-only")).toBe(true)
    expect(help.closest("label")).toBeNull()
    expect(help.closest("[data-slot=field-label-row]")?.querySelector("label")?.htmlFor).toBe(
      input.id,
    )
    expect(screen.queryByRole("dialog")).toBeNull()
    await user.click(help)
    expect(
      within(screen.getByRole("dialog", { name: "Width" })).getByText(
        "Enter a length or #variable.",
      ),
    ).toBeTruthy()
    expect(input.value).toBe("10 mm")
    expect(submit).not.toHaveBeenCalled()
    await user.keyboard("{Escape}")
    expect(screen.queryByRole("dialog")).toBeNull()
    expect(document.activeElement).toBe(help)
  })

  it("opens with the keyboard and preserves visible errors", async () => {
    const user = userEvent.setup()
    render(
      <TextField
        label="Depth"
        description="Measured from the sketch plane."
        error="Depth must be positive."
      />,
    )
    const help = screen.getByRole("button", { name: "Help for Depth" })
    help.focus()
    await user.keyboard("{Enter}")
    expect(screen.getByRole("dialog", { name: "Depth" })).toBeTruthy()
    expect(screen.getByRole("alert").textContent).toBe("Depth must be positive.")
    await user.keyboard("{Escape}")
    await user.keyboard(" ")
    expect(screen.getByRole("dialog", { name: "Depth" })).toBeTruthy()
    await user.click(screen.getByRole("textbox", { name: "Depth" }))
    expect(screen.queryByRole("dialog")).toBeNull()
  })

  it("omits the help control for fields without a description", () => {
    render(<TextField label="Name" />)
    expect(screen.queryByRole("button")).toBeNull()
    expect(screen.getByRole("textbox").getAttribute("aria-describedby")).toBeNull()
  })

  it("uses the owner's localized help name while preserving the input label", () => {
    render(
      <FieldHelpProvider formatLabel={(subject) => <>{subject} details</>}>
        <TextField label="Width" description="Enter a length." />
      </FieldHelpProvider>,
    )
    expect(screen.getByLabelText("Width").tagName).toBe("INPUT")
    expect(screen.getByRole("button", { name: "Width details" })).toBeTruthy()
  })
})
