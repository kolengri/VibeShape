/** @vitest-environment jsdom */

import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"
import { ResponsiveTaskPanel } from "./responsive-task-panel"

function setCompactLayout(matches: boolean) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn().mockImplementation((query: string) => ({
      addEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
      matches: query === "(width < 64rem)" && matches,
      media: query,
      onchange: null,
      removeEventListener: vi.fn(),
    })),
  )
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe("ResponsiveTaskPanel", () => {
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
