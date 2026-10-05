// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { Dialog, DialogContent } from "@vibeshape/ui/components/dialog"
import { type ReactNode, useState } from "react"
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
const documentUndoCommand: ResolvedEditorCommand = {
  ...undoCommand,
  descriptor: {
    ...undoCommand.descriptor,
    group: "history",
    id: editorCommandIds.documentUndo,
    labelKey: "documentUndo",
    ownerModuleId: "org.vibeshape.core.editor",
  },
}

function ShortcutHarness({
  commands = [lineCommand],
  sketchShortcutToolbarAvailable = false,
  sketchShortcutToolbarOpen = false,
  paletteOpen = false,
  children,
}: {
  commands?: ResolvedEditorCommand[]
  sketchShortcutToolbarAvailable?: boolean
  sketchShortcutToolbarOpen?: boolean
  paletteOpen?: boolean
  children?: ReactNode
}) {
  useEditorCommandShortcuts({
    commands,
    paletteOpen,
    sketchShortcutToolbarAvailable,
    sketchShortcutToolbarOpen,
    onPaletteOpenChange: paletteChange,
    onSketchShortcutToolbarOpenChange: sketchShortcutToolbarChange,
  })
  return (
    <>
      {children}
      <input aria-label="Expression" />
    </>
  )
}

function NavigationHoldHarness({
  initiallyNavigating = false,
  available = true,
  paletteOpen = false,
  onNavigation = vi.fn(),
  onEditing = vi.fn(),
  children,
}: {
  initiallyNavigating?: boolean
  available?: boolean
  paletteOpen?: boolean
  onNavigation?: () => void
  onEditing?: () => void
  children?: ReactNode
}) {
  const [navigating, setNavigating] = useState(initiallyNavigating)
  const navigation: ResolvedEditorCommand = {
    ...lineCommand,
    active: navigating,
    descriptor: {
      ...lineCommand.descriptor,
      id: editorCommandIds.sketchNavigateView,
      labelKey: "sketchNavigateView",
      shortcut: { key: "Space" },
    },
    eligibility: available ? editorCommandEnabled() : { enabled: false, reason: "requiresSketch" },
    invoke: () => {
      onNavigation()
      setNavigating(!navigating)
    },
  }
  const editing: ResolvedEditorCommand = {
    ...navigation,
    descriptor: { ...navigation.descriptor, id: editorCommandIds.sketchOrbitView },
    invoke: () => {
      onEditing()
      setNavigating(false)
    },
  }
  return (
    <ShortcutHarness commands={[navigation, editing]} paletteOpen={paletteOpen}>
      <output aria-label="Navigation state">{navigating ? "navigation" : "editing"}</output>
      {children}
    </ShortcutHarness>
  )
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe("useEditorCommandShortcuts", () => {
  it("holds Space for navigation, ignores repeat, and resumes editing once on release", () => {
    const onNavigation = vi.fn(),
      onEditing = vi.fn()
    render(<NavigationHoldHarness onNavigation={onNavigation} onEditing={onEditing} />)
    fireEvent.keyDown(document.body, { key: " ", code: "Space" })
    expect(screen.getByLabelText("Navigation state").textContent).toBe("navigation")
    fireEvent.keyDown(document.body, { key: " ", code: "Space", repeat: true })
    expect(onNavigation).toHaveBeenCalledOnce()
    fireEvent.keyUp(document.body, { key: " ", code: "Space" })
    fireEvent.keyUp(document.body, { key: " ", code: "Space" })
    expect(screen.getByLabelText("Navigation state").textContent).toBe("editing")
    expect(onEditing).toHaveBeenCalledOnce()
  })

  it("releases a held navigation mode when window focus is lost", () => {
    const onEditing = vi.fn()
    render(<NavigationHoldHarness onEditing={onEditing} />)
    fireEvent.keyDown(document.body, { key: " ", code: "Space" })
    fireEvent.blur(window)
    expect(screen.getByLabelText("Navigation state").textContent).toBe("editing")
    fireEvent.keyUp(document.body, { key: " ", code: "Space" })
    expect(onEditing).toHaveBeenCalledOnce()
  })

  it("preserves navigation explicitly enabled before the Space hold", () => {
    const onNavigation = vi.fn(),
      onEditing = vi.fn()
    render(
      <NavigationHoldHarness
        initiallyNavigating
        onNavigation={onNavigation}
        onEditing={onEditing}
      />,
    )
    fireEvent.keyDown(document.body, { key: " ", code: "Space" })
    fireEvent.keyUp(document.body, { key: " ", code: "Space" })
    expect(screen.getByLabelText("Navigation state").textContent).toBe("navigation")
    expect(onNavigation).not.toHaveBeenCalled()
    expect(onEditing).not.toHaveBeenCalled()
  })

  it("leaves Space to text fields, native buttons and modified shortcuts", async () => {
    const user = userEvent.setup()
    const onNavigation = vi.fn(),
      click = vi.fn()
    render(
      <NavigationHoldHarness onNavigation={onNavigation}>
        <button type="button" onClick={click}>
          Action
        </button>
      </NavigationHoldHarness>,
    )
    await user.click(screen.getByRole("textbox", { name: "Expression" }))
    await user.keyboard(" ")
    expect(screen.getByRole("textbox", { name: "Expression" })).toHaveProperty("value", " ")
    screen.getByRole("button", { name: "Action" }).focus()
    await user.keyboard(" ")
    expect(click).toHaveBeenCalledOnce()
    fireEvent.keyDown(document.body, { key: " ", code: "Space", ctrlKey: true })
    expect(onNavigation).not.toHaveBeenCalled()
  })

  it("releases the hold before opening the command palette and cannot reopen a closed sketch", () => {
    const onNavigation = vi.fn(),
      onEditing = vi.fn()
    const view = render(<NavigationHoldHarness onNavigation={onNavigation} onEditing={onEditing} />)
    fireEvent.keyDown(document.body, { key: " ", code: "Space" })
    view.rerender(
      <NavigationHoldHarness paletteOpen onNavigation={onNavigation} onEditing={onEditing} />,
    )
    expect(screen.getByLabelText("Navigation state").textContent).toBe("editing")
    expect(onEditing).toHaveBeenCalledOnce()
    fireEvent.keyUp(document.body, { key: " ", code: "Space" })
    fireEvent.keyDown(document.body, { key: " ", code: "Space" })
    expect(onNavigation).toHaveBeenCalledOnce()
    view.rerender(<NavigationHoldHarness onNavigation={onNavigation} onEditing={onEditing} />)
    fireEvent.keyDown(document.body, { key: " ", code: "Space" })
    expect(onNavigation).toHaveBeenCalledTimes(2)
    view.rerender(
      <NavigationHoldHarness available={false} onNavigation={onNavigation} onEditing={onEditing} />,
    )
    fireEvent.keyUp(document.body, { key: " ", code: "Space" })
    expect(onEditing).toHaveBeenCalledOnce()
  })

  it("does not capture Space inside a modal dialog", () => {
    const onNavigation = vi.fn()
    render(
      <NavigationHoldHarness onNavigation={onNavigation}>
        <div role="dialog" aria-modal="true" tabIndex={-1}>
          Modal
        </div>
      </NavigationHoldHarness>,
    )
    fireEvent.keyDown(screen.getByRole("dialog"), { key: " ", code: "Space" })
    expect(onNavigation).not.toHaveBeenCalled()
  })

  it("releases a hold when the document becomes hidden", () => {
    const onEditing = vi.fn()
    render(<NavigationHoldHarness onEditing={onEditing} />)
    fireEvent.keyDown(document.body, { key: " ", code: "Space" })
    const hidden = vi.spyOn(document, "hidden", "get").mockReturnValue(true)
    fireEvent(document, new Event("visibilitychange"))
    hidden.mockRestore()
    expect(screen.getByLabelText("Navigation state").textContent).toBe("editing")
    expect(onEditing).toHaveBeenCalledOnce()
  })

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

  it("matches letters case-insensitively and rejects unregistered extra modifiers", async () => {
    const user = userEvent.setup()
    render(<ShortcutHarness />)

    await user.keyboard("{Shift>}L{/Shift}")
    await user.keyboard("{Control>}l{/Control}")
    expect(invokeLine).not.toHaveBeenCalled()
    await user.keyboard("L")
    expect(invokeLine).toHaveBeenCalledOnce()
  })

  it.each([
    ["composing", { isComposing: true }],
    ["repeated", { repeat: true }],
    ["already prevented", { defaultPrevented: true }],
  ])("ignores %s shortcut events, including the palette shortcut", (_label, init) => {
    render(<ShortcutHarness />)
    const event = new KeyboardEvent("keydown", {
      key: "k",
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
      ...init,
    })
    if ("defaultPrevented" in init && init.defaultPrevented) event.preventDefault()
    document.body.dispatchEvent(event)
    expect(paletteChange).not.toHaveBeenCalled()
  })

  it.each(["", "plaintext-only"])(
    "treats contenteditable=%s descendants as text input",
    async (editable) => {
      const user = userEvent.setup()
      const { container } = render(
        <ShortcutHarness>
          <div contentEditable={editable === "plaintext-only" ? "plaintext-only" : true}>
            <span>focusable text</span>
          </div>
        </ShortcutHarness>,
      )
      const editableHost = container.querySelector("[contenteditable]")
      const editableTarget = editableHost?.firstElementChild
      if (!(editableTarget instanceof HTMLElement)) throw new Error("Editable target is missing")
      await user.click(editableTarget)
      editableTarget.dispatchEvent(new KeyboardEvent("keydown", { key: "l", bubbles: true }))
      expect(invokeLine).not.toHaveBeenCalled()
    },
  )

  it("leaves global commands and the palette alone while a modal owns focus", () => {
    render(
      <ShortcutHarness>
        <Dialog open>
          <DialogContent closeLabel="Close">
            <button type="button">Modal action</button>
          </DialogContent>
        </Dialog>
      </ShortcutHarness>,
    )
    const button = screen.getByRole("button", { name: "Modal action" })
    button.focus()
    button.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))
    button.dispatchEvent(new KeyboardEvent("keydown", { key: "k", ctrlKey: true, bubbles: true }))
    expect(invokeCancel).not.toHaveBeenCalled()
    expect(paletteChange).not.toHaveBeenCalled()
  })

  it("fails closed when two enabled commands claim the same shortcut", async () => {
    const user = userEvent.setup()
    const duplicate: ResolvedEditorCommand = { ...lineCommand, invoke: vi.fn() }
    render(<ShortcutHarness commands={[lineCommand, duplicate]} />)
    await user.keyboard("l")
    expect(invokeLine).not.toHaveBeenCalled()
    expect(duplicate.invoke).not.toHaveBeenCalled()
  })

  it("uses the latest command callbacks after rerender", async () => {
    const user = userEvent.setup()
    const latest = vi.fn()
    const { rerender } = render(<ShortcutHarness />)
    rerender(<ShortcutHarness commands={[{ ...lineCommand, invoke: latest }]} />)
    await user.keyboard("l")
    expect(latest).toHaveBeenCalledOnce()
    expect(invokeLine).not.toHaveBeenCalled()
  })

  it("removes its document listener on unmount", () => {
    const addListener = vi.spyOn(document, "addEventListener")
    const removeListener = vi.spyOn(document, "removeEventListener")
    const { unmount } = render(<ShortcutHarness />)
    unmount()
    const addedKeydown = addListener.mock.calls.find(([type]) => type === "keydown")
    expect(addedKeydown).toBeDefined()
    expect(removeListener).toHaveBeenCalledWith("keydown", addedKeydown?.[1])
    addListener.mockRestore()
    removeListener.mockRestore()
  })

  it("reserves Ctrl/Cmd+K for the command palette even from text input", async () => {
    const user = userEvent.setup()
    render(<ShortcutHarness />)

    await user.click(screen.getByRole("textbox", { name: "Expression" }))
    await user.keyboard("{Control>}k{/Control}")
    expect(paletteChange).toHaveBeenCalledWith(true)
  })

  it("does not reserve Ctrl/Cmd+Shift+K for the command palette", () => {
    render(<ShortcutHarness />)
    document.body.dispatchEvent(
      new KeyboardEvent("keydown", { key: "k", ctrlKey: true, shiftKey: true, bubbles: true }),
    )
    expect(paletteChange).not.toHaveBeenCalled()
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

  it("keeps typing and Escape command ownership inside a text field in the shortcut toolbar", async () => {
    const user = userEvent.setup()
    render(
      <ShortcutHarness
        commands={[cancelCommand]}
        sketchShortcutToolbarAvailable
        sketchShortcutToolbarOpen
      >
        <input aria-label="Shortcut filter" />
      </ShortcutHarness>,
    )

    const filter = screen.getByRole("textbox", { name: "Shortcut filter" })
    await user.click(filter)
    await user.keyboard("s")
    expect((filter as HTMLInputElement).value).toBe("s")
    expect(sketchShortcutToolbarChange).not.toHaveBeenCalled()

    await user.keyboard("{Escape}")
    expect(invokeCancel).toHaveBeenCalledOnce()
  })

  it("routes Ctrl/Cmd+Z to the committed document command when registered", async () => {
    const user = userEvent.setup()
    render(<ShortcutHarness commands={[documentUndoCommand]} />)

    await user.keyboard("{Control>}z{/Control}")

    expect(invokeUndo).toHaveBeenCalledOnce()
  })

  it("allows Escape to cancel the active editor command from text input", async () => {
    const user = userEvent.setup()
    render(<ShortcutHarness commands={[lineCommand, cancelCommand]} />)

    await user.click(screen.getByRole("textbox", { name: "Expression" }))
    await user.keyboard("{Escape}")
    expect(invokeCancel).toHaveBeenCalledOnce()
  })

  it("opens registered F1 help from a text field without consuming text-editing shortcuts", async () => {
    const invokeHelp = vi.fn()
    const help: ResolvedEditorCommand = {
      ...lineCommand,
      descriptor: {
        ...lineCommand.descriptor,
        id: editorCommandIds.openShortcutHelp,
        labelKey: "openShortcutHelp",
        shortcut: { key: "F1" },
      },
      invoke: invokeHelp,
    }
    const user = userEvent.setup()
    render(<ShortcutHarness commands={[help, lineCommand]} />)
    await user.click(screen.getByRole("textbox", { name: "Expression" }))
    await user.keyboard("l{F1}")
    expect(invokeHelp).toHaveBeenCalledOnce()
    expect(invokeLine).not.toHaveBeenCalled()
  })

  it("keeps Escape available from a non-modal task dialog input", () => {
    render(
      <ShortcutHarness commands={[cancelCommand]}>
        <div role="dialog">
          <input aria-label="Task parameter" />
        </div>
      </ShortcutHarness>,
    )
    const input = screen.getByRole("textbox", { name: "Task parameter" })
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))
    expect(invokeCancel).toHaveBeenCalledOnce()
  })
})
