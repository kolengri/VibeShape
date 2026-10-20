import "../../../../tests/unit/support/dom"
import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test"
import { vi } from "../../../../tests/unit/support/bun-test"
import { printExportWorkerFailure } from "./print-export-error.test-fixture"

const { exportDocument, download, handoff, placeFace } = (() => ({
  exportDocument: vi.fn(),
  download: vi.fn(),
  handoff: vi.fn(),
  placeFace: vi.fn(),
}))()
mock.module("../document/document-controller", () => ({
  prepareActiveDocumentPrint: exportDocument,
}))
mock.module("../document/document-export", () => ({ downloadDocumentExport: download }))
mock.module("./print-preparation-preview", () => ({
  PrintPreparationPreview: ({
    disabled,
    onLayFace,
  }: {
    disabled: boolean
    onLayFace: (meshIndex: number, triangleIndex: number) => Promise<void>
  }) => (
    <button type="button" disabled={disabled} onClick={() => onLayFace(0, 0)}>
      Lay selected face on bed
    </button>
  ),
}))
mock.module("./print-face-placement", () => ({ placePreparedPrintFace: placeFace }))
mock.module("./slicer-handoff-panel", () => ({
  SlicerHandoffPanel: ({ onBusyChange }: { onBusyChange: (busy: boolean) => void }) => (
    <button
      type="button"
      onClick={async () => {
        onBusyChange(true)
        try {
          await handoff()
        } finally {
          onBusyChange(false)
        }
      }}
    >
      Begin test handoff
    </button>
  ),
}))

const { act, cleanup, fireEvent, render, screen, waitFor, within } = await import(
  "@testing-library/react"
)
const { documentExportFailure } = await import("@vibeshape/application/persistent-document-session")
const { default: userEvent } = await import("@testing-library/user-event")
const { I18nProvider } = await import("@vibeshape/i18n/provider")
const { i18n } = await import("../i18n")
const { ViewerPreferencesProvider } = await import("../shell/viewer-preferences")
const { PrintPreparationPanel } = await import("./print-preparation-panel")
const { ApplicationNoticesProvider } = await import("../shell/application-notices")
beforeEach(() => {
  HTMLElement.prototype.scrollIntoView = vi.fn()
  HTMLElement.prototype.hasPointerCapture = () => false
  HTMLElement.prototype.setPointerCapture = vi.fn()
  HTMLElement.prototype.releasePointerCapture = vi.fn()
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  )
  vi.stubGlobal("matchMedia", () => ({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }))
})
afterEach(() => {
  cleanup()
  vi.resetAllMocks()
  vi.unstubAllGlobals()
})

function panel(onBusyChange = vi.fn(), applicationNotices = false) {
  const content = <PrintPreparationPanel disabled={false} onBusyChange={onBusyChange} />
  return render(
    <I18nProvider i18n={i18n} initialLocale="en">
      <ViewerPreferencesProvider>
        {applicationNotices ? (
          <ApplicationNoticesProvider>{content}</ApplicationNoticesProvider>
        ) : (
          content
        )}
      </ViewerPreferencesProvider>
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
  it("reports known preparation details in fixed notices without adding panel rows and retries after dismissal", async () => {
    exportDocument.mockResolvedValue(documentExportFailure(printExportWorkerFailure()))
    const busy = vi.fn()
    const user = userEvent.setup()
    panel(busy, true)
    const section = screen
      .getByRole("button", { name: "Generate print preview" })
      .closest("section") as HTMLElement
    const children = section.childElementCount
    const generate = screen.getByRole("button", { name: "Generate print preview" })
    await act(async () => {
      fireEvent.click(generate)
      fireEvent.click(generate)
    })
    expect(exportDocument).toHaveBeenCalledTimes(1)
    const error = await screen.findByRole("alert")
    expect(error.textContent).toContain(
      "Print preparation failed: Body Lid contains a degenerate triangle.",
    )
    expect(error.closest('[data-slot="notification-viewport"]')?.classList.contains("fixed")).toBe(
      true,
    )
    expect(within(section).queryByRole("alert")).toBeNull()
    expect(section.childElementCount).toBe(children)
    await user.click(screen.getByRole("button", { name: "Dismiss notification" }))
    expect(screen.queryByRole("alert")).toBeNull()
    await user.click(screen.getByRole("button", { name: "Generate print preview" }))
    expect((await screen.findByRole("alert")).textContent).toContain(
      "Body Lid contains a degenerate triangle.",
    )
    expect(exportDocument).toHaveBeenCalledTimes(2)
    expect(busy).toHaveBeenLastCalledWith(false)
  })
  it("validates rejected worker evidence and keeps the accessible standalone diagnostic out of flow", async () => {
    exportDocument.mockRejectedValueOnce(printExportWorkerFailure())
    const user = userEvent.setup()
    panel()
    await user.click(screen.getByRole("button", { name: "Generate print preview" }))
    const error = await screen.findByRole("alert")
    expect(error.textContent).toContain(
      "Print preparation failed: Body Lid contains a degenerate triangle.",
    )
    expect(error.classList.contains("fixed")).toBe(true)
  })
  it("does not publish a late worker failure after the preparation panel unmounts", async () => {
    let reject: ((reason: unknown) => void) | undefined
    exportDocument.mockImplementationOnce(
      () =>
        new Promise((_resolve, fail) => {
          reject = fail
        }),
    )
    const busy = vi.fn()
    const user = userEvent.setup()
    const view = panel(busy, true)
    await user.click(screen.getByRole("button", { name: "Generate print preview" }))
    view.unmount()
    expect(exportDocument.mock.calls[0]?.[1].aborted).toBe(true)
    await act(async () => {
      reject?.(printExportWorkerFailure())
    })
    expect(screen.queryByRole("alert")).toBeNull()
    expect(busy).toHaveBeenLastCalledWith(false)
    expect(download).not.toHaveBeenCalled()
  })
  it("prepares with selected tessellation quality and invalidates the old copy when quality changes", async () => {
    exportDocument.mockResolvedValue(result)
    panel()
    fireEvent.keyDown(screen.getByRole("combobox", { name: "Mesh quality" }), { key: "Enter" })
    await userEvent.click(screen.getByRole("option", { name: "Fine" }))
    await userEvent.click(screen.getByRole("button", { name: "Generate print preview" }))
    await screen.findByRole("button", { name: "Download prepared 3MF" })
    expect(exportDocument).toHaveBeenCalledWith(
      expect.objectContaining({ layerHeight: 0.2 }),
      expect.any(AbortSignal),
      { chordTolerance: 0.01, angularTolerance: 0.05 },
    )
    fireEvent.keyDown(screen.getByRole("combobox", { name: "Mesh quality" }), { key: "Enter" })
    await userEvent.click(screen.getByRole("option", { name: "Coarse" }))
    expect(screen.queryByRole("button", { name: "Download prepared 3MF" })).toBeNull()
  })
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
  it("blocks selected-face placement while a slicer handoff owns the busy state", async () => {
    exportDocument.mockResolvedValue(result)
    placeFace.mockImplementation(
      async (_prepared: unknown, form: { handleSubmit: () => Promise<unknown> }) => {
        await form.handleSubmit()
      },
    )
    let finish: (() => void) | undefined
    handoff.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve
        }),
    )
    const user = userEvent.setup()
    panel()
    await user.click(screen.getByRole("button", { name: "Generate print preview" }))
    const lay = await screen.findByRole("button", { name: "Lay selected face on bed" })
    expect(lay.hasAttribute("disabled")).toBe(false)
    await user.click(screen.getByRole("button", { name: "Begin test handoff" }))
    expect(lay.hasAttribute("disabled")).toBe(true)
    expect(
      screen.getByRole("button", { name: "Generate print preview" }).hasAttribute("disabled"),
    ).toBe(true)
    await user.click(lay)
    expect(placeFace).not.toHaveBeenCalled()
    expect(exportDocument).toHaveBeenCalledTimes(1)
    expect(screen.getByRole("button", { name: "Download prepared 3MF" })).toBeDefined()
    finish?.()
    await waitFor(() => expect(lay.hasAttribute("disabled")).toBe(false))
    await user.click(lay)
    expect(placeFace).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(exportDocument).toHaveBeenCalledTimes(2))
  })
  it("releases pending state and preserves settings after a rejected export", async () => {
    exportDocument.mockRejectedValue(new Error("Worker unavailable"))
    const busy = vi.fn()
    const user = userEvent.setup()
    panel(busy)
    await user.click(screen.getByRole("button", { name: "Generate print preview" }))
    expect((await screen.findByRole("alert")).textContent).toContain(
      "Print preparation failed or the project changed.",
    )
    expect(screen.getByRole("alert").textContent).not.toContain("Worker unavailable")
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
