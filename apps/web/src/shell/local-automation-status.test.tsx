// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { I18nProvider } from "@vibeshape/i18n/provider"
import type { ComponentProps } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { i18n } from "../i18n"
import { LocalAutomationStatus } from "./local-automation-status"

type Props = ComponentProps<typeof LocalAutomationStatus>

const manual: Props["current"] = {
  available: true,
  connected: true,
  autoApply: false,
  busy: false,
  client: { name: "Test CAD client", version: "1" },
  error: false,
}

function setup(current: Props["current"] = manual) {
  const connection = {
    enable: vi.fn().mockResolvedValue(true),
    disable: vi.fn().mockResolvedValue(undefined),
    enableAutoApply: vi.fn().mockReturnValue(true),
  }
  const content = (snapshot: Props["current"]) => (
    <I18nProvider i18n={i18n} initialLocale="en">
      <LocalAutomationStatus connection={connection} current={snapshot} />
    </I18nProvider>
  )
  const result = render(content(current))
  return {
    connection,
    rerender: (snapshot: Props["current"]) => result.rerender(content(snapshot)),
  }
}

afterEach(cleanup)

describe("local AI auto-apply controls", () => {
  it("offers explicit setup only after pairing and preserves manual session actions", async () => {
    const { connection, rerender } = setup({ ...manual, connected: false })
    expect(screen.queryByRole("button", { name: "Set up auto-apply" })).toBeNull()
    await userEvent.click(screen.getByRole("button", { name: "Enable AI session" }))
    expect(connection.enable).toHaveBeenCalledOnce()
    expect(connection.enableAutoApply).not.toHaveBeenCalled()
    rerender(manual)
    expect(screen.getByRole("button", { name: "Disable AI session" })).toBeTruthy()
    await userEvent.click(screen.getByRole("button", { name: "Set up auto-apply" }))
    expect(screen.getByRole("dialog", { name: "Set up auto-apply" })).toBeTruthy()
    expect(screen.getByText(/only for this project and this paired AI session/)).toBeTruthy()
    expect(screen.getByText(/with Undo/)).toBeTruthy()
    expect(
      screen.getByText(/Destructive and unknown commands still require manual review/),
    ).toBeTruthy()
    expect(screen.getByText(/grants no additional export, printing, or access/)).toBeTruthy()
    expect(connection.enableAutoApply).not.toHaveBeenCalled()
  })

  it("keeps rejected setup visible and enables only after explicit successful confirmation", async () => {
    const { connection } = setup()
    connection.enableAutoApply.mockReturnValueOnce(false)
    await userEvent.click(screen.getByRole("button", { name: "Set up auto-apply" }))
    await userEvent.click(screen.getByRole("button", { name: "Enable auto-apply" }))
    expect(screen.getByRole("alert").textContent).toBe(
      "Wait for the current AI operation or review to finish, then try again.",
    )
    expect(screen.getByRole("dialog")).toBeTruthy()
    await userEvent.click(screen.getByRole("button", { name: "Enable auto-apply" }))
    expect(connection.enableAutoApply).toHaveBeenCalledTimes(2)
    expect(screen.queryByRole("dialog")).toBeNull()
  })

  it("closes setup on disconnect and supports cancellation with focus restoration", async () => {
    const { rerender } = setup()
    const trigger = screen.getByRole("button", { name: "Set up auto-apply" })
    await userEvent.click(trigger)
    await userEvent.keyboard("{Escape}")
    expect(screen.queryByRole("dialog")).toBeNull()
    expect(document.activeElement).toBe(trigger)
    await userEvent.click(trigger)
    rerender({ ...manual, connected: false })
    expect(screen.queryByRole("dialog")).toBeNull()
  })

  it("exposes the active indicator and stops the whole AI session without another confirmation", async () => {
    const { connection } = setup({ ...manual, autoApply: true })
    expect(screen.getByRole("status").textContent).toBe("Auto-apply on")
    expect(screen.queryByRole("button", { name: "Set up auto-apply" })).toBeNull()
    await userEvent.click(screen.getByRole("button", { name: "Stop AI" }))
    expect(connection.disable).toHaveBeenCalledOnce()
    expect(screen.queryByRole("dialog")).toBeNull()
  })
})
