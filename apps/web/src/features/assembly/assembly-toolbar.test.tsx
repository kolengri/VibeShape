import "../../../../../tests/unit/support/dom"
import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { vi } from "../../../../../tests/unit/support/bun-test"
import { i18n } from "../../i18n"
import { asBuiltUiFixture } from "./assembly-as-built-test-fixture"
import type { AssemblyWorkspaceView } from "./use-assembly-workspace"

const { cleanup, fireEvent, render, screen } = await import("@testing-library/react")
const { default: userEvent } = await import("@testing-library/user-event")
const { I18nProvider } = await import("@vibeshape/i18n/provider")
const { TooltipProvider } = await import("@vibeshape/ui/components/tooltip")
const { AssemblyToolbar } = await import("./assembly-toolbar")

function fixture(): AssemblyWorkspaceView {
  const f = asBuiltUiFixture()
  return {
    assembly: f.assembly,
    documentKey: f.capture.documentKey,
    sources: f.sources,
    task: null,
    setTask: vi.fn(),
    removal: null,
    setRemoval: vi.fn(),
    mutations: {
      pending: false,
      error: null,
      apply: vi.fn(),
      rejectStale: vi.fn(),
      rejectPose: vi.fn(),
    },
    inspection: {
      key: f.capture.documentKey,
      pending: false,
      diagnostic: null,
      inspection: f.inspection,
      inspectPairs: vi.fn(),
    },
    selected: {
      instance: f.assembly.instances[0],
      definition: f.definition,
      activeId: f.assembly.instances[0]?.id ?? null,
    },
    definitionId: null,
    disabled: false,
    selectInstance: vi.fn(),
    selectDefinition: vi.fn(),
    openTask: vi.fn(),
    motion: null,
    studyTask: null,
    openStudy: vi.fn(),
    closeStudy: vi.fn(),
    idle: true,
    panelKey: "assembly",
    motionActive: false,
    taskActionsDisabled: false,
    openMotion: vi.fn(),
    closeMotion: vi.fn(),
    setMotionCoordinate: vi.fn(),
    onRemove: vi.fn(),
    ground: vi.fn(),
    upgrade: vi.fn(),
  }
}
function setup(view = fixture()) {
  render(
    <I18nProvider i18n={i18n} initialLocale="en">
      <TooltipProvider>
        <AssemblyToolbar view={view} />
      </TooltipProvider>
    </I18nProvider>,
  )
  return view
}
async function openMenu() {
  fireEvent.keyDown(screen.getByRole("button", { name: "More assembly actions" }), { key: "Enter" })
  await screen.findByRole("menu")
}
beforeEach(() => {
  HTMLElement.prototype.scrollIntoView = vi.fn()
  vi.stubGlobal(
    "ResizeObserver",
    class ResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  )
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})
describe("Assembly command presentation", () => {
  it("keeps frequent commands as named icon controls and the selected-item actions in a labelled menu", async () => {
    const view = setup()
    const toolbar = screen.getByRole("toolbar", { name: "Assembly actions" })
    expect(toolbar.querySelectorAll("button")).toHaveLength(5)
    const add = screen.getByRole("button", { name: "Add instance" })
    expect(add.textContent).toBe("")
    expect(add.getAttribute("title")).toBeNull()
    await userEvent.click(add)
    expect(view.openTask).toHaveBeenCalledWith("addInstance")
    await openMenu()
    expect(screen.getByRole("group", { name: "Create and connect" })).toBeTruthy()
    expect(screen.getByRole("group", { name: "Actions for Member 1" })).toBeTruthy()
    const rename = screen.getByRole("menuitem", { name: "Edit instance" })
    expect(rename.getAttribute("title")).toBeNull()
    expect(rename.hasAttribute("data-slot")).toBe(true)
    await userEvent.click(rename)
    expect(view.openTask).toHaveBeenLastCalledWith("editInstance", view.selected.instance?.id)
  })
  it("exposes pose-preserving authoring and existing upgrade handlers without applying automatically", async () => {
    const view = setup()
    await openMenu()
    await userEvent.click(screen.getByRole("menuitem", { name: "As-built joint" }))
    expect(view.openTask).toHaveBeenCalledWith("asBuiltJoint")
    expect(view.mutations.apply).not.toHaveBeenCalled()
    await openMenu()
    await userEvent.click(screen.getByRole("menuitem", { name: "Rigid group" }))
    expect(view.openTask).toHaveBeenLastCalledWith("rigidGroup")
    await openMenu()
    await userEvent.click(screen.getByRole("menuitem", { name: "Enable general mates" }))
    expect(view.upgrade).toHaveBeenCalledTimes(1)
    expect(view.onRemove).not.toHaveBeenCalled()
  })
  it("retains unavailable, inspection and pending guards for every command", async () => {
    const base = fixture()
    const view = {
      ...base,
      disabled: true,
      taskActionsDisabled: true,
      inspection: { ...base.inspection, pending: true },
    }
    setup(view)
    expect(screen.getByRole("button", { name: "Add joint" }).hasAttribute("disabled")).toBe(true)
    await openMenu()
    for (const item of screen.getAllByRole("menuitem"))
      expect(item.getAttribute("aria-disabled")).toBe("true")
    await userEvent.click(screen.getByRole("menuitem", { name: "Rigid group" }))
    expect(view.openTask).not.toHaveBeenCalled()
    expect(view.upgrade).not.toHaveBeenCalled()
    expect(view.onRemove).not.toHaveBeenCalled()
  })
})
