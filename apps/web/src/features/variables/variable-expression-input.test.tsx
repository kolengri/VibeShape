// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { I18nProvider } from "@vibeshape/i18n/provider"
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
