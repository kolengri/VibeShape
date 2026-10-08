import "../../../../tests/unit/support/dom"
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, mock } from "bun:test"
import { vi } from "../../../../tests/unit/support/bun-test"

import type { DocumentControllerState } from "./document-controller"

class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}

const renameActiveProject = (() => vi.fn())()

const originalModule1 = { ...(await import("./document-controller")) }
mock.module("./document-controller", () => ({
  ...originalModule1,
  renameActiveProject,
}))

const { cleanup, render, screen, waitFor } = await import("@testing-library/react")
const { default: userEvent } = await import("@testing-library/user-event")
const { I18nProvider } = await import("@vibeshape/i18n/provider")
const { TooltipProvider } = await import("@vibeshape/ui/components/tooltip")
const { i18n } = await import("../i18n")
const { DocumentRenameDialog } = await import("./document-rename-dialog")

const controller = {
  status: "ready",
  report: {
    mode: "read-write",
    snapshot: {
      id: "0195b5ac-b220-7a2c-8c33-67a36a7f21ac",
      revision: 3,
      name: "Bracket",
    },
  },
} as DocumentControllerState

beforeAll(() => vi.stubGlobal("ResizeObserver", ResizeObserverMock))
afterAll(() => vi.unstubAllGlobals())

function renderDialog(state = controller) {
  render(
    <I18nProvider i18n={i18n} initialLocale="en">
      <TooltipProvider>
        <DocumentRenameDialog controller={state} />
      </TooltipProvider>
    </I18nProvider>,
  )
}

beforeEach(() => {
  renameActiveProject.mockResolvedValue({ ok: true })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe("DocumentRenameDialog", () => {
  it("submits one normalized revisioned rename and locks the form while pending", async () => {
    const user = userEvent.setup()
    let finish: ((result: { ok: true }) => void) | undefined
    renameActiveProject.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve
      }),
    )
    renderDialog()
    const trigger = screen.getByRole("button", { name: "Rename Bracket" })
    expect(trigger.textContent).toBe("")
    await user.click(trigger)
    const input = screen.getByRole("textbox", { name: "Project name" })
    expect((input as HTMLInputElement).value).toBe("Bracket")
    await user.clear(input)
    await user.type(input, "  Calibration bracket  ")
    const submit = screen.getByRole("button", { name: "Rename project" })

    await user.dblClick(submit)

    expect(renameActiveProject).toHaveBeenCalledTimes(1)
    expect(renameActiveProject).toHaveBeenCalledWith(3, "Calibration bracket")
    expect(submit.getAttribute("aria-busy")).toBe("true")
    expect((input as HTMLInputElement).disabled).toBe(true)
    expect((screen.getByRole("button", { name: "Cancel" }) as HTMLButtonElement).disabled).toBe(
      true,
    )
    finish?.({ ok: true })
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Rename project" })).toBeNull())
  })

  it("keeps invalid and unchanged normalized names out of the command path", async () => {
    const user = userEvent.setup()
    renderDialog()
    await user.click(screen.getByRole("button", { name: "Rename Bracket" }))
    const input = screen.getByRole("textbox", { name: "Project name" })
    await user.clear(input)
    await user.tab()
    expect(screen.getByText("Enter a project name using 120 characters or fewer.")).toBeTruthy()
    expect(
      (screen.getByRole("button", { name: "Rename project" }) as HTMLButtonElement).disabled,
    ).toBe(true)

    await user.type(input, " Bracket ")
    await user.tab()
    expect(screen.getByText("Enter a different project name.")).toBeTruthy()
    expect(renameActiveProject).not.toHaveBeenCalled()
  })

  it("preserves the edited name and reports a stale revision", async () => {
    const user = userEvent.setup()
    renameActiveProject.mockResolvedValue({
      ok: false,
      diagnostic: {
        code: "command-rejected",
        message: "stale",
        retryable: true,
        sourceCode: "stale-revision",
      },
    })
    renderDialog()
    await user.click(screen.getByRole("button", { name: "Rename Bracket" }))
    const input = screen.getByRole("textbox", { name: "Project name" })
    await user.clear(input)
    await user.type(input, "Updated bracket")
    await user.click(screen.getByRole("button", { name: "Rename project" }))

    expect((await screen.findByRole("alert")).textContent).toContain(
      "The project changed while its name was being edited.",
    )
    expect((input as HTMLInputElement).value).toBe("Updated bracket")
    expect(screen.getByRole("dialog", { name: "Rename project" })).toBeTruthy()
  })

  it("disables rename when the current document is read-only", () => {
    renderDialog({
      ...controller,
      report: controller.report ? { ...controller.report, mode: "read-only" } : null,
    })

    expect(
      (screen.getByRole("button", { name: "Rename Bracket" }) as HTMLButtonElement).disabled,
    ).toBe(true)
  })
})
