// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { I18nProvider } from "@vibeshape/i18n/provider"
import { TooltipProvider } from "@vibeshape/ui/components/tooltip"
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest"
import { i18n } from "../i18n"
import type { DocumentControllerState } from "./document-controller"
import { DocumentExportDialog } from "./document-export-dialog"

class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}

beforeAll(() => vi.stubGlobal("ResizeObserver", ResizeObserverMock))
afterAll(() => vi.unstubAllGlobals())
afterEach(cleanup)

const loading: DocumentControllerState = {
  status: "loading",
  report: null,
  saveStatus: "saved",
  diagnostic: null,
}

function dialog(controller: DocumentControllerState) {
  return (
    <I18nProvider i18n={i18n} initialLocale="en">
      <TooltipProvider>
        <DocumentExportDialog controller={controller} />
      </TooltipProvider>
    </I18nProvider>
  )
}

describe("document export availability", () => {
  it.each(["idle", "loading", "error"] as const)(
    "does not open a transient dialog while the document is %s",
    async (status) => {
      const user = userEvent.setup()
      render(dialog({ ...loading, status }))
      const trigger = screen.getByRole("button", { name: "Export…" })
      expect((trigger as HTMLButtonElement).disabled).toBe(true)
      await user.click(trigger)
      expect(screen.queryByRole("dialog", { name: "Export model" })).toBeNull()
    },
  )

  it("allows the empty-document explanation after the project finishes opening", async () => {
    const user = userEvent.setup()
    const view = render(dialog(loading))
    view.rerender(dialog({ ...loading, status: "ready" }))
    expect((screen.getByRole("button", { name: "Export…" }) as HTMLButtonElement).disabled).toBe(
      true,
    )
    view.rerender(
      dialog({
        ...loading,
        status: "ready",
        report: { mode: "read-write", snapshot: { name: "Untitled project" } },
      } as DocumentControllerState),
    )
    await user.click(screen.getByRole("button", { name: "Export…" }))
    expect(screen.getByRole("dialog", { name: "Export model" })).toBeDefined()
    expect(screen.getByText("Create a valid solid body before exporting.")).toBeDefined()
    expect(
      (screen.getByRole("button", { name: "Export STEP" }) as HTMLButtonElement).disabled,
    ).toBe(true)
    await user.click(screen.getByRole("button", { name: "Close" }))
    expect(screen.queryByRole("dialog", { name: "Export model" })).toBeNull()
  })
})
