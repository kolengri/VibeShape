// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { I18nProvider } from "@vibeshape/i18n/provider"
import { afterEach, describe, expect, it, vi } from "vitest"
import { i18n } from "../i18n"
import { PrintPreparationPanel } from "./print-preparation-panel"

const { exportDocument, download } = vi.hoisted(() => ({
  exportDocument: vi.fn(),
  download: vi.fn(),
}))
vi.mock("../document/document-controller", () => ({ prepareActiveDocumentPrint: exportDocument }))
vi.mock("../document/document-export", () => ({ downloadDocumentExport: download }))
vi.mock("./print-preparation-preview", () => ({
  PrintPreparationPreview: () => <div>Preview</div>,
}))
afterEach(() => {
  cleanup()
  vi.resetAllMocks()
})

function panel(onBusyChange = vi.fn()) {
  return render(
    <I18nProvider i18n={i18n} initialLocale="en">
      <PrintPreparationPanel disabled={false} onBusyChange={onBusyChange} />
    </I18nProvider>,
  )
}
const result = {
  ok: true,
  documentName: "Bracket",
  format: "3mf",
  bodyCount: 1,
  file: new Uint8Array([80, 75]),
  printPreparation: {
    meshes: [],
    report: { bodyCount: 1, finCount: 1, contactCount: 2, bounds: [20, 30, 40], warnings: [] },
  },
}

describe("print preparation interaction", () => {
  it("invalidates a prepared download immediately when settings change", async () => {
    exportDocument.mockResolvedValue(result)
    const user = userEvent.setup()
    panel()
    await user.click(screen.getByRole("button", { name: "Generate print preview" }))
    await user.click(await screen.findByRole("button", { name: "Download prepared 3MF" }))
    expect(download).toHaveBeenCalledWith(result)
    await user.type(screen.getByLabelText("Tilt around X (degrees)"), "1")
    expect(screen.queryByRole("button", { name: "Download prepared 3MF" })).toBeNull()
  })
  it("releases pending state and preserves settings after a rejected export", async () => {
    exportDocument.mockRejectedValue(new Error("Worker unavailable"))
    const busy = vi.fn()
    const user = userEvent.setup()
    panel(busy)
    await user.click(screen.getByRole("button", { name: "Generate print preview" }))
    expect(await screen.findByRole("alert")).toBeDefined()
    await waitFor(() => expect(busy).toHaveBeenLastCalledWith(false))
    expect((screen.getByLabelText("Tilt around X (degrees)") as HTMLInputElement).value).toBe("45")
  })
  it("discards pending results after closing the preparation panel", async () => {
    let resolve: ((value: typeof result) => void) | undefined
    exportDocument.mockReturnValue(
      new Promise((done) => {
        resolve = done
      }),
    )
    const busy = vi.fn()
    const user = userEvent.setup()
    const view = panel(busy)
    await user.click(screen.getByRole("button", { name: "Generate print preview" }))
    view.unmount()
    expect(exportDocument.mock.calls[0]?.[1].aborted).toBe(true)
    resolve?.(result)
    await waitFor(() => expect(busy).toHaveBeenLastCalledWith(false))
    expect(download).not.toHaveBeenCalled()
  })
})
