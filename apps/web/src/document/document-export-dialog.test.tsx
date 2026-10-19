import "../../../../tests/unit/support/dom"
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, mock } from "bun:test"
import type { NativeSlicerApi } from "@vibeshape/slicer-handoff/native"
import { vi } from "../../../../tests/unit/support/bun-test"
import type { DocumentControllerState } from "./document-controller"

const mocks = (() => ({
  exportActiveDocument: vi.fn(),
  downloadDocumentExport: vi.fn(),
}))()

const controllerModule = { ...(await import("./document-controller")) }
mock.module("./document-controller", () => ({
  ...controllerModule,
  exportActiveDocument: mocks.exportActiveDocument,
}))

const originalModule1 = { ...(await import("./document-export")) }
mock.module("./document-export", () => {
  const actual = originalModule1
  return { ...actual, downloadDocumentExport: mocks.downloadDocumentExport }
})

const { cleanup, fireEvent, render, screen, waitFor, within } = await import(
  "@testing-library/react"
)
const { default: userEvent } = await import("@testing-library/user-event")
const { documentSnapshotV5Schema } = await import("@vibeshape/domain/document-v5")
const { createDefaultSurfaceTextureLayer, surfaceTextureLayerIdSchema } = await import(
  "@vibeshape/domain/surface-textures"
)
const { I18nProvider } = await import("@vibeshape/i18n/provider")
const { TooltipProvider } = await import("@vibeshape/ui/components/tooltip")
const { historyRepairFixture, repairId } = await import(
  "../../../../packages/domain/src/history-repair.test-fixture"
)
const { i18n } = await import("../i18n")
const { createTestBrowserStorage } = await import("../test-support/browser-storage")
const { DocumentExportDialog } = await import("./document-export-dialog")
const { ApplicationNoticesProvider } = await import("../shell/application-notices")

class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}

beforeAll(() => {
  vi.stubGlobal("ResizeObserver", ResizeObserverMock)
  HTMLElement.prototype.scrollIntoView = vi.fn()
})
afterAll(() => vi.unstubAllGlobals())
beforeEach(() => {
  vi.stubGlobal("localStorage", createTestBrowserStorage())
  mocks.exportActiveDocument.mockReset()
  mocks.downloadDocumentExport.mockReset()
})
afterEach(() => {
  cleanup()
  delete window.vibeshapeSlicer
})

const readyWithSolid = {
  mode: "read-write",
  snapshot: { name: "Bracket" },
  rebuild: {
    ok: true,
    response: { geometry: [{ geometry: { shape: { solidCount: 1 } } }] },
  },
} as unknown as DocumentControllerState["report"]

const loading: DocumentControllerState = {
  status: "loading",
  report: null,
  saveStatus: "saved",
  diagnostic: null,
}

function dialog(
  controller: DocumentControllerState,
  preferredFormat: "3mf" | "step" | "stl" = "3mf",
  applicationNotices = false,
) {
  return (
    <I18nProvider i18n={i18n} initialLocale="en">
      <TooltipProvider>
        {applicationNotices ? (
          <ApplicationNoticesProvider>
            <DocumentExportDialog controller={controller} preferredFormat={preferredFormat} />
          </ApplicationNoticesProvider>
        ) : (
          <DocumentExportDialog controller={controller} preferredFormat={preferredFormat} />
        )}
      </TooltipProvider>
    </I18nProvider>
  )
}

function nativeSlicer(overrides: Partial<NativeSlicerApi> = {}): NativeSlicerApi {
  return {
    protocolVersion: 1,
    async listApplications() {
      return { ok: true, targets: [{ id: "orca-slicer", name: "OrcaSlicer" }] }
    },
    async chooseApplication() {
      return {
        ok: true,
        target: { id: "custom-00000000-0000-4000-8000-000000000002", name: "Custom Slicer" },
      }
    },
    async send() {
      return { ok: true, fileId: "00000000-0000-4000-8000-000000000001", slicerName: "OrcaSlicer" }
    },
    async reveal() {
      return true
    },
    ...overrides,
  }
}

describe("document export availability", () => {
  it("shows the surface relief export hint on V5 authority", async () => {
    const fixture = historyRepairFixture()
    const feature = fixture.features[3]
    if (!feature) throw new Error("Missing independent feature fixture.")
    const authority = documentSnapshotV5Schema.parse({
      ...fixture,
      schemaVersion: 5,
      assets: [],
      repairIntents: [],
      suspendedParts: [],
      surfaceTextures: [
        createDefaultSurfaceTextureLayer(
          feature.id,
          "result",
          surfaceTextureLayerIdSchema.parse(repairId(550)),
        ),
      ],
    })
    render(
      dialog({ ...loading, status: "ready", report: readyWithSolid, authoredSnapshot: authority }),
    )
    await userEvent.click(screen.getByRole("button", { name: "Export…" }))
    expect(
      screen.getByText(
        "STL and 3MF include surface relief. STEP exports the original CAD geometry.",
      ),
    ).toBeDefined()
  })

  it("forwards selected mesh quality to document export", async () => {
    mocks.exportActiveDocument.mockResolvedValueOnce({
      ok: true,
      format: "stl",
      documentName: "Bracket",
      file: new Uint8Array([1]),
      bodyCount: 1,
    })
    const user = userEvent.setup()
    render(dialog({ ...loading, status: "ready", report: readyWithSolid }))
    await user.click(screen.getByRole("button", { name: "Export…" }))
    await user.selectOptions(screen.getByRole("combobox", { name: "File format" }), "stl")
    fireEvent.keyDown(screen.getByRole("combobox", { name: "Mesh quality" }), { key: "Enter" })
    await user.click(screen.getByRole("option", { name: "Fine" }))
    await user.click(screen.getByRole("button", { name: "Save STL file" }))
    await waitFor(() =>
      expect(mocks.exportActiveDocument).toHaveBeenLastCalledWith("stl", undefined, {
        chordTolerance: 0.01,
        angularTolerance: 0.05,
      }),
    )
  })
  it("shows a recoverable error when slicer preparation unexpectedly rejects", async () => {
    window.vibeshapeSlicer = nativeSlicer()
    mocks.exportActiveDocument.mockRejectedValueOnce(new Error("Worker unavailable"))
    mocks.downloadDocumentExport.mockClear()
    const user = userEvent.setup()
    render(dialog({ ...loading, status: "ready", report: readyWithSolid }))
    await user.click(screen.getByRole("button", { name: "Export…" }))
    await user.selectOptions(screen.getByRole("combobox", { name: "Destination" }), "slicer")
    await waitFor(() =>
      expect(
        (screen.getByRole("button", { name: "Open in slicer" }) as HTMLButtonElement).disabled,
      ).toBe(false),
    )
    await user.click(screen.getByRole("button", { name: "Open in slicer" }))
    expect((await screen.findByRole("alert")).textContent).toContain(
      "The mesh could not be prepared.",
    )
    expect(mocks.downloadDocumentExport).not.toHaveBeenCalled()
    expect(
      (screen.getByRole("button", { name: "Open in slicer" }) as HTMLButtonElement).disabled,
    ).toBe(false)
  })

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
      (screen.getByRole("button", { name: "Save 3MF file" }) as HTMLButtonElement).disabled,
    ).toBe(true)
    await user.click(screen.getByRole("button", { name: "Close" }))
    expect(screen.queryByRole("dialog", { name: "Export model" })).toBeNull()
  })

  it("releases export actions after a thrown failure and clears the error on reopen", async () => {
    const user = userEvent.setup()
    mocks.exportActiveDocument.mockRejectedValueOnce(new Error("worker disconnected"))
    render(
      dialog({
        status: "ready",
        report: readyWithSolid,
        saveStatus: "saved",
        diagnostic: null,
      }),
    )

    await user.click(screen.getByRole("button", { name: "Export…" }))
    const exportButton = screen.getByRole("button", { name: "Save 3MF file" })
    await user.click(exportButton)

    expect((await screen.findByRole("alert")).textContent).toContain(
      "The model could not be exported. Your saved document is unchanged.",
    )
    expect((exportButton as HTMLButtonElement).disabled).toBe(false)

    await user.click(screen.getByRole("button", { name: "Close" }))
    await user.click(screen.getByRole("button", { name: "Export…" }))
    expect(screen.queryByRole("alert")).toBeNull()
  })
  it("starts with the preferred format, one primary action, and only relevant options", async () => {
    const user = userEvent.setup()
    render(dialog({ ...loading, status: "ready", report: readyWithSolid }, "step"))
    await user.click(screen.getByRole("button", { name: "Export…" }))
    expect((screen.getByRole("combobox", { name: "File format" }) as HTMLSelectElement).value).toBe(
      "step",
    )
    expect(screen.queryByRole("combobox", { name: "Mesh quality" })).toBeNull()
    expect(screen.queryByRole("button", { name: "Open in slicer" })).toBeNull()
    expect(screen.getByRole("button", { name: "Save STEP file" })).toBeDefined()
    await user.selectOptions(screen.getByRole("combobox", { name: "File format" }), "stl")
    expect(screen.getByRole("combobox", { name: "Mesh quality" })).toBeDefined()
    expect(screen.queryByRole("button", { name: "Save STEP file" })).toBeNull()
    expect(screen.getByRole("button", { name: "Save STL file" }).hasAttribute("title")).toBe(false)
    await user.click(screen.getByRole("button", { name: "Close" }))
    await user.click(screen.getByRole("button", { name: "Export…" }))
    expect((screen.getByRole("combobox", { name: "File format" }) as HTMLSelectElement).value).toBe(
      "step",
    )
  })

  it("explains browser handoff without offering an unsupported native launch", async () => {
    const user = userEvent.setup()
    render(dialog({ ...loading, status: "ready", report: readyWithSolid }))
    await user.click(screen.getByRole("button", { name: "Export…" }))
    await user.selectOptions(screen.getByRole("combobox", { name: "Destination" }), "slicer")
    expect(screen.getByText(/Direct handoff is available in the desktop app/)).toBeDefined()
    expect(
      (screen.getByRole("button", { name: "Open in slicer" }) as HTMLButtonElement).disabled,
    ).toBe(true)
    expect(screen.queryByRole("option", { name: "STEP" })).toBeNull()
    await user.selectOptions(screen.getByRole("combobox", { name: "Destination" }), "file")
    expect(
      (screen.getByRole("button", { name: "Save 3MF file" }) as HTMLButtonElement).disabled,
    ).toBe(false)
  })

  it("uses the selected native slicer and mesh format through the single primary action", async () => {
    const send = vi.fn(nativeSlicer().send)
    window.vibeshapeSlicer = nativeSlicer({ send })
    mocks.exportActiveDocument.mockResolvedValueOnce({
      ok: true,
      format: "stl",
      documentName: "Bracket",
      file: new Uint8Array([1]),
      bodyCount: 1,
    })
    const user = userEvent.setup()
    render(dialog({ ...loading, status: "ready", report: readyWithSolid }))
    await user.click(screen.getByRole("button", { name: "Export…" }))
    await user.selectOptions(screen.getByRole("combobox", { name: "Destination" }), "slicer")
    await user.click(screen.getByRole("button", { name: "Choose slicer application…" }))
    await user.selectOptions(screen.getByRole("combobox", { name: "File format" }), "stl")
    await user.click(screen.getByRole("button", { name: "Open in slicer" }))
    expect(mocks.exportActiveDocument).toHaveBeenCalledWith("stl", undefined)
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        slicerId: "custom-00000000-0000-4000-8000-000000000002",
        format: "stl",
        filename: "Bracket.stl",
      }),
    )
    expect(mocks.downloadDocumentExport).not.toHaveBeenCalled()
    expect(screen.queryByRole("dialog")).toBeNull()
  })

  it("locks settings and dismissal during a single export and restores trigger focus", async () => {
    let finish: ((value: unknown) => void) | undefined
    mocks.exportActiveDocument.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve
        }),
    )
    const user = userEvent.setup()
    render(dialog({ ...loading, status: "ready", report: readyWithSolid }))
    const trigger = screen.getByRole("button", { name: "Export…" })
    await user.click(trigger)
    const primary = screen.getByRole("button", { name: "Save 3MF file" })
    await user.click(primary)
    await user.click(primary)
    expect(mocks.exportActiveDocument).toHaveBeenCalledTimes(1)
    expect((primary as HTMLButtonElement).disabled).toBe(true)
    expect(primary.getAttribute("aria-busy")).toBe("true")
    expect(
      (screen.getByRole("combobox", { name: "Destination" }) as HTMLSelectElement).disabled,
    ).toBe(true)
    expect((screen.getByRole("button", { name: "Close" }) as HTMLButtonElement).disabled).toBe(true)
    await user.keyboard("{Escape}")
    expect(screen.getByRole("dialog")).toBeDefined()
    finish?.({
      ok: true,
      format: "3mf",
      documentName: "Bracket",
      file: new Uint8Array([1]),
      bodyCount: 1,
    })
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
    await waitFor(() => expect(document.activeElement).toBe(trigger))
    expect(mocks.downloadDocumentExport).toHaveBeenCalledTimes(1)
  })
  it("reports action failures in the app error center without moving the modal form", async () => {
    mocks.exportActiveDocument.mockRejectedValueOnce(new Error("Worker unavailable"))
    const user = userEvent.setup()
    render(dialog({ ...loading, status: "ready", report: readyWithSolid }, "3mf", true))
    await user.click(screen.getByRole("button", { name: "Export…" }))
    const modal = screen.getByRole("dialog", { name: "Export model" })
    await user.click(within(modal).getByRole("button", { name: "Save 3MF file" }))
    expect((await screen.findByRole("alert")).textContent).toContain(
      "The model could not be exported.",
    )
    expect(within(modal).queryByRole("alert")).toBeNull()
    await user.click(within(modal).getByRole("button", { name: "Close" }))
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull())
  })
})
