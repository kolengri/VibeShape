// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { I18nProvider } from "@vibeshape/i18n/provider"
import { TooltipProvider } from "@vibeshape/ui/components/tooltip"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import type { createRemoteAutomationConnection } from "../automation/remote-automation-connection"
import type { DocumentControllerState } from "../document/document-controller"
import { i18n } from "../i18n"
import { createTestBrowserStorage } from "../test-support/browser-storage"
import { ApplicationBar } from "./application-bar"
import { AutomationConnectionsProvider, AutomationEditorScope } from "./automation-status"
import { StatusBar } from "./status-bar"
import { ViewerPreferencesProvider } from "./viewer-preferences"
import { WorkspaceLayoutPreferencesProvider } from "./workspace-layout-preferences"

const work = vi.hoisted(() => ({
  active: vi.fn(),
  register: vi.fn((_guard: () => unknown) => () => {}),
  disable: vi.fn(),
  remoteDisable: vi.fn(),
  remoteConsent: vi.fn(),
  localValidate: vi.fn(),
  remoteValidate: vi.fn(),
  localProjectPending: vi.fn(() => false),
  remoteProjectPending: vi.fn(() => false),
  remote: {
    available: false,
    connected: false,
    connecting: false,
    busy: false,
    autoApply: false,
    projectManagement: false,
    client: null,
    pairingCode: null,
    consent: null,
    error: false,
  } as ReturnType<ReturnType<typeof createRemoteAutomationConnection>["getSnapshot"]>,
  local: {
    available: false,
    busy: false,
    connected: false,
    recovering: false,
    autoApply: false,
    projectManagement: false,
    client: null,
  },
}))
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
    const snapshot = work.local
    return {
      getSnapshot: () => snapshot,
      subscribe: () => () => {},
      start: vi.fn(),
      status: vi.fn(),
      dispose: vi.fn(),
      disable: work.disable,
      validateDocumentScope: work.localValidate,
      isProjectActionPending: work.localProjectPending,
    }
  },
}))
vi.mock("../automation/remote-automation-connection", () => ({
  createRemoteAutomationConnection: () => ({
    getSnapshot: () => work.remote,
    subscribe: () => () => {},
    start: vi.fn(),
    dispose: vi.fn(),
    disable: work.remoteDisable,
    consent: work.remoteConsent,
    validateDocumentScope: work.remoteValidate,
    isProjectActionPending: work.remoteProjectPending,
  }),
}))
vi.mock("../editor-session/editor-session-provider", () => {
  const state = { activePartDesignTool: null, sketch: { activeSketchTool: null, draft: null } }
  const store = { getState: () => state, subscribe: () => () => {} }
  return { useEditorSessionStoreApi: () => store }
})

beforeEach(() => {
  work.local = {
    available: false,
    busy: false,
    connected: false,
    recovering: false,
    autoApply: false,
    projectManagement: false,
    client: null,
  }
  work.disable.mockReset()
  work.remoteDisable.mockReset()
  work.remoteConsent.mockReset()
  work.localValidate.mockClear()
  work.remoteValidate.mockClear()
  work.localProjectPending.mockReturnValue(false)
  work.remoteProjectPending.mockReturnValue(false)
  work.register.mockClear()
  work.remote = {
    available: false,
    connected: false,
    connecting: false,
    busy: false,
    autoApply: false,
    projectManagement: false,
    client: null,
    pairingCode: null,
    consent: null,
    error: false,
  }
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
              <AutomationConnectionsProvider controller={controller}>
                <AutomationEditorScope />
                <ApplicationBar
                  controller={controller}
                  onOpenCommandPalette={vi.fn()}
                  onOpenShortcutHelp={vi.fn()}
                />
              </AutomationConnectionsProvider>
            </TooltipProvider>
          </WorkspaceLayoutPreferencesProvider>
        </ViewerPreferencesProvider>
      </I18nProvider>
    )
  }
  const result = render(<Header />)
  await userEvent.click(screen.getByRole("button", { name: "Application menu" }))
  await userEvent.click(screen.getByRole("menuitem", { name: "Files and projects…" }))
  expect(
    (screen.getByRole("button", { name: "Save project (.vshape)" }) as HTMLButtonElement).disabled,
  ).toBe(true)
  await userEvent.keyboard("{Escape}")
  await userEvent.click(screen.getByRole("button", { name: "Application menu" }))
  await userEvent.click(screen.getByRole("menuitem", { name: "Settings…" }))
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

function renderHeader(
  onOpenCommandPalette = vi.fn(),
  onOpenShortcutHelp = vi.fn(),
  hideModelExport = false,
) {
  const controller = {
    status: "ready",
    saveStatus: "saved",
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
  const element = () => (
    <I18nProvider i18n={i18n} initialLocale="en">
      <ViewerPreferencesProvider>
        <WorkspaceLayoutPreferencesProvider>
          <TooltipProvider>
            <AutomationConnectionsProvider controller={controller}>
              <AutomationEditorScope />
              <ApplicationBar
                controller={controller}
                hideModelExport={hideModelExport}
                onOpenCommandPalette={onOpenCommandPalette}
                onOpenShortcutHelp={onOpenShortcutHelp}
              />
              <StatusBar controller={controller} selectedOriginPlane={null} selection={null} />
            </AutomationConnectionsProvider>
          </TooltipProvider>
        </WorkspaceLayoutPreferencesProvider>
      </ViewerPreferencesProvider>
    </I18nProvider>
  )
  const result = render(element())
  return { ...result, refresh: () => result.rerender(element()) }
}

it("opens help from the keyboard and restores focus to the closed application menu", async () => {
  renderHeader()
  const user = userEvent.setup()
  const trigger = screen.getByRole("button", { name: "Application menu" })
  trigger.focus()
  await user.keyboard("{Enter}")
  expect(screen.getByRole("group", { name: "Project" })).toBeTruthy()
  expect(screen.getByRole("group", { name: "Workspace" })).toBeTruthy()
  expect(screen.getByRole("group", { name: "Help" })).toBeTruthy()
  await user.keyboard("f{Enter}")
  expect(screen.getByRole("dialog", { name: "VibeShape FAQ" })).toBeTruthy()
  await user.keyboard("{Escape}")
  expect(screen.queryByRole("dialog")).toBeNull()
  expect(screen.queryByRole("menu")).toBeNull()
  expect(document.activeElement).toBe(trigger)
})

it("invokes palette and shortcut help with the persistent menu trigger as the return target", async () => {
  const palette = vi.fn(),
    shortcuts = vi.fn()
  renderHeader(palette, shortcuts)
  const user = userEvent.setup()
  const trigger = screen.getByRole("button", { name: "Application menu" })
  await user.click(trigger)
  await user.click(screen.getByRole("menuitem", { name: /^Commands/ }))
  expect(palette).toHaveBeenCalledWith(trigger)
  expect(screen.queryByRole("menu")).toBeNull()
  await user.click(trigger)
  await user.click(screen.getByRole("menuitem", { name: /Keyboard shortcuts/ }))
  expect(shortcuts).toHaveBeenCalledWith(trigger)
})

it("keeps AI status and neutral Stop AI in the footer instead of the application header", async () => {
  work.local = {
    available: true,
    busy: false,
    connected: true,
    recovering: false,
    autoApply: true,
    projectManagement: false,
    client: null,
  }
  renderHeader()
  expect(screen.queryByRole("button", { name: "Remote AI…" })).toBeNull()
  const stop = screen.getByRole("button", { name: "Stop AI" })
  expect(stop.closest("footer")).toBeTruthy()
  expect(stop.closest("header")).toBeNull()
  expect(stop.className).not.toContain("bg-destructive")
  await userEvent.click(stop)
  expect(work.disable).toHaveBeenCalledTimes(1)
  expect(work.remoteDisable).toHaveBeenCalledTimes(1)
  await userEvent.click(screen.getByRole("button", { name: "Application menu" }))
  expect(screen.queryByRole("menuitem", { name: "AI connections…" })).toBeNull()
})

it("keeps Stop AI available when the local bridge is offline during approved recovery", async () => {
  work.local = { ...work.local, available: false, connected: false, recovering: true }
  renderHeader()
  expect(screen.getByText("Reconnecting AI…").closest("footer")).toBeTruthy()
  await userEvent.click(screen.getByRole("button", { name: "Stop AI" }))
  expect(work.disable).toHaveBeenCalledOnce()
  expect(work.remoteDisable).toHaveBeenCalledOnce()
})

it("lets the initiating project action pass its guard while another busy transport remains blocking", () => {
  renderHeader()
  const guard = work.register.mock.calls.at(-1)?.[0]
  if (!guard) throw new Error("Missing project action guard.")
  expect(work.localValidate).toHaveBeenCalledOnce()
  expect(work.remoteValidate).toHaveBeenCalledOnce()
  work.local.busy = true
  expect(guard()).toBe("automation-busy")
  work.localProjectPending.mockReturnValue(true)
  expect(guard()).toBeNull()
  work.remote = { ...work.remote, busy: true }
  expect(guard()).toBe("automation-busy")
  work.remoteProjectPending.mockReturnValue(true)
  expect(guard()).toBe("automation-busy")
  work.local.busy = false
  expect(guard()).toBeNull()
  expect(work.remoteDisable).not.toHaveBeenCalled()
})

it("stops both connections when a remote pairing hides an already connected local client", async () => {
  work.local = {
    available: true,
    busy: false,
    connected: true,
    recovering: false,
    autoApply: true,
    projectManagement: false,
    client: null,
  }
  work.remote = {
    ...work.remote,
    available: true,
    connected: true,
    pairingCode: "ABCDEF0123456789",
  }
  renderHeader()
  expect(screen.getAllByRole("button", { name: "Stop AI" })).toHaveLength(1)
  await userEvent.click(screen.getByRole("button", { name: "Stop AI" }))
  expect(work.disable).toHaveBeenCalledOnce()
  expect(work.remoteDisable).toHaveBeenCalledOnce()
})

it("keeps local AI status and Stop visible while remote pairing is still awaiting authorization", async () => {
  work.local = {
    available: true,
    busy: false,
    connected: true,
    recovering: false,
    autoApply: true,
    projectManagement: false,
    client: null,
  }
  work.remote = {
    ...work.remote,
    available: true,
    connected: false,
    pairingCode: "ABCDEF0123456789",
  }
  renderHeader()
  expect(screen.getByText("AI on · Auto-apply on").closest("footer")).toBeTruthy()
  await userEvent.click(screen.getByRole("button", { name: "Stop AI" }))
  expect(work.disable).toHaveBeenCalledOnce()
  expect(work.remoteDisable).toHaveBeenCalledOnce()
})

it("shows incoming remote consent while the application menu and connection settings are closed", async () => {
  const header = renderHeader()
  expect(screen.queryByRole("menu")).toBeNull()
  expect(screen.queryByRole("dialog")).toBeNull()
  work.remote = {
    ...work.remote,
    available: true,
    consent: {
      type: "consent",
      requestId: "69a2b4b3-322c-4154-bae6-bfafb86b4255",
      client: {
        clientId: "verified-client",
        name: "CAD client",
        redirectUri: "https://client.example/callback",
      },
    },
  }
  header.refresh()
  expect(screen.getByRole("dialog", { name: "Allow this client in this tab?" })).toBeTruthy()
  expect(screen.queryByRole("menu")).toBeNull()
  await userEvent.keyboard("{Escape}")
  expect(work.remoteConsent).toHaveBeenCalledWith(false)
  work.remote = { ...work.remote, consent: null }
  header.refresh()
  await waitFor(() =>
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Application menu" })),
  )
})

it.each([
  ["Import geometry…", "Import geometry"],
  ["Import sketch…", "Import sketch curves"],
  ["Library…", "Local component library"],
])("opens %s from the application menu and restores focus after closing", async (item, title) => {
  renderHeader()
  const user = userEvent.setup()
  const trigger = screen.getByRole("button", { name: "Application menu" })
  await user.click(trigger)
  await user.click(screen.getByRole("menuitem", { name: item }))
  expect(screen.getByRole("dialog", { name: title })).toBeTruthy()
  expect(screen.queryByRole("menu")).toBeNull()
  await user.keyboard("{Escape}")
  expect(screen.queryByRole("dialog")).toBeNull()
  expect(document.activeElement).toBe(trigger)
})

it("hides Model export in Assembly mode while retaining source and library entry points", async () => {
  renderHeader(vi.fn(), vi.fn(), true)
  await userEvent.click(screen.getByRole("button", { name: "Application menu" }))
  expect(screen.queryByRole("menuitem", { name: "Export…" })).toBeNull()
  for (const name of ["Import geometry…", "Import sketch…", "Library…"])
    expect(screen.getByRole("menuitem", { name })).toBeTruthy()
})
