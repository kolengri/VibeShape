import "../../../../../tests/unit/support/dom"
import { afterEach, expect, it } from "bun:test"
import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { I18nProvider } from "@vibeshape/i18n/provider"
import { vi } from "../../../../../tests/unit/support/bun-test"
import type { DocumentControllerState } from "../../document/document-controller"
import { i18n } from "../../i18n"
import { VariablesDialog } from "./variables-dialog"

afterEach(cleanup)
const controller = {
  status: "ready",
  saveStatus: "saved",
  report: {
    mode: "read-write",
    snapshot: { revision: 1, variables: [], features: [], sketches: [] },
  },
} as unknown as DocumentControllerState
function setup(saving = false) {
  const close = vi.fn()
  render(
    <I18nProvider i18n={i18n}>
      <VariablesDialog
        controller={{ ...controller, saveStatus: saving ? "saving" : "saved" }}
        open
        onOpenChange={close}
      />
    </I18nProvider>,
  )
  return close
}
it("opens the existing variables editor as a named modal and dismisses through Escape", async () => {
  const close = setup()
  expect(screen.getByRole("dialog", { name: "Variables" })).toBeTruthy()
  expect(screen.getByRole("button", { name: "Add variable" })).toBeTruthy()
  await userEvent.keyboard("{Escape}")
  expect(close).toHaveBeenCalledWith(false)
})
it("keeps the editor mounted while its document save is pending", async () => {
  const close = setup(true)
  await userEvent.keyboard("{Escape}")
  expect(close).not.toHaveBeenCalled()
  expect((screen.getByRole("button", { name: "Done" }) as HTMLButtonElement).disabled).toBe(true)
  expect(screen.getByRole("dialog", { name: "Variables" })).toBeTruthy()
})
