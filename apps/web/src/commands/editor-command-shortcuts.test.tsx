// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { ResolvedEditorCommand } from "./editor-command"
import { editorCommandEnabled, editorCommandIds } from "./editor-command"
import { useEditorCommandShortcuts } from "./editor-command-shortcuts"

const invokeLine = vi.fn()
const invokeCenterRectangle = vi.fn()
const invokeCancel = vi.fn()
const invokeUndo = vi.fn()
const paletteChange = vi.fn()
const sketchShortcutToolbarChange = vi.fn()
const lineCommand: ResolvedEditorCommand = {
  active: false,
  descriptor: {
    group: "sketch",
    icon: "line",
    id: editorCommandIds.sketchLine,
    labelKey: "sketchLine",
    ownerModuleId: "org.vibeshape.core.sketch",
    shortcut: { key: "l" },
  },
  eligibility: editorCommandEnabled(),
  invoke: invokeLine,
  toolbarVisible: true,
}
const cancelCommand: ResolvedEditorCommand = {
  active: false,
  descriptor: {
    group: "workspace",
    icon: "cancel",
    id: editorCommandIds.cancelActive,
    labelKey: "cancelActive",
    ownerModuleId: "org.vibeshape.core.editor",
    shortcut: { key: "Escape" },
  },
  eligibility: editorCommandEnabled(),
  invoke: invokeCancel,
  toolbarVisible: false,
}
const centerRectangleCommand: ResolvedEditorCommand = {
  active: false,
  descriptor: {
    group: "sketch",
    icon: "center-rectangle",
    id: editorCommandIds.sketchCenterRectangle,
    labelKey: "sketchCenterRectangle",
    ownerModuleId: "org.vibeshape.core.sketch",
    shortcut: { key: "r", modifiers: ["shift"] },
  },
  eligibility: editorCommandEnabled(),
  invoke: invokeCenterRectangle,
  toolbarVisible: true,
}
const undoCommand: ResolvedEditorCommand = {
  active: false,
  descriptor: {
    group: "sketch",
    icon: "undo",
    id: editorCommandIds.sketchUndo,
    labelKey: "sketchUndo",
    ownerModuleId: "org.vibeshape.core.sketch",
    shortcut: { key: "z", modifiers: ["mod"] },
  },
  eligibility: editorCommandEnabled(),
  invoke: invokeUndo,
  toolbarVisible: true,
}

function ShortcutHarness({
  commands = [lineCommand],
  sketchShortcutToolbarAvailable = false,
  sketchShortcutToolbarOpen = false,
}: {
  commands?: ResolvedEditorCommand[]
  sketchShortcutToolbarAvailable?: boolean
  sketchShortcutToolbarOpen?: boolean
}) {
  useEditorCommandShortcuts({
    commands,
    paletteOpen: false,
    sketchShortcutToolbarAvailable,
    sketchShortcutToolbarOpen,
    onPaletteOpenChange: paletteChange,
    onSketchShortcutToolbarOpenChange: sketchShortcutToolbarChange,
  })
  return <input aria-label="Expression" />
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe("useEditorCommandShortcuts", () => {
  it("invokes a registered single-letter shortcut outside text input", async () => {
    const user = userEvent.setup()
    render(<ShortcutHarness />)

    await user.keyboard("l")
    expect(invokeLine).toHaveBeenCalledOnce()
  })

  it("does not capture single-letter shortcuts while the user is typing", async () => {
    const user = userEvent.setup()
    render(<ShortcutHarness />)

    await user.click(screen.getByRole("textbox", { name: "Expression" }))
    await user.keyboard("l")
    expect(invokeLine).not.toHaveBeenCalled()
    expect((screen.getByRole("textbox", { name: "Expression" }) as HTMLInputElement).value).toBe(
      "l",
    )
  })

  it("matches a registered Shift modifier exactly", async () => {
    const user = userEvent.setup()
    render(<ShortcutHarness commands={[lineCommand, centerRectangleCommand]} />)

    await user.keyboard("r")
    expect(invokeCenterRectangle).not.toHaveBeenCalled()
    await user.keyboard("{Shift>}r{/Shift}")
    expect(invokeCenterRectangle).toHaveBeenCalledOnce()
  })

  it("reserves Ctrl/Cmd+K for the command palette even from text input", async () => {
    const user = userEvent.setup()
    render(<ShortcutHarness />)

    await user.click(screen.getByRole("textbox", { name: "Expression" }))
    await user.keyboard("{Control>}k{/Control}")
    expect(paletteChange).toHaveBeenCalledWith(true)
  })

  it("opens the sketch shortcut toolbar with S only while sketch editing is available", async () => {
    const user = userEvent.setup()
    const { rerender } = render(<ShortcutHarness />)

    await user.keyboard("s")
    expect(sketchShortcutToolbarChange).not.toHaveBeenCalled()

    rerender(<ShortcutHarness sketchShortcutToolbarAvailable />)
    await user.keyboard("s")
    expect(sketchShortcutToolbarChange).toHaveBeenCalledWith(true)
  })

  it("does not open the sketch shortcut toolbar while typing", async () => {
    const user = userEvent.setup()
    render(<ShortcutHarness sketchShortcutToolbarAvailable />)

    await user.click(screen.getByRole("textbox", { name: "Expression" }))
    await user.keyboard("s")

    expect(sketchShortcutToolbarChange).not.toHaveBeenCalled()
  })

  it("closes the sketch shortcut toolbar before the active editor command", async () => {
    const user = userEvent.setup()
    render(
      <ShortcutHarness
        commands={[cancelCommand]}
        sketchShortcutToolbarAvailable
        sketchShortcutToolbarOpen
      />,
    )

    await user.keyboard("{Escape}")

    expect(sketchShortcutToolbarChange).toHaveBeenCalledWith(false)
    expect(invokeCancel).not.toHaveBeenCalled()
  })

  it("keeps registered shortcuts available while the non-modal sketch toolbar is open", async () => {
    const user = userEvent.setup()
    render(
      <ShortcutHarness
        commands={[undoCommand]}
        sketchShortcutToolbarAvailable
        sketchShortcutToolbarOpen
      />,
    )

    await user.keyboard("{Control>}z{/Control}")

    expect(invokeUndo).toHaveBeenCalledOnce()
    expect(sketchShortcutToolbarChange).not.toHaveBeenCalled()
  })

  it("allows Escape to cancel the active editor command from text input", async () => {
    const user = userEvent.setup()
    render(<ShortcutHarness commands={[lineCommand, cancelCommand]} />)

    await user.click(screen.getByRole("textbox", { name: "Expression" }))
    await user.keyboard("{Escape}")
    expect(invokeCancel).toHaveBeenCalledOnce()
  })
})
