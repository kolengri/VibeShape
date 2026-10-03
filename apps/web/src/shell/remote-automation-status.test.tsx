// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { I18nProvider } from "@vibeshape/i18n/provider"
import type { ComponentProps } from "react"
import { afterEach, expect, it, vi } from "vitest"
import { i18n } from "../i18n"
import { RemoteAutomationStatus } from "./remote-automation-status"

type Props = ComponentProps<typeof RemoteAutomationStatus>
afterEach(cleanup)
it("shows the exact consent client and return address, approves explicitly and denies on Escape", async () => {
  const consent = vi.fn().mockReturnValue(true)
  const connection = {
    consent,
    enable: vi.fn(),
    disable: vi.fn(),
    enableAutoApply: vi.fn(),
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
      <RemoteAutomationStatus connection={connection} current={state} blocked={false} />
    </I18nProvider>
  )
  const rendered = render(view(current))
  expect(screen.getByRole("dialog", { name: "Allow this client in this tab?" })).toBeTruthy()
  expect(screen.getByText("Return address: https://client.example/callback")).toBeTruthy()
  expect(screen.getByText("Client: CAD client")).toBeTruthy()
  expect(connection.enableAutoApply).not.toHaveBeenCalled()
  expect(consent).not.toHaveBeenCalled()
  await userEvent.click(screen.getByRole("button", { name: "Allow this client" }))
  expect(consent).toHaveBeenCalledWith(true)
  rendered.rerender(view({ ...current, consent: null }))
  rendered.rerender(view(current))
  await userEvent.keyboard("{Escape}")
  expect(consent).toHaveBeenLastCalledWith(false)
  expect(connection.enableAutoApply).not.toHaveBeenCalled()
})
