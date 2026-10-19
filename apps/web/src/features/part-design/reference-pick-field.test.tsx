import "../../../../../tests/unit/support/dom"
import { afterEach, describe, expect, it, mock } from "bun:test"
import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { ReferencePickField } from "./reference-pick-field"

afterEach(cleanup)

describe("ReferencePickField list fallback", () => {
  it("keeps native list values, name, required, blur and the existing combobox accessible name", async () => {
    const user = userEvent.setup()
    const onChange = mock(() => {})
    const onBlur = mock(() => {})
    render(
      <>
        <ReferencePickField
          id="target"
          name="targetBody"
          label="Target body"
          selectAriaLabel="Target solid"
          value=""
          placeholder="Choose a body"
          options={[
            { value: "producer:right", label: "Split · right" },
            { value: "producer:left", label: "Split · left" },
          ]}
          candidates={[]}
          required
          onValueChange={onChange}
          onBlur={onBlur}
        />
        <button type="button">Next control</button>
      </>,
    )
    const select = screen.getByRole("combobox", { name: "Target solid" }) as HTMLSelectElement
    expect(select.name).toBe("targetBody")
    expect(select.required).toBe(true)
    expect(screen.queryByRole("button", { name: "Select Target body in 3D" })).toBeNull()
    await user.selectOptions(select, "producer:right")
    expect(onChange).toHaveBeenCalledWith("producer:right")
    await user.tab()
    expect(onBlur).toHaveBeenCalledTimes(1)
  })

  it("exposes adjacent error and description and preserves disabled list behavior", () => {
    render(
      <ReferencePickField
        id="target"
        label="Target body"
        value="producer:right"
        placeholder="Choose a body"
        options={[{ value: "producer:right", label: "Split · right" }]}
        candidates={[]}
        disabled
        required
        description="Choose a committed body."
        error="The selected body is unavailable."
        onValueChange={() => {}}
      />,
    )
    const select = screen.getByRole("combobox", { name: "Target body" }) as HTMLSelectElement
    expect(select.disabled).toBe(true)
    expect(select.value).toBe("producer:right")
    expect(select.getAttribute("aria-invalid")).toBe("true")
    expect(select.getAttribute("aria-describedby")).toBe("target-description target-error")
    expect(screen.getByRole("alert").textContent).toBe("The selected body is unavailable.")
  })

  it("retains a selected reference omitted from the current fallback options without i18n", () => {
    render(
      <ReferencePickField
        id="retained-target"
        label="Target body"
        value="producer:right"
        placeholder="Choose a body"
        options={[]}
        candidates={[]}
        onValueChange={() => {}}
      />,
    )
    const select = screen.getByRole("combobox", { name: "Target body" }) as HTMLSelectElement
    expect(select.value).toBe("producer:right")
    expect(
      screen.getByRole("option", { name: "Choose a body", selected: true }).getAttribute("value"),
    ).toBe("producer:right")
  })
})
