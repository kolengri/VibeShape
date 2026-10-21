import "../../../../../tests/unit/support/dom"
import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test"
import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { I18nProvider } from "@vibeshape/i18n"
import { type FocusEvent, useState } from "react"
import { vi } from "../../../../../tests/unit/support/bun-test"
import { i18n } from "../../i18n"
import { ReferencePickField } from "./reference-pick-field"

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn()
  vi.stubGlobal(
    "ResizeObserver",
    class ResizeObserver {
      disconnect() {}
      observe() {}
      unobserve() {}
    },
  )
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe("ReferencePickField searchable fallback", () => {
  it("keeps reference values, named submission, required validation, blur and its accessible name", async () => {
    const user = userEvent.setup()
    const onChange = mock((_value: string) => {})
    const onBlur = mock((_event: FocusEvent<HTMLButtonElement | HTMLSelectElement>) => {})
    function Field() {
      const [value, setValue] = useState("")
      return (
        <ReferencePickField
          id="target"
          name="targetBody"
          label="Target body"
          selectAriaLabel="Target solid"
          value={value}
          placeholder="Choose a body"
          options={[
            { value: "producer:right", label: "Split · right", keywords: ["housing"] },
            { value: "producer:left", label: "Split · left", disabled: true },
          ]}
          candidates={[]}
          required
          onValueChange={(next) => {
            setValue(next)
            onChange(next)
          }}
          onBlur={onBlur}
        />
      )
    }
    render(
      <I18nProvider i18n={i18n} initialLocale="en">
        <form aria-label="References">
          <Field />
          <button type="button">Next control</button>
        </form>
      </I18nProvider>,
    )
    const trigger = screen.getByRole("combobox", { name: "Target solid" })
    const form = screen.getByRole("form", { name: "References" }) as HTMLFormElement
    const backingSelect = form.elements.namedItem("targetBody") as HTMLSelectElement
    expect(backingSelect.required).toBe(true)
    expect(backingSelect.checkValidity()).toBe(false)
    expect(trigger.getAttribute("aria-required")).toBe("true")
    expect(screen.queryByRole("button", { name: "Select Target body in 3D" })).toBeNull()
    await user.click(trigger)
    const search = screen.getByRole("combobox", { name: "Search options…" })
    expect(document.activeElement === search).toBe(true)
    expect(screen.getByRole("option", { name: "Split · left" }).getAttribute("aria-disabled")).toBe(
      "true",
    )
    await user.type(search, "housing")
    expect(screen.queryByRole("option", { name: "Split · left" })).toBeNull()
    await user.keyboard("{Enter}")
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenCalledWith("producer:right")
    expect(backingSelect.value).toBe("producer:right")
    expect(backingSelect.checkValidity()).toBe(true)
    expect(new FormData(form).get("targetBody")).toBe("producer:right")
    expect(trigger.textContent).toContain("Split · right")
    expect(document.activeElement === trigger).toBe(true)
    await user.click(trigger)
    await user.click(screen.getByRole("option", { name: "Choose a body" }))
    expect(backingSelect.value).toBe("")
    expect(backingSelect.checkValidity()).toBe(false)
    expect(onChange).toHaveBeenLastCalledWith("")
    await user.tab()
    expect(document.activeElement?.textContent).toBe("Next control")
    expect(onBlur).toHaveBeenCalled()
    for (const [event] of onBlur.mock.calls) {
      expect(event.target instanceof HTMLButtonElement).toBe(true)
    }
  })

  it("exposes adjacent error and description and preserves disabled reference submission behavior", async () => {
    const user = userEvent.setup()
    const onChange = mock(() => {})
    render(
      <I18nProvider i18n={i18n} initialLocale="en">
        <form aria-label="References">
          <ReferencePickField
            id="target"
            label="Target body"
            name="targetBody"
            value="producer:right"
            placeholder="Choose a body"
            options={[{ value: "producer:right", label: "Split · right" }]}
            candidates={[]}
            disabled
            required
            description="Choose a committed body."
            error="The selected body is unavailable."
            onValueChange={onChange}
          />
        </form>
      </I18nProvider>,
    )
    const trigger = screen.getByRole("combobox", { name: "Target body" }) as HTMLButtonElement
    expect(trigger.disabled).toBe(true)
    expect(trigger.textContent).toContain("Split · right")
    expect(trigger.getAttribute("aria-invalid")).toBe("true")
    expect(trigger.getAttribute("aria-describedby")).toBe("target-description target-error")
    expect(screen.getByRole("alert").textContent).toBe("The selected body is unavailable.")
    await user.click(trigger)
    expect(screen.queryByRole("listbox")).toBeNull()
    expect(onChange).not.toHaveBeenCalled()
    expect(new FormData(screen.getByRole("form") as HTMLFormElement).has("targetBody")).toBe(false)
  })

  it("retains a missing current reference without silently changing or submitting a replacement", async () => {
    const user = userEvent.setup()
    const onChange = mock(() => {})
    render(
      <I18nProvider i18n={i18n} initialLocale="en">
        <form aria-label="References">
          <ReferencePickField
            id="retained-target"
            label="Target body"
            name="targetBody"
            value="producer:right"
            placeholder="Choose a body"
            options={[]}
            candidates={[]}
            onValueChange={onChange}
          />
        </form>
      </I18nProvider>,
    )
    const trigger = screen.getByRole("combobox", { name: "Target body" })
    const form = screen.getByRole("form", { name: "References" }) as HTMLFormElement
    expect(new FormData(form).get("targetBody")).toBe("producer:right")
    expect(trigger.textContent).toContain("Choose a body")
    await user.click(trigger)
    expect(screen.getByRole("option", { name: "Choose a body" })).toBeTruthy()
    await user.type(screen.getByRole("combobox", { name: "Search options…" }), "missing-reference")
    expect(screen.getByText("No matching options")).toBeTruthy()
    await user.keyboard("{Enter}")
    expect(onChange).not.toHaveBeenCalled()
    await user.keyboard("{Escape}")
    expect(document.activeElement === trigger).toBe(true)
    expect(new FormData(form).get("targetBody")).toBe("producer:right")
  })
})
