// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { I18nProvider } from "@vibeshape/i18n/provider"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { resolveBuiltInEditorCommands } from "../commands/built-in-editor-commands"
import { editorCommandIds } from "../commands/editor-command"
import type { DocumentControllerState } from "../document/document-controller"
import { i18n } from "../i18n"
import { EditorCommandPalette } from "./command-palette"

const actions = {
  cancelActive: vi.fn(),
  createBox: vi.fn(),
  createCylinder: vi.fn(),
  createDatumPlane: vi.fn(),
  createExtrusion: vi.fn(),
  createSketch: vi.fn(),
  createSubtract: vi.fn(),
  redoSketch: vi.fn(),
  setSketchCameraMode: vi.fn(),
  setSketchConstruction: vi.fn(),
  setSketchTool: vi.fn(),
  switchWorkspace: vi.fn(),
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
    activeSketchTool: null,
    controller,
    extrusionAvailable: false,
    sketchConstruction: false,
    sketchCameraMode: "normal",
    sketchRedoAvailable: false,
    slotFromSelectionAvailable: false,
    sketchTool: "select",
    sketchUndoAvailable: false,
    workspace: "model",
  },
})

function renderPalette(onOpenChange = vi.fn()) {
  const returnFocusRef = { current: null }
  render(
    <I18nProvider i18n={i18n} initialLocale="en">
      <EditorCommandPalette
        commands={commands}
        open
        returnFocusRef={returnFocusRef}
        onOpenChange={onOpenChange}
      />
    </I18nProvider>,
  )
  return onOpenChange
}

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn()
  const entries = new Map<string, string>()
  vi.stubGlobal("localStorage", {
    clear: () => entries.clear(),
    getItem: (key: string) => entries.get(key) ?? null,
    key: (index: number) => [...entries.keys()][index] ?? null,
    get length() {
      return entries.size
    },
    removeItem: (key: string) => entries.delete(key),
    setItem: (key: string, value: string) => entries.set(key, value),
  } satisfies Storage)
  vi.stubGlobal(
    "ResizeObserver",
    class ResizeObserver {
      disconnect() {}
      observe() {}
      unobserve() {}
    },
  )
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe("EditorCommandPalette", () => {
  it("keeps disabled commands discoverable with their current precondition", () => {
    renderPalette()

    expect(screen.getByRole("dialog", { name: "Command palette" })).toBeTruthy()
    expect(screen.getByText("Extrude")).toBeTruthy()
    expect(screen.getByText("Select a closed sketch profile first.")).toBeTruthy()
    expect(screen.getAllByText("Start or edit a sketch first.").length).toBeGreaterThan(0)
  })

  it("searches localized keywords and invokes the registered command", async () => {
    const user = userEvent.setup()
    const onOpenChange = renderPalette()

    await user.type(screen.getByRole("combobox", { name: "Search commands" }), "cube")
    await user.click(screen.getByText("Box"))

    expect(onOpenChange).toHaveBeenCalledWith(false)
    expect(actions.createBox).toHaveBeenCalledOnce()
    expect(JSON.parse(localStorage.getItem("vibeshape.editor-command-recents.v1") ?? "[]")).toEqual(
      [editorCommandIds.createBox],
    )
  })
})
