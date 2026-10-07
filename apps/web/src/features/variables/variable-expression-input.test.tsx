// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { I18nProvider } from "@vibeshape/i18n/provider"
import { useState } from "react"
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest"
import { i18n } from "../../i18n"
import { VariableExpressionInput } from "./variable-expression-input"

class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}

const suggestions = [
  { id: "width-id", name: "width", description: "20 mm" },
  { id: "wall-id", name: "wall", description: "2 mm" },
  { id: "height-id", name: "height", description: "40 mm" },
] as const

beforeAll(() => {
  vi.stubGlobal("ResizeObserver", ResizeObserverMock)
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    callback(0)
    return 1
  })
})

afterAll(() => vi.unstubAllGlobals())
afterEach(cleanup)

function renderInput(props: Partial<React.ComponentProps<typeof VariableExpressionInput>> = {}) {
  const onValueChange = vi.fn()
  render(
    <I18nProvider i18n={i18n} initialLocale="en">
      <VariableExpressionInput
        aria-label="Expression"
        suggestions={suggestions}
        onValueChange={onValueChange}
        {...props}
      />
    </I18nProvider>,
  )
  return onValueChange
}

describe("VariableExpressionInput", () => {
  it.each([
    ["20 mm", "21 mm", "19 mm"],
    [" -2.5e+2 cm ", " -249 cm ", " -251 cm "],
    [".75in", "1.75in", "-0.25in"],
    ["90 deg", "91 deg", "89 deg"],
    ["12", "13", "11"],
    ["-0.9 rad", "0.1 rad", "-1.9 rad"],
    ["0.1 mm", "1.1 mm", "-0.9 mm"],
  ])("steps %s with arrows while retaining its unit", async (value, increased, decreased) => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    const onValueChange = renderInput({ defaultValue: value, onChange })
    const input = screen.getByRole("combobox", { name: "Expression" }) as HTMLInputElement
    await user.click(input)
    await user.keyboard("{ArrowUp}")
    expect(input.value).toBe(increased)
    expect(onValueChange).toHaveBeenCalledExactlyOnceWith(increased)
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(document.activeElement).toBe(input)
    expect(input.value.slice(input.selectionStart ?? 0, input.selectionEnd ?? 0)).toBe(
      increased.trim().replace(/\s*[A-Za-z]+$/, ""),
    )
    await user.keyboard("{ArrowDown}{ArrowDown}")
    expect(input.value).toBe(decreased)
    expect(onValueChange).toHaveBeenCalledTimes(3)
  })

  it("updates controlled form values through the native change callback", async () => {
    const user = userEvent.setup()
    function ControlledInput() {
      const [value, setValue] = useState("2.5 mm")
      return (
        <VariableExpressionInput
          aria-label="Expression"
          suggestions={[]}
          value={value}
          onChange={(event) => setValue(event.currentTarget.value)}
        />
      )
    }
    render(
      <I18nProvider i18n={i18n} initialLocale="en">
        <ControlledInput />
      </I18nProvider>,
    )
    const input = screen.getByRole("combobox", { name: "Expression" }) as HTMLInputElement
    await user.click(input)
    await user.keyboard("{ArrowUp}{ArrowUp}{ArrowDown}")
    expect(input.value).toBe("3.5 mm")
  })

  it("consumes stepping arrows before they reach editor shortcuts", async () => {
    const user = userEvent.setup()
    const onParentKeyDown = vi.fn()
    render(
      <I18nProvider i18n={i18n} initialLocale="en">
        <fieldset onKeyDown={onParentKeyDown}>
          <VariableExpressionInput aria-label="Expression" defaultValue="20 mm" suggestions={[]} />
        </fieldset>
      </I18nProvider>,
    )
    const input = screen.getByRole("combobox", { name: "Expression" }) as HTMLInputElement
    await user.click(input)
    await user.keyboard("{ArrowUp}")
    expect(input.value).toBe("21 mm")
    expect(onParentKeyDown).not.toHaveBeenCalled()
  })

  it.each(["2 * #width", "#width", "", "-", "20 px", "Infinity", "1e309", "1e30"])(
    "leaves non-steppable expression %s unchanged",
    async (value) => {
      const user = userEvent.setup()
      const onValueChange = renderInput({ defaultValue: value })
      const input = screen.getByRole("combobox", { name: "Expression" }) as HTMLInputElement
      await user.click(input)
      await user.keyboard("{ArrowUp}{ArrowDown}")
      expect(input.value).toBe(value)
      expect(onValueChange).not.toHaveBeenCalled()
    },
  )

  it.each([{ readOnly: true }, { disabled: true }])("does not step locked inputs %j", (props) => {
    const onValueChange = renderInput({ defaultValue: "20 mm", ...props })
    const input = screen.getByRole("combobox", { name: "Expression" }) as HTMLInputElement
    fireEvent.keyDown(input, { key: "ArrowUp" })
    expect(input.value).toBe("20 mm")
    expect(onValueChange).not.toHaveBeenCalled()
  })

  it("honors cancelled keys, modifiers, and composition", () => {
    const onValueChange = renderInput({
      defaultValue: "20 mm",
      onKeyDown: (event) => {
        if (event.key === "ArrowDown") event.preventDefault()
      },
    })
    const input = screen.getByRole("combobox", { name: "Expression" }) as HTMLInputElement
    fireEvent.keyDown(input, { key: "ArrowDown" })
    for (const modifier of ["altKey", "ctrlKey", "metaKey", "shiftKey", "isComposing"])
      fireEvent.keyDown(input, { key: "ArrowUp", [modifier]: true })
    expect(input.value).toBe("20 mm")
    expect(onValueChange).not.toHaveBeenCalled()
  })

  it("keeps arrow navigation in the variable autocomplete list", async () => {
    const user = userEvent.setup()
    renderInput({ defaultValue: "#" })
    const input = screen.getByRole("combobox", { name: "Expression" }) as HTMLInputElement
    await user.click(input)
    await user.keyboard("{ArrowDown}{Enter}")
    expect(input.value).toBe("#wall")
  })

  it.each([
    ["20 mm", "20"],
    [" -2.5e+2 cm ", "-2.5e+2"],
    [".75in", ".75"],
    ["90 deg", "90"],
    ["12", "12"],
  ])("selects the numeric literal in %s on entry", async (value, selected) => {
    const user = userEvent.setup()
    const onValueChange = renderInput({ defaultValue: value })
    const input = screen.getByRole("combobox", { name: "Expression" }) as HTMLInputElement
    await user.click(input)
    expect(input.value.slice(input.selectionStart ?? 0, input.selectionEnd ?? 0)).toBe(selected)
    expect(onValueChange).not.toHaveBeenCalled()
    await user.keyboard("8")
    expect(input.value).toBe(value.replace(selected, "8"))
  })

  it("selects on keyboard entry but preserves subsequent pointer caret placement", async () => {
    const user = userEvent.setup()
    renderInput({ defaultValue: "20 mm" })
    const input = screen.getByRole("combobox", { name: "Expression" }) as HTMLInputElement
    await user.tab()
    expect([input.selectionStart, input.selectionEnd]).toEqual([0, 2])
    await user.click(input)
    expect(input.selectionStart).toBe(input.selectionEnd)
  })

  it("preserves native selection for formulas and read-only values", async () => {
    const user = userEvent.setup()
    renderInput({ defaultValue: "2 * #width" })
    const input = screen.getByRole("combobox", { name: "Expression" }) as HTMLInputElement
    await user.click(input)
    expect(input.selectionStart).toBe(input.selectionEnd)
    cleanup()
    renderInput({ defaultValue: "20 mm", readOnly: true })
    const readOnly = screen.getByRole("combobox", { name: "Expression" }) as HTMLInputElement
    await user.click(readOnly)
    expect(readOnly.selectionStart).toBe(readOnly.selectionEnd)
  })

  it("filters the current variable token and completes it with the keyboard", async () => {
    const user = userEvent.setup()
    const onValueChange = renderInput()
    const input = screen.getByRole("combobox", { name: "Expression" }) as HTMLInputElement

    await user.type(input, "2 * #wi")

    expect(screen.getByRole("listbox", { name: "Available variables" })).toBeTruthy()
    expect(screen.getByRole("option", { name: /#width/ })).toBeTruthy()
    expect(screen.queryByRole("option", { name: /#wall/ })).toBeNull()
    expect(input.getAttribute("aria-expanded")).toBe("true")

    await user.keyboard("{Enter}")

    expect(input.value).toBe("2 * #width")
    expect(onValueChange).toHaveBeenLastCalledWith("2 * #width")
    expect(screen.queryByRole("listbox")).toBeNull()
    expect(document.activeElement).toBe(input)
  })

  it("replaces only the token at the caret when chosen with the pointer", () => {
    renderInput({ defaultValue: "2 * #wi + #height" })
    const input = screen.getByRole("combobox", { name: "Expression" }) as HTMLInputElement
    const caret = input.value.indexOf("#wi") + 3
    input.focus()
    input.setSelectionRange(caret, caret)
    fireEvent.select(input)

    fireEvent.pointerDown(screen.getByRole("option", { name: /#width/ }))

    expect(input.value).toBe("2 * #width + #height")
    expect(input.selectionStart).toBe("2 * #width".length)
  })

  it("accepts the active option with Tab and continues native focus order", async () => {
    const user = userEvent.setup()
    render(
      <I18nProvider i18n={i18n} initialLocale="en">
        <VariableExpressionInput aria-label="Expression" suggestions={suggestions} />
        <button type="button">Next control</button>
      </I18nProvider>,
    )
    const input = screen.getByRole("combobox", { name: "Expression" }) as HTMLInputElement
    await user.type(input, "#wa")

    await user.tab()

    expect(input.value).toBe("#wall")
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Next control" }))
  })

  it("closes suggestions with Escape without clearing the expression or reaching parents", async () => {
    const user = userEvent.setup()
    const onParentKeyDown = vi.fn()
    render(
      <I18nProvider i18n={i18n} initialLocale="en">
        <fieldset aria-label="Editor commands" onKeyDown={onParentKeyDown}>
          <VariableExpressionInput
            aria-label="Expression"
            suggestions={suggestions}
            excludedSuggestionId="height-id"
          />
        </fieldset>
      </I18nProvider>,
    )
    const input = screen.getByRole("combobox", { name: "Expression" }) as HTMLInputElement
    await user.type(input, "#")
    expect(screen.queryByRole("option", { name: /#height/ })).toBeNull()
    onParentKeyDown.mockClear()

    await user.keyboard("{Escape}")

    expect(input.value).toBe("#")
    expect(screen.queryByRole("listbox")).toBeNull()
    expect(onParentKeyDown).not.toHaveBeenCalled()
  })
})
