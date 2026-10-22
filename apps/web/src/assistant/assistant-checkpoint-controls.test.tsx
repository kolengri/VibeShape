import "../../../../tests/unit/support/dom"
import { afterEach, beforeEach, expect, it } from "bun:test"
import { cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { I18nProvider } from "@vibeshape/i18n/provider"
import { vi } from "../../../../tests/unit/support/bun-test"
import { i18n } from "../i18n"
import { AssistantPanel } from "./assistant-panel"

afterEach(cleanup)
beforeEach(() => {
  HTMLElement.prototype.scrollIntoView = vi.fn()
})

type Props = Parameters<typeof AssistantPanel>[0]
function panel(props: Partial<Props> = {}) {
  return (
    <I18nProvider i18n={i18n} initialLocale="en">
      <AssistantPanel
        open
        messages={[]}
        busy={false}
        canSend
        configuration={null}
        error={null}
        storageFailed={false}
        onClose={() => {}}
        onReset={async () => {}}
        onSend={async () => true}
        onCancel={async () => {}}
        {...props}
      />
    </I18nProvider>
  )
}

it("shows internal model controls only for a saved changed turn and exposes the before/current toggle", async () => {
  const viewBefore = vi.fn().mockResolvedValue(true),
    undo = vi.fn().mockResolvedValue(true)
  const props = { onViewBefore: viewBefore, onUndoAgentChanges: undo }
  const view = render(panel(props))
  expect(screen.queryByRole("button", { name: "Undo agent changes" })).toBeNull()
  expect(screen.queryByRole("button", { name: "View before" })).toBeNull()
  view.rerender(panel({ ...props, canUndoAgentChanges: true }))
  expect(screen.getByRole("button", { name: "View before" }).getAttribute("aria-pressed")).toBe(
    "false",
  )
  await userEvent.click(screen.getByRole("button", { name: "View before" }))
  expect(viewBefore).toHaveBeenCalledTimes(1)
  view.rerender(panel({ ...props, canUndoAgentChanges: true, viewingBefore: true }))
  expect(screen.getByRole("button", { name: "View current" }).getAttribute("aria-pressed")).toBe(
    "true",
  )
  expect(screen.getByRole("button", { name: "View current" }).getAttribute("data-variant")).toBe(
    "secondary",
  )
  expect(
    screen.getByRole("button", { name: "Undo agent changes" }).hasAttribute("aria-pressed"),
  ).toBe(false)
  await userEvent.click(screen.getByRole("button", { name: "Undo agent changes" }))
  expect(undo).toHaveBeenCalledTimes(1)
})

it("locks duplicate Undo activation and makes pending preview controls unavailable", async () => {
  let resolve!: (saved: boolean) => void
  const pending = new Promise<boolean>((done) => {
    resolve = done
  })
  const undo = vi.fn().mockReturnValue(pending),
    viewBefore = vi.fn().mockResolvedValue(true)
  const props = { canUndoAgentChanges: true, onUndoAgentChanges: undo, onViewBefore: viewBefore }
  const view = render(panel(props))
  const action = screen.getByRole("button", { name: "Undo agent changes" })
  await userEvent.dblClick(action)
  expect(undo).toHaveBeenCalledTimes(1)
  expect(action.getAttribute("aria-busy")).toBe("true")
  resolve(false)
  await waitFor(() => expect(action.getAttribute("aria-busy")).not.toBe("true"))
  view.rerender(panel({ ...props, preparingBefore: true }))
  expect(action.hasAttribute("disabled")).toBe(true)
  expect(screen.getByRole("button", { name: "View before" }).hasAttribute("disabled")).toBe(true)
})
