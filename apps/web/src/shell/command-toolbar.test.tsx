import "../../../../tests/unit/support/dom"
import { afterAll, afterEach, beforeAll, describe, expect, it } from "bun:test"
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { partIdSchema } from "@vibeshape/domain/identifiers"
import { I18nProvider } from "@vibeshape/i18n/provider"
import { TooltipProvider } from "@vibeshape/ui/components/tooltip"
import { vi } from "../../../../tests/unit/support/bun-test"
import {
  type BuiltInEditorCommandContext,
  resolveBuiltInEditorCommands,
} from "../commands/built-in-editor-commands"
import { editorCommandIds } from "../commands/editor-command"
import type { DocumentControllerState } from "../document/document-controller"
import { SketchToolbarPortalsProvider } from "../features/sketch/sketch-toolbar-portals"
import { i18n } from "../i18n"
import { CommandToolbar } from "./command-toolbar"

const controller = {
  status: "ready",
  saveStatus: "saved",
  history: { canUndo: true, canRedo: true },
  report: {
    mode: "read-write",
    snapshot: { features: [], revision: 1 },
  },
} as unknown as DocumentControllerState

const actions = {
  lightweighting: vi.fn(),
  quickLightweighting: vi.fn(),
  generativeDesign: vi.fn(),
  createFdm: vi.fn(),
  surfaceTexture: vi.fn(),
  measure: vi.fn(),
  placePart: vi.fn(),
  mirrorPart: vi.fn(),
  shellPart: vi.fn(),
  splitPart: vi.fn(),
  patternPart: vi.fn(),
  threadPart: vi.fn(),
  combineParts: vi.fn(),
  cancelActive: vi.fn(),
  documentRedo: vi.fn(() => Promise.resolve({ ok: true })),
  documentUndo: vi.fn(() => Promise.resolve({ ok: true })),
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
  createLoft: vi.fn(),
  createSweep: vi.fn(),
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

const resizeObservers = new Set<ResizeObserverMock>()
class ResizeObserverMock implements ResizeObserver {
  readonly targets = new Set<Element>()
  constructor(readonly callback: ResizeObserverCallback) {
    resizeObservers.add(this)
  }
  observe(target: Element) {
    this.targets.add(target)
  }
  unobserve(target: Element) {
    this.targets.delete(target)
  }
  disconnect() {
    resizeObservers.delete(this)
  }
}

function commands(overrides: Partial<BuiltInEditorCommandContext["state"]> = {}) {
  return resolveBuiltInEditorCommands({
    actions,
    state: {
      activePartDesignCommand: null,
      activeSketchTool: null,
      controller,
      extrusionAvailable: false,
      hasSavedSketches: false,
      revolveAvailable: false,
      sketchConstruction: false,
      sketchCameraMode: "normal",
      sketchFinalContext: false,
      sketchRedoAvailable: false,
      slotFromSelectionAvailable: true,
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
        <SketchToolbarPortalsProvider>
          <CommandToolbar commands={commandSet} />
        </SketchToolbarPortalsProvider>
      </TooltipProvider>
    </I18nProvider>,
  )
}

function measuredToolbar(initialWidth: number) {
  let width = initialWidth
  let measurements = 0
  const original = HTMLElement.prototype.getBoundingClientRect
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
    this: HTMLElement,
  ) {
    let measured: number | undefined
    if (this.hasAttribute("data-responsive-model-toolbar")) {
      measured = width
      measurements++
    } else if (this.hasAttribute("data-fit-icon")) measured = 32
    else if (this.hasAttribute("data-fit-leading")) measured = 104
    else if (this.hasAttribute("data-fit-separator")) measured = 9
    else if (this.hasAttribute("data-fit-menu")) measured = 32
    return measured === undefined ? original.call(this) : new DOMRect(0, 0, measured, 32)
  })
  return {
    measurements: () => measurements,
    async resize(next: number) {
      width = next
      await act(async () => {
        for (const observer of resizeObservers) {
          if (
            [...observer.targets].some((target) =>
              target.hasAttribute("data-responsive-model-toolbar"),
            )
          ) {
            observer.callback([], observer)
            observer.callback([], observer)
          }
        }
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
      })
    },
  }
}

const originalScrollIntoView = Element.prototype.scrollIntoView
beforeAll(() => {
  vi.stubGlobal("ResizeObserver", ResizeObserverMock)
  Element.prototype.scrollIntoView = vi.fn()
})
afterAll(() => {
  vi.unstubAllGlobals()
  Element.prototype.scrollIntoView = originalScrollIntoView
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.clearAllMocks()
})

describe("CommandToolbar", () => {
  it("turns the last Create command into a direct icon and keeps it unique through resize", async () => {
    const size = measuredToolbar(1200)
    const user = userEvent.setup()
    renderToolbar(
      commands().map((command) => ({ ...command, eligibility: { enabled: true as const } })),
    )
    expect(screen.queryByRole("button", { name: "Create" })).toBeNull()
    const direct = screen.getByRole("button", { name: "Generative Design" })
    expect(direct.getAttribute("aria-haspopup")).toBeNull()
    await user.click(direct)
    expect(actions.generativeDesign).toHaveBeenCalledTimes(1)
    act(() => direct.focus())
    await size.resize(320)
    const menu = screen.getByRole("button", { name: "Create" })
    expect(document.activeElement?.getAttribute("aria-label")).toBe("Create")
    expect(screen.queryByRole("button", { name: "Generative Design" })).toBeNull()
    await user.click(menu)
    expect(screen.getAllByRole("menuitem", { name: "Generative Design" })).toHaveLength(1)
    await user.keyboard("{Escape}")
    await size.resize(1200)
    expect(screen.getAllByRole("button", { name: "Generative Design" })).toHaveLength(1)
  })
  it("promotes frequent commands only when they fit and moves disappearing focus into its group menu", async () => {
    const size = measuredToolbar(1200)
    const user = userEvent.setup()
    const invokeSweep = vi.fn()
    renderToolbar(
      commands().map((command) => ({
        ...command,
        eligibility: { enabled: true as const },
        ...(command.descriptor.id === editorCommandIds.createSweep ? { invoke: invokeSweep } : {}),
      })),
    )
    expect(screen.getByRole("button", { name: "Fillet" })).toBeTruthy()
    await user.click(screen.getByRole("button", { name: "Box" }))
    expect(actions.createBox).toHaveBeenCalledTimes(1)
    const sweep = screen.getByRole("button", { name: "Sweep" })
    act(() => sweep.focus())
    const before = size.measurements()
    await size.resize(320)
    expect(size.measurements() - before).toBe(1)
    expect(screen.queryByRole("button", { name: "Sweep" })).toBeNull()
    const create = screen.getByRole("button", { name: "Create" })
    expect(document.activeElement).toBe(create)
    await user.keyboard("{ArrowDown}")
    await user.click(screen.getByRole("menuitem", { name: "Sweep" }))
    expect(invokeSweep).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(document.activeElement).toBe(create))
  })

  it("keeps an open dropdown stable across a resize and applies compact overflow after closing", async () => {
    const size = measuredToolbar(1200)
    const user = userEvent.setup()
    const all = commands().map((command) => ({
      ...command,
      eligibility: { enabled: true as const },
    }))
    renderToolbar(all)
    const create = screen.getByRole("button", { name: "Modify" })
    await user.click(create)
    await size.resize(100)
    expect(screen.getByRole("menu")).toBeTruthy()
    expect(create.isConnected).toBe(true)
    expect(create.getAttribute("aria-expanded")).toBe("true")
    await user.keyboard("{Escape}")
    const overflow = await screen.findByRole("button", { name: "Modeling actions" })
    await waitFor(() => expect(document.activeElement).toBe(overflow))
    expect(screen.getByRole("button", { name: "Undo" })).toBeTruthy()
    expect(screen.getByRole("button", { name: "Redo" })).toBeTruthy()
    await user.keyboard("{Enter}")
    expect(
      screen
        .getAllByRole("option")
        .map((item) => item.getAttribute("data-command-id"))
        .sort(),
    ).toEqual(
      all
        .filter(
          (command) =>
            command.toolbarVisible && command.descriptor.toolbarGroup?.startsWith("model-"),
        )
        .map((command) => command.descriptor.id)
        .sort(),
    )
    expect(screen.getByRole("option", { name: "Create sketch" })).toBeTruthy()
    expect(screen.getByRole("option", { name: "Box" })).toBeTruthy()
    expect(screen.getByRole("option", { name: "Measure" })).toBeTruthy()
    await user.click(screen.getByRole("option", { name: "Box" }))
    expect(actions.createBox).toHaveBeenCalledTimes(1)
  })

  it("filters the compact tool picker by name and invokes the keyboard choice once", async () => {
    measuredToolbar(100)
    const user = userEvent.setup()
    renderToolbar(
      commands().map((command) => ({ ...command, eligibility: { enabled: true as const } })),
    )
    const trigger = screen.getByRole("button", { name: "Modeling actions" })
    await user.click(trigger)
    const search = screen.getByRole("combobox", { name: "Search tools…" })
    await user.type(search, "lightweight")
    expect(
      screen
        .getAllByRole("option")
        .map((option) => option.getAttribute("aria-label"))
        .sort(),
    ).toEqual(["Generative Design", "Lightweighting", "Quick lightweighting"])
    await user.clear(search)
    await user.type(search, "unavailable-tool-name")
    expect(screen.getByText("No matching tools")).toBeTruthy()
    await user.clear(search)
    await user.type(search, "sphere")
    await user.keyboard("{Enter}")
    expect(actions.createSphere).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(document.activeElement).toBe(trigger))
    expect(screen.queryByRole("dialog")).toBeNull()
  })

  it("names icon-only category triggers and shows their tooltips", async () => {
    const user = userEvent.setup()
    renderToolbar()
    const icons = new Set<string>()
    for (const name of ["Primitives", "Modify", "Create"]) {
      const trigger = screen.getByRole("button", { name })
      expect(trigger.textContent).toBe("")
      const icon = trigger.querySelector("svg")
      expect(icon?.getAttribute("aria-hidden")).toBe("true")
      icons.add(icon?.innerHTML ?? "")
      expect(trigger.getAttribute("aria-haspopup")).toMatch(/^(menu|dialog)$/)
      expect(trigger.getAttribute("title")).toBeNull()
      await user.hover(trigger)
      expect((await screen.findByRole("tooltip")).textContent).toBe(name)
      await user.unhover(trigger)
      await waitFor(() => expect(screen.queryByRole("tooltip")).toBeNull())
    }
    expect(icons.size).toBe(3)
    const icon = screen.getByRole("button", { name: "Create sketch" })
    await user.hover(icon)
    expect((await screen.findByRole("tooltip")).textContent).toContain("Create sketch")
  })

  it("opens icon category menus by keyboard and restores focus on Escape", async () => {
    const user = userEvent.setup()
    renderToolbar(
      commands().map((command) => ({ ...command, eligibility: { enabled: true as const } })),
    )
    for (const [name, item] of [
      ["Create", "Datum plane"],
      ["Modify", "Fillet"],
      ["Primitives", "Box"],
    ] as const) {
      const trigger = screen.getByRole("button", { name })
      act(() => trigger.focus())
      await user.keyboard("{ArrowDown}")
      const role = trigger.getAttribute("aria-haspopup") === "dialog" ? "option" : "menuitem"
      expect(screen.getByRole(role, { name: item })).toBeTruthy()
      expect(trigger.getAttribute("aria-expanded")).toBe("true")
      await user.keyboard("{Escape}")
      await waitFor(() => expect(document.activeElement).toBe(trigger))
    }
    await user.keyboard("{ArrowDown}{Home}{Enter}")
    expect(actions.createBox).toHaveBeenCalledTimes(1)
  })

  it("opens Lightweighting from Modify with distinct vector icons", async () => {
    const user = userEvent.setup()
    renderToolbar()
    await user.click(screen.getByRole("button", { name: "Modify" }))
    const button = screen.getByRole("option", { name: "Lightweighting" })
    expect(button.querySelector("svg")).toBeTruthy()
    expect(button.querySelector("img")).toBeNull()
    const quickButton = screen.getByRole("option", { name: "Quick lightweighting" })
    expect(quickButton.querySelector("svg")?.innerHTML).not.toBe(
      button.querySelector("svg")?.innerHTML,
    )
    await user.click(button)
    expect(actions.lightweighting).toHaveBeenCalledTimes(1)
  })
  it("presents registry-backed sketch-first model commands", async () => {
    const user = userEvent.setup()
    renderToolbar()

    expect(screen.getByRole("toolbar", { name: "Model commands" })).toBeTruthy()
    expect(screen.getByRole("button", { name: "Primitives" })).toBeTruthy()
    expect(screen.getByRole("button", { name: "Extrude" }).getAttribute("aria-disabled")).toBe(
      "true",
    )

    const createSketch = screen.getByRole("button", { name: "Create sketch" })
    expect(createSketch.textContent).toBe("")
    await user.hover(createSketch)
    expect((await screen.findByRole("tooltip")).textContent).toContain("Create sketch")

    await user.click(createSketch)
    expect(actions.createSketch).toHaveBeenCalledTimes(1)

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
    expect(screen.queryByRole("button", { name: "Model" })).toBeNull()
    expect(screen.queryByRole("button", { name: "Sketch" })).toBeNull()
    expect(screen.queryByRole("button", { name: "Create sketch" })).toBeNull()
    expect(screen.queryByRole("button", { name: "Create datum plane" })).toBeNull()
    expect(document.querySelector("[data-sketch-constraint-manager-toolbar-slot]")).toBeTruthy()
    expect(screen.getByRole("button", { name: "Select" }).getAttribute("aria-pressed")).toBe("true")
    expect(
      screen.getByRole("button", { name: "Construction geometry" }).getAttribute("aria-pressed"),
    ).toBe("false")
    expect(screen.getByRole("button", { name: "Dimension" })).toBeTruthy()
    expect(screen.getByRole("button", { name: "Constraint tools" })).toBeTruthy()
    const toolbarActions = screen
      .getAllByRole("button")
      .map((button) => button.getAttribute("aria-label"))
    expect(toolbarActions.indexOf("Line tools")).toBeLessThan(toolbarActions.indexOf("Arc tools"))
    expect(toolbarActions.indexOf("Arc tools")).toBeLessThan(
      toolbarActions.indexOf("Rectangle tools"),
    )
    expect(toolbarActions.indexOf("Polygon tools")).toBeGreaterThan(
      toolbarActions.indexOf("Slot tools"),
    )
    expect(toolbarActions.indexOf("Dimension")).toBeLessThan(toolbarActions.indexOf("Trim"))
    await user.click(screen.getByRole("button", { name: "Use external geometry" }))
    expect(actions.setSketchTool).toHaveBeenCalledWith("use")

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

    await user.click(screen.getByRole("button", { name: "Rectangle tools" }))
    await user.click(screen.getByRole("menuitemradio", { name: "Centered aligned rectangle" }))
    expect(actions.setSketchTool).toHaveBeenCalledWith("centered-aligned-rectangle")

    await user.click(screen.getByRole("button", { name: "Line tools" }))
    await user.click(screen.getByRole("menuitemradio", { name: "Midpoint line" }))
    expect(actions.setSketchTool).toHaveBeenCalledWith("midpoint-line")
    await user.click(screen.getByRole("button", { name: "Line tools" }))
    expect(
      screen.getByRole("menuitemradio", { name: "Midpoint line" }).getAttribute("aria-checked"),
    ).toBe("true")
    await user.keyboard("{Escape}")

    await user.click(screen.getByRole("button", { name: "Constraint tools" }))
    await user.click(screen.getByRole("menuitemradio", { name: "Point on line" }))
    expect(actions.setSketchTool).toHaveBeenCalledWith("constraint-point-on-line")

    await user.click(screen.getByRole("button", { name: "Circle tools" }))
    await user.click(screen.getByRole("menuitemradio", { name: "Three-point circle" }))
    expect(actions.setSketchTool).toHaveBeenCalledWith("three-point-circle")

    await user.click(screen.getByRole("button", { name: "Circle tools" }))
    await user.click(screen.getByRole("menuitemradio", { name: "Center-point ellipse" }))
    expect(actions.setSketchTool).toHaveBeenCalledWith("ellipse")

    await user.click(screen.getByRole("button", { name: "Polygon tools" }))
    await user.click(screen.getByRole("menuitemradio", { name: "Circumscribed polygon" }))
    expect(actions.setSketchTool).toHaveBeenCalledWith("circumscribed-polygon")
    expect(screen.getByRole("button", { name: "Circumscribed polygon" })).toBeTruthy()

    await user.click(screen.getByRole("button", { name: "Polygon tools" }))
    await user.click(screen.getByRole("menuitemradio", { name: "Inscribed polygon" }))
    expect(actions.setSketchTool).toHaveBeenCalledWith("inscribed-polygon")

    await user.click(screen.getByRole("button", { name: "Slot tools" }))
    await user.click(screen.getByRole("menuitemradio", { name: "Straight slot" }))
    expect(actions.setSketchTool).toHaveBeenCalledWith("slot")

    await user.click(screen.getByRole("button", { name: "Slot tools" }))
    await user.click(screen.getByRole("menuitemradio", { name: "Centered slot" }))
    expect(actions.setSketchTool).toHaveBeenCalledWith("centered-slot")

    await user.click(screen.getByRole("button", { name: "Slot tools" }))
    await user.click(screen.getByRole("menuitemradio", { name: "Slot from selected line" }))
    expect(actions.setSketchTool).toHaveBeenCalledWith("slot-from-selection")

    await user.click(screen.getByRole("button", { name: "Arc tools" }))
    await user.click(screen.getByRole("menuitemradio", { name: "Three-point arc A" }))
    expect(actions.setSketchTool).toHaveBeenCalledWith("three-point-arc")

    await user.click(screen.getByRole("button", { name: "Arc tools" }))
    await user.click(screen.getByRole("menuitemradio", { name: "Tangent arc Shift+A" }))
    expect(actions.setSketchTool).toHaveBeenCalledWith("tangent-arc")

    await user.click(screen.getByRole("button", { name: "Trim" }))
    expect(actions.setSketchTool).toHaveBeenCalledWith("trim")

    await user.click(screen.getByRole("button", { name: "Extend" }))
    expect(actions.setSketchTool).toHaveBeenCalledWith("extend")

    await user.click(screen.getByRole("button", { name: "Mirror" }))
    expect(actions.setSketchTool).toHaveBeenCalledWith("mirror")

    await user.click(screen.getByRole("button", { name: "Offset" }))
    expect(actions.setSketchTool).toHaveBeenCalledWith("offset")

    await user.click(screen.getByRole("button", { name: "Linear pattern" }))
    expect(actions.setSketchTool).toHaveBeenCalledWith("linear-pattern")

    await user.click(screen.getByRole("button", { name: "Circular pattern" }))
    expect(actions.setSketchTool).toHaveBeenCalledWith("circular-pattern")

    await user.click(screen.getByRole("button", { name: "Split" }))
    expect(actions.setSketchTool).toHaveBeenCalledWith("split")

    await user.click(screen.getByRole("button", { name: "Transform" }))
    expect(actions.setSketchTool).toHaveBeenCalledWith("transform")

    await user.click(screen.getByRole("button", { name: "Construction geometry" }))
    expect(actions.setSketchConstruction).toHaveBeenCalledWith(true)

    await user.click(screen.getByRole("button", { name: "Orbit 3D view" }))
    await user.click(screen.getByRole("button", { name: "Normal to sketch" }))
    expect(actions.setSketchCameraMode).toHaveBeenNthCalledWith(1, "orbit")
    expect(actions.setSketchCameraMode).toHaveBeenNthCalledWith(2, "normal")

    await user.click(screen.getByRole("button", { name: "Undo" }))
    expect(actions.undoSketch).toHaveBeenCalledTimes(1)
  }, 15_000)

  it("keeps workspace switches out of the toolbar and focuses creation commands", async () => {
    const user = userEvent.setup()
    renderToolbar()

    await user.tab()
    expect(screen.queryByRole("button", { name: "Model" })).toBeNull()
    expect(screen.queryByRole("button", { name: "Sketch" })).toBeNull()
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Create sketch" }))
    await user.keyboard("{ArrowRight}")
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Extrude" }))
  })

  it("includes blocked commands in roving focus and describes their prerequisite on focus", async () => {
    const user = userEvent.setup()
    renderToolbar()
    const createSketch = screen.getByRole("button", { name: "Create sketch" })
    createSketch.focus()

    await user.keyboard("{ArrowRight}")
    const extrude = screen.getByRole("button", { name: "Extrude" })
    expect(document.activeElement).toBe(extrude)
    expect(extrude).toHaveProperty("disabled", false)
    const descriptionId = extrude.getAttribute("aria-describedby")
    expect(descriptionId).toBeTruthy()
    expect(document.getElementById(descriptionId ?? "")?.textContent).toBe(
      "Select a closed sketch profile first.",
    )
    expect((await screen.findByRole("tooltip")).textContent).toContain(
      "Select a closed sketch profile first.",
    )
    expect(actions.createExtrusion).not.toHaveBeenCalled()
  })

  it.each(["{Enter}", " "])(
    "opens a blocked reason with %s and restores toolbar focus on Escape without invoking the command",
    async (key) => {
      const user = userEvent.setup()
      const invoke = vi.fn()
      renderToolbar(
        commands().map((command) =>
          command.descriptor.id === editorCommandIds.createExtrusion
            ? { ...command, invoke }
            : command,
        ),
      )
      const extrude = screen.getByRole("button", { name: "Extrude" })
      extrude.focus()

      await user.keyboard(key)
      const disclosure = await screen.findByRole("dialog", { name: "Extrude" })
      expect(disclosure.textContent).toBe("Select a closed sketch profile first.")
      expect(invoke).not.toHaveBeenCalled()
      expect(actions.createExtrusion).not.toHaveBeenCalled()
      await user.keyboard("{Escape}")
      await waitFor(() => expect(screen.queryByRole("dialog", { name: "Extrude" })).toBeNull())
      expect(document.activeElement).toBe(extrude)
      await user.keyboard("{ArrowRight}")
      expect(document.activeElement).toBe(screen.getByRole("button", { name: "Revolve" }))
    },
  )

  it("reveals a blocked command's reason on a touch tap without invoking it", async () => {
    const user = userEvent.setup()
    const invoke = vi.fn()
    renderToolbar(
      commands().map((command) =>
        command.descriptor.id === editorCommandIds.createExtrusion
          ? { ...command, invoke }
          : command,
      ),
    )
    const extrude = screen.getByRole("button", { name: "Extrude" })

    await user.pointer([
      { keys: "[TouchA>]", target: extrude },
      { keys: "[/TouchA]", target: extrude },
    ])

    expect((await screen.findByRole("dialog", { name: "Extrude" })).textContent).toBe(
      "Select a closed sketch profile first.",
    )
    expect(actions.createExtrusion).not.toHaveBeenCalled()
    expect(invoke).not.toHaveBeenCalled()
  })

  it("keeps primary model actions direct and groups remaining commands in named icon menus", async () => {
    const user = userEvent.setup()
    renderToolbar()
    const modeling = screen.getByRole("group", { name: "Modeling actions" })
    const history = screen.getByRole("group", { name: "History" })
    expect(history.classList.contains("border")).toBe(false)
    expect(within(history).getByText("History").classList.contains("sr-only")).toBe(true)
    expect(
      within(modeling)
        .getAllByRole("button")
        .map((button) => button.ariaLabel),
    ).toEqual(["Create sketch", "Extrude", "Revolve"])
    for (const label of ["Create", "Modify", "Primitives"]) {
      expect(screen.getByRole("button", { name: label }).textContent).toBe("")
    }
    expect(screen.queryByRole("button", { name: "Inspect" })).toBeNull()
    expect(screen.getByRole("button", { name: "Measure" })).toBeTruthy()
    expect(
      within(history)
        .getAllByRole("button")
        .map((button) => button.getAttribute("aria-label")),
    ).toEqual(["Undo", "Redo"])

    await user.click(screen.getByRole("button", { name: "Create" }))
    expect(screen.getByRole("menuitem", { name: "Datum plane" })).toBeTruthy()
    expect(screen.getByRole("menuitem", { name: "Loft" })).toBeTruthy()
    expect(screen.getByRole("menuitem", { name: "Sweep" })).toBeTruthy()
    expect(screen.queryByRole("menuitem", { name: "Subtract" })).toBeNull()
    await user.keyboard("{Escape}")
    await user.click(screen.getByRole("button", { name: "Modify" }))
    expect(screen.getByRole("option", { name: "Subtract" })).toBeTruthy()
    await user.keyboard("{Escape}")
    await user.click(screen.getByRole("button", { name: "Measure" }))
    expect(actions.measure).toHaveBeenCalledTimes(1)
  })

  it("exposes all basic primitives through the shared command handlers", async () => {
    const user = userEvent.setup()
    renderToolbar()
    for (const key of ["createSphere", "createCone", "createTorus", "createPyramid"] as const) {
      const label = {
        createSphere: "Sphere",
        createCone: "Cone",
        createTorus: "Torus",
        createPyramid: "Pyramid",
      }[key]
      await user.click(screen.getByRole("button", { name: "Primitives" }))
      await user.click(screen.getByRole("menuitem", { name: label }))
      expect(actions[key]).toHaveBeenCalledTimes(1)
    }
  })

  it("preserves every visible model command exactly once through its shared handler", async () => {
    const user = userEvent.setup()
    const modelCommands = commands()
      .filter(
        ({ descriptor, toolbarVisible }) =>
          toolbarVisible &&
          ["model-primary", "model-primitives", "model-inspection"].includes(
            descriptor.toolbarGroup ?? "",
          ),
      )
      .map((command) => ({
        ...command,
        eligibility: { enabled: true as const },
        invoke: vi.fn(),
      }))
    renderToolbar(modelCommands)

    for (const button of screen.getAllByRole("button")) {
      if (button.dataset.responsiveCommand) await user.click(button)
    }
    for (const name of ["Create", "Modify", "Primitives", "Inspect"]) {
      const menu = screen.queryByRole("button", { name })
      if (!menu) continue
      await user.click(menu)
      const role = screen.queryByRole("dialog") ? "option" : "menuitem"
      const labels = screen.getAllByRole(role).map((item) => item.ariaLabel ?? "")
      for (const [index, label] of labels.entries()) {
        if (index > 0) await user.click(screen.getByRole("button", { name }))
        await user.click(screen.getByRole(role, { name: label }))
      }
    }
    for (const command of modelCommands) {
      expect(command.invoke).toHaveBeenCalledTimes(1)
    }
  }, 15_000)

  it("keeps unclassified model commands reachable in Modify", async () => {
    const user = userEvent.setup()
    renderToolbar(
      commands().map((command) =>
        command.descriptor.id === editorCommandIds.createBox
          ? {
              ...command,
              descriptor: { ...command.descriptor, toolbarGroup: "model-primary" as const },
            }
          : command,
      ),
    )
    await user.click(screen.getByRole("button", { name: "Modify" }))
    await user.click(screen.getByRole("option", { name: "Box" }))
    expect(actions.createBox).toHaveBeenCalledTimes(1)
  })

  it("shows disabled prerequisites in the named menu and prevents invocation", async () => {
    const user = userEvent.setup()
    renderToolbar()
    await user.click(screen.getByRole("button", { name: "Create" }))
    const loft = screen.getByRole("menuitem", { name: "Loft" })
    expect(loft.getAttribute("aria-disabled")).toBe("true")
    expect(document.getElementById(loft.getAttribute("aria-describedby") ?? "")?.textContent).toBe(
      "Create and save a sketch first.",
    )
    fireEvent.click(loft)
    expect(actions.createLoft).not.toHaveBeenCalled()
  })

  it("opens labeled menus by keyboard, invokes the command, and restores focus", async () => {
    const user = userEvent.setup()
    renderToolbar()
    const create = screen.getByRole("button", { name: "Create" })
    create.focus()
    await user.keyboard("{ArrowDown}")
    expect(document.activeElement).toBe(screen.getByRole("menuitem", { name: "Datum plane" }))
    await user.keyboard("{Enter}")
    expect(actions.createDatumPlane).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(document.activeElement).toBe(create))
    await user.keyboard("{ArrowDown}{Escape}")
    await waitFor(() => expect(document.activeElement).toBe(create))
  })

  it("indicates an active command on its menu trigger and item", async () => {
    const user = userEvent.setup()
    renderToolbar(commands({ activePartDesignCommand: "loft" }))
    const create = screen.getByRole("button", { name: "Create" })
    expect(create.getAttribute("aria-current")).toBe("true")
    expect(screen.getByRole("button", { name: "Modify" }).hasAttribute("aria-current")).toBe(false)
    await user.click(create)
    expect(screen.getByRole("menuitem", { name: "Loft" }).getAttribute("aria-current")).toBe("true")
    expect(screen.getByRole("menuitem", { name: "Loft" }).querySelectorAll("svg")).toHaveLength(2)
  })

  it("shows committed history only in idle model mode", () => {
    renderToolbar()
    expect(screen.getByRole("button", { name: "Undo" })).toBeTruthy()
    expect(screen.getByRole("button", { name: "Redo" })).toBeTruthy()

    cleanup()
    renderToolbar(commands({ activePartDesignCommand: "box" }))
    expect(screen.queryByRole("button", { name: "Undo" })).toBeNull()
    expect(screen.queryByRole("button", { name: "Redo" })).toBeNull()

    cleanup()
    const sketchCommands = commands({
      activeSketchTool: { kind: "create-sketch" },
      workspace: "sketch",
      sketchUndoAvailable: true,
    })
    renderToolbar(sketchCommands)
    expect(
      sketchCommands.find(({ descriptor }) => descriptor.id === editorCommandIds.documentUndo)
        ?.toolbarVisible,
    ).toBe(false)
    expect(screen.getByRole("button", { name: "Undo" })).toBeTruthy()
  })

  it("omits the sketch diagnostics slot outside active sketch editing", () => {
    renderToolbar()

    expect(document.querySelector("[data-sketch-constraint-manager-toolbar-slot]")).toBeNull()
  })

  it("keeps sketch modification commands available in the compact overflow menu", async () => {
    const user = userEvent.setup()
    renderToolbar(
      commands({
        activeSketchTool: { kind: "create-sketch" },
        workspace: "sketch",
      }),
    )

    await user.click(screen.getByRole("button", { name: "Sketch modification tools" }))
    await user.click(screen.getByRole("option", { name: "Extend" }))

    expect(actions.setSketchTool).toHaveBeenCalledWith("extend")
  })

  it("shows Extrude and Revolve as separate sketch toolbar commands", async () => {
    const user = userEvent.setup()
    actions.createExtrusion.mockImplementation(() => new Promise<boolean>(() => undefined))
    renderToolbar(
      commands({
        activeSketchTool: { kind: "create-sketch" },
        extrusionAvailable: true,
        revolveAvailable: true,
        workspace: "sketch",
      }),
    )

    const extrude = screen.getByRole("button", { name: "Extrude" })
    const revolve = screen.getByRole("button", { name: "Revolve" })
    expect(screen.queryByRole("button", { name: "Profile features" })).toBeNull()

    await user.dblClick(extrude)
    expect(actions.createExtrusion).toHaveBeenCalledTimes(1)
    expect(extrude.getAttribute("aria-busy")).toBe("true")

    await user.click(revolve)
    expect(actions.createRevolve).toHaveBeenCalledTimes(1)
    expect(screen.getByRole("button", { name: "Extrude" })).toBeTruthy()
    expect(screen.getByRole("button", { name: "Revolve" })).toBeTruthy()
  })
})

describe("contextual Part toolbar", () => {
  const selectedExactPartId = partIdSchema.parse("10000000-0000-7000-8000-000000000001")
  it("reveals accessible icon actions for an exact current Part and dispatches its identity", async () => {
    renderToolbar(commands({ selectedExactPartId, partCombinationAvailable: true }))
    const group = screen.getByRole("group", { name: "Selected part actions" })
    for (const name of [
      "Place / align faces",
      "Mirror",
      "Shell",
      "Split",
      "Pattern",
      "Thread",
      "Compound",
      "Union",
    ]) {
      const button = within(group).getByRole("button", { name })
      expect(button.querySelector("svg")).toBeTruthy()
      expect(button.textContent).toBe("")
      await userEvent.click(button)
    }
    expect(actions.placePart).toHaveBeenCalledWith(selectedExactPartId)
    expect(actions.threadPart).toHaveBeenCalledWith(selectedExactPartId)
    expect(actions.combineParts.mock.calls).toEqual([["compound"], ["union"]])
  })
  it.each([
    {},
    { selectedExactPartId, activePartDesignCommand: "placement" as const },
    { selectedExactPartId, workspace: "sketch" as const },
  ])("hides Part actions outside an idle eligible selection", (state) => {
    renderToolbar(commands(state))
    expect(screen.queryByRole("group", { name: "Selected part actions" })).toBeNull()
  })
  it("hides combinations when fewer than two exact bodies are available", () => {
    renderToolbar(commands({ selectedExactPartId, partCombinationAvailable: false }))
    expect(screen.getByRole("button", { name: "Place / align faces" })).toBeTruthy()
    expect(screen.queryByRole("button", { name: "Compound" })).toBeNull()
    expect(screen.queryByRole("button", { name: "Union" })).toBeNull()
  })
})
