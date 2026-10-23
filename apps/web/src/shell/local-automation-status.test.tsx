import "../../../../tests/unit/support/dom"
import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { I18nProvider } from "@vibeshape/i18n/provider"
import type { ComponentProps } from "react"
import { vi } from "../../../../tests/unit/support/bun-test"
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
  await userEvent.click(
    screen.getByRole("button", { name: "Local MCP connection and approval mode" }),
  )
  await userEvent.click(screen.getByRole("menuitemradio", { name: "Apply automatically" }))
}

beforeEach(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  )
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe("local AI auto-apply controls", () => {
  it.each([false, true])(
    "shows internal automatic access without approval or project-management setup (busy: %s)",
    async (busy) => {
      const { connection } = setup({
        ...manual,
        projectBound: true,
        autoApply: true,
        busy,
        client: { name: "Embedded assistant", version: "1" },
      })
      expect(screen.getByRole("status").textContent).toBe("AI access on · Auto-apply on")
      const info = screen.getByRole("button", { name: "Built-in assistant connection" })
      await userEvent.click(info)
      expect(
        screen.getByRole("dialog", { name: "Built-in assistant connection" }).textContent,
      ).toBe("Embedded assistant")
      expect(screen.queryByRole("menuitemradio")).toBeNull()
      expect(
        screen.queryByRole("menuitemcheckbox", { name: "Allow project management" }),
      ).toBeNull()
      expect(screen.queryByText("Approve each change")).toBeNull()
      expect(screen.queryByText("Apply automatically")).toBeNull()
      expect(screen.queryByRole("dialog", { name: "Set up auto-apply" })).toBeNull()
      await userEvent.keyboard("{Escape}")
      expect(document.activeElement).toBe(info)
      await userEvent.click(screen.getByRole("button", { name: "Stop AI" }))
      expect(connection.disable).toHaveBeenCalledTimes(1)
      expect(connection.enable).not.toHaveBeenCalled()
      expect(connection.enableAutoApply).not.toHaveBeenCalled()
      expect(connection.disableAutoApply).not.toHaveBeenCalled()
      expect(connection.setProjectManagement).not.toHaveBeenCalled()
    },
  )

  it("does not claim automatic access for an internal snapshot that has not enabled it", () => {
    setup({ ...manual, projectBound: true })
    expect(screen.getByRole("status").textContent).toBe("AI on")
    expect(screen.queryByText("AI access on · Auto-apply on")).toBeNull()
    expect(screen.queryByText("Approve each change")).toBeNull()
  })

  it("explains why AI access is disabled until an MCP client is connected", async () => {
    const { connection, rerender } = setup({ ...manual, connected: false, client: null })
    const enable = screen.getByRole("button", { name: "Enable AI session" })
    expect(enable.textContent).toBe("AI access")
    expect(enable.getAttribute("data-variant")).toBe("ghost")
    expect(enable.hasAttribute("disabled")).toBe(true)
    expect(
      document.getElementById(enable.getAttribute("aria-describedby") ?? "")?.textContent,
    ).toBe("MCP client not connected")
    expect(enable.hasAttribute("title")).toBe(false)
    await userEvent.click(enable)
    expect(connection.enable).not.toHaveBeenCalled()

    rerender({ ...manual, connected: false })
    expect(enable.hasAttribute("disabled")).toBe(false)
    expect(enable.hasAttribute("aria-describedby")).toBe(false)
    expect(screen.queryByText("MCP client not connected")).toBeNull()
    expect(connection.enable).not.toHaveBeenCalled()
    await userEvent.click(enable)
    expect(connection.enable).toHaveBeenCalledTimes(1)
  })

  it("uses unobtrusive status-bar actions for active AI access and Stop AI", () => {
    setup()
    const settings = screen.getByRole("button", { name: "Local MCP connection and approval mode" })
    expect(settings.textContent).toBe("AI access on · Approve each change")
    expect(settings.getAttribute("data-variant")).toBe("ghost")
    expect(screen.getByRole("button", { name: "Stop AI" }).getAttribute("data-variant")).toBe(
      "ghost",
    )
  })

  it.each([false, true])(
    "keeps error diagnostics on the actual active status trigger (project bound: %s)",
    async (projectBound) => {
      const { connection } = setup({ ...manual, projectBound, error: true })
      const button = screen.getByRole("button", {
        name: projectBound
          ? "Built-in assistant connection"
          : "Local MCP connection and approval mode",
      })
      const diagnostic =
        "AI connection interrupted. An approved local session reconnects automatically while its approval remains valid."
      expect(button.classList.contains("text-destructive")).toBe(true)
      expect(
        screen.getAllByText(diagnostic).every((node) => node.classList.contains("sr-only")),
      ).toBe(true)
      expect(
        document.getElementById(button.getAttribute("aria-describedby") ?? "")?.textContent,
      ).toBe(diagnostic)
      await userEvent.hover(button)
      await waitFor(() => expect(screen.getByRole("tooltip").textContent).toBe(diagnostic))
      await userEvent.unhover(button)
      await waitFor(() => expect(screen.queryByRole("tooltip")).toBeNull())
      fireEvent.focus(button)
      expect(screen.getByRole("tooltip").textContent).toBe(diagnostic)
      await userEvent.click(button)
      expect(screen.getByRole(projectBound ? "dialog" : "menu")).toBeTruthy()
      await userEvent.keyboard("{Escape}")
      expect(document.activeElement).toBe(button)
      await userEvent.click(screen.getByRole("button", { name: "Stop AI" }))
      expect(connection.disable).toHaveBeenCalledTimes(1)
    },
  )

  it("exposes a disabled access diagnostic to keyboard focus and keeps the action inert", async () => {
    const { connection } = setup({ ...manual, connected: false, client: null, error: true })
    const button = screen.getByRole("button", { name: "Enable AI session" })
    expect(button.hasAttribute("disabled")).toBe(true)
    await userEvent.tab()
    expect(document.activeElement).toBe(button.parentElement)
    expect(screen.getByRole("tooltip").textContent).toContain("AI connection interrupted.")
    await userEvent.keyboard("{Enter}")
    expect(connection.enable).not.toHaveBeenCalled()
  })

  it("keeps recovery cancellation available with its full error diagnostic", async () => {
    const { connection, rerender } = setup({
      ...manual,
      connected: false,
      recovering: true,
      error: true,
    })
    const stop = screen.getByRole("button", { name: "Stop AI" })
    expect(stop.classList.contains("text-destructive")).toBe(true)
    fireEvent.focus(stop)
    expect(screen.getByRole("tooltip").textContent).toContain("AI connection interrupted.")
    await userEvent.click(stop)
    expect(connection.disable).toHaveBeenCalledTimes(1)
    rerender({ ...manual, error: false })
    expect(
      screen
        .getByRole("button", { name: "Local MCP connection and approval mode" })
        .classList.contains("text-destructive"),
    ).toBe(false)
    expect(screen.queryByText(/AI connection interrupted/)).toBeNull()
  })

  it("offers project management as a separate explicit grant with a described browser-local scope", async () => {
    const { connection, rerender } = setup()
    await userEvent.click(
      screen.getByRole("button", { name: "Local MCP connection and approval mode" }),
    )
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
    await userEvent.click(
      screen.getByRole("button", { name: "Local MCP connection and approval mode" }),
    )
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
    expect(connection.disable).toHaveBeenCalledTimes(1)
  })
  it("offers explicit setup only after pairing and preserves manual session actions", async () => {
    const { connection, rerender } = setup({ ...manual, connected: false })
    expect(
      screen.queryByRole("button", { name: "Local MCP connection and approval mode" }),
    ).toBeNull()
    await userEvent.click(screen.getByRole("button", { name: "Enable AI session" }))
    expect(connection.enable).toHaveBeenCalledTimes(1)
    expect(connection.enableAutoApply).not.toHaveBeenCalled()
    rerender(manual)
    expect(screen.getByRole("button", { name: "Stop AI" })).toBeTruthy()
    await openSetup()
    expect(screen.getByRole("dialog", { name: "Set up auto-apply" })).toBeTruthy()
    expect(screen.getByText(/remembered for this local AI client in this browser/)).toBeTruthy()
    expect(screen.getByText(/with Undo/)).toBeTruthy()
    expect(
      screen.getByText(
        /Metadata, imports, assembly, history, textures and unsupported commands still require manual review/,
      ),
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
    const trigger = screen.getByRole("button", { name: "Local MCP connection and approval mode" })
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
    expect(
      screen.getByRole("button", { name: "Local MCP connection and approval mode" }),
    ).toBeTruthy()
    await userEvent.click(screen.getByRole("button", { name: "Stop AI" }))
    expect(connection.disable).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole("dialog")).toBeNull()
  })
  it("switches to manual approval without disconnecting and restores menu focus", async () => {
    const { connection } = setup({ ...manual, autoApply: true })
    const trigger = screen.getByRole("button", { name: "Local MCP connection and approval mode" })
    trigger.focus()
    await userEvent.keyboard("{Enter}")
    expect(
      screen
        .getByRole("menuitemradio", { name: "Apply automatically" })
        .getAttribute("aria-checked"),
    ).toBe("true")
    await userEvent.click(screen.getByRole("menuitemradio", { name: "Approve each change" }))
    expect(connection.disableAutoApply).toHaveBeenCalledTimes(1)
    expect(connection.disable).not.toHaveBeenCalled()
    expect(document.activeElement).toBe(trigger)
  })

  it("blocks mode changes during an AI operation while keeping Stop AI available", async () => {
    const { connection } = setup({ ...manual, autoApply: true, busy: true })
    await userEvent.click(
      screen.getByRole("button", { name: "Local MCP connection and approval mode" }),
    )
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
    expect(connection.disable).toHaveBeenCalledTimes(1)
  })
})
