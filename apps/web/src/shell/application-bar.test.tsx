// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { I18nProvider } from "@vibeshape/i18n/provider"
import { TooltipProvider } from "@vibeshape/ui/components/tooltip"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import type { DocumentControllerState } from "../document/document-controller"
import { i18n } from "../i18n"
import { createTestBrowserStorage } from "../test-support/browser-storage"
import { ApplicationBar } from "./application-bar"
import { ViewerPreferencesProvider } from "./viewer-preferences"
import { WorkspaceLayoutPreferencesProvider } from "./workspace-layout-preferences"

const work = vi.hoisted(() => ({ active: vi.fn(), register: vi.fn(() => () => {}) }))
vi.mock("../document/document-controller", async (original) => ({
  ...(await original<typeof import("../document/document-controller")>()),
  getProjectActionBlock: () => "save-error",
  getProjectActiveWorkBlock: work.active,
  registerProjectActionGuard: work.register,
}))
vi.mock("../document/document-export-dialog", () => ({ DocumentExportDialog: () => null }))
vi.mock("../document/document-rename-dialog", () => ({ DocumentRenameDialog: () => null }))
vi.mock("../automation/local-automation-connection", () => ({
  createLocalAutomationConnection: () => {
    const snapshot = { available: false, busy: false }
    return {
      getSnapshot: () => snapshot,
      subscribe: () => () => {},
      start: vi.fn(),
      status: vi.fn(),
      dispose: vi.fn(),
    }
  },
}))
vi.mock("../editor-session/editor-session-provider", () => {
  const state = { activePartDesignTool: null, sketch: { activeSketchTool: null, draft: null } }
  const store = { getState: () => state, subscribe: () => () => {} }
  return { useEditorSessionStoreApi: () => store }
})

beforeEach(() => {
  work.active.mockReturnValue(null)
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  )
  vi.stubGlobal("localStorage", createTestBrowserStorage())
  vi.stubGlobal("matchMedia", () => ({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }))
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

it("keeps File blocked after save failure while allowing unit retry only without concurrent active work", async () => {
  const controller = {
    status: "ready",
    saveStatus: "save-error",
    report: {
      mode: "read-write",
      snapshot: {
        id: "0195b5ac-b250-7a2c-8c33-000000000101",
        name: "Project",
        revision: 3,
        displayUnits: { length: "mm", angle: "deg" },
      },
    },
  } as unknown as DocumentControllerState
  function Header() {
    return (
      <I18nProvider i18n={i18n} initialLocale="en">
        <ViewerPreferencesProvider>
          <WorkspaceLayoutPreferencesProvider>
            <TooltipProvider>
              <ApplicationBar
                controller={controller}
                onOpenCommandPalette={vi.fn()}
                onOpenShortcutHelp={vi.fn()}
              />
            </TooltipProvider>
          </WorkspaceLayoutPreferencesProvider>
        </ViewerPreferencesProvider>
      </I18nProvider>
    )
  }
  const result = render(<Header />)
  await userEvent.click(screen.getByRole("button", { name: "File" }))
  expect(
    (screen.getByRole("button", { name: "Save project (.vshape)" }) as HTMLButtonElement).disabled,
  ).toBe(true)
  await userEvent.keyboard("{Escape}")
  await userEvent.click(screen.getByRole("button", { name: "Settings" }))
  const units = screen.getByRole("combobox", { name: "Length unit" }) as HTMLSelectElement
  expect(units.disabled).toBe(false)
  work.active.mockReturnValue("automation-busy")
  result.rerender(<Header />)
  expect(units.disabled).toBe(true)
  work.active.mockReturnValue("editor-draft")
  result.rerender(<Header />)
  expect(units.disabled).toBe(true)
  work.active.mockReturnValue(null)
  result.rerender(<Header />)
  expect(units.disabled).toBe(false)
})
