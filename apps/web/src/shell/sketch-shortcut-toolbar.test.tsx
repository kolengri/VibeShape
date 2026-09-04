// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { I18nProvider } from "@vibeshape/i18n/provider"
import { TooltipProvider } from "@vibeshape/ui/components/tooltip"
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest"
import { resolveBuiltInEditorCommands } from "../commands/built-in-editor-commands"
import type { DocumentControllerState } from "../document/document-controller"
import { i18n } from "../i18n"
import { SketchShortcutToolbar } from "./sketch-shortcut-toolbar"

const actions = {
  cancelActive: vi.fn(),
  createBox: vi.fn(),
  createCylinder: vi.fn(),
  createDatumPlane: vi.fn(),
  createExtrusion: vi.fn(),
  createRevolve: vi.fn(),
  createSketch: vi.fn(),
  createSubtract: vi.fn(),
  redoSketch: vi.fn(),
  setSketchCameraMode: vi.fn(),
  setSketchConstruction: vi.fn(),
  setSketchFinalContext: vi.fn(),
  setSketchTool: vi.fn(),
  switchWorkspace: vi.fn(),
  toggleAllSketchVisibility: vi.fn(),
  undoSketch: vi.fn(),
}

const controller = {
  status: "ready",
  report: { mode: "read-write", snapshot: { features: [] } },
} as unknown as DocumentControllerState

const commands = resolveBuiltInEditorCommands({
  actions,
  state: {
    activePartDesignCommand: null,
    activeSketchTool: { kind: "create-sketch" },
    controller,
    extrusionAvailable: false,
    hasSavedSketches: false,
    revolveAvailable: false,
    sketchConstruction: false,
    sketchCameraMode: "normal",
    sketchFinalContext: false,
    sketchRedoAvailable: false,
    slotFromSelectionAvailable: false,
    sketchTool: "select",
    sketchUndoAvailable: false,
    workspace: "sketch",
  },
})

class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}

beforeAll(() => vi.stubGlobal("ResizeObserver", ResizeObserverMock))
afterAll(() => vi.unstubAllGlobals())
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

function renderToolbar(onOpenChange = vi.fn()) {
  const returnFocusRef = { current: document.createElement("button") }
  render(
    <I18nProvider i18n={i18n} initialLocale="en">
      <TooltipProvider delayDuration={0}>
        <SketchShortcutToolbar
          anchor={{ x: 320, y: 240 }}
          commands={commands}
          open
          returnFocusRef={returnFocusRef}
          onOpenChange={onOpenChange}
        />
      </TooltipProvider>
    </I18nProvider>,
  )
  return { onOpenChange, returnFocusRef }
}

describe("SketchShortcutToolbar", () => {
  it("presents distinct icon commands from the shared editor registry", async () => {
    const user = userEvent.setup()
    const { onOpenChange } = renderToolbar()

    expect(screen.getByRole("toolbar", { name: "Sketch shortcuts" })).toBeTruthy()
    expect(
      screen.getAllByRole("button").map((button) => button.getAttribute("aria-label")),
    ).toEqual([
      "Select",
      "Use external geometry",
      "Line",
      "Center rectangle",
      "Center-point circle",
      "Three-point arc",
      "Dimension",
      "Trim",
      "Offset",
      "Extrude",
      "Revolve",
    ])
    expect(screen.getByRole("button", { name: "Use external geometry" })).toBeTruthy()
    expect((screen.getByRole("button", { name: "Extrude" }) as HTMLButtonElement).disabled).toBe(
      true,
    )
    expect((screen.getByRole("button", { name: "Revolve" }) as HTMLButtonElement).disabled).toBe(
      true,
    )
    expect(document.querySelector<HTMLElement>("[data-sketch-shortcut-anchor]")?.style.left).toBe(
      "320px",
    )

    await user.click(screen.getByRole("button", { name: "Line" }))

    expect(onOpenChange).toHaveBeenCalledWith(false)
    expect(actions.setSketchTool).toHaveBeenCalledWith("line")
  })

  it("explains unavailable profile features without adding text to the buttons", async () => {
    const user = userEvent.setup()
    renderToolbar()
    const extrude = screen.getByRole("button", { name: "Extrude" })

    expect(extrude.textContent).toBe("")
    await user.hover(extrude.parentElement ?? extrude)

    await waitFor(() =>
      expect(screen.getByRole("tooltip").textContent).toContain(
        "Select a closed sketch profile first.",
      ),
    )
  })

  it("handles Escape inside the non-modal layer before sketch cancellation", async () => {
    const user = userEvent.setup()
    const { onOpenChange } = renderToolbar()

    const toolbar = screen.getByRole("toolbar", { name: "Sketch shortcuts" })
    await waitFor(() => expect(toolbar.contains(document.activeElement)).toBe(true))
    await user.keyboard("{Escape}")

    expect(onOpenChange).toHaveBeenCalledWith(false)
  })
})
