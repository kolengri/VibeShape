import "../../../../tests/unit/support/dom"
import { afterEach, expect, it } from "bun:test"
import { cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { I18nProvider } from "@vibeshape/i18n/provider"
import type { ComponentProps } from "react"
import { vi } from "../../../../tests/unit/support/bun-test"
import { i18n } from "../i18n"
import { RemoteAutomationConsentDialog, RemoteAutomationStatus } from "./remote-automation-status"

type Props = ComponentProps<typeof RemoteAutomationStatus>
afterEach(cleanup)
it("shows the exact consent client and return address, approves explicitly and denies on Escape", async () => {
  const consent = vi.fn().mockReturnValue(true)
  const connection = {
    consent,
    enable: vi.fn(),
    disable: vi.fn(),
    enableAutoApply: vi.fn(),
    disableAutoApply: vi.fn(),
    setProjectManagement: vi.fn(),
    validateDocumentScope: vi.fn(),
    isProjectActionPending: vi.fn(),
    configuration: vi.fn(),
    subscribe: vi.fn(),
    getSnapshot: vi.fn(),
    start: vi.fn(),
    dispose: vi.fn(),
  }
  const current: Props["current"] = {
    available: true,
    pairingCode: "ABCDEF0123456789",
    connected: false,
    connecting: false,
    autoApply: false,
    projectManagement: false,
    busy: false,
    client: null,
    error: false,
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
  const view = (state: Props["current"]) => (
    <I18nProvider i18n={i18n} initialLocale="en">
      <button type="button">Editor action</button>
      <RemoteAutomationStatus connection={connection} current={state} blocked={false} />
      <RemoteAutomationConsentDialog connection={connection} current={state} />
    </I18nProvider>
  )
  const rendered = render(view({ ...current, consent: null }))
  const editorAction = screen.getByRole("button", { name: "Editor action" })
  editorAction.focus()
  rendered.rerender(view(current))
  expect(screen.getByRole("dialog", { name: "Allow this client in this tab?" })).toBeTruthy()
  expect(screen.getByText("Return address: https://client.example/callback")).toBeTruthy()
  expect(screen.getByText("Client: CAD client")).toBeTruthy()
  expect(connection.enableAutoApply).not.toHaveBeenCalled()
  expect(consent).not.toHaveBeenCalled()
  await userEvent.click(screen.getByRole("button", { name: "Allow this client" }))
  expect(consent).toHaveBeenCalledWith(true)
  rendered.rerender(view({ ...current, consent: null }))
  await waitFor(() => expect(document.activeElement).toBe(editorAction))
  rendered.rerender(view(current))
  await userEvent.keyboard("{Escape}")
  expect(consent).toHaveBeenLastCalledWith(false)
  rendered.rerender(view({ ...current, consent: null }))
  await waitFor(() => expect(document.activeElement).toBe(editorAction))
  expect(connection.enableAutoApply).not.toHaveBeenCalled()
  rendered.rerender(view({ ...current, consent: null, connected: true }))
  await userEvent.click(
    screen.getByRole("button", { name: "Remote AI connection and approval mode" }),
  )
  await userEvent.click(screen.getByRole("menuitemcheckbox", { name: "Allow project management" }))
  expect(connection.setProjectManagement).toHaveBeenCalledWith(true)
  expect(connection.enableAutoApply).not.toHaveBeenCalled()
})
