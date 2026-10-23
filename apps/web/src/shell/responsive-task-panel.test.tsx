import "../../../../tests/unit/support/dom"

import { afterEach, describe, expect, it } from "bun:test"
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { I18nProvider } from "@vibeshape/i18n/provider"
import { vi } from "../../../../tests/unit/support/bun-test"
import { TaskPanelLayout } from "../components/task-panel-layout"
import { i18n } from "../i18n"
import { ResponsiveTaskPanel } from "./responsive-task-panel"

function setCompactLayout(matches: boolean) {
  let compact = matches
  const listeners = new Set<() => void>()
  vi.stubGlobal(
    "matchMedia",
    vi.fn().mockImplementation((query: string) => ({
      addEventListener: (_event: string, listener: () => void) => {
        if (query === "(width < 64rem)") listeners.add(listener)
      },
      dispatchEvent: vi.fn(),
      matches: query === "(width < 64rem)" && compact,
      media: query,
      onchange: null,
      removeEventListener: (_event: string, listener: () => void) => listeners.delete(listener),
    })),
  )
  return (next: boolean) => {
    act(() => {
      compact = next
      for (const listener of listeners) listener()
    })
  }
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe("ResponsiveTaskPanel", () => {
  it("retains the explicit choice for the same task and resets scroll only for a fresh task", async () => {
    setCompactLayout(true)
    const user = userEvent.setup()
    const panel = (taskKey: string, autoExpandActiveTask = true) => (
      <ResponsiveTaskPanel
        activeTaskKey={taskKey}
        autoExpandActiveTask={autoExpandActiveTask}
        collapseLabel="Collapse task panel"
        expandLabel="Open task panel"
      >
        <aside aria-label="Task panel">
          <TaskPanelLayout title="Cylinder">
            <input aria-label="Radius" defaultValue="10 mm" />
          </TaskPanelLayout>
        </aside>
      </ResponsiveTaskPanel>
    )
    const { rerender } = render(panel("cylinder:first"), {
      wrapper: ({ children }) => <I18nProvider i18n={i18n}>{children}</I18nProvider>,
    })
    const input = screen.getByRole<HTMLInputElement>("textbox", { name: "Radius" })
    const scroller = input.closest<HTMLElement>("[data-slot='task-panel-content']")
    if (!scroller) throw new Error("Expected the task field scrollport.")
    const content = input.closest(".responsive-task-panel__content")
    await user.clear(input)
    await user.type(input, "27 mm")
    scroller.scrollTop = 150
    const collapse = screen.getByRole("button", { name: "Collapse task panel" })
    fireEvent.click(collapse)
    expect(document.activeElement).toBe(collapse)
    expect(content).toHaveProperty("hidden", true)

    rerender(panel("cylinder:first", false))
    rerender(panel("cylinder:first", true))
    expect(content).toHaveProperty("hidden", true)
    expect(scroller.scrollTop).toBe(150)
    await user.click(screen.getByRole("button", { name: "Open task panel" }))
    rerender(panel("cylinder:first", false))
    expect(content).toHaveProperty("hidden", false)
    expect(scroller.scrollTop).toBe(150)

    rerender(panel("cylinder:second"))
    expect(content).toHaveProperty("hidden", false)
    expect(screen.getByRole("button", { name: "Collapse task panel" })).toBeTruthy()
    expect(scroller.scrollTop).toBe(0)
    expect(screen.getByRole("textbox", { name: "Radius" })).toBe(input)
    expect(input.value).toBe("27 mm")
  })

  it("preserves compact collapse choice and mounted input across wide layout round trips", async () => {
    const changeCompact = setCompactLayout(true)
    const user = userEvent.setup()
    render(
      <ResponsiveTaskPanel
        activeTaskKey="edit-cylinder"
        collapseLabel="Collapse task panel"
        expandLabel="Open task panel"
      >
        <aside aria-label="Task panel">
          <input aria-label="Radius" defaultValue="10 mm" />
        </aside>
      </ResponsiveTaskPanel>,
    )
    const input = screen.getByRole<HTMLInputElement>("textbox", { name: "Radius" })
    await user.clear(input)
    await user.type(input, "31 mm")
    const content = input.closest(".responsive-task-panel__content")
    await user.click(screen.getByRole("button", { name: "Collapse task panel" }))
    changeCompact(false)
    expect(content).toHaveProperty("hidden", false)
    expect(screen.getByRole("textbox", { name: "Radius" })).toBe(input)
    changeCompact(true)
    expect(content).toHaveProperty("hidden", true)
    expect(screen.getByRole("button", { name: "Open task panel" })).toBeTruthy()
    await user.click(screen.getByRole("button", { name: "Open task panel" }))
    changeCompact(false)
    changeCompact(true)
    expect(content).toHaveProperty("hidden", false)
    expect(screen.getByRole("textbox", { name: "Radius" })).toBe(input)
    expect(input.value).toBe("31 mm")
  })

  it("keeps an idle compact panel collapsed until requested", async () => {
    setCompactLayout(true)
    const user = userEvent.setup()
    render(
      <ResponsiveTaskPanel
        activeTaskKey={null}
        collapseLabel="Collapse task panel"
        expandLabel="Open task panel"
      >
        <aside aria-label="Task panel">Task content</aside>
      </ResponsiveTaskPanel>,
    )

    expect(
      screen.getByRole("button", { name: "Open task panel" }).getAttribute("aria-expanded"),
    ).toBe("false")
    expect(
      screen.getByText("Task content").closest(".responsive-task-panel__content"),
    ).toHaveProperty("hidden", true)

    await user.click(screen.getByRole("button", { name: "Open task panel" }))

    expect(
      screen.getByText("Task content").closest(".responsive-task-panel__content"),
    ).toHaveProperty("hidden", false)
    expect(
      screen.getByRole("button", { name: "Collapse task panel" }).getAttribute("aria-expanded"),
    ).toBe("true")
  })

  it("preserves form input while a compact active panel is collapsed", async () => {
    setCompactLayout(true)
    const user = userEvent.setup()
    render(
      <ResponsiveTaskPanel
        activeTaskKey="create-revolve"
        collapseLabel="Collapse task panel"
        expandLabel="Open task panel"
      >
        <aside aria-label="Task panel">
          <label htmlFor="angle">Angle</label>
          <input defaultValue="360 deg" id="angle" />
        </aside>
      </ResponsiveTaskPanel>,
    )

    const angle = screen.getByRole("textbox", { name: "Angle" })
    await user.clear(angle)
    await user.type(angle, "125 deg")
    await user.click(screen.getByRole("button", { name: "Collapse task panel" }))
    await user.click(screen.getByRole("button", { name: "Open task panel" }))

    expect(screen.getByRole<HTMLInputElement>("textbox", { name: "Angle" }).value).toBe("125 deg")
  })

  it("automatically opens a compact panel when a task starts", () => {
    setCompactLayout(true)
    const { rerender } = render(
      <ResponsiveTaskPanel
        activeTaskKey={null}
        collapseLabel="Collapse task panel"
        expandLabel="Open task panel"
      >
        <aside aria-label="Task panel">Task content</aside>
      </ResponsiveTaskPanel>,
    )

    rerender(
      <ResponsiveTaskPanel
        activeTaskKey="create-sketch"
        collapseLabel="Collapse task panel"
        expandLabel="Open task panel"
      >
        <aside aria-label="Task panel">Task content</aside>
      </ResponsiveTaskPanel>,
    )

    expect(
      screen.getByText("Task content").closest(".responsive-task-panel__content"),
    ).toHaveProperty("hidden", false)
  })

  it("keeps a canvas-first task collapsed when its active state changes", () => {
    setCompactLayout(true)
    const { rerender } = render(
      <ResponsiveTaskPanel
        activeTaskKey={null}
        autoExpandActiveTask={false}
        collapseLabel="Collapse task panel"
        expandLabel="Open task panel"
      >
        <aside aria-label="Task panel">Sketch details</aside>
      </ResponsiveTaskPanel>,
    )

    rerender(
      <ResponsiveTaskPanel
        activeTaskKey="sketch:edit"
        autoExpandActiveTask={false}
        collapseLabel="Collapse task panel"
        expandLabel="Open task panel"
      >
        <aside aria-label="Task panel">Sketch details</aside>
      </ResponsiveTaskPanel>,
    )

    expect(
      screen.getByText("Sketch details").closest(".responsive-task-panel__content"),
    ).toHaveProperty("hidden", true)
    expect(screen.getByRole("button", { name: "Open task panel" })).toBeTruthy()
  })
})
