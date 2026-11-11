import "../../../../../tests/unit/support/dom"
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, mock } from "bun:test"
import { DRAWING_CHORD_TOLERANCE_MM, type DrawingViewId } from "@vibeshape/protocol"
import { vi } from "../../../../../tests/unit/support/bun-test"
import type { DocumentControllerState } from "../../document/document-controller"
import type { ActiveDocumentDrawingResult } from "../../document/document-drawing"

const downloads = vi.fn()
const fileModule = { ...(await import("./drawing-file")) }
mock.module("./drawing-file", () => ({ ...fileModule, downloadDrawing: downloads }))

const { cleanup, render, screen, waitFor } = await import("@testing-library/react")
const { default: userEvent } = await import("@testing-library/user-event")
const { I18nProvider } = await import("@vibeshape/i18n/provider")
const { i18n } = await import("../../i18n")
const { createTestBrowserStorage } = await import("../../test-support/browser-storage")
const { DrawingDialog } = await import("./drawing-dialog")

class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}
beforeAll(() => {
  vi.stubGlobal("ResizeObserver", ResizeObserverMock)
  HTMLElement.prototype.scrollIntoView = vi.fn()
  HTMLElement.prototype.hasPointerCapture = () => false
  HTMLElement.prototype.setPointerCapture = vi.fn()
  HTMLElement.prototype.releasePointerCapture = vi.fn()
})
afterAll(() => vi.unstubAllGlobals())
beforeEach(() => {
  vi.stubGlobal("localStorage", createTestBrowserStorage())
  downloads.mockReset()
})
afterEach(() => cleanup())

const documentId = "0195b5ac-b220-7a2c-8c33-67a36a7f0001"
function controller(solidCount = 1, revision = 3): DocumentControllerState {
  return {
    status: "ready",
    saveStatus: "saved",
    diagnostic: null,
    report: {
      mode: "read-write",
      snapshot: { id: documentId, name: "Bracket", revision },
      rebuild: { ok: true, response: { geometry: [{ geometry: { shape: { solidCount } } }] } },
    },
  } as unknown as DocumentControllerState
}

function projection(views: readonly DrawingViewId[]): ActiveDocumentDrawingResult {
  return {
    ok: true,
    documentId,
    revision: 3,
    documentName: "Bracket",
    projection: {
      chordTolerance: DRAWING_CHORD_TOLERANCE_MM,
      bodyCount: 1,
      views: views.map((view) => ({
        view,
        bounds: { min: [0, 0], max: [40, 10] },
        edges: [
          {
            visibility: "visible",
            edgeClass: "sharp",
            curve: { kind: "line", start: [0, 0], end: [40, 10] },
          },
        ],
      })),
    },
  }
}

function dialog(
  state: DocumentControllerState,
  project: (
    views: readonly DrawingViewId[],
    partId?: string,
  ) => Promise<ActiveDocumentDrawingResult>,
) {
  return (
    <I18nProvider i18n={i18n} initialLocale="en">
      <DrawingDialog controller={state} open onOpenChange={() => {}} project={project} />
    </I18nProvider>
  )
}

function previewSource() {
  return decodeURIComponent(screen.getByTestId("drawing-preview").getAttribute("src") ?? "")
}

describe("Create Drawing dialog", () => {
  it("previews the projected sheet and downloads every format from the same sheet", async () => {
    const project = vi.fn(async (views: readonly DrawingViewId[]) => projection(views))
    const user = userEvent.setup()
    render(dialog(controller(), project))
    await waitFor(() => expect(screen.getByTestId("drawing-preview")).toBeTruthy())
    expect(project).toHaveBeenCalledWith(["front", "top", "right", "isometric"], undefined)
    expect(previewSource()).toContain('id="view-front"')
    expect(previewSource()).toContain("Bracket")
    expect(screen.getByTestId("drawing-scale").textContent).toMatch(/^Scale \d+:\d+$/)
    for (const label of ["Download SVG", "Download DXF", "Download PDF"])
      await user.click(screen.getByRole("button", { name: label }))
    expect(downloads.mock.calls.map(([, format, name]) => [format, name])).toEqual([
      ["svg", "Bracket"],
      ["dxf", "Bracket"],
      ["pdf", "Bracket"],
    ])
    expect(screen.getByRole("status").textContent).toBe("Drawing downloaded.")
  })

  it("recomposes title edits locally and reprojects only when the view set changes", async () => {
    const project = vi.fn(async (views: readonly DrawingViewId[]) => projection(views))
    const user = userEvent.setup()
    render(dialog(controller(), project))
    await waitFor(() => expect(screen.getByTestId("drawing-preview")).toBeTruthy())
    await user.type(screen.getByRole("textbox", { name: "Drawing number" }), "VS-7 A")
    await waitFor(() => expect(previewSource()).toContain("VS-7 A"))
    expect(project).toHaveBeenCalledTimes(1)
    await user.click(screen.getByRole("checkbox", { name: "Back" }))
    await waitFor(() => expect(project).toHaveBeenCalledTimes(2))
    expect(project.mock.calls[1]?.[0]).toEqual(["front", "back", "top", "right", "isometric"])
    await waitFor(() => expect(previewSource()).toContain('id="view-back"'))
    expect(
      JSON.parse(localStorage.getItem(`vibeshape-drawing-preset:${documentId}`) ?? "null"),
    ).toMatchObject({ schemaVersion: 1, settings: { titleBlock: { drawingNumber: "VS-7 A" } } })
  })

  it("keeps the last selected view and restores the saved preset", async () => {
    localStorage.setItem(
      `vibeshape-drawing-preset:${documentId}`,
      JSON.stringify({
        schemaVersion: 1,
        settings: { views: ["top"], titleBlock: { author: "Ada" } },
      }),
    )
    const project = vi.fn(async (views: readonly DrawingViewId[]) => projection(views))
    render(dialog(controller(), project))
    await waitFor(() => expect(project).toHaveBeenCalledWith(["top"], undefined))
    expect((screen.getByRole("checkbox", { name: "Top" }) as HTMLInputElement).disabled).toBe(true)
    expect((screen.getByRole("textbox", { name: "Author" }) as HTMLInputElement).value).toBe("Ada")
  })

  it("explains models without exact solids and failed projections", async () => {
    const project = vi.fn(async () => ({
      ok: false as const,
      diagnostic: {
        code: "export-failed" as const,
        message: "Kernel failure",
        retryable: true,
        sourceCode: null,
      },
    }))
    const empty = render(dialog(controller(0), project))
    expect(screen.getByRole("alert").textContent).toBe("The model has no exact solid body to draw.")
    expect(project).not.toHaveBeenCalled()
    empty.unmount()
    render(dialog(controller(), project))
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toBe(
        "The drawing could not be created. Try again after the model finishes rebuilding.",
      ),
    )
    expect(
      (screen.getByRole("button", { name: "Download PDF" }) as HTMLButtonElement).disabled,
    ).toBe(true)
  })
})
