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
  recovering: false,
  autoApply: false,
  projectManagement: false,
  busy: false,
  client: { name: "Test CAD client", version: "1" },
  error: false,
}

function setup(current: Props["current"] = manual) {
  const connection = {
    enable: vi.fn().mockResolvedValue(true),
    disable: vi.fn().mockResolvedValue(undefined),
    enableAutoApply: vi.fn().mockReturnValue(true),
    disableAutoApply: vi.fn().mockReturnValue(true),
    setProjectManagement: vi.fn().mockReturnValue(true),
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

async function openSetup() {
  await userEvent.click(screen.getByRole("button", { name: "AI connection and approval mode" }))
  await userEvent.click(screen.getByRole("menuitemradio", { name: "Apply automatically" }))
}

afterEach(cleanup)

describe("local AI auto-apply controls", () => {
  it("explains why AI access is disabled until an MCP client is connected", async () => {
    const { connection, rerender } = setup({ ...manual, connected: false, client: null })
    const enable = screen.getByRole("button", { name: "Enable AI session" })
    expect(enable.textContent).toBe("AI access")
    expect(enable.getAttribute("data-variant")).toBe("outline")
    expect(enable.hasAttribute("disabled")).toBe(true)
    expect(
      document.getElementById(enable.getAttribute("aria-describedby") ?? "")?.textContent,
    ).toBe("MCP client not connected")
    expect(enable.title).toBe("Connect an MCP client, then enable AI access to this project.")
    await userEvent.click(enable)
    expect(connection.enable).not.toHaveBeenCalled()

    rerender({ ...manual, connected: false })
    expect(enable.hasAttribute("disabled")).toBe(false)
    expect(enable.hasAttribute("aria-describedby")).toBe(false)
    expect(screen.queryByText("MCP client not connected")).toBeNull()
    expect(connection.enable).not.toHaveBeenCalled()
    await userEvent.click(enable)
    expect(connection.enable).toHaveBeenCalledOnce()
  })

  it("keeps active AI access and Stop AI visibly styled as buttons", () => {
    setup()
    const settings = screen.getByRole("button", { name: "AI connection and approval mode" })
    expect(settings.textContent).toBe("AI access on · Approve each change")
    expect(settings.getAttribute("data-variant")).toBe("outline")
    expect(screen.getByRole("button", { name: "Stop AI" }).getAttribute("data-variant")).toBe(
      "outline",
    )
  })

  it("offers project management as a separate explicit grant with a described browser-local scope", async () => {
    const { connection, rerender } = setup()
    await userEvent.click(screen.getByRole("button", { name: "AI connection and approval mode" }))
    const grant = screen.getByRole("menuitemcheckbox", { name: "Allow project management" })
    expect(grant.getAttribute("aria-checked")).toBe("false")
    expect(
      document.getElementById(grant.getAttribute("aria-describedby") ?? "")?.textContent,
    ).toContain("list project names and create or open projects saved in this browser")
    await userEvent.click(grant)
    expect(connection.setProjectManagement).toHaveBeenCalledWith(true)
    expect(connection.enableAutoApply).not.toHaveBeenCalled()
    expect(connection.disable).not.toHaveBeenCalled()
    rerender({ ...manual, projectManagement: true })
    await userEvent.click(screen.getByRole("button", { name: "AI connection and approval mode" }))
    expect(
      screen
        .getByRole("menuitemcheckbox", { name: "Allow project management" })
        .getAttribute("aria-checked"),
    ).toBe("true")
    await userEvent.click(
      screen.getByRole("menuitemcheckbox", { name: "Allow project management" }),
    )
    expect(connection.setProjectManagement).toHaveBeenLastCalledWith(false)
  })

  it("keeps Stop AI available while an approved session is reconnecting", async () => {
    const { connection } = setup({ ...manual, connected: false, recovering: true })
    expect(screen.getByRole("status").textContent).toBe("Reconnecting AI…")
    expect(screen.queryByRole("button", { name: "Enable AI session" })).toBeNull()
    await userEvent.click(screen.getByRole("button", { name: "Stop AI" }))
    expect(connection.disable).toHaveBeenCalledOnce()
  })
  it("offers explicit setup only after pairing and preserves manual session actions", async () => {
    const { connection, rerender } = setup({ ...manual, connected: false })
    expect(screen.queryByRole("button", { name: "AI connection and approval mode" })).toBeNull()
    await userEvent.click(screen.getByRole("button", { name: "Enable AI session" }))
    expect(connection.enable).toHaveBeenCalledOnce()
    expect(connection.enableAutoApply).not.toHaveBeenCalled()
    rerender(manual)
    expect(screen.getByRole("button", { name: "Stop AI" })).toBeTruthy()
    await openSetup()
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
    await openSetup()
    await userEvent.click(screen.getByRole("button", { name: "Enable auto-apply" }))
    expect(screen.getByRole("alert").textContent).toBe(
      "Wait for the current AI operation or review to finish, then try again.",
    )
    expect(screen.getByRole("dialog")).toBeTruthy()
    await userEvent.click(screen.getByRole("button", { name: "Enable auto-apply" }))
    expect(connection.enableAutoApply).toHaveBeenCalledTimes(2)
    expect(screen.queryByRole("dialog")).toBeNull()
    expect(screen.queryByRole("alert")).toBeNull()
  })

  it("closes setup on disconnect and supports cancellation with focus restoration", async () => {
    const { rerender } = setup()
    const trigger = screen.getByRole("button", { name: "AI connection and approval mode" })
    await openSetup()
    await userEvent.keyboard("{Escape}")
    expect(screen.queryByRole("dialog")).toBeNull()
    expect(document.activeElement).toBe(trigger)
    await openSetup()
    rerender({ ...manual, connected: false })
    expect(screen.queryByRole("dialog")).toBeNull()
  })

  it("exposes the active indicator and stops the whole AI session without another confirmation", async () => {
    const { connection } = setup({ ...manual, autoApply: true })
    expect(screen.getByRole("status").textContent).toBe("AI access on · Auto-apply on")
    expect(screen.getByRole("button", { name: "AI connection and approval mode" })).toBeTruthy()
    await userEvent.click(screen.getByRole("button", { name: "Stop AI" }))
    expect(connection.disable).toHaveBeenCalledOnce()
    expect(screen.queryByRole("dialog")).toBeNull()
  })
  it("switches to manual approval without disconnecting and restores menu focus", async () => {
    const { connection } = setup({ ...manual, autoApply: true })
    const trigger = screen.getByRole("button", { name: "AI connection and approval mode" })
    trigger.focus()
    await userEvent.keyboard("{Enter}")
    expect(
      screen
        .getByRole("menuitemradio", { name: "Apply automatically" })
        .getAttribute("aria-checked"),
    ).toBe("true")
    await userEvent.click(screen.getByRole("menuitemradio", { name: "Approve each change" }))
    expect(connection.disableAutoApply).toHaveBeenCalledOnce()
    expect(connection.disable).not.toHaveBeenCalled()
    expect(document.activeElement).toBe(trigger)
  })

  it("blocks mode changes during an AI operation while keeping Stop AI available", async () => {
    const { connection } = setup({ ...manual, autoApply: true, busy: true })
    await userEvent.click(screen.getByRole("button", { name: "AI connection and approval mode" }))
    expect(
      screen
        .getByRole("menuitemradio", { name: "Approve each change" })
        .hasAttribute("data-disabled"),
    ).toBe(true)
    expect(
      screen
        .getByRole("menuitemcheckbox", { name: "Allow project management" })
        .hasAttribute("data-disabled"),
    ).toBe(true)
    expect(
      screen
        .getByRole("menuitemradio", { name: "Apply automatically" })
        .hasAttribute("data-disabled"),
    ).toBe(true)
    expect(connection.disableAutoApply).not.toHaveBeenCalled()
    await userEvent.keyboard("{Escape}")
    await userEvent.click(screen.getByRole("button", { name: "Stop AI" }))
    expect(connection.disable).toHaveBeenCalledOnce()
  })
})
