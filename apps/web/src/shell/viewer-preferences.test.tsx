// @vitest-environment jsdom

import { act, cleanup, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createTestBrowserStorage } from "../test-support/browser-storage"
import {
  createViewerPreferencesStore,
  useViewerPreferences,
  ViewerPreferencesProvider,
} from "./viewer-preferences"

beforeEach(() => {
  vi.stubGlobal("localStorage", createTestBrowserStorage())
  localStorage.clear()
})

afterEach(() => {
  cleanup()
  localStorage.clear()
  vi.unstubAllGlobals()
})

describe("browser viewer preferences", () => {
  it("keeps safe defaults after malformed, unknown-version, oversized, or unavailable storage", () => {
    for (const raw of [
      "{",
      JSON.stringify({ version: 2, theme: "light" }),
      JSON.stringify({
        version: 1,
        theme: "invalid",
        autoHideConsumedSketches: false,
        preferredExportFormat: "step",
      }),
      "x".repeat(4097),
    ]) {
      const store = createViewerPreferencesStore({ getItem: () => raw, setItem: vi.fn() })
      expect(store.getState()).toMatchObject({
        theme: "dark",
        autoHideConsumedSketches: true,
        preferredExportFormat: "3mf",
      })
    }
    const store = createViewerPreferencesStore({
      getItem: () => {
        throw new Error("denied")
      },
      setItem: () => {
        throw new Error("denied")
      },
    })
    store.getState().actions.setTheme("light")
    expect(store.getState().theme).toBe("light")
  })

  it("persists and restores only browser preferences without authority or document data", () => {
    let raw: string | null = null
    const storage = {
      getItem: () => raw,
      setItem: (_key: string, value: string) => {
        raw = value
      },
    }
    const store = createViewerPreferencesStore(storage)
    store.getState().actions.setTheme("system")
    store.getState().actions.setAutoHideConsumedSketches(false)
    store.getState().actions.setPreferredExportFormat("step")
    expect(JSON.parse(raw ?? "null")).toEqual({
      version: 1,
      printerProfile: null,
      printBedVisible: false,
      groundGridVisible: true,
      theme: "system",
      autoHideConsumedSketches: false,
      preferredExportFormat: "step",
    })
    expect(createViewerPreferencesStore(storage).getState()).toMatchObject({
      theme: "system",
      autoHideConsumedSketches: false,
      preferredExportFormat: "step",
    })
  })

  it("preserves existing preferences while discarding an invalid printer profile", () => {
    const storage = {
      getItem: () =>
        JSON.stringify({
          version: 1,
          theme: "light",
          autoHideConsumedSketches: false,
          preferredExportFormat: "step",
          printerProfile: { version: 1, width: -1 },
          printBedVisible: true,
        }),
      setItem: vi.fn(),
    }
    const store = createViewerPreferencesStore(storage)
    expect(store.getState()).toMatchObject({
      theme: "light",
      preferredExportFormat: "step",
      autoHideConsumedSketches: false,
      printerProfile: null,
      printBedVisible: false,
    })
  })

  it("restores a maximally sized profile name and hides the bed when its profile is removed", () => {
    const storage = createTestBrowserStorage()
    const store = createViewerPreferencesStore(storage)
    store.getState().actions.setPrinterProfile({
      version: 1,
      name: "P".repeat(128),
      bedShape: "rectangular",
      width: 220,
      depth: 220,
      height: 250,
      margin: 5,
    })
    store.getState().actions.setPrintBedVisible(true)
    expect(createViewerPreferencesStore(storage).getState().printerProfile?.name).toHaveLength(128)
    store.getState().actions.setPrinterProfile(null)
    expect(store.getState().printBedVisible).toBe(false)
  })

  it("follows system changes only in System mode and cleans up the media listener", () => {
    const media = new EventTarget() as EventTarget & {
      matches: boolean
      addListener: () => void
      removeListener: () => void
    }
    media.matches = false
    const remove = vi.spyOn(media, "removeEventListener")
    vi.stubGlobal("matchMedia", () => media)
    function Controls() {
      const actions = useViewerPreferences((state) => state.actions)
      return (
        <>
          <button type="button" onClick={() => actions.setTheme("system")}>
            System
          </button>
          <button type="button" onClick={() => actions.setTheme("light")}>
            Light
          </button>
        </>
      )
    }
    render(
      <ViewerPreferencesProvider>
        <Controls />
      </ViewerPreferencesProvider>,
    )
    expect(document.documentElement.classList.contains("dark")).toBe(true)
    act(() => screen.getByText("System").click())
    expect(document.documentElement.classList.contains("dark")).toBe(false)
    act(() => {
      media.matches = true
      media.dispatchEvent(new Event("change"))
    })
    expect(document.documentElement.classList.contains("dark")).toBe(true)
    act(() => screen.getByText("Light").click())
    expect(remove).toHaveBeenCalledWith("change", expect.any(Function))
    act(() => media.dispatchEvent(new Event("change")))
    expect(document.documentElement.style.colorScheme).toBe("light")
  })
})
