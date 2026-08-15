// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { I18nProvider } from "@vibeshape/i18n/provider"
import { afterEach, describe, expect, it, vi } from "vitest"
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

const baseProps = {
  activeCommand: null,
  activeSketchTool: null,
  controller,
  extrusionAvailable: false,
  onCreateBox: vi.fn(),
  onCreateCylinder: vi.fn(),
  onCreateExtrusion: vi.fn(),
  onCreateSketch: vi.fn(),
  onCreateSubtract: vi.fn(),
  onSketchConstructionChange: vi.fn(),
  onSketchEditorToolChange: vi.fn(),
  onSketchRedo: vi.fn(),
  onSketchUndo: vi.fn(),
  onWorkspaceChange: vi.fn(),
  sketchConstruction: false,
  sketchEditorTool: "select",
  sketchRedoAvailable: false,
  sketchUndoAvailable: false,
  workspace: "model",
} as const

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe("CommandToolbar", () => {
  it("presents sketch-first model commands without unavailable workspace placeholders", async () => {
    const user = userEvent.setup()
    render(
      <I18nProvider i18n={i18n} initialLocale="en">
        <CommandToolbar {...baseProps} />
      </I18nProvider>,
    )

    expect(screen.getByRole("toolbar", { name: "Model commands" })).toBeTruthy()
    expect(screen.queryByRole("button", { name: "Print" })).toBeNull()
    expect(screen.getByText("Primitives", { exact: true })).toBeTruthy()
    expect((screen.getByRole("button", { name: "Extrude" }) as HTMLButtonElement).disabled).toBe(
      true,
    )

    await user.click(screen.getByRole("button", { name: "Create sketch" }))
    expect(baseProps.onCreateSketch).toHaveBeenCalledOnce()
  })

  it("replaces model features with contextual sketch tools while a sketch is active", async () => {
    const user = userEvent.setup()
    render(
      <I18nProvider i18n={i18n} initialLocale="en">
        <CommandToolbar
          {...baseProps}
          activeSketchTool={{ kind: "create-sketch" }}
          sketchUndoAvailable
          workspace="sketch"
        />
      </I18nProvider>,
    )

    expect(screen.queryByRole("button", { name: "Box" })).toBeNull()
    expect(screen.getByRole("button", { name: "Select" }).getAttribute("aria-pressed")).toBe("true")
    expect((screen.getByRole("button", { name: "Model" }) as HTMLButtonElement).disabled).toBe(true)

    await user.click(screen.getByRole("button", { name: "Rectangle" }))
    expect(baseProps.onSketchEditorToolChange).toHaveBeenCalledWith("rectangle")

    await user.click(screen.getByRole("button", { name: "Construction geometry" }))
    expect(baseProps.onSketchConstructionChange).toHaveBeenCalledWith(true)

    await user.click(screen.getByRole("button", { name: "Undo" }))
    expect(baseProps.onSketchUndo).toHaveBeenCalledOnce()
  })

  it("uses roving arrow-key focus across workspace controls", async () => {
    const user = userEvent.setup()
    render(
      <I18nProvider i18n={i18n} initialLocale="en">
        <CommandToolbar {...baseProps} />
      </I18nProvider>,
    )

    await user.tab()
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Model" }))
    await user.keyboard("{ArrowRight}")
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Sketch" }))
  })
})
