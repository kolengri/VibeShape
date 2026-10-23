import "../../../../tests/unit/support/dom"
import { afterEach, beforeEach, expect, it } from "bun:test"
import { act, cleanup, render, screen } from "@testing-library/react"
import { I18nProvider } from "@vibeshape/i18n/provider"
import { vi } from "../../../../tests/unit/support/bun-test"
import { i18n } from "../i18n"
import { createTestBrowserStorage } from "../test-support/browser-storage"
import {
  useWorkspaceLayoutPreferences,
  WorkspaceLayoutPreferencesProvider,
} from "./workspace-layout-preferences"
import { WorkspacePanels } from "./workspace-panels"

beforeEach(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  )
  vi.stubGlobal("matchMedia", () => ({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }))
  vi.stubGlobal("localStorage", createTestBrowserStorage())
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

function Preferences() {
  const { taskWidth, taskCollapsed } = useWorkspaceLayoutPreferences((state) => state)
  return (
    <output data-testid="task-preferences">
      {taskWidth}:{String(taskCollapsed)}
    </output>
  )
}
function Fixture({ active, interactive = true }: { active: boolean; interactive?: boolean }) {
  return (
    <I18nProvider i18n={i18n} initialLocale="en">
      <WorkspaceLayoutPreferencesProvider>
        <WorkspacePanels
          allowTransparency={false}
          interactive={interactive}
          taskPanelActive={active}
          modelTree={<aside>Parts</aside>}
          taskPanel={
            <aside>
              <input aria-label="Task value" defaultValue="12 mm" />
            </aside>
          }
        >
          <button type="button">Viewport</button>
        </WorkspacePanels>
        <Preferences />
      </WorkspaceLayoutPreferencesProvider>
    </I18nProvider>
  )
}

it("reclaims an idle task panel without overwriting layout preferences or remounting viewport and form", async () => {
  const view = render(<Fixture active />)
  const viewport = screen.getByRole("button", { name: "Viewport" })
  const input = screen.getByRole<HTMLInputElement>("textbox", { name: "Task value" })
  input.value = "28 mm"
  view.rerender(<Fixture active={false} />)
  await act(async () => {
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
  })
  expect(view.container.querySelector("[data-task-active]")?.getAttribute("data-task-active")).toBe(
    "false",
  )
  expect(view.container.querySelector(".workspace-panel--task")?.hasAttribute("inert")).toBe(true)
  expect(screen.getByTestId("task-preferences").textContent).toBe("320:false")
  expect(viewport.isConnected).toBe(true)
  view.rerender(<Fixture active />)
  expect(view.container.querySelector(".workspace-panel--task")?.hasAttribute("inert")).toBe(false)
  expect(screen.getByRole("textbox", { name: "Task value" })).toBe(input)
  expect(input.value).toBe("28 mm")
  expect(screen.getByRole("button", { name: "Viewport" })).toBe(viewport)
})

it("keeps the narrow model-tree toggle available while no task is active", () => {
  vi.stubGlobal("matchMedia", () => ({
    matches: true,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }))
  render(<Fixture active={false} />)
  expect(screen.getByRole("button", { name: "Show model tree" })).toBeTruthy()
})

it.each([false, true])(
  "keeps loading panel controls inert at narrow=%s without hiding viewport feedback",
  (narrow) => {
    vi.stubGlobal("matchMedia", () => ({
      matches: narrow,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }))
    const view = render(<Fixture active={false} interactive={false} />)
    const group = view.container.querySelector('[data-slot="resizable-panel-group"]')
    expect(group?.hasAttribute("inert")).toBe(true)
    expect(group?.getAttribute("aria-hidden")).toBe("true")
    expect(screen.queryByRole("separator")).toBeNull()
    expect(screen.queryByRole("button", { name: "Show model tree" })).toBeNull()
    expect(screen.getByRole("button", { name: "Viewport" })).toBeTruthy()

    view.rerender(<Fixture active={false} />)
    expect(group?.hasAttribute("inert")).toBe(false)
    if (narrow) expect(screen.getByRole("button", { name: "Show model tree" })).toBeTruthy()
    else expect(screen.getByRole("separator")).toBeTruthy()
  },
)
