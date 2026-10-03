// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { I18nProvider } from "@vibeshape/i18n/provider"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { i18n } from "../i18n"
import { createTestBrowserStorage } from "../test-support/browser-storage"
import { ViewerPreferencesProvider } from "../shell/viewer-preferences"
import { PrinterSettings } from "./printer-settings"

beforeEach(() => {
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
function setup() {
  return render(
    <I18nProvider i18n={i18n} initialLocale="en">
      <ViewerPreferencesProvider>
        <PrinterSettings />
      </ViewerPreferencesProvider>
    </I18nProvider>,
  )
}

describe("printer profile preferences", () => {
  it("validates the usable area, applies locally, restores, and removes a profile", async () => {
    const user = userEvent.setup()
    const view = setup()
    const margin = screen.getByLabelText("Bed edge margin (mm)")
    await user.clear(margin)
    await user.type(margin, "110")
    await user.click(screen.getByRole("button", { name: "Apply printer profile" }))
    expect(screen.getByRole("alert")).toBeDefined()
    expect(localStorage.getItem("vibeshape.viewer-preferences.v1")).toBeNull()
    await user.clear(margin)
    await user.type(margin, "5")
    await user.click(screen.getByRole("button", { name: "Apply printer profile" }))
    const stored = JSON.parse(localStorage.getItem("vibeshape.viewer-preferences.v1") ?? "null")
    expect(stored).toMatchObject({
      printerProfile: { version: 1, width: 220, depth: 220, height: 250, margin: 5 },
      printBedVisible: true,
    })
    view.unmount()
    setup()
    expect((screen.getByLabelText("Bed edge margin (mm)") as HTMLInputElement).value).toBe("5")
    await user.click(screen.getByRole("button", { name: "Remove printer profile" }))
    expect(
      JSON.parse(localStorage.getItem("vibeshape.viewer-preferences.v1") ?? "null"),
    ).toMatchObject({ printerProfile: null, printBedVisible: false })
  })
})
