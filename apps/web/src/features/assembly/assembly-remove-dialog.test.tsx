// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { I18nProvider } from "@vibeshape/i18n/provider"
import { afterEach, describe, expect, it, vi } from "vitest"
import { i18n } from "../../i18n"
import { authoredTestId as id } from "../../test-support/authored-tree-fixture"
import { AssemblyRemoveDialog } from "./assembly-remove-dialog"

afterEach(cleanup)
function dialog(kind: "definition" | "instance", pending = false) {
  const onApply = vi.fn().mockResolvedValue(false)
  const onClose = vi.fn()
  render(
    <I18nProvider i18n={i18n} initialLocale="en">
      <AssemblyRemoveDialog
        removal={{ kind, id: id(740), name: "Bracket", revision: 7 }}
        pending={pending}
        error={null}
        onApply={onApply}
        onClose={onClose}
      />
    </I18nProvider>,
  )
  return { onApply, onClose }
}
describe("Assembly removal review", () => {
  it.each(["definition", "instance"] as const)(
    "requires explicit cascade and preserves a rejected %s removal for retry",
    async (kind) => {
      const ports = dialog(kind)
      const remove = screen.getByRole("button", { name: "Remove" })
      await userEvent.click(remove)
      expect(ports.onApply).toHaveBeenCalledWith(
        [expect.objectContaining({ kind: `${kind}.remove`, cascade: false })],
        7,
      )
      expect(ports.onClose).not.toHaveBeenCalled()
      await userEvent.click(
        screen.getByRole("checkbox", { name: "Also remove dependent instance subtrees" }),
      )
      ports.onApply.mockResolvedValueOnce(true)
      await userEvent.click(remove)
      expect(ports.onApply).toHaveBeenLastCalledWith(
        [expect.objectContaining({ kind: `${kind}.remove`, cascade: true })],
        7,
      )
      expect(ports.onClose).toHaveBeenCalledOnce()
    },
  )
  it("prevents changes and duplicate activation while the atomic removal is pending", async () => {
    const ports = dialog("instance", true)
    const remove = screen.getByRole("button", { name: "Remove" })
    expect(remove.getAttribute("aria-busy")).toBe("true")
    expect(screen.getByRole("checkbox").hasAttribute("disabled")).toBe(true)
    await userEvent.click(remove)
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }))
    expect(ports.onApply).not.toHaveBeenCalled()
    expect(ports.onClose).not.toHaveBeenCalled()
  })
})
