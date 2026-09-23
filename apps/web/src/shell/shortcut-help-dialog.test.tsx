// @vitest-environment jsdom

import { cleanup, render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { I18nProvider } from "@vibeshape/i18n/provider"
import { afterEach, describe, expect, it, vi } from "vitest"
import { editorCommandIds, type ResolvedEditorCommand } from "../commands/editor-command"
import { i18n } from "../i18n"
import { ShortcutHelpDialog } from "./shortcut-help-dialog"

const line: ResolvedEditorCommand = {
  descriptor: {
    id: editorCommandIds.sketchLine,
    labelKey: "sketchLine",
    ownerModuleId: "org.vibeshape.core.sketch",
    group: "sketch",
    icon: "line",
    shortcut: { key: "l" },
  },
  eligibility: { enabled: false, reason: "requiresSketch" },
  active: false,
  toolbarVisible: false,
  invoke: vi.fn(),
}

afterEach(cleanup)

describe("shortcut help", () => {
  it("reads current command bindings and explains unavailable contexts without invoking them", async () => {
    const user = userEvent.setup()
    const view = (commands: readonly ResolvedEditorCommand[]) => (
      <I18nProvider i18n={i18n} initialLocale="en">
        <ShortcutHelpDialog
          commands={commands}
          open
          onOpenChange={vi.fn()}
          returnFocusRef={{ current: null }}
        />
      </I18nProvider>
    )
    const { rerender } = render(view([line]))
    const list = screen.getByLabelText("Registered keyboard shortcuts")
    expect(within(list).getByText("Line")).toBeTruthy()
    expect(within(list).getByText("Rename the focused sketch or feature")).toBeTruthy()
    expect(within(list).getByText("F2")).toBeTruthy()
    expect(within(list).getByText("Start or edit a sketch first.")).toBeTruthy()
    await user.type(screen.getByRole("textbox", { name: "Search shortcuts…" }), "line")
    expect(within(list).queryByText("Command palette")).toBeNull()
    rerender(view([{ ...line, descriptor: { ...line.descriptor, shortcut: { key: "q" } } }]))
    expect(within(list).getByText("Q")).toBeTruthy()
    expect(line.invoke).not.toHaveBeenCalled()
  })

  it("reports an empty search and exposes accessible close and drag instructions", async () => {
    const user = userEvent.setup()
    const close = vi.fn()
    render(
      <I18nProvider i18n={i18n} initialLocale="en">
        <ShortcutHelpDialog
          commands={[line]}
          open
          onOpenChange={close}
          returnFocusRef={{ current: null }}
        />
      </I18nProvider>,
    )
    await user.type(screen.getByRole("textbox", { name: "Search shortcuts…" }), "not a command")
    expect(screen.getByRole("status").textContent).toBe("No matching shortcuts")
    expect(screen.getByText(/History: drag a grip/)).toBeTruthy()
    await user.click(screen.getByRole("button", { name: "Close keyboard shortcuts" }))
    expect(close).toHaveBeenCalledWith(false)
  })
})
