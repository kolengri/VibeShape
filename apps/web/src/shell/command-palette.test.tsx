import "../../../../tests/unit/support/dom"
import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { cleanup, render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { I18nProvider } from "@vibeshape/i18n/provider"
import { vi } from "../../../../tests/unit/support/bun-test"
import { resolveBuiltInEditorCommands } from "../commands/built-in-editor-commands"
import { editorCommandIds } from "../commands/editor-command"
import type { DocumentControllerState } from "../document/document-controller"
import { i18n } from "../i18n"
import { EditorCommandPalette } from "./command-palette"

const actions = {
  openShortcutHelp: vi.fn(),
  cancelActive: vi.fn(),
  createFillet: vi.fn(),
  createChamfer: vi.fn(),
  createHole: vi.fn(),
  createBox: vi.fn(),
  createCylinder: vi.fn(),
  createSphere: vi.fn(),
  createCone: vi.fn(),
  createPyramid: vi.fn(),
  createTorus: vi.fn(),
  createDatumPlane: vi.fn(),
  createExtrusion: vi.fn(),
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
    activeSketchTool: null,
    controller,
    extrusionAvailable: false,
    hasSavedSketches: false,
    sketchConstruction: false,
    sketchCameraMode: "normal",
    sketchFinalContext: false,
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
    expect(screen.getByText("Revolve")).toBeTruthy()
    expect(screen.getAllByText("Select a closed sketch profile first.")).toHaveLength(2)
    expect(screen.getAllByText("Start or edit a sketch first.").length).toBeGreaterThan(0)
  })

  it("searches localized keywords and invokes the registered command", async () => {
    const user = userEvent.setup()
    const onOpenChange = renderPalette()

    await user.type(screen.getByRole("combobox", { name: "Search commands" }), "cube")
    await user.click(screen.getByText("Box"))

    expect(onOpenChange).toHaveBeenCalledWith(false)
    expect(actions.createBox).toHaveBeenCalledTimes(1)
    expect(JSON.parse(localStorage.getItem("vibeshape.editor-command-recents.v1") ?? "[]")).toEqual(
      [editorCommandIds.createBox],
    )
  })

  it.each([
    ["ball", "Sphere", "createSphere"],
    ["pointed", "Cone", "createCone"],
    ["donut", "Torus", "createTorus"],
    ["facets", "Pyramid", "createPyramid"],
  ] as const)(
    "discovers %s and invokes its registered primitive command",
    async (keyword, label, key) => {
      const user = userEvent.setup()
      renderPalette()
      await user.type(screen.getByRole("combobox", { name: "Search commands" }), keyword)
      await user.click(screen.getByText(label))
      expect(actions[key]).toHaveBeenCalledTimes(1)
    },
  )

  it("retains recent ordering after invoking shortcut help and reopening the palette", async () => {
    const user = userEvent.setup()
    renderPalette()
    await user.type(screen.getByRole("combobox", { name: "Search commands" }), "keyboard")
    await user.click(screen.getByText("Keyboard shortcuts"))
    expect(actions.openShortcutHelp).toHaveBeenCalledTimes(1)
    cleanup()
    renderPalette()
    const workspace = screen.getByRole("group", { name: "Workspace" })
    expect(within(workspace).getAllByRole("option")[0]?.textContent).toContain("Keyboard shortcuts")
  })
  it("retains newly registered commands after reload and ignores stale entries individually", () => {
    localStorage.setItem(
      "vibeshape.editor-command-recents.v1",
      JSON.stringify([
        "removed-command",
        editorCommandIds.createSphere,
        { invalid: true },
        editorCommandIds.createHole,
        editorCommandIds.createSphere,
        editorCommandIds.createBox,
      ]),
    )
    renderPalette()
    const modeling = screen.getByRole("group", { name: "Modeling" })
    const options = within(modeling).getAllByRole("option")
    expect(options.slice(0, 3).map((option) => option.textContent)).toEqual([
      expect.stringContaining("Sphere"),
      expect.stringContaining("Hole"),
      expect.stringContaining("Box"),
    ])
  })

  it("persists a newly registered primitive through an actual invocation and remount", async () => {
    const user = userEvent.setup()
    renderPalette()
    await user.type(screen.getByRole("combobox", { name: "Search commands" }), "ball")
    await user.click(screen.getByText("Sphere"))
    cleanup()
    renderPalette()
    const modeling = screen.getByRole("group", { name: "Modeling" })
    expect(within(modeling).getAllByRole("option")[0]?.textContent).toContain("Sphere")
  })
})
