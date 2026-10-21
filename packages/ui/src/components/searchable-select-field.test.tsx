import "../../../../tests/unit/support/dom"
import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { FocusEvent } from "react"
import { vi } from "../../../../tests/unit/support/bun-test"
import { SearchableSelectField, type SearchableSelectOption } from "./searchable-select-field"

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

const copy = {
  label: "Target body",
  placeholder: "Choose a body",
  searchPlaceholder: "Search bodies…",
  emptyMessage: "No matching bodies",
}
const options: readonly SearchableSelectOption[] = [
  { value: "block", label: "Housing", keywords: ["cube"], group: "Solids" },
  { value: "disabled", label: "Unavailable body", disabled: true, group: "Solids" },
  { value: "shaft", label: "Shaft", description: "Main drive cylinder", group: "Solids" },
]

function nativeSelect(form: HTMLFormElement) {
  return form.elements.namedItem("target") as HTMLSelectElement
}

describe("SearchableSelectField", () => {
  it("supports uncontrolled selection, named submission, current-item identification and reset", async () => {
    const user = userEvent.setup()
    const change = mock(() => {})
    render(
      <form aria-label="Parameters">
        <SearchableSelectField
          {...copy}
          name="target"
          defaultValue="shaft"
          options={options}
          onValueChange={change}
        />
        <button type="reset">Reset</button>
      </form>,
    )
    const form = screen.getByRole("form", { name: "Parameters" }) as HTMLFormElement
    const trigger = screen.getByRole("combobox", { name: "Target body" })
    expect(new FormData(form).get("target")).toBe("shaft")
    expect(trigger.textContent).toContain("Shaft")
    await user.click(trigger)
    expect(screen.getByRole("option", { name: "Shaft" }).getAttribute("aria-current")).toBe("true")
    await user.type(screen.getByRole("combobox", { name: "Search bodies…" }), "cube")
    expect(screen.queryByRole("option", { name: "Shaft" })).toBeNull()
    await user.keyboard("{Enter}")
    expect(change).toHaveBeenCalledWith("block")
    expect(new FormData(form).get("target")).toBe("block")
    expect(trigger.textContent).toContain("Housing")
    expect(document.activeElement === trigger).toBe(true)
    await user.click(screen.getByRole("button", { name: "Reset" }))
    expect(new FormData(form).get("target")).toBe("shaft")
    expect(trigger.textContent).toContain("Shaft")
    await user.click(screen.getByRole("button", { name: "Reset" }))
    expect(new FormData(form).get("target")).toBe("shaft")
  })

  it("keeps controlled value ownership with the caller", async () => {
    const user = userEvent.setup()
    const change = mock(() => {})
    const view = render(
      <SearchableSelectField {...copy} value="block" options={options} onValueChange={change} />,
    )
    const trigger = screen.getByRole("combobox", { name: "Target body" })
    await user.click(trigger)
    await user.click(screen.getByRole("option", { name: "Shaft" }))
    expect(change).toHaveBeenCalledWith("shaft")
    expect(trigger.textContent).toContain("Housing")
    view.rerender(
      <SearchableSelectField {...copy} value="shaft" options={options} onValueChange={change} />,
    )
    expect(trigger.textContent).toContain("Shaft")
  })

  it.each(["controlled", "uncontrolled"] as const)(
    "closes unchanged %s selections without notifying the caller",
    async (mode) => {
      const user = userEvent.setup()
      const change = mock(() => {})
      const valueProps = mode === "controlled" ? { value: "block" } : { defaultValue: "block" }
      const view = render(
        <SearchableSelectField
          {...copy}
          {...valueProps}
          options={options}
          onValueChange={change}
        />,
      )
      const trigger = screen.getByRole("combobox", { name: "Target body" })
      await user.click(trigger)
      await user.click(screen.getByRole("option", { name: "Housing" }))
      expect(change).not.toHaveBeenCalled()
      expect(screen.queryByRole("listbox")).toBeNull()
      expect(document.activeElement === trigger).toBe(true)
      await user.click(trigger)
      await user.keyboard("{Enter}")
      expect(change).not.toHaveBeenCalled()
      expect(screen.queryByRole("listbox")).toBeNull()
      expect(document.activeElement === trigger).toBe(true)

      await user.click(trigger)
      await user.click(screen.getByRole("option", { name: "Shaft" }))
      expect(change).toHaveBeenCalledTimes(1)
      expect(change).toHaveBeenLastCalledWith("shaft")
      if (mode === "controlled")
        view.rerender(
          <SearchableSelectField
            {...copy}
            value="shaft"
            options={options}
            onValueChange={change}
          />,
        )
      await user.click(trigger)
      await user.click(screen.getByRole("option", { name: "Shaft" }))
      expect(change).toHaveBeenCalledTimes(1)
      expect(trigger.textContent).toContain("Shaft")
      expect(screen.queryByRole("listbox")).toBeNull()
    },
  )

  it("navigates enabled results by keyboard and never commits on hover", async () => {
    const user = userEvent.setup()
    const change = mock(() => {})
    render(<SearchableSelectField {...copy} options={options} onValueChange={change} />)
    const trigger = screen.getByRole("combobox", { name: "Target body" })
    trigger.focus()
    await user.keyboard("{ArrowDown}")
    expect(
      document.activeElement === screen.getByRole("combobox", { name: "Search bodies…" }),
    ).toBe(true)
    const shaft = screen.getByRole("option", { name: "Shaft" })
    await user.hover(shaft)
    expect(change).not.toHaveBeenCalled()
    await user.keyboard("{Home}{ArrowDown}{Enter}")
    expect(change).toHaveBeenCalledTimes(1)
    expect(change).toHaveBeenCalledWith("shaft")
    await user.click(trigger)
    await user.keyboard("{Escape}")
    expect(document.activeElement === trigger).toBe(true)
    expect(screen.queryByRole("listbox")).toBeNull()
  })

  it("rejects disabled and stale results after filtering, including an empty result set", async () => {
    const user = userEvent.setup()
    const change = mock(() => {})
    render(<SearchableSelectField {...copy} options={options} onValueChange={change} />)
    await user.click(screen.getByRole("combobox", { name: "Target body" }))
    fireEvent.click(screen.getByRole("option", { name: "Unavailable body" }))
    expect(change).not.toHaveBeenCalled()
    const search = screen.getByRole("combobox", { name: "Search bodies…" })
    await user.type(search, "shaft")
    expect(screen.getAllByRole("option")).toHaveLength(1)
    await user.clear(search)
    await user.type(search, "no-such-body")
    expect(screen.queryByRole("option")).toBeNull()
    expect(screen.getByText("No matching bodies")).toBeTruthy()
    await user.keyboard("{Enter}")
    expect(change).not.toHaveBeenCalled()
    await user.clear(search)
    await user.type(search, "HOUSING")
    await user.keyboard("{Enter}")
    expect(change).toHaveBeenCalledWith("block")
  })

  it("distinguishes duplicate labels by their values and keyword aliases", async () => {
    const user = userEvent.setup()
    const change = mock(() => {})
    render(
      <SearchableSelectField
        {...copy}
        options={[
          { value: "right body", label: "Housing", keywords: ["right"], description: "Right half" },
          { value: "left body", label: "Housing", keywords: ["left"], description: "Left half" },
        ]}
        onValueChange={change}
      />,
    )
    await user.click(screen.getByRole("combobox", { name: "Target body" }))
    await user.type(screen.getByRole("combobox", { name: "Search bodies…" }), "left")
    const result = screen.getByRole("option", { name: "Housing" })
    expect(screen.getAllByRole("option")).toHaveLength(1)
    expect(
      document.getElementById(result.getAttribute("aria-describedby") ?? "")?.textContent,
    ).toBe("Left half")
    await user.keyboard("{Enter}")
    expect(change).toHaveBeenCalledWith("left body")
  })

  it("filters duplicate labels by their visible description and provenance group", async () => {
    const user = userEvent.setup()
    const change = mock(() => {})
    render(
      <SearchableSelectField
        {...copy}
        options={[
          { value: "left", label: "Housing", description: "Left half", group: "Extrude 1" },
          { value: "right", label: "Housing", description: "Right half", group: "Split 2" },
        ]}
        onValueChange={change}
      />,
    )
    await user.click(screen.getByRole("combobox", { name: "Target body" }))
    const search = screen.getByRole("combobox", { name: "Search bodies…" })
    await user.type(search, "right half")
    expect(screen.getAllByRole("option")).toHaveLength(1)
    expect(screen.getByText("Right half")).toBeTruthy()
    await user.clear(search)
    await user.type(search, "split 2")
    expect(screen.getAllByRole("option")).toHaveLength(1)
    await user.keyboard("{Enter}")
    expect(change).toHaveBeenCalledWith("right")
  })

  it("retains native required validation, clear selection, and missing current references", async () => {
    const user = userEvent.setup()
    const view = render(
      <form aria-label="Parameters">
        <SearchableSelectField
          {...copy}
          name="target"
          required
          options={[{ value: "", label: "Clear body" }, ...options]}
        />
      </form>,
    )
    const form = screen.getByRole("form", { name: "Parameters" }) as HTMLFormElement
    const trigger = screen.getByRole("combobox", { name: "Target body" })
    expect(nativeSelect(form).required).toBe(true)
    expect(form.checkValidity()).toBe(false)
    expect(document.activeElement === trigger).toBe(true)
    await user.click(trigger)
    await user.click(screen.getByRole("option", { name: "Housing" }))
    expect(form.checkValidity()).toBe(true)
    await user.click(trigger)
    await user.click(screen.getByRole("option", { name: "Clear body" }))
    expect(new FormData(form).get("target")).toBe("")
    expect(form.checkValidity()).toBe(false)
    view.rerender(
      <form aria-label="Parameters">
        <SearchableSelectField {...copy} name="target" required value="missing-body" options={[]} />
      </form>,
    )
    expect(new FormData(form).get("target")).toBe("missing-body")
    expect(trigger.textContent).toContain("Choose a body")
  })

  it("associates labels, descriptions and errors, and disables interaction and submission", async () => {
    const user = userEvent.setup()
    const change = mock(() => {})
    render(
      <form aria-label="Parameters">
        <SearchableSelectField
          {...copy}
          id="body"
          name="target"
          disabled
          required
          options={options}
          defaultValue="block"
          description="Choose a committed solid."
          error="The body is unavailable."
          onValueChange={change}
        />
      </form>,
    )
    const trigger = screen.getByRole("combobox", { name: "Target body" }) as HTMLButtonElement
    expect(trigger.disabled).toBe(true)
    expect(trigger.getAttribute("aria-required")).toBe("true")
    expect(trigger.getAttribute("aria-invalid")).toBe("true")
    expect(trigger.getAttribute("aria-describedby")).toBe("body-description body-error")
    expect(screen.getByRole("alert").textContent).toBe("The body is unavailable.")
    await user.click(trigger)
    expect(screen.queryByRole("listbox")).toBeNull()
    expect(change).not.toHaveBeenCalled()
    const form = screen.getByRole("form", { name: "Parameters" }) as HTMLFormElement
    expect(new FormData(form).has("target")).toBe(false)
  })

  it("returns to surrounding tab order in both directions", async () => {
    const user = userEvent.setup()
    const blur = mock(() => {})
    render(
      <>
        <button type="button">Before</button>
        <SearchableSelectField {...copy} options={options} onBlur={blur} />
        <button type="button">After</button>
      </>,
    )
    const trigger = screen.getByRole("combobox", { name: "Target body" })
    await user.click(trigger)
    await user.keyboard("{Tab}")
    expect(document.activeElement?.textContent).toBe("After")
    expect(screen.queryByRole("listbox")).toBeNull()
    expect(blur).toHaveBeenCalled()
    await user.click(trigger)
    await user.keyboard("{Shift>}{Tab}{/Shift}")
    expect(document.activeElement?.textContent).toBe("Before")
  })

  it("reports blur only when focus leaves the trigger and its popup, with the trigger event contract", async () => {
    const user = userEvent.setup()
    const events: {
      target: EventTarget
      currentTarget: EventTarget
      relatedTarget: EventTarget | null
    }[] = []
    const blur = mock((event: FocusEvent<HTMLButtonElement>) => {
      events.push({
        target: event.target,
        currentTarget: event.currentTarget,
        relatedTarget: event.relatedTarget,
      })
    })
    render(
      <>
        <SearchableSelectField {...copy} options={options} onBlur={blur} />
        <button type="button">After</button>
      </>,
    )
    const trigger = screen.getByRole("combobox", { name: "Target body" })
    const after = screen.getByRole("button", { name: "After" })
    await user.click(trigger)
    expect(blur).toHaveBeenCalledTimes(0)
    await user.type(screen.getByRole("combobox", { name: "Search bodies…" }), "shaft")
    expect(blur).toHaveBeenCalledTimes(0)
    await user.keyboard("{Enter}")
    expect(document.activeElement === trigger).toBe(true)
    expect(blur).toHaveBeenCalledTimes(0)
    await user.click(trigger)
    await user.keyboard("{Escape}")
    expect(blur).toHaveBeenCalledTimes(0)
    await user.click(trigger)
    await user.keyboard("{Tab}")
    expect(document.activeElement === after).toBe(true)
    expect(blur).toHaveBeenCalledTimes(1)
    expect(events[0]?.target === trigger).toBe(true)
    expect(events[0]?.currentTarget === trigger).toBe(true)
    expect(events[0]?.relatedTarget === after).toBe(true)
    await user.click(trigger)
    await user.click(after)
    expect(blur).toHaveBeenCalledTimes(2)
    expect(events[1]?.relatedTarget === after).toBe(true)
    await user.click(trigger)
    await user.keyboard("{Escape}{Tab}")
    expect(blur).toHaveBeenCalledTimes(3)
  })

  it("preserves decorative artwork in options and the selected trigger without changing search or names", async () => {
    const user = userEvent.setup()
    render(
      <SearchableSelectField
        {...copy}
        defaultValue="block"
        options={[
          {
            value: "block",
            label: "Housing",
            icon: <span data-testid="body-artwork">Decorative artwork</span>,
          },
        ]}
      />,
    )
    const trigger = screen.getByRole("combobox", { name: "Target body" })
    expect(
      trigger.querySelector('[data-testid="body-artwork"]')?.closest('[aria-hidden="true"]'),
    ).toBeTruthy()
    await user.click(trigger)
    const option = screen.getByRole("option", { name: "Housing" })
    expect(
      option.querySelector('[data-testid="body-artwork"]')?.closest('[aria-hidden="true"]'),
    ).toBeTruthy()
    expect(screen.getAllByTestId("body-artwork")).toHaveLength(2)
    await user.type(screen.getByRole("combobox", { name: "Search bodies…" }), "artwork")
    expect(screen.queryByRole("option")).toBeNull()
    expect(screen.getByText("No matching bodies")).toBeTruthy()
  })

  it("reduces a 200-item object list to one exact keyword result without truncating long labels", async () => {
    const user = userEvent.setup()
    const longLabel =
      "Assembly mounting bracket with an unusually long but meaningful component name"
    const manyOptions = Array.from({ length: 200 }, (_, index) => ({
      value: `body-${index}`,
      label: index === 173 ? longLabel : `Body ${index}`,
      keywords: [`part-${index}`],
    }))
    const change = mock(() => {})
    render(<SearchableSelectField {...copy} options={manyOptions} onValueChange={change} />)
    await user.click(screen.getByRole("combobox", { name: "Target body" }))
    expect(screen.getAllByRole("option")).toHaveLength(200)
    await user.type(screen.getByRole("combobox", { name: "Search bodies…" }), "part-173")
    expect(screen.getAllByRole("option")).toHaveLength(1)
    expect(screen.getByRole("option", { name: longLabel }).textContent).toContain(longLabel)
    await user.keyboard("{Enter}")
    expect(change).toHaveBeenCalledWith("body-173")
    expect(screen.getByRole("combobox", { name: "Target body" }).textContent).toContain(longLabel)
  })
})
