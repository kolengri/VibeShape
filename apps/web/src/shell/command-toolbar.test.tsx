// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { I18nProvider } from "@vibeshape/i18n/provider"
import { TooltipProvider } from "@vibeshape/ui/components/tooltip"
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest"
import {
  type BuiltInEditorCommandContext,
  resolveBuiltInEditorCommands,
} from "../commands/built-in-editor-commands"
import type { DocumentControllerState } from "../document/document-controller"
import { i18n } from "../i18n"
import { CommandToolbar } from "./command-toolbar"

const controller = {
  status: "ready",
  report: {
    mode: "read-write",
    snapshot: { features: [] },
  },
} as unknown as DocumentControllerState

const actions = {
  cancelActive: vi.fn(),
  createBox: vi.fn(),
  createCylinder: vi.fn(),
  createExtrusion: vi.fn(),
  createSketch: vi.fn(),
  createSubtract: vi.fn(),
  redoSketch: vi.fn(),
  setSketchConstruction: vi.fn(),
  setSketchTool: vi.fn(),
  switchWorkspace: vi.fn(),
  undoSketch: vi.fn(),
}

class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}

function commands(overrides: Partial<BuiltInEditorCommandContext["state"]> = {}) {
  return resolveBuiltInEditorCommands({
    actions,
    state: {
      activePartDesignCommand: null,
      activeSketchTool: null,
      controller,
      extrusionAvailable: false,
      sketchConstruction: false,
      sketchRedoAvailable: false,
      sketchTool: "select",
      sketchUndoAvailable: false,
      workspace: "model",
      ...overrides,
    },
  })
}

function renderToolbar(commandSet = commands()) {
  render(
    <I18nProvider i18n={i18n} initialLocale="en">
      <TooltipProvider delayDuration={0}>
        <CommandToolbar commands={commandSet} />
      </TooltipProvider>
    </I18nProvider>,
  )
}

beforeAll(() => vi.stubGlobal("ResizeObserver", ResizeObserverMock))
afterAll(() => vi.unstubAllGlobals())
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe("CommandToolbar", () => {
  it("presents registry-backed sketch-first model commands", async () => {
    const user = userEvent.setup()
    renderToolbar()

    expect(screen.getByRole("toolbar", { name: "Model commands" })).toBeTruthy()
    expect(screen.getByText("Primitives", { exact: true })).toBeTruthy()
    expect((screen.getByRole("button", { name: "Extrude" }) as HTMLButtonElement).disabled).toBe(
      true,
    )

    const createSketch = screen.getByRole("button", { name: "Create sketch" })
    expect(createSketch.textContent).toBe("")
    await user.hover(createSketch)
    expect((await screen.findByRole("tooltip")).textContent).toContain("Create sketch")

    await user.click(createSketch)
    expect(actions.createSketch).toHaveBeenCalledOnce()

    const extrude = screen.getByRole("button", { name: "Extrude" })
    await user.unhover(createSketch)
    await user.hover(extrude)
    await waitFor(() =>
      expect(screen.getByRole("tooltip").textContent).toContain(
        "Select a closed sketch profile first.",
      ),
    )
  })

  it("replaces model features with contextual registry commands during a sketch", async () => {
    const user = userEvent.setup()
    renderToolbar(
      commands({
        activeSketchTool: { kind: "create-sketch" },
        sketchUndoAvailable: true,
        workspace: "sketch",
      }),
    )

    expect(screen.queryByRole("button", { name: "Box" })).toBeNull()
    expect(screen.getByRole("button", { name: "Select" }).getAttribute("aria-pressed")).toBe("true")
    expect(
      screen.getByRole("button", { name: "Construction geometry" }).getAttribute("aria-pressed"),
    ).toBe("false")
    expect((screen.getByRole("button", { name: "Model" }) as HTMLButtonElement).disabled).toBe(true)

    await user.click(screen.getByRole("button", { name: "Rectangle tools" }))
    await user.click(screen.getByRole("menuitemradio", { name: "Rectangle G" }))
    expect(actions.setSketchTool).toHaveBeenCalledWith("rectangle")
    expect(screen.getByRole("button", { name: "Rectangle" })).toBeTruthy()

    await user.click(screen.getByRole("button", { name: "Rectangle tools" }))
    await user.click(screen.getByRole("menuitemradio", { name: "Center rectangle R" }))
    expect(actions.setSketchTool).toHaveBeenCalledWith("center-rectangle")

    await user.click(screen.getByRole("button", { name: "Rectangle tools" }))
    await user.click(screen.getByRole("menuitemradio", { name: "Aligned rectangle" }))
    expect(actions.setSketchTool).toHaveBeenCalledWith("aligned-rectangle")

    await user.click(screen.getByRole("button", { name: "Line tools" }))
    await user.click(screen.getByRole("menuitemradio", { name: "Midpoint line" }))
    expect(actions.setSketchTool).toHaveBeenCalledWith("midpoint-line")

    await user.click(screen.getByRole("button", { name: "Circle tools" }))
    await user.click(screen.getByRole("menuitemradio", { name: "Three-point circle" }))
    expect(actions.setSketchTool).toHaveBeenCalledWith("three-point-circle")

    await user.click(screen.getByRole("button", { name: "Arc tools" }))
    await user.click(screen.getByRole("menuitemradio", { name: "Three-point arc A" }))
    expect(actions.setSketchTool).toHaveBeenCalledWith("three-point-arc")

    await user.click(screen.getByRole("button", { name: "Arc tools" }))
    await user.click(screen.getByRole("menuitemradio", { name: "Tangent arc Shift+A" }))
    expect(actions.setSketchTool).toHaveBeenCalledWith("tangent-arc")

    await user.click(screen.getByRole("button", { name: "Construction geometry" }))
    expect(actions.setSketchConstruction).toHaveBeenCalledWith(true)

    await user.click(screen.getByRole("button", { name: "Undo" }))
    expect(actions.undoSketch).toHaveBeenCalledOnce()
  })

  it("uses roving arrow-key focus across workspace controls", async () => {
    const user = userEvent.setup()
    renderToolbar()

    await user.tab()
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Model" }))
    await user.keyboard("{ArrowRight}")
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Sketch" }))
  })
})
