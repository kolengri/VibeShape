import "../../../../tests/unit/support/dom"
import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test"
import { vi } from "../../../../tests/unit/support/bun-test"
import type { DocumentControllerState } from "../document/document-controller"

const applyUnits = (() => vi.fn())()
const originalModule1 = { ...(await import("../document/document-controller")) }
mock.module("../document/document-controller", () => ({
  ...originalModule1,
  setActiveProjectDisplayUnits: applyUnits,
}))

const { cleanup, fireEvent, render, screen, waitFor } = await import("@testing-library/react")
const { default: userEvent } = await import("@testing-library/user-event")
const { I18nProvider } = await import("@vibeshape/i18n/provider")
const { i18n } = await import("../i18n")
const { createTestBrowserStorage } = await import("../test-support/browser-storage")
const { SettingsDialog } = await import("./settings-dialog")
const { ViewerPreferencesProvider } = await import("./viewer-preferences")
const { WorkspaceLayoutPreferencesProvider } = await import("./workspace-layout-preferences")
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
  it("shows one category at a time and navigates categories with the keyboard", async () => {
    setup()
    await userEvent.click(screen.getByRole("button", { name: "Settings" }))
    expect(screen.getAllByRole("tab")).toHaveLength(7)
    expect(screen.getAllByRole("tabpanel")).toHaveLength(1)
    expect(screen.getByRole("tabpanel", { name: "Appearance" })).toBeTruthy()
    expect(screen.queryByRole("combobox", { name: "Length unit" })).toBeNull()
    screen.getByRole("tab", { name: "Appearance" }).focus()
    await userEvent.keyboard("{ArrowRight}")
    await waitFor(() =>
      expect(screen.getByRole("tab", { name: "Workspace" }).getAttribute("aria-selected")).toBe(
        "true",
      ),
    )
    expect(screen.getAllByRole("tabpanel")).toHaveLength(1)
    expect(screen.getByRole("tabpanel", { name: "Workspace" })).toBeTruthy()
    await userEvent.keyboard("{End}")
    await waitFor(() =>
      expect(screen.getByRole("tabpanel", { name: "About VibeShape" })).toBeTruthy(),
    )
    await userEvent.keyboard("{Home}")
    await waitFor(() => expect(screen.getByRole("tabpanel", { name: "Appearance" })).toBeTruthy())
  })

  it("retains unapplied project inputs when changing categories", async () => {
    setup()
    await userEvent.click(screen.getByRole("button", { name: "Settings" }))
    await userEvent.click(screen.getByRole("tab", { name: "Project units" }))
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Length unit" }), "in")
    await userEvent.click(screen.getByRole("tab", { name: "Appearance" }))
    await userEvent.click(screen.getByRole("tab", { name: "Project units" }))
    expect((screen.getByRole("combobox", { name: "Length unit" }) as HTMLSelectElement).value).toBe(
      "in",
    )
    expect(applyUnits).not.toHaveBeenCalled()
  })

  it("changes browser preferences without committing project units and restores focus on close", async () => {
    setup()
    const trigger = screen.getByRole("button", { name: "Settings" })
    await userEvent.click(trigger)
    expect(screen.getAllByRole("dialog")).toHaveLength(1)
    await userEvent.click(screen.getByRole("tab", { name: "About VibeShape" }))
    const sources = screen.getByRole("link", {
      name: "Licenses and corresponding source (opens in a new tab)",
    })
    expect(sources.getAttribute("href")).toBe("/sources/index.html")
    expect(sources.getAttribute("target")).toBe("_blank")
    await userEvent.click(screen.getByRole("tab", { name: "Appearance" }))
    await choose("Theme", "Light")
    expect(document.documentElement.classList.contains("dark")).toBe(false)
    await userEvent.click(screen.getByRole("tab", { name: "Export preferences" }))
    await choose("Preferred export format", "STEP")
    await userEvent.click(screen.getByRole("tab", { name: "Workspace" }))
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
    await userEvent.click(screen.getByRole("tab", { name: "Project units" }))
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Length unit" }), "in")
    await userEvent.click(screen.getByRole("button", { name: "Apply project units" }))
    expect(applyUnits).toHaveBeenCalledWith(3, { length: "in", angle: "deg" })
    await userEvent.keyboard("{Escape}")
    expect(screen.getByRole("dialog", { name: "Settings" })).toBeTruthy()
    expect((screen.getByRole("button", { name: "Done" }) as HTMLButtonElement).disabled).toBe(true)
    const appearance = screen.getByRole("tab", { name: "Appearance" })
    expect((appearance as HTMLButtonElement).disabled).toBe(true)
    await userEvent.click(appearance)
    expect(screen.getByRole("tabpanel", { name: "Project units" })).toBeTruthy()
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
    await userEvent.click(screen.getByRole("tab", { name: "Project units" }))
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
    await userEvent.click(screen.getByRole("tab", { name: "Project units" }))
    expect(
      (screen.getByRole("combobox", { name: "Length unit" }) as HTMLSelectElement).disabled,
    ).toBe(true)
    expect(
      (screen.getByRole("button", { name: "Apply project units" }) as HTMLButtonElement).disabled,
    ).toBe(true)
    await userEvent.click(screen.getByRole("tab", { name: "Appearance" }))
    await choose("Theme", "Light")
    expect(applyUnits).not.toHaveBeenCalled()
  })
})
