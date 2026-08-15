// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { I18nProvider } from "@vibeshape/i18n/provider"
import { TooltipProvider } from "@vibeshape/ui/components/tooltip"
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { i18n } from "../i18n"
import type { DocumentControllerState } from "./document-controller"
import { DocumentDisplayUnitsDialog } from "./document-display-units-dialog"

class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}

const setActiveProjectDisplayUnits = vi.hoisted(() => vi.fn())

vi.mock("./document-controller", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./document-controller")>()),
  setActiveProjectDisplayUnits,
}))

const controller = {
  status: "ready",
  report: {
    mode: "read-write",
    snapshot: {
      revision: 4,
      displayUnits: { length: "mm", angle: "deg" },
    },
  },
} as unknown as DocumentControllerState

beforeAll(() => vi.stubGlobal("ResizeObserver", ResizeObserverMock))
afterAll(() => vi.unstubAllGlobals())

beforeEach(() => setActiveProjectDisplayUnits.mockResolvedValue({ ok: true }))
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

function renderDialog(state = controller) {
  render(
    <I18nProvider i18n={i18n} initialLocale="en">
      <TooltipProvider>
        <DocumentDisplayUnitsDialog controller={state} />
      </TooltipProvider>
    </I18nProvider>,
  )
}

describe("DocumentDisplayUnitsDialog", () => {
  it("persists one revisioned unit change and locks every control while pending", async () => {
    const user = userEvent.setup()
    let finish: ((result: { ok: true }) => void) | undefined
    setActiveProjectDisplayUnits.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve
      }),
    )
    renderDialog()
    await user.click(screen.getByRole("button", { name: "Project units: mm, deg" }))
    const length = screen.getByRole("combobox", { name: "Length unit" })
    const angle = screen.getByRole("combobox", { name: "Angle unit" })
    await user.selectOptions(length, "in")
    await user.selectOptions(angle, "rad")
    const submit = screen.getByRole("button", { name: "Apply project units" })

    await user.dblClick(submit)

    expect(setActiveProjectDisplayUnits).toHaveBeenCalledOnce()
    expect(setActiveProjectDisplayUnits).toHaveBeenCalledWith(4, {
      length: "in",
      angle: "rad",
    })
    expect(submit.getAttribute("aria-busy")).toBe("true")
    expect((length as HTMLSelectElement).disabled).toBe(true)
    expect((angle as HTMLSelectElement).disabled).toBe(true)
    expect((screen.getByRole("button", { name: "Cancel" }) as HTMLButtonElement).disabled).toBe(
      true,
    )
    finish?.({ ok: true })
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Project units" })).toBeNull())
  })

  it("preserves selections after a stale revision and disables read-only changes", async () => {
    const user = userEvent.setup()
    setActiveProjectDisplayUnits.mockResolvedValue({
      ok: false,
      diagnostic: { code: "command-rejected", sourceCode: "stale-revision" },
    })
    renderDialog()
    await user.click(screen.getByRole("button", { name: "Project units: mm, deg" }))
    const length = screen.getByRole("combobox", { name: "Length unit" })
    await user.selectOptions(length, "cm")
    await user.click(screen.getByRole("button", { name: "Apply project units" }))

    expect((await screen.findByRole("alert")).textContent).toContain("The project changed")
    expect((length as HTMLSelectElement).value).toBe("cm")

    cleanup()
    renderDialog({
      ...controller,
      report: controller.report ? { ...controller.report, mode: "read-only" } : null,
    })
    expect(
      (screen.getByRole("button", { name: "Project units: mm, deg" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true)
  })
})
