import "../../../../tests/unit/support/dom"
import { afterEach, beforeEach, expect, it, mock } from "bun:test"
import type { DesktopHostBridge, DesktopMcpSetup } from "@vibeshape/automation-api/desktop-host"
import { vi } from "../../../../tests/unit/support/bun-test"
import type { createLocalAutomationConnection } from "../automation/local-automation-connection"

type LocalSnapshot = ReturnType<ReturnType<typeof createLocalAutomationConnection>["getSnapshot"]>
let external: LocalSnapshot | null = null
const restart = vi.fn(async () => true)
mock.module("../shell/automation-status", () => ({
  useOptionalAutomationConnections: () =>
    external ? { external, externalConnection: { enable: restart } } : null,
}))

const { act, cleanup, fireEvent, render, screen, waitFor } = await import("@testing-library/react")
const { I18nProvider } = await import("@vibeshape/i18n/provider")
const { i18n } = await import("../i18n")
const { DesktopMcpSettings } = await import("./desktop-mcp-settings")
const setup: DesktopMcpSetup = {
  protocolVersion: 1,
  mcpServers: {
    vibeshape: {
      command: "/Applications/VibeShape.app/Contents/MacOS/VibeShape",
      args: [
        "/Applications/VibeShape.app/Contents/Resources/app/mcp.cjs",
        "--descriptor",
        "/private/profile/desktop-mcp.json",
      ],
      env: { ELECTRON_RUN_AS_NODE: "1" },
    },
  },
}
const host: DesktopHostBridge = {
  protocolVersion: 1,
  platform: "darwin",
  windowChrome: "unified",
  async getMcpSetup() {
    return setup
  },
  onCommand() {
    return () => {}
  },
  async updateCommandState() {},
  async editText() {},
}
const originalClipboard = Object.getOwnPropertyDescriptor(navigator, "clipboard")
beforeEach(() => {
  external = null
  restart.mockClear()
})
afterEach(() => {
  cleanup()
  delete window.vibeshapeDesktop
  if (originalClipboard) Object.defineProperty(navigator, "clipboard", originalClipboard)
  else Reflect.deleteProperty(navigator, "clipboard")
})
function renderSettings() {
  return render(
    <I18nProvider i18n={i18n} initialLocale="en">
      <DesktopMcpSettings />
    </I18nProvider>,
  )
}

it("offers native configuration without a secret and releases the copy lock after failure", async () => {
  window.vibeshapeDesktop = host
  const writeText = vi.fn(async (_value: string): Promise<void> => {
    throw new Error("Private clipboard diagnostic")
  })
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } })
  renderSettings()
  const button = await screen.findByRole("button", { name: "Copy configuration" })
  await waitFor(() => expect(button.hasAttribute("disabled")).toBe(false))
  const text = screen.getByRole("textbox")
  expect(text.textContent).toBe(JSON.stringify({ mcpServers: setup.mcpServers }, null, 2))
  fireEvent.click(button)
  await waitFor(() =>
    expect(screen.getByRole("status").textContent).toContain(
      "Select and copy the configuration above.",
    ),
  )
  expect(screen.queryByText("Private clipboard diagnostic")).toBeNull()
  expect(button.hasAttribute("disabled")).toBe(false)
  writeText.mockResolvedValue(undefined)
  await act(async () => {
    fireEvent.click(button)
  })
  await waitFor(() => expect(screen.getByRole("status").textContent).toContain("copied"))
  expect(writeText).toHaveBeenLastCalledWith(
    JSON.stringify({ mcpServers: setup.mcpServers }, null, 2),
  )
})

it("keeps native setup unavailable in a normal web browser", () => {
  renderSettings()
  expect(screen.queryByRole("textbox")).toBeNull()
  expect(screen.queryByRole("button", { name: "Copy configuration" })).toBeNull()
})

it.each([
  { recoveryBlocked: false, recoveryFailed: true },
  { recoveryBlocked: true, recoveryFailed: false },
  { recoveryBlocked: true, recoveryFailed: true },
])("distinguishes failed access from intentional Stop: %j", async (recovery) => {
  window.vibeshapeDesktop = host
  external = {
    available: true,
    connected: false,
    recovering: false,
    autoApply: false,
    projectManagement: false,
    defaultAccess: true,
    busy: false,
    client: { name: "Test CAD client", version: "1" },
    error: recovery.recoveryFailed,
    ...recovery,
  }
  await act(async () => {
    renderSettings()
  })
  const stopped =
    "Local MCP access is stopped. Restart it to share the current project with the connected client."
  const failed =
    "Local MCP connection failed. Check the connected client, then restart local MCP to share the current project."
  expect(screen.queryByText(recovery.recoveryBlocked ? stopped : failed)).not.toBeNull()
  expect(screen.queryByText(recovery.recoveryBlocked ? failed : stopped)).toBeNull()
  expect(screen.queryByRole("button", { name: "Enable AI session" })).toBeNull()
  expect(restart).not.toHaveBeenCalled()
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Restart local MCP" }))
  })
  expect(restart).toHaveBeenCalledTimes(1)
})
