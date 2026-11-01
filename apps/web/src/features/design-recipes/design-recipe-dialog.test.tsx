import "../../../../../tests/unit/support/dom"
import { afterEach, describe, expect, it, mock } from "bun:test"
import { documentSnapshotV2Schema } from "@vibeshape/domain/document-v2"
import { vi } from "../../../../../tests/unit/support/bun-test"
import type { DocumentControllerState } from "../../document/document-controller"

const runScript = vi.fn()
const previewRecipe = vi.fn()
const applyRecipe = vi.fn()
mock.module("./script-client", () => ({ runDesignScript: runScript }))
mock.module("./design-recipe-preview", () => ({
  previewDesignRecipe: previewRecipe,
  applyDesignRecipePreview: applyRecipe,
}))
const { render, screen, cleanup, waitFor } = await import("@testing-library/react")
const { default: userEvent } = await import("@testing-library/user-event")
const { I18nProvider } = await import("@vibeshape/i18n/provider")
const { i18n } = await import("../../i18n")
const { DesignRecipeDialog } = await import("./design-recipe-dialog")

const snapshot = documentSnapshotV2Schema.parse({
  schemaVersion: 2,
  id: "0195b5ac-b250-7a2c-8c33-000000000001",
  revision: 1,
  name: "Test",
  displayUnits: { length: "mm", angle: "deg" },
  variables: [],
  sketches: [],
  features: [],
  history: [],
  parts: [],
  folders: [],
  createdAt: "2026-11-01T00:00:00Z",
  updatedAt: "2026-11-01T00:00:00Z",
})
const controller = {
  status: "ready",
  saveStatus: "saved",
  authoredSnapshot: snapshot,
  report: { mode: "read-write", snapshot },
} as unknown as DocumentControllerState
function view(state = controller, onOpenChange = vi.fn()) {
  return (
    <I18nProvider i18n={i18n} initialLocale="en">
      <DesignRecipeDialog controller={state} open onOpenChange={onOpenChange} />
    </I18nProvider>
  )
}
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe("Scripts and macros dialog", () => {
  it("exports inspectable code, keeps Apply locked until preview, and rejects stale preview", async () => {
    const user = userEvent.setup()
    const rendered = render(view())
    await user.click(screen.getByRole("button", { name: "Export design as script" }))
    const editor = screen.getByRole("textbox", { name: "TypeScript source" }) as HTMLTextAreaElement
    expect(editor.value).toContain("export default recipe")
    expect(
      (screen.getByRole("button", { name: "Apply recipe" }) as HTMLButtonElement).disabled,
    ).toBe(true)
    runScript.mockResolvedValue({})
    previewRecipe.mockResolvedValue({
      documentId: snapshot.id,
      baseRevision: 1,
      renamedVariables: [],
      recipe: { features: [], sketches: [], variables: [] },
    })
    await user.click(screen.getByRole("button", { name: "Run and preview" }))
    await waitFor(() =>
      expect(
        (screen.getByRole("button", { name: "Apply recipe" }) as HTMLButtonElement).disabled,
      ).toBe(false),
    )
    rendered.rerender(view({ ...controller, authoredSnapshot: { ...snapshot, revision: 2 } }))
    expect(
      (screen.getByRole("button", { name: "Apply recipe" }) as HTMLButtonElement).disabled,
    ).toBe(true)
    expect(screen.getByRole("alert").textContent).toContain("design changed")
    expect(applyRecipe).not.toHaveBeenCalled()
  })

  it("suppresses duplicate runs and recovers source after sandbox failure", async () => {
    const user = userEvent.setup()
    let reject: ((reason: Error) => void) | undefined
    runScript.mockReturnValue(
      new Promise((_resolve, fail) => {
        reject = fail
      }),
    )
    render(view())
    await user.click(screen.getByRole("button", { name: "Load loop example" }))
    await user.dblClick(screen.getByRole("button", { name: "Run and preview" }))
    expect(runScript).toHaveBeenCalledTimes(1)
    expect(screen.getByRole("button", { name: "Run and preview" }).getAttribute("aria-busy")).toBe(
      "true",
    )
    reject?.(new Error("interrupted"))
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("interrupted"))
    expect(
      (screen.getByRole("textbox", { name: "TypeScript source" }) as HTMLTextAreaElement).value,
    ).toContain("for (let index")
    expect(
      (screen.getByRole("button", { name: "Run and preview" }) as HTMLButtonElement).disabled,
    ).toBe(false)
  })

  it("starts recording and closes the dialog so ordinary modeling remains usable", async () => {
    const user = userEvent.setup()
    const close = vi.fn()
    const rendered = render(view(controller, close))
    await user.click(screen.getByRole("button", { name: "Start recording" }))
    expect(close).toHaveBeenCalledWith(false)
    expect(screen.getByRole("button", { name: "Stop recording" })).toBeDefined()
    await user.click(screen.getByRole("button", { name: "Stop recording" }))
    expect(screen.getByRole("alert").textContent).toContain("No new History items")
    rendered.rerender(
      view({
        ...controller,
        report: { ...controller.report, mode: "read-only" },
      } as DocumentControllerState),
    )
    expect(
      (screen.getByRole("button", { name: "Start recording" }) as HTMLButtonElement).disabled,
    ).toBe(true)
  })
})
