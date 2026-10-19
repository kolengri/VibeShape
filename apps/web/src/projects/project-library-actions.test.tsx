import "../../../../tests/unit/support/dom"
import { afterEach, beforeEach, expect, it } from "bun:test"
import type { DesktopCommand, DesktopHostBridge } from "@vibeshape/automation-api/desktop-host"
import { vi } from "../../../../tests/unit/support/bun-test"
import type { DocumentControllerState } from "../document/document-controller"

const { act, cleanup, fireEvent, render, screen } = await import("@testing-library/react")
const { I18nProvider } = await import("@vibeshape/i18n/provider")
const { default: userEvent } = await import("@testing-library/user-event")
const { TooltipProvider } = await import("@vibeshape/ui/components/tooltip")
const { i18n } = await import("../i18n")
const { createTestBrowserStorage } = await import("../test-support/browser-storage")
const { ViewerPreferencesProvider } = await import("../shell/viewer-preferences")
const { WorkspaceLayoutPreferencesProvider } = await import("../shell/workspace-layout-preferences")
const { ProjectLibraryPageLayout } = await import("./project-library-page-layout")

const listeners = new Set<(command: DesktopCommand) => void>()
const state = vi.fn()
const host: DesktopHostBridge = {
  protocolVersion: 1,
  platform: "darwin",
  windowChrome: "unified",
  async getMcpSetup() {
    return {
      protocolVersion: 1,
      mcpServers: {
        vibeshape: {
          command: "/VibeShape",
          args: ["/mcp.cjs", "--descriptor", "/private/descriptor.json"],
          env: { ELECTRON_RUN_AS_NODE: "1" },
        },
      },
    }
  },
  onCommand(listener) {
    listeners.add(listener)
    return () => listeners.delete(listener)
  },
  async updateCommandState(value) {
    state(value)
  },
  async editText() {},
}
const controller: DocumentControllerState = {
  status: "library",
  saveStatus: "saved",
  diagnostic: null,
  report: null,
}
beforeEach(() => {
  window.vibeshapeDesktop = host
  vi.stubGlobal("localStorage", createTestBrowserStorage())
  vi.stubGlobal("matchMedia", () => ({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }))
  HTMLElement.prototype.scrollIntoView = vi.fn()
})
afterEach(() => {
  cleanup()
  delete window.vibeshapeDesktop
  listeners.clear()
  state.mockClear()
  vi.unstubAllGlobals()
})
function landing() {
  return render(
    <I18nProvider i18n={i18n} initialLocale="en">
      <TooltipProvider>
        <ViewerPreferencesProvider>
          <WorkspaceLayoutPreferencesProvider>
            <ProjectLibraryPageLayout
              controller={controller}
              title="Projects"
              description="Local projects"
            >
              <p>Project chooser content</p>
            </ProjectLibraryPageLayout>
          </WorkspaceLayoutPreferencesProvider>
        </ViewerPreferencesProvider>
      </TooltipProvider>
    </I18nProvider>,
  )
}
it("opens global Settings from the native menu on the project chooser without enabling editor commands", async () => {
  landing()
  expect(state).toHaveBeenCalledWith({ scope: "application", enabled: ["settings", "faq"] })
  expect(screen.getByRole("heading", { level: 1, name: "Projects" })).not.toBeNull()
  await act(async () => {
    for (const listener of listeners) listener("settings")
  })
  const dialog = screen.getByRole("dialog", { name: "Settings" })
  expect(dialog).not.toBeNull()
  expect(screen.getByRole("tab", { name: "Appearance" })).not.toBeNull()
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Done" }))
  })
  expect(screen.queryByRole("dialog", { name: "Settings" })).toBeNull()
  await userEvent.click(screen.getByRole("button", { name: "Application menu" }))
  expect(screen.queryByRole("menuitem", { name: "Projects…" })).toBeNull()
  expect(screen.queryByRole("menuitem", { name: "Export model…" })).toBeNull()
  expect(screen.queryByRole("menuitem", { name: "Extensions…" })).toBeNull()
  await userEvent.click(screen.getByRole("menuitem", { name: "Settings…" }))
  expect(screen.getByRole("dialog", { name: "Settings" })).not.toBeNull()
  await userEvent.click(screen.getByRole("button", { name: "Done" }))
  expect(document.activeElement).toBe(screen.getByRole("button", { name: "Application menu" }))
})
