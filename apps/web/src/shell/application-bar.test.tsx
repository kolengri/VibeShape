import "../../../../tests/unit/support/dom"
import { afterEach, beforeEach, expect, it, mock } from "bun:test"
import { vi } from "../../../../tests/unit/support/bun-test"
import type { createRemoteAutomationConnection } from "../automation/remote-automation-connection"
import type { DocumentControllerState } from "../document/document-controller"

const work = (() => ({
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
}))()
const originalModule1 = { ...(await import("../document/document-controller")) }
mock.module("../document/document-controller", () => ({
  ...originalModule1,
  getProjectActionBlock: () => "save-error",
  getProjectActiveWorkBlock: work.active,
  registerProjectActionGuard: work.register,
}))
mock.module("../document/document-export-dialog", () => ({ DocumentExportDialog: () => null }))
mock.module("../document/document-rename-dialog", () => ({ DocumentRenameDialog: () => null }))
mock.module("../automation/local-automation-connection", () => ({
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
mock.module("../automation/remote-automation-connection", () => ({
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
mock.module("../editor-session/editor-session-provider", () => {
  const state = { activePartDesignTool: null, sketch: { activeSketchTool: null, draft: null } }
  const store = { getState: () => state, subscribe: () => () => {} }
  return { useEditorSessionStoreApi: () => store }
})

const { cleanup, render, screen, waitFor } = await import("@testing-library/react")
const { default: userEvent } = await import("@testing-library/user-event")
const { I18nProvider } = await import("@vibeshape/i18n/provider")
const { TooltipProvider } = await import("@vibeshape/ui/components/tooltip")
const { i18n } = await import("../i18n")
const { createTestBrowserStorage } = await import("../test-support/browser-storage")
const { ApplicationBar } = await import("./application-bar")
const { ApplicationChromeProvider } = await import("./application-header")
const { AutomationConnectionsProvider, AutomationEditorScope } = await import("./automation-status")
const { StatusBar } = await import("./status-bar")
const { ViewerPreferencesProvider } = await import("./viewer-preferences")
const { WorkspaceLayoutPreferencesProvider } = await import("./workspace-layout-preferences")

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
  delete window.vibeshapeDesktop
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
  expect(
    screen.getByRole("menuitem", { name: "Save project (.vshape)" }).getAttribute("aria-disabled"),
  ).toBe("true")
  await userEvent.keyboard("{Escape}")
  await userEvent.click(screen.getByRole("button", { name: "Application menu" }))
  await userEvent.click(screen.getByRole("menuitem", { name: "Settings…" }))
  await userEvent.click(screen.getByRole("tab", { name: "Project units" }))
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
  controllerOverrides: Partial<DocumentControllerState> = {},
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
    ...controllerOverrides,
  } as unknown as DocumentControllerState
  const element = () => (
    <I18nProvider i18n={i18n} initialLocale="en">
      <ApplicationChromeProvider>
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
      </ApplicationChromeProvider>
    </I18nProvider>
  )
  const result = render(element())
  return { ...result, refresh: () => result.rerender(element()) }
}

it("keeps the saved idle status quiet while announcing loading, saving, and failure", () => {
  const header = renderHeader()
  const status = screen.getByRole("status", { name: "Project save status" })
  expect(status.textContent).toBe("Saved")
  expect(status.classList.contains("sr-only")).toBe(true)
  expect(status.classList.contains("sm:not-sr-only")).toBe(false)
  expect(header.container.querySelector("[data-global-loader]")).toBeNull()
  header.unmount()
  const loading = renderHeader(undefined, undefined, false, { status: "loading", report: null })
  expect(screen.getByText("Opening local document…")).toBeTruthy()
  loading.unmount()
  const saving = renderHeader(undefined, undefined, false, { saveStatus: "saving" })
  expect(screen.getByText("Saving…")).toBeTruthy()
  expect(
    screen.getByRole("status", { name: "Project save status" }).classList.contains("sr-only"),
  ).toBe(true)
  expect(saving.container.querySelectorAll("[data-global-loader]")).toHaveLength(1)
  const wordmark = saving.container.querySelector("[data-application-wordmark]")
  expect(wordmark?.textContent).toBe("VibeShape")
  expect(wordmark?.getAttribute("aria-busy")).toBe("true")
  expect(saving.container.querySelector("[data-global-loader]")?.textContent).toBe("VibeShape")
  saving.unmount()
  const failed = renderHeader(undefined, undefined, false, { saveStatus: "save-error" })
  expect(screen.getByText("Could not save")).toBeTruthy()
  expect(failed.container.querySelector("[data-global-loader]")).toBeNull()
})

it("releases the native traffic-light inset only while the macOS window reports fullscreen", async () => {
  let update: ((fullScreen: boolean) => void) | undefined
  const unsubscribe = vi.fn()
  window.vibeshapeDesktop = {
    protocolVersion: 1,
    platform: "darwin",
    windowChrome: "unified",
    getMcpSetup: async () => {
      throw new Error("Not used")
    },
    onCommand: () => () => {},
    updateCommandState: async () => {},
    editText: async () => {},
    onFullScreenChange: (listener) => {
      update = listener
      listener(false)
      return unsubscribe
    },
  }
  const header = renderHeader()
  const bar = header.container.querySelector("header.application-bar")
  expect(bar?.hasAttribute("data-unified-chrome")).toBe(true)
  expect(bar?.getAttribute("data-full-screen")).toBe("false")
  const { act } = await import("@testing-library/react")
  act(() => update?.(true))
  expect(bar?.getAttribute("data-full-screen")).toBe("true")
  act(() => update?.(false))
  expect(bar?.getAttribute("data-full-screen")).toBe("false")
  header.unmount()
  expect(unsubscribe).toHaveBeenCalledTimes(1)
})

it("reports an unavailable project instead of a saved document after opening fails", () => {
  renderHeader(undefined, undefined, false, { status: "error", report: null })
  expect(screen.getByText("Project unavailable", { exact: true })).toBeTruthy()
  expect(screen.queryByText("Saved in this browser", { exact: true })).toBeNull()
})

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
  expect(work.disable).toHaveBeenCalledTimes(1)
  expect(work.remoteDisable).toHaveBeenCalledTimes(1)
})

it("lets the initiating project action pass its guard while another busy transport remains blocking", () => {
  renderHeader()
  const guard = work.register.mock.calls.at(-1)?.[0]
  if (!guard) throw new Error("Missing project action guard.")
  expect(work.localValidate).toHaveBeenCalledTimes(1)
  expect(work.remoteValidate).toHaveBeenCalledTimes(1)
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
  expect(work.disable).toHaveBeenCalledTimes(1)
  expect(work.remoteDisable).toHaveBeenCalledTimes(1)
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
  expect(screen.getByText("AI access on · Auto-apply on").closest("footer")).toBeTruthy()
  await userEvent.click(screen.getByRole("button", { name: "Stop AI" }))
  expect(work.disable).toHaveBeenCalledTimes(1)
  expect(work.remoteDisable).toHaveBeenCalledTimes(1)
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
