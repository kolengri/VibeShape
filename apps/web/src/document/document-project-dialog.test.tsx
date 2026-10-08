import "../../../../tests/unit/support/dom"
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, mock } from "bun:test"
import { vi } from "../../../../tests/unit/support/bun-test"

import type { DocumentControllerState } from "./document-controller"

const activeDocumentId = "0195b5ac-b220-7a2c-8c33-67a36a7f21ac"
const otherDocumentId = "0195b5ac-b220-7a2c-8c33-67a36a7f21ad"
const fixtureThumbnail = new TextEncoder().encode(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 160" role="img"></svg>',
)
const controller = {
  status: "ready",
  report: {
    mode: "read-write",
    snapshot: { id: activeDocumentId, name: "Bracket", revision: 3 },
  },
} as unknown as DocumentControllerState

class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}

const controllerMocks = (() => ({
  activateLocalProject: vi.fn(),
  createNewLocalProject: vi.fn(),
  deleteLocalProject: vi.fn(),
  duplicateLocalProject: vi.fn(),
  exportActiveProjectBackup: vi.fn(),
  importProjectBackup: vi.fn(),
  listLocalProjects: vi.fn(),
  renameActiveProject: vi.fn(),
  getProjectActionBlock: vi.fn().mockReturnValue(null),
}))()

const originalModule1 = { ...(await import("./document-controller")) }
mock.module("./document-controller", () => ({
  ...originalModule1,
  ...controllerMocks,
}))

mock.module("./document-project-file", () => ({
  downloadProjectBackup: vi.fn(),
}))

const { cleanup, fireEvent, render, screen, waitFor } = await import("@testing-library/react")
const { default: userEvent } = await import("@testing-library/user-event")
const { I18nProvider } = await import("@vibeshape/i18n/provider")
const { TooltipProvider } = await import("@vibeshape/ui/components/tooltip")
const { i18n } = await import("../i18n")
const { DocumentProjectDialog } = await import("./document-project-dialog")
const { downloadProjectBackup } = await import("./document-project-file")

beforeAll(() => vi.stubGlobal("ResizeObserver", ResizeObserverMock))
afterAll(() => vi.unstubAllGlobals())

function renderDialog(state = controller, blockedReason: string | null = null) {
  return render(
    <I18nProvider i18n={i18n} initialLocale="en">
      <TooltipProvider>
        <DocumentProjectDialog controller={state} blockedReason={blockedReason} />
      </TooltipProvider>
    </I18nProvider>,
  )
}

function projectFile(name = "Bracket.vshape", bytes = new Uint8Array([1, 2, 3])) {
  const file = new File([bytes], name, { type: "application/vnd.vibeshape.project+zip" })
  Object.defineProperty(file, "arrayBuffer", {
    configurable: true,
    value: vi.fn(async () =>
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    ),
  })
  return file
}

function dropPayload(files: File[]) {
  return {
    files,
    items: files.map((file) => ({ kind: "file", getAsFile: () => file })),
    types: ["Files"],
  }
}

beforeEach(() => {
  controllerMocks.activateLocalProject.mockResolvedValue({ ok: true })
  controllerMocks.createNewLocalProject.mockResolvedValue({ ok: true })
  controllerMocks.deleteLocalProject.mockResolvedValue({ ok: true })
  controllerMocks.duplicateLocalProject.mockResolvedValue({
    ok: true,
    documentId: "0195b5ac-b220-7a2c-8c33-67a36a7f21ae",
    name: "Fixture copy",
  })
  controllerMocks.renameActiveProject.mockResolvedValue({ ok: true })
  controllerMocks.listLocalProjects.mockResolvedValue({
    ok: true,
    projects: [
      {
        documentId: activeDocumentId,
        name: "Bracket",
        headRevision: 3,
        createdAt: "2026-08-08T00:00:00Z",
        updatedAt: "2026-08-08T00:03:00Z",
        lastExternalBackupAt: null,
        thumbnail: null,
      },
      {
        documentId: otherDocumentId,
        name: "Fixture",
        headRevision: 2,
        createdAt: "2026-08-08T00:00:00Z",
        updatedAt: "2026-08-08T00:02:00Z",
        lastExternalBackupAt: null,
        thumbnail: {
          revision: 2,
          mediaType: "image/svg+xml",
          bytes: fixtureThumbnail,
          generatedAt: "2026-08-08T00:02:00Z",
        },
      },
    ],
  })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe("DocumentProjectDialog", () => {
  it("displays binary PNG previews without decoding them as text", async () => {
    const user = userEvent.setup()
    const result = await controllerMocks.listLocalProjects()
    result.projects[1].thumbnail = {
      revision: 2,
      mediaType: "image/png",
      bytes: new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
      generatedAt: "2026-08-08T00:02:00Z",
    }
    controllerMocks.listLocalProjects.mockResolvedValue(result)
    renderDialog()
    await user.click(screen.getByRole("button", { name: "File" }))
    expect(await screen.findByRole("img", { name: "3D preview of Fixture" })).toHaveProperty(
      "src",
      "data:image/png;base64,iVBORw0KGgo=",
    )
  })

  it("guards an asynchronous backup against double activation and exposes loading", async () => {
    const user = userEvent.setup()
    let finish: ((value: unknown) => void) | undefined
    controllerMocks.exportActiveProjectBackup.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve
      }),
    )
    renderDialog()
    const projectTrigger = screen.getByRole("button", { name: "File" })
    expect(projectTrigger.textContent).toBe("File")
    await user.click(projectTrigger)
    const backup = screen.getByRole("button", { name: "Save project (.vshape)" })

    await user.dblClick(backup)

    expect(controllerMocks.exportActiveProjectBackup).toHaveBeenCalledTimes(1)
    expect(backup.getAttribute("aria-busy")).toBe("true")
    finish?.({
      ok: true,
      documentName: "Bracket",
      file: new Uint8Array([1, 2, 3]),
    })
    await waitFor(() => expect(downloadProjectBackup).toHaveBeenCalledTimes(1))
  })

  it("lists local projects and guards project switching against double activation", async () => {
    const user = userEvent.setup()
    let finish: ((value: unknown) => void) | undefined
    controllerMocks.activateLocalProject.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve
      }),
    )
    renderDialog()
    await user.click(screen.getByRole("button", { name: "File" }))
    expect(await screen.findByText(/Revision 3/)).toBeTruthy()
    expect(screen.getByText("Current")).toBeTruthy()
    expect(screen.getByRole("img", { name: "3D preview of Fixture" })).toBeTruthy()
    expect(screen.getByRole("img", { name: "No 3D preview is available for Bracket" })).toBeTruthy()
    const open = screen.getByRole("button", { name: "Open Fixture, revision 2" })

    await user.dblClick(open)

    expect(controllerMocks.activateLocalProject).toHaveBeenCalledTimes(1)
    expect(controllerMocks.activateLocalProject).toHaveBeenCalledWith(otherDocumentId)
    expect(open.getAttribute("aria-busy")).toBe("true")
    finish?.({ ok: true })
    await waitFor(() => expect(open.getAttribute("aria-busy")).not.toBe("true"))
  })

  it("renames the current project from the local project library", async () => {
    const user = userEvent.setup()
    renderDialog()
    await user.click(screen.getByRole("button", { name: "File" }))

    await user.click(await screen.findByRole("button", { name: "Rename Bracket" }))
    const name = screen.getByRole("textbox", { name: "Project name" })
    await user.clear(name)
    await user.type(name, "Named bracket")
    await user.click(screen.getByRole("button", { name: /^Rename project$/ }))

    expect(controllerMocks.renameActiveProject).toHaveBeenCalledWith(3, "Named bracket")
    await waitFor(() => expect(controllerMocks.listLocalProjects).toHaveBeenCalledTimes(2))
    expect(screen.queryByRole("button", { name: "Rename Fixture" })).toBeNull()
  })

  it("duplicates a semantic project with a localized bounded name as one action", async () => {
    const user = userEvent.setup()
    let finish: ((value: unknown) => void) | undefined
    controllerMocks.duplicateLocalProject.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve
      }),
    )
    renderDialog()
    await user.click(screen.getByRole("button", { name: "File" }))
    const duplicate = await screen.findByRole("button", {
      name: "Duplicate Fixture, revision 2",
    })

    await user.dblClick(duplicate)

    expect(controllerMocks.duplicateLocalProject).toHaveBeenCalledTimes(1)
    expect(controllerMocks.duplicateLocalProject).toHaveBeenCalledWith(
      otherDocumentId,
      2,
      "Fixture copy",
    )
    expect(duplicate.getAttribute("aria-busy")).toBe("true")
    finish?.({
      ok: true,
      documentId: "0195b5ac-b220-7a2c-8c33-67a36a7f21ae",
      name: "Fixture copy",
    })
    await waitFor(() => expect(controllerMocks.listLocalProjects).toHaveBeenCalledTimes(2))
    expect(screen.getByRole("status").textContent).toContain("Local project duplicated")
  })

  it("confirms inactive project deletion and guards the destructive request", async () => {
    const user = userEvent.setup()
    let finish: ((value: unknown) => void) | undefined
    controllerMocks.deleteLocalProject.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve
      }),
    )
    renderDialog()
    await user.click(screen.getByRole("button", { name: "File" }))
    const currentDelete = await screen.findByRole("button", {
      name: "Delete Bracket, revision 3",
    })
    expect((currentDelete as HTMLButtonElement).disabled).toBe(true)
    await user.click(screen.getByRole("button", { name: "Delete Fixture, revision 2" }))
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Keep project" }))
    const confirm = screen.getByRole("button", { name: "Delete project" })

    await user.dblClick(confirm)

    expect(controllerMocks.deleteLocalProject).toHaveBeenCalledTimes(1)
    expect(controllerMocks.deleteLocalProject).toHaveBeenCalledWith(otherDocumentId, 2)
    expect(confirm.getAttribute("aria-busy")).toBe("true")
    expect(screen.getByRole("alertdialog")).toBeTruthy()
    finish?.({ ok: true })
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull())
    expect(controllerMocks.listLocalProjects).toHaveBeenCalledTimes(2)
  })

  it("keeps project deletion context visible after a storage conflict", async () => {
    const user = userEvent.setup()
    controllerMocks.deleteLocalProject.mockResolvedValue({
      ok: false,
      diagnostic: { code: "lease-held", message: "Project open elsewhere." },
    })
    renderDialog()
    await user.click(screen.getByRole("button", { name: "File" }))
    await user.click(await screen.findByRole("button", { name: "Delete Fixture, revision 2" }))
    await user.click(screen.getByRole("button", { name: "Delete project" }))

    expect((await screen.findByRole("alert")).textContent).toContain(
      "This project could not be deleted.",
    )
    expect(screen.getByRole("alertdialog")).toBeTruthy()
  })

  it("keeps an import collision visible and allows the same file to be chosen again", async () => {
    const user = userEvent.setup()
    controllerMocks.importProjectBackup.mockResolvedValue({
      ok: false,
      diagnostic: { code: "document-already-exists", message: "collision" },
    })
    renderDialog()
    await user.click(screen.getByRole("button", { name: "File" }))
    const input = screen.getByLabelText("Choose VibeShape project file") as HTMLInputElement
    const file = projectFile()

    await user.upload(input, file)

    expect((await screen.findByRole("alert")).textContent).toContain(
      "The imported copy could not be added because its identity already exists.",
    )
    expect(input.value).toBe("")
    await user.upload(input, file)
    expect(controllerMocks.importProjectBackup).toHaveBeenCalledTimes(2)
  })

  it("imports a selected .vshape file and activates it through the validated project flow", async () => {
    const user = userEvent.setup()
    controllerMocks.importProjectBackup.mockResolvedValue({ ok: true, documentId: otherDocumentId })
    renderDialog()
    await user.click(screen.getByRole("button", { name: "File" }))
    const input = screen.getByLabelText("Choose VibeShape project file") as HTMLInputElement

    await user.upload(input, projectFile())

    await waitFor(() => expect(controllerMocks.importProjectBackup).toHaveBeenCalledTimes(1))
    expect(controllerMocks.activateLocalProject).toHaveBeenCalledWith(otherDocumentId, {
      documentId: activeDocumentId,
      revision: 3,
    })
  })

  it("imports a dropped .vshape file through the same validation and activation flow", async () => {
    controllerMocks.importProjectBackup.mockResolvedValue({ ok: true, documentId: otherDocumentId })
    renderDialog()
    await userEvent.setup().click(screen.getByRole("button", { name: "File" }))
    const dropArea = screen.getByRole("group", { name: "Drop a .vshape project" })

    fireEvent.drop(dropArea, {
      dataTransfer: dropPayload([projectFile()]),
    })

    await waitFor(() => expect(controllerMocks.importProjectBackup).toHaveBeenCalledTimes(1))
    expect(controllerMocks.activateLocalProject).toHaveBeenCalledWith(otherDocumentId, {
      documentId: activeDocumentId,
      revision: 3,
    })
  })

  it("rejects unsupported extensions and multiple dropped files without partial import", async () => {
    const user = userEvent.setup()
    renderDialog()
    await user.click(screen.getByRole("button", { name: "File" }))
    const input = screen.getByLabelText("Choose VibeShape project file") as HTMLInputElement

    await user.upload(input, projectFile("notes.zip"))
    expect((await screen.findByRole("alert")).textContent).toContain(
      "Choose one .vshape project file.",
    )
    expect(controllerMocks.importProjectBackup).not.toHaveBeenCalled()

    fireEvent.drop(screen.getByRole("group", { name: "Drop a .vshape project" }), {
      dataTransfer: dropPayload([projectFile("one.vshape"), projectFile("two.vshape")]),
    })
    expect(controllerMocks.importProjectBackup).not.toHaveBeenCalled()
  })

  it("keeps pending import feedback when a queued rejected drop resolves later", async () => {
    let finishRead: ((value: ArrayBuffer) => void) | undefined
    const pendingFile = projectFile()
    Object.defineProperty(pendingFile, "arrayBuffer", {
      configurable: true,
      value: vi.fn(() => {
        const rejectedFile = new File(["bad"], "rejected.zip", { type: "application/zip" })
        fireEvent.drop(dropArea, { dataTransfer: dropPayload([rejectedFile]) })
        return new Promise<ArrayBuffer>((resolve) => (finishRead = resolve))
      }),
    })
    controllerMocks.importProjectBackup.mockResolvedValue({ ok: true, documentId: otherDocumentId })
    renderDialog()
    await userEvent.setup().click(screen.getByRole("button", { name: "File" }))
    const dropArea = screen.getByRole("group", { name: "Drop a .vshape project" })
    fireEvent.drop(dropArea, { dataTransfer: dropPayload([pendingFile]) })

    await waitFor(() => expect(pendingFile.arrayBuffer).toHaveBeenCalledTimes(1))
    expect(screen.queryByRole("alert")).toBeNull()
    expect(screen.getByRole("status").textContent).toContain("Verifying")
    finishRead?.(new ArrayBuffer(3))
    await waitFor(() => expect(controllerMocks.activateLocalProject).toHaveBeenCalledTimes(1))
  })

  it("rejects oversized files before reading and guards concurrent imports while extraction is pending", async () => {
    const user = userEvent.setup()
    let finishRead: ((value: ArrayBuffer) => void) | undefined
    const pendingFile = projectFile()
    Object.defineProperty(pendingFile, "arrayBuffer", {
      configurable: true,
      value: vi.fn(() => new Promise<ArrayBuffer>((resolve) => (finishRead = resolve))),
    })
    renderDialog()
    await user.click(screen.getByRole("button", { name: "File" }))
    const input = screen.getByLabelText("Choose VibeShape project file") as HTMLInputElement

    await user.upload(input, pendingFile)
    fireEvent.drop(screen.getByRole("group", { name: "Drop a .vshape project" }), {
      dataTransfer: dropPayload([projectFile()]),
    })
    expect(controllerMocks.importProjectBackup).not.toHaveBeenCalled()
    finishRead?.(new Uint8Array([1, 2, 3]).buffer)
    await waitFor(() => expect(controllerMocks.importProjectBackup).toHaveBeenCalledTimes(1))

    const oversizedFile = projectFile()
    Object.defineProperty(oversizedFile, "size", {
      configurable: true,
      value: 33 * 1024 * 1024,
    })
    await user.upload(input, oversizedFile)
    expect((await screen.findByRole("alert")).textContent).toContain(
      "This project exceeds the current 32 MiB archive limit.",
    )
    expect(oversizedFile.arrayBuffer).not.toHaveBeenCalled()
    expect(controllerMocks.importProjectBackup).toHaveBeenCalledTimes(1)
  })
  it("keeps Save/Open first and refuses replacing actions while an edit is active", async () => {
    renderDialog(controller, "editor-draft")
    await userEvent.click(screen.getByRole("button", { name: "File" }))
    const save = screen.getByRole("button", { name: "Save project (.vshape)" }) as HTMLButtonElement
    const open = screen.getByRole("button", { name: "Open project (.vshape)" }) as HTMLButtonElement
    expect(save.disabled).toBe(true)
    expect(open.disabled).toBe(true)
    expect(
      (screen.getByRole("button", { name: "New project" }) as HTMLButtonElement).disabled,
    ).toBe(true)
    expect(screen.getByText(/Finish or cancel the current edit/)).toBeTruthy()
    const headings = screen.getAllByRole("heading").map((heading) => heading.textContent)
    expect(headings.indexOf("Save project (.vshape)")).toBeLessThan(
      headings.indexOf("Local projects"),
    )
    expect(headings.indexOf("Open project (.vshape)")).toBeLessThan(
      headings.indexOf("Local projects"),
    )
  })

  it("refuses a late file read when the active project changes", async () => {
    let finish!: (bytes: ArrayBuffer) => void
    const file = projectFile()
    Object.defineProperty(file, "arrayBuffer", {
      value: () =>
        new Promise<ArrayBuffer>((resolve) => {
          finish = resolve
        }),
    })
    const result = renderDialog()
    await userEvent.click(screen.getByRole("button", { name: "File" }))
    await userEvent.upload(screen.getByLabelText("Choose VibeShape project file"), file)
    const replacement = {
      ...controller,
      report: {
        ...controller.report,
        snapshot: { ...controller.report?.snapshot, id: otherDocumentId },
      },
    } as DocumentControllerState
    result.rerender(
      <I18nProvider i18n={i18n} initialLocale="en">
        <TooltipProvider>
          <DocumentProjectDialog controller={replacement} />
        </TooltipProvider>
      </I18nProvider>,
    )
    finish(new ArrayBuffer(3))
    expect((await screen.findByRole("alert")).textContent).toContain("Finish or cancel")
    expect(controllerMocks.importProjectBackup).not.toHaveBeenCalled()
    expect(controllerMocks.activateLocalProject).not.toHaveBeenCalled()
  })

  it("keeps an explicit checkpoint refusal and never activates that archive", async () => {
    controllerMocks.importProjectBackup.mockResolvedValue({
      ok: false,
      diagnostic: { code: "checkpoint-read-only" },
    })
    renderDialog()
    await userEvent.click(screen.getByRole("button", { name: "File" }))
    await userEvent.upload(screen.getByLabelText("Choose VibeShape project file"), projectFile())
    expect((await screen.findByRole("alert")).textContent).toContain(
      "cannot be opened as a writable copy",
    )
    expect(controllerMocks.activateLocalProject).not.toHaveBeenCalled()
  })
})
