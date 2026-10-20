import "../../../../tests/unit/support/dom"
import { afterEach, beforeEach, expect, it, mock } from "bun:test"
import type { NativeMeshFormat, NativeSlicerApi } from "@vibeshape/slicer-handoff/native"
import { vi } from "../../../../tests/unit/support/bun-test"
import type { ActiveDocumentExportResult } from "../document/document-controller"
import { printExportWorkerFailure } from "./print-export-error.test-fixture"

const downloaded = vi.fn()
const exportModule = { ...(await import("../document/document-export")) }
mock.module("../document/document-export", () => ({
  ...exportModule,
  downloadDocumentExport: downloaded,
}))
const { act, cleanup, fireEvent, render, screen, waitFor } = await import("@testing-library/react")
const { I18nProvider } = await import("@vibeshape/i18n/provider")
const { i18n } = await import("../i18n")
const { createTestBrowserStorage } = await import("../test-support/browser-storage")
const { SlicerHandoffPanel } = await import("./slicer-handoff-panel")
const { readNativeSlicerPreference } = await import("./native-slicer-client")
const { documentExportFailure } = await import("@vibeshape/application/persistent-document-session")
const { ApplicationNoticesProvider } = await import("../shell/application-notices")
const fileId = "00000000-0000-4000-8000-000000000001"
const custom = { id: "custom-00000000-0000-4000-8000-000000000002", name: "Custom Slicer" }
const opened = vi.fn()
const busy = vi.fn()
const prepare = vi.fn(
  async (format: NativeMeshFormat): Promise<ActiveDocumentExportResult> => ({
    ok: true,
    format,
    file: new Uint8Array([80, 75, 3, 4]),
    bodyCount: 1,
    documentName: "Bracket",
  }),
)
function api(overrides: Partial<NativeSlicerApi> = {}): NativeSlicerApi {
  return {
    protocolVersion: 1,
    async listApplications() {
      return { ok: true, targets: [{ id: "orca-slicer", name: "OrcaSlicer" }] }
    },
    async chooseApplication() {
      return { ok: true, target: custom }
    },
    async send() {
      return { ok: true, fileId, slicerName: "OrcaSlicer" }
    },
    async reveal() {
      return true
    },
    ...overrides,
  }
}
function panel(applicationNotices = false) {
  const content = (
    <SlicerHandoffPanel
      disabled={false}
      onBusyChange={busy}
      onOpened={opened}
      prepareMesh={prepare}
    />
  )
  return render(
    <I18nProvider i18n={i18n} initialLocale="en">
      {applicationNotices ? (
        <ApplicationNoticesProvider>{content}</ApplicationNoticesProvider>
      ) : (
        content
      )}
    </I18nProvider>,
  )
}
beforeEach(() => {
  vi.stubGlobal("localStorage", createTestBrowserStorage())
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  )
  HTMLElement.prototype.scrollIntoView = vi.fn()
  HTMLElement.prototype.hasPointerCapture = () => false
  HTMLElement.prototype.setPointerCapture = vi.fn()
  HTMLElement.prototype.releasePointerCapture = vi.fn()
})
afterEach(() => {
  cleanup()
  delete window.vibeshapeSlicer
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

it("offers honest browser downloads without pairing or local bridge controls", async () => {
  panel()
  expect(screen.queryByRole("button", { name: "Choose slicer application…" })).toBeNull()
  expect(screen.queryByText(/pairing token/i)).toBeNull()
  fireEvent.change(screen.getByRole("combobox", { name: "Mesh format" }), {
    target: { value: "stl" },
  })
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Download STL" }))
  })
  expect(prepare).toHaveBeenCalledWith("stl")
  expect(downloaded).toHaveBeenCalledTimes(1)
  expect(opened).toHaveBeenCalledWith("STL download started")
  expect(busy.mock.calls).toEqual([[true], [false]])
})

it("retains known mesh diagnostics in fixed notices and retries the same failure without launching a slicer", async () => {
  const send = vi.fn(api().send)
  window.vibeshapeSlicer = api({ send })
  prepare.mockResolvedValueOnce(documentExportFailure(printExportWorkerFailure()))
  prepare.mockResolvedValueOnce(documentExportFailure(printExportWorkerFailure()))
  panel(true)
  const button = await screen.findByRole("button", { name: "Send to OrcaSlicer" })
  await waitFor(() => expect(button.hasAttribute("disabled")).toBe(false))
  const section = button.closest("section") as HTMLElement
  const children = section.childElementCount
  await act(async () => {
    fireEvent.click(button)
    fireEvent.click(button)
  })
  expect(prepare).toHaveBeenCalledTimes(1)
  const error = screen.getByRole("alert")
  expect(error.textContent).toContain(
    "The mesh could not be prepared: Body Lid contains a degenerate triangle.",
  )
  expect(error.closest('[data-slot="notification-viewport"]')?.classList.contains("fixed")).toBe(
    true,
  )
  expect(section.querySelector('[role="alert"]')).toBeNull()
  expect(section.childElementCount).toBe(children)
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Dismiss notification" }))
  })
  expect(screen.queryByRole("alert")).toBeNull()
  await act(async () => {
    fireEvent.click(button)
  })
  expect(screen.getByRole("alert").textContent).toContain(
    "Body Lid contains a degenerate triangle.",
  )
  expect(prepare).toHaveBeenCalledTimes(2)
  expect(send).not.toHaveBeenCalled()
  expect(button.hasAttribute("disabled")).toBe(false)
  expect(busy).toHaveBeenLastCalledWith(false)
})

it("validates rejected worker details before rendering them as plain text", async () => {
  const details = 'Body Lid contains a degenerate triangle. <img src=x onerror="alert(1)">'
  const send = vi.fn(api().send)
  window.vibeshapeSlicer = api({ send })
  prepare.mockRejectedValueOnce(printExportWorkerFailure(details))
  panel()
  const button = await screen.findByRole("button", { name: "Send to OrcaSlicer" })
  await waitFor(() => expect(button.hasAttribute("disabled")).toBe(false))
  await act(async () => {
    fireEvent.click(button)
  })
  const error = screen.getByRole("alert")
  expect(error.textContent).toBe(`The mesh could not be prepared: ${details}`)
  expect(error.querySelector("img")).toBeNull()
  expect(error.classList.contains("fixed")).toBe(true)
  expect(send).not.toHaveBeenCalled()
})

it.each([
  new Error("Unvalidated private export details"),
  { response: { type: "failure", diagnostic: { message: "Unvalidated private export details" } } },
])("does not display unknown exception data as a native handoff diagnostic", async (error) => {
  const send = vi.fn(api().send)
  window.vibeshapeSlicer = api({ send })
  prepare.mockRejectedValueOnce(error)
  panel()
  const button = await screen.findByRole("button", { name: "Send to OrcaSlicer" })
  await waitFor(() => expect(button.hasAttribute("disabled")).toBe(false))
  await act(async () => {
    fireEvent.click(button)
  })
  expect(screen.getByRole("alert").textContent).toBe(
    "The mesh could not be prepared. Try again after the model finishes rebuilding.",
  )
  expect(screen.getByRole("alert").textContent).not.toContain("Unvalidated")
  expect(send).not.toHaveBeenCalled()
  expect(button.hasAttribute("disabled")).toBe(false)
})

it("keeps source-code-null failures generic instead of promoting their message to worker evidence", async () => {
  window.vibeshapeSlicer = api()
  prepare.mockResolvedValueOnce({
    ok: false,
    diagnostic: {
      code: "export-failed",
      sourceCode: null,
      retryable: true,
      message: "No validated worker evidence",
    },
  })
  panel()
  const button = await screen.findByRole("button", { name: "Send to OrcaSlicer" })
  await waitFor(() => expect(button.hasAttribute("disabled")).toBe(false))
  await act(async () => {
    fireEvent.click(button)
  })
  expect(screen.getByRole("alert").textContent).not.toContain("No validated worker evidence")
  expect(screen.getByRole("alert").textContent).toContain("The mesh could not be prepared.")
})

it("does not launch a slicer when mesh preparation completes after its owner unmounts", async () => {
  let finish: ((value: ActiveDocumentExportResult) => void) | undefined
  prepare.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve
      }),
  )
  const send = vi.fn(api().send)
  window.vibeshapeSlicer = api({ send })
  const view = panel()
  const button = await screen.findByRole("button", { name: "Send to OrcaSlicer" })
  await waitFor(() => expect(button.hasAttribute("disabled")).toBe(false))
  fireEvent.click(button)
  expect(prepare).toHaveBeenCalledTimes(1)
  view.unmount()
  await act(async () => {
    finish?.({
      ok: true,
      format: "3mf",
      file: new Uint8Array([1]),
      bodyCount: 1,
      documentName: "Old project",
    })
  })
  expect(send).not.toHaveBeenCalled()
  expect(opened).not.toHaveBeenCalled()
  expect(busy).toHaveBeenLastCalledWith(false)
})

it("does not publish native handoff success after its owner unmounts", async () => {
  let finish: ((value: Awaited<ReturnType<NativeSlicerApi["send"]>>) => void) | undefined
  const send = vi.fn(
    () =>
      new Promise<Awaited<ReturnType<NativeSlicerApi["send"]>>>((resolve) => {
        finish = resolve
      }),
  )
  window.vibeshapeSlicer = api({ send })
  const view = panel()
  const button = await screen.findByRole("button", { name: "Send to OrcaSlicer" })
  await waitFor(() => expect(button.hasAttribute("disabled")).toBe(false))
  fireEvent.click(button)
  await waitFor(() => expect(send).toHaveBeenCalledTimes(1))
  view.unmount()
  await act(async () => {
    finish?.({ ok: true, fileId, slicerName: "OrcaSlicer" })
  })
  expect(opened).not.toHaveBeenCalled()
  expect(busy).toHaveBeenLastCalledWith(false)
})
it("remembers a host-selected slicer and sends the chosen mesh directly without downloading", async () => {
  const send = vi.fn(api().send)
  window.vibeshapeSlicer = api({ send })
  panel()
  await waitFor(() =>
    expect(screen.getByRole("combobox", { name: "Slicer" }).hasAttribute("disabled")).toBe(false),
  )
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Choose slicer application…" }))
  })
  fireEvent.change(screen.getByRole("combobox", { name: "Mesh format" }), {
    target: { value: "stl" },
  })
  expect(readNativeSlicerPreference()).toEqual({ slicerId: custom.id, format: "stl" })
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Send to Custom Slicer" }))
  })
  expect(send).toHaveBeenCalledWith({
    slicerId: custom.id,
    format: "stl",
    filename: "Bracket.stl",
    file: expect.any(Uint8Array),
  })
  expect(downloaded).not.toHaveBeenCalled()
  expect(opened).toHaveBeenCalledWith(
    "Sent to OrcaSlicer. Verify the imported model in the slicer.",
  )
})
it("retains a failed-launch mesh for an opaque Finder reveal and releases the action lock", async () => {
  let complete: ((value: Awaited<ReturnType<NativeSlicerApi["send"]>>) => void) | undefined
  const send = vi.fn(
    () =>
      new Promise<Awaited<ReturnType<NativeSlicerApi["send"]>>>((resolve) => {
        complete = resolve
      }),
  )
  const reveal = vi.fn(async (_id: string) => true)
  window.vibeshapeSlicer = api({ send, reveal })
  panel()
  const button = await screen.findByRole("button", { name: "Send to OrcaSlicer" })
  await waitFor(() => expect(button.hasAttribute("disabled")).toBe(false))
  fireEvent.click(button)
  fireEvent.click(button)
  await waitFor(() => expect(send).toHaveBeenCalledTimes(1))
  await act(async () => complete?.({ ok: false, reason: "launch-failed", fileId }))
  expect(screen.getByRole("alert").textContent).toContain("Your mesh is kept on this Mac")
  expect(button.hasAttribute("disabled")).toBe(false)
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Show mesh in Finder" }))
  })
  expect(reveal).toHaveBeenCalledWith(fileId)
  expect(downloaded).not.toHaveBeenCalled()
  expect(opened).not.toHaveBeenCalled()
})

it("recovers from failed discovery after the user chooses an installed application", async () => {
  window.vibeshapeSlicer = api({
    async listApplications() {
      return { ok: false, reason: "unavailable" }
    },
  })
  panel()
  await screen.findByRole("alert")
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Choose slicer application…" }))
  })
  expect(screen.queryByRole("alert")).toBeNull()
  expect(
    screen.getByRole("button", { name: "Send to Custom Slicer" }).hasAttribute("disabled"),
  ).toBe(false)
})
