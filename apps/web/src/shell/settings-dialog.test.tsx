// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { I18nProvider } from "@vibeshape/i18n/provider"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { DocumentControllerState } from "../document/document-controller"
import { i18n } from "../i18n"
import { createTestBrowserStorage } from "../test-support/browser-storage"
import { SettingsDialog } from "./settings-dialog"
import { ViewerPreferencesProvider } from "./viewer-preferences"
import { WorkspaceLayoutPreferencesProvider } from "./workspace-layout-preferences"

const applyUnits = vi.hoisted(() => vi.fn())
vi.mock("../document/document-controller", async (original) => ({
  ...(await original<typeof import("../document/document-controller")>()),
  setActiveProjectDisplayUnits: applyUnits,
}))
const controller = {
  status: "ready",
  saveStatus: "saved",
  report: {
    mode: "read-write",
    snapshot: {
      id: "0195b5ac-b250-7a2c-8c33-000000000101",
      revision: 3,
      displayUnits: { length: "mm", angle: "deg" },
    },
  },
} as unknown as DocumentControllerState
beforeEach(() => {
  vi.stubGlobal("localStorage", createTestBrowserStorage())
  localStorage.clear()
  applyUnits.mockResolvedValue({ ok: true })
  vi.stubGlobal("matchMedia", () => ({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }))
  HTMLElement.prototype.scrollIntoView = vi.fn()
})
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  vi.unstubAllGlobals()
})
function setup(blocked = false) {
  return render(
    <I18nProvider i18n={i18n} initialLocale="en">
      <ViewerPreferencesProvider>
        <WorkspaceLayoutPreferencesProvider>
          <SettingsDialog controller={controller} blocked={blocked} />
        </WorkspaceLayoutPreferencesProvider>
      </ViewerPreferencesProvider>
    </I18nProvider>,
  )
}
async function choose(label: string, option: string) {
  fireEvent.keyDown(screen.getByRole("combobox", { name: label }), { key: "Enter" })
  await userEvent.click(await screen.findByRole("option", { name: option }))
}

describe("coherent browser and project settings", () => {
  it("changes browser preferences without committing project units and restores focus on close", async () => {
    setup()
    const trigger = screen.getByRole("button", { name: "Settings" })
    await userEvent.click(trigger)
    expect(screen.getAllByRole("dialog")).toHaveLength(1)
    const sources = screen.getByRole("link", {
      name: "Licenses and corresponding source (opens in a new tab)",
    })
    expect(sources.getAttribute("href")).toBe("/sources/index.html")
    expect(sources.getAttribute("target")).toBe("_blank")
    await choose("Theme", "Light")
    expect(document.documentElement.classList.contains("dark")).toBe(false)
    await choose("Preferred export format", "STEP")
    const autoHide = screen.getByRole("checkbox", {
      name: /Automatically hide sketches/,
    }) as HTMLInputElement
    expect(autoHide.checked).toBe(true)
    await userEvent.click(autoHide)
    expect(JSON.parse(localStorage.getItem("vibeshape.viewer-preferences.v1") ?? "null")).toEqual({
      version: 1,
      printerProfile: null,
      printBedVisible: false,
      groundGridVisible: true,
      theme: "light",
      autoHideConsumedSketches: false,
      preferredExportFormat: "step",
    })
    expect(applyUnits).not.toHaveBeenCalled()
    await userEvent.keyboard("{Escape}")
    expect(document.activeElement).toBe(trigger)
  })

  it("reuses revisioned unit Apply and prevents closing while that save is pending", async () => {
    let finish!: (value: { ok: true }) => void
    applyUnits.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve
      }),
    )
    setup()
    await userEvent.click(screen.getByRole("button", { name: "Settings" }))
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Length unit" }), "in")
    await userEvent.click(screen.getByRole("button", { name: "Apply project units" }))
    expect(applyUnits).toHaveBeenCalledWith(3, { length: "in", angle: "deg" })
    await userEvent.keyboard("{Escape}")
    expect(screen.getByRole("dialog", { name: "Settings" })).toBeTruthy()
    expect((screen.getByRole("button", { name: "Done" }) as HTMLButtonElement).disabled).toBe(true)
    finish({ ok: true })
    await waitFor(() =>
      expect((screen.getByRole("button", { name: "Done" }) as HTMLButtonElement).disabled).toBe(
        false,
      ),
    )
  })

  it("allows a failed project-unit save to be retried while the File save-error guard remains separate", async () => {
    applyUnits.mockResolvedValueOnce({ ok: false, diagnostic: { sourceCode: null } })
    setup()
    await userEvent.click(screen.getByRole("button", { name: "Settings" }))
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Length unit" }), "in")
    const apply = screen.getByRole("button", { name: "Apply project units" })
    await userEvent.click(apply)
    expect(await screen.findByRole("alert")).toBeTruthy()
    await waitFor(() => expect((apply as HTMLButtonElement).disabled).toBe(false))
    await userEvent.click(apply)
    await waitFor(() => expect(applyUnits).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull())
  })

  it("allows appearance changes while an active edit blocks project-unit mutation", async () => {
    setup(true)
    await userEvent.click(screen.getByRole("button", { name: "Settings" }))
    expect(
      (screen.getByRole("combobox", { name: "Length unit" }) as HTMLSelectElement).disabled,
    ).toBe(true)
    expect(
      (screen.getByRole("button", { name: "Apply project units" }) as HTMLButtonElement).disabled,
    ).toBe(true)
    await choose("Theme", "Light")
    expect(applyUnits).not.toHaveBeenCalled()
  })
})
