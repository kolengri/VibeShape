import "../../../../tests/unit/support/dom"
import { afterAll, afterEach, beforeAll, describe, expect, it, mock } from "bun:test"
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

const { cleanup, fireEvent, render, screen, waitFor } = await import("@testing-library/react")
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
const { DocumentExportDialog } = await import("./document-export-dialog")

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
afterEach(cleanup)

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
    fireEvent.keyDown(screen.getByRole("combobox", { name: "Mesh quality" }), { key: "Enter" })
    await user.click(screen.getByRole("option", { name: "Fine" }))
    await user.click(screen.getByRole("button", { name: "Export STL" }))
    await waitFor(() =>
      expect(mocks.exportActiveDocument).toHaveBeenLastCalledWith("stl", undefined, {
        chordTolerance: 0.01,
        angularTolerance: 0.05,
      }),
    )
  })
  it("shows a recoverable error when slicer preparation unexpectedly rejects", async () => {
    mocks.exportActiveDocument.mockRejectedValueOnce(new Error("Worker unavailable"))
    mocks.downloadDocumentExport.mockClear()
    const user = userEvent.setup()
    render(dialog({ ...loading, status: "ready", report: readyWithSolid }))
    await user.click(screen.getByRole("button", { name: "Export…" }))
    await user.click(screen.getByRole("button", { name: "Download 3MF" }))
    expect((await screen.findByRole("alert")).textContent).toContain(
      "The mesh could not be prepared.",
    )
    expect(mocks.downloadDocumentExport).not.toHaveBeenCalled()
    expect(
      (screen.getByRole("button", { name: "Download 3MF" }) as HTMLButtonElement).disabled,
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
      (screen.getByRole("button", { name: "Export STEP" }) as HTMLButtonElement).disabled,
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
    const exportButton = screen.getByRole("button", { name: "Export STEP" })
    await user.click(exportButton)

    expect((await screen.findByRole("alert")).textContent).toContain(
      "The model could not be exported. Your saved document is unchanged.",
    )
    expect((exportButton as HTMLButtonElement).disabled).toBe(false)

    await user.click(screen.getByRole("button", { name: "Close" }))
    await user.click(screen.getByRole("button", { name: "Export…" }))
    expect(screen.queryByRole("alert")).toBeNull()
  })
})
