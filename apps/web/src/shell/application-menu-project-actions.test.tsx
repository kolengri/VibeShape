import "../../../../tests/unit/support/dom"
import { afterEach, beforeEach, expect, it, mock } from "bun:test"
import { vi } from "../../../../tests/unit/support/bun-test"
import type { DocumentControllerState } from "../document/document-controller"

const actions = { create: vi.fn(), rename: vi.fn() }
let blocked: string | null = null
const original = { ...(await import("../document/document-controller")) }
mock.module("../document/document-controller", () => ({
  ...original,
  getProjectActionBlock: () => blocked,
  getProjectNavigationBlock: () => blocked,
  createNewLocalProject: actions.create,
  renameActiveProject: actions.rename,
}))
const { cleanup, render, screen, waitFor } = await import("@testing-library/react")
const { default: userEvent } = await import("@testing-library/user-event")
const { I18nProvider } = await import("@vibeshape/i18n/provider")
const { TooltipProvider } = await import("@vibeshape/ui/components/tooltip")
const { ActivityProvider, useBlockingActivity } = await import("@vibeshape/ui/components/activity")
const { i18n } = await import("../i18n")
const { ApplicationMenu } = await import("./application-menu")

const controller = {
  status: "ready",
  saveStatus: "saved",
  report: { mode: "read-write", snapshot: { id: "project", revision: 3, name: "Bracket" } },
} as DocumentControllerState
function BlockingStatus() {
  return <output aria-label="Project action blocking">{useBlockingActivity() ?? "none"}</output>
}
function setup(state = controller) {
  render(
    <ActivityProvider>
      <BlockingStatus />
      <I18nProvider i18n={i18n} initialLocale="en">
        <TooltipProvider>
          <ApplicationMenu
            controller={state}
            unitChangesBlocked={false}
            onOpenCommandPalette={() => {}}
            onOpenShortcutHelp={() => {}}
            renderDialogs={() => null}
          />
        </TooltipProvider>
      </I18nProvider>
    </ActivityProvider>,
  )
}
beforeEach(() => {
  blocked = null
  actions.create.mockReset().mockResolvedValue({ ok: true })
  actions.rename.mockReset().mockResolvedValue({ ok: true })
  vi.stubGlobal(
    "ResizeObserver",
    class {
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

it("creates through the existing command and locks repeat menu activation while pending", async () => {
  let finish: ((value: { ok: true }) => void) | undefined
  actions.create.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve
      }),
  )
  setup()
  const user = userEvent.setup()
  const trigger = screen.getByRole("button", { name: "Application menu" })
  await user.click(trigger)
  await user.click(screen.getByRole("menuitem", { name: "New project" }))
  expect(actions.create).toHaveBeenCalledTimes(1)
  expect(screen.getByLabelText("Project action blocking").textContent).not.toBe("none")
  await user.click(trigger)
  expect(screen.getByRole("menuitem", { name: "New project" }).getAttribute("aria-disabled")).toBe(
    "true",
  )
  finish?.({ ok: true })
  await waitFor(() =>
    expect(
      screen.getByRole("menuitem", { name: "New project" }).getAttribute("aria-disabled"),
    ).toBeNull(),
  )
  expect(screen.getByLabelText("Project action blocking").textContent).toBe("none")
})

it("opens the shared rename dialog from the menu and restores focus after a revisioned rename", async () => {
  setup()
  const user = userEvent.setup()
  const trigger = screen.getByRole("button", { name: "Application menu" })
  await user.click(trigger)
  await user.click(screen.getByRole("menuitem", { name: "Rename project" }))
  const input = screen.getByRole("textbox", { name: "Project name" })
  await user.clear(input)
  await user.type(input, "  Updated bracket  ")
  await user.click(screen.getByRole("button", { name: "Rename project" }))
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
  expect(actions.rename).toHaveBeenCalledWith(3, "Updated bracket")
  expect(document.activeElement).toBe(trigger)
})

it("keeps project creation and rename disabled while editing blocks project actions", async () => {
  blocked = "editor-draft"
  setup()
  await userEvent.click(screen.getByRole("button", { name: "Application menu" }))
  for (const name of ["New project", "Rename project"]) {
    expect(screen.getByRole("menuitem", { name }).getAttribute("aria-disabled")).toBe("true")
  }
  expect(actions.create).not.toHaveBeenCalled()
  expect(actions.rename).not.toHaveBeenCalled()
})

it("disables rename for read-only documents", async () => {
  setup({
    ...controller,
    report: controller.report ? { ...controller.report, mode: "read-only" } : null,
  })
  await userEvent.click(screen.getByRole("button", { name: "Application menu" }))
  expect(
    screen.getByRole("menuitem", { name: "Rename project" }).getAttribute("aria-disabled"),
  ).toBe("true")
})

it("reports a failed creation and releases the action for retry", async () => {
  actions.create.mockRejectedValueOnce(new Error("fixture storage error"))
  setup()
  const user = userEvent.setup()
  const trigger = screen.getByRole("button", { name: "Application menu" })
  await user.click(trigger)
  await user.click(screen.getByRole("menuitem", { name: "New project" }))
  expect((await screen.findByRole("alert")).textContent).toBe(
    "Could not create a project. The current project remains open.",
  )
  expect(screen.getByLabelText("Project action blocking").textContent).toBe("none")
  await user.click(trigger)
  await user.click(screen.getByRole("menuitem", { name: "New project" }))
  expect(actions.create).toHaveBeenCalledTimes(2)
})
