import "../../../../tests/unit/support/dom"
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, mock } from "bun:test"
import type { ReactNode } from "react"
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
  importProjectBackup: vi.fn(),
  listLocalProjects: vi.fn(),
  showProjectLibrary: vi.fn(),
  renameActiveProject: vi.fn(),
  getProjectActionBlock: vi.fn().mockReturnValue(null),
}))()

const originalModule1 = { ...(await import("./document-controller")) }
mock.module("./document-controller", () => ({
  ...originalModule1,
  ...controllerMocks,
}))

const { cleanup, fireEvent, render, screen, waitFor } = await import("@testing-library/react")
const { default: userEvent } = await import("@testing-library/user-event")
const { I18nProvider } = await import("@vibeshape/i18n/provider")
const { TooltipProvider } = await import("@vibeshape/ui/components/tooltip")
const { i18n } = await import("../i18n")
const { ViewerPreferencesProvider } = await import("../shell/viewer-preferences")
const { WorkspaceLayoutPreferencesProvider } = await import("../shell/workspace-layout-preferences")
const { DocumentProjectPage } = await import("./document-project-page")

beforeAll(() => vi.stubGlobal("ResizeObserver", ResizeObserverMock))
afterAll(() => vi.unstubAllGlobals())

function ProjectPageProviders({ children }: { children: ReactNode }) {
  return (
    <I18nProvider i18n={i18n} initialLocale="en">
      <TooltipProvider>
        <ViewerPreferencesProvider>
          <WorkspaceLayoutPreferencesProvider>{children}</WorkspaceLayoutPreferencesProvider>
        </ViewerPreferencesProvider>
      </TooltipProvider>
    </I18nProvider>
  )
}

function renderPage(state = controller, blockedReason: string | null = null) {
  return render(
    <ProjectPageProviders>
      <DocumentProjectPage controller={state} blockedReason={blockedReason} />
    </ProjectPageProviders>,
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
  vi.stubGlobal("matchMedia", () => ({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }))
  controllerMocks.getProjectActionBlock.mockReturnValue(null)
  controllerMocks.showProjectLibrary.mockResolvedValue({ ok: true })
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

describe("DocumentProjectPage", () => {
  it("displays binary PNG previews without decoding them as text", async () => {
    const result = await controllerMocks.listLocalProjects()
    result.projects[1].thumbnail = {
      revision: 2,
      mediaType: "image/png",
      bytes: new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
      generatedAt: "2026-08-08T00:02:00Z",
    }
    controllerMocks.listLocalProjects.mockResolvedValue(result)
    renderPage()
    expect(await screen.findByRole("img", { name: "3D preview of Fixture" })).toHaveProperty(
      "src",
      "data:image/png;base64,iVBORw0KGgo=",
    )
  })

  it("lists local projects and guards project switching against double activation", async () => {
    const user = userEvent.setup()
    let finish: ((value: unknown) => void) | undefined
    controllerMocks.activateLocalProject.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve
      }),
    )
    renderPage()
    expect(await screen.findByText(/Revision 3/)).toBeTruthy()
    expect(screen.getByText("Current")).toBeTruthy()
    expect(screen.getByRole("img", { name: "3D preview of Fixture" })).toBeTruthy()
    expect(screen.getByRole("img", { name: "3D preview of Bracket" })).toBeTruthy()
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
    renderPage()

    await user.click(await screen.findByRole("button", { name: "Rename Bracket" }))
    const name = screen.getByRole("textbox", { name: "Project name" })
    await user.clear(name)
    await user.type(name, "Named bracket")
    await user.click(screen.getByRole("button", { name: /^Rename project$/ }))

    expect(controllerMocks.activateLocalProject).not.toHaveBeenCalled()
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
    renderPage()
    const duplicate = await screen.findByRole("button", {
      name: "Duplicate Fixture, revision 2",
    })

    await user.dblClick(duplicate)

    expect(controllerMocks.activateLocalProject).not.toHaveBeenCalled()
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
    renderPage()
    const currentDelete = await screen.findByRole("button", {
      name: "Delete Bracket, revision 3",
    })
    expect((currentDelete as HTMLButtonElement).disabled).toBe(true)
    await user.click(screen.getByRole("button", { name: "Delete Fixture, revision 2" }))
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Keep project" }))
    const confirm = screen.getByRole("button", { name: "Delete project" })

    await user.dblClick(confirm)

    expect(controllerMocks.activateLocalProject).not.toHaveBeenCalled()
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
    renderPage()
    await user.click(await screen.findByRole("button", { name: "Delete Fixture, revision 2" }))
    await user.click(screen.getByRole("button", { name: "Delete project" }))

    expect((await screen.findByRole("alert")).textContent).toContain(
      "This project could not be deleted.",
    )
    expect(screen.getByRole("alertdialog")).toBeTruthy()
  })

  it.each([
    [
      "document-already-exists",
      "The imported copy could not be added because its identity already exists.",
    ],
    ["resource-limit", "This project exceeds an archive or document validation limit."],
  ])(
    "keeps import failure %s visible and allows the same file to be chosen again",
    async (code, message) => {
      const user = userEvent.setup()
      controllerMocks.importProjectBackup.mockResolvedValue({
        ok: false,
        diagnostic: { code, message: "Import rejected." },
      })
      renderPage()
      const input = screen.getByLabelText("Choose VibeShape project file") as HTMLInputElement
      const file = projectFile()

      await user.upload(input, file)

      expect((await screen.findByRole("alert")).textContent).toContain(message)
      expect(input.value).toBe("")
      await user.upload(input, file)
      expect(controllerMocks.importProjectBackup).toHaveBeenCalledTimes(2)
    },
  )

  it("imports a selected .vshape file and activates it through the validated project flow", async () => {
    const user = userEvent.setup()
    controllerMocks.importProjectBackup.mockResolvedValue({ ok: true, documentId: otherDocumentId })
    renderPage()
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
    renderPage()
    const dropArea = screen.getByRole("button", { name: "Drop a .vshape project" })

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
    renderPage()
    const input = screen.getByLabelText("Choose VibeShape project file") as HTMLInputElement

    await user.upload(input, projectFile("notes.zip"))
    expect((await screen.findByRole("alert")).textContent).toContain(
      "Choose one .vshape project file.",
    )
    expect(controllerMocks.importProjectBackup).not.toHaveBeenCalled()

    fireEvent.drop(screen.getByRole("button", { name: "Drop a .vshape project" }), {
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
    renderPage()
    const dropArea = screen.getByRole("button", { name: "Drop a .vshape project" })
    fireEvent.drop(dropArea, { dataTransfer: dropPayload([pendingFile]) })

    await waitFor(() => expect(pendingFile.arrayBuffer).toHaveBeenCalledTimes(1))
    expect(screen.queryByRole("alert")).toBeNull()
    expect(screen.getByRole("status").textContent).toContain("Verifying")
    finishRead?.(new ArrayBuffer(3))
    await waitFor(() => expect(controllerMocks.activateLocalProject).toHaveBeenCalledTimes(1))
  })

  it("accepts files above the former size ceiling and guards concurrent imports while extraction is pending", async () => {
    const user = userEvent.setup()
    controllerMocks.importProjectBackup.mockResolvedValue({ ok: true, documentId: otherDocumentId })
    let finishRead: ((value: ArrayBuffer) => void) | undefined
    const pendingFile = projectFile()
    Object.defineProperty(pendingFile, "arrayBuffer", {
      configurable: true,
      value: vi.fn(() => new Promise<ArrayBuffer>((resolve) => (finishRead = resolve))),
    })
    renderPage()
    const input = screen.getByLabelText("Choose VibeShape project file") as HTMLInputElement

    await user.upload(input, pendingFile)
    fireEvent.drop(screen.getByRole("button", { name: "Drop a .vshape project" }), {
      dataTransfer: dropPayload([projectFile()]),
    })
    expect(controllerMocks.importProjectBackup).not.toHaveBeenCalled()
    finishRead?.(new Uint8Array([1, 2, 3]).buffer)
    await waitFor(() => expect(controllerMocks.importProjectBackup).toHaveBeenCalledTimes(1))

    const bytes = new Uint8Array(33 * 1024 * 1024)
    bytes[bytes.length - 1] = 23
    const largeFile = projectFile("Large.vshape", bytes)
    await user.upload(input, largeFile)
    await waitFor(() => expect(controllerMocks.importProjectBackup).toHaveBeenCalledTimes(2))
    expect(largeFile.arrayBuffer).toHaveBeenCalledTimes(1)
    const imported = controllerMocks.importProjectBackup.mock.calls[1]?.[0]
    expect(imported.byteLength).toBe(34_603_008)
    expect(imported.at(-1)).toBe(23)
    expect(screen.queryByRole("alert")).toBeNull()
  })
  it("keeps Open first and refuses replacing actions while an edit is active", async () => {
    renderPage(controller, "editor-draft")
    const open = screen.getByRole("button", { name: "Drop a .vshape project" })
    expect(open.getAttribute("aria-disabled")).toBe("true")
    expect(
      ((await screen.findByRole("button", { name: "New project" })) as HTMLButtonElement).disabled,
    ).toBe(true)
    expect(screen.getByText(/Finish or cancel the current edit/)).toBeTruthy()
    const headings = screen.getAllByRole("heading").map((heading) => heading.textContent)
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
    const result = renderPage()
    await userEvent.upload(screen.getByLabelText("Choose VibeShape project file"), file)
    const replacement = {
      ...controller,
      report: {
        ...controller.report,
        snapshot: { ...controller.report?.snapshot, id: otherDocumentId },
      },
    } as DocumentControllerState
    result.rerender(
      <ProjectPageProviders>
        <DocumentProjectPage controller={replacement} />
      </ProjectPageProviders>,
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
    renderPage()
    await userEvent.upload(screen.getByLabelText("Choose VibeShape project file"), projectFile())
    expect((await screen.findByRole("alert")).textContent).toContain(
      "cannot be opened as a writable copy",
    )
    expect(controllerMocks.activateLocalProject).not.toHaveBeenCalled()
  })
})

describe("full-page project chooser", () => {
  const libraryController = {
    status: "library",
    saveStatus: "saved",
    report: null,
    diagnostic: null,
    authoredSnapshot: null,
  } as unknown as DocumentControllerState

  it("lists existing project cards without a modal or creating a blank project", async () => {
    renderPage(libraryController)
    expect(screen.getByRole("main")).toBeTruthy()
    expect(screen.getByRole("heading", { name: "Projects", level: 1 })).toBeTruthy()
    expect(await screen.findByRole("button", { name: "Open Bracket, revision 3" })).toBeTruthy()
    expect(screen.queryByRole("dialog")).toBeNull()
    expect(screen.queryByRole("button", { name: "Save project (.vshape)" })).toBeNull()
    expect(controllerMocks.createNewLocalProject).not.toHaveBeenCalled()
    expect(controllerMocks.activateLocalProject).not.toHaveBeenCalled()
  })

  it("opens the thumbnail and name through one keyboard-accessible card target", async () => {
    renderPage(libraryController)
    const open = await screen.findByRole("button", { name: "Open Fixture, revision 2" })
    const preview = screen.getByRole("img", { name: "3D preview of Fixture" })
    const name = screen.getByText("Fixture", { exact: true })
    expect(open.contains(preview)).toBe(true)
    expect(open.contains(name)).toBe(true)
    expect(screen.queryByRole("button", { name: "Open" })).toBeNull()
    expect(open.hasAttribute("title")).toBe(false)
    open.focus()
    await userEvent.keyboard("{Enter}")
    expect(controllerMocks.activateLocalProject).toHaveBeenCalledWith(otherDocumentId)
  })

  it("opens and creates projects only after explicit user actions", async () => {
    renderPage(libraryController)
    await userEvent.click(await screen.findByRole("button", { name: "Open Fixture, revision 2" }))
    expect(controllerMocks.activateLocalProject).toHaveBeenCalledWith(otherDocumentId)
    await userEvent.click(screen.getByRole("button", { name: "New project" }))
    expect(controllerMocks.createNewLocalProject).toHaveBeenCalledTimes(1)
  })

  it("imports from the sessionless chooser and activates only the verified copy", async () => {
    controllerMocks.getProjectActionBlock.mockReturnValue("unavailable")
    controllerMocks.importProjectBackup.mockResolvedValue({ ok: true, documentId: otherDocumentId })
    renderPage(libraryController)
    await userEvent.upload(screen.getByLabelText("Choose VibeShape project file"), projectFile())
    await waitFor(() =>
      expect(controllerMocks.activateLocalProject).toHaveBeenCalledWith(otherDocumentId, undefined),
    )
    expect(controllerMocks.importProjectBackup).toHaveBeenCalledTimes(1)
    expect(controllerMocks.createNewLocalProject).not.toHaveBeenCalled()
  })

  it("keeps loading visible until catalog startup completes and supports a failed-read retry", async () => {
    controllerMocks.listLocalProjects.mockResolvedValueOnce({
      ok: false,
      diagnostic: { code: "persistence-failed" },
    })
    const result = renderPage({ ...libraryController, status: "loading" })
    expect(screen.getByRole("status").textContent).toContain("Loading")
    expect(controllerMocks.listLocalProjects).not.toHaveBeenCalled()
    result.rerender(
      <ProjectPageProviders>
        <DocumentProjectPage controller={libraryController} />
      </ProjectPageProviders>,
    )
    expect(await screen.findByRole("alert")).toBeTruthy()
    await userEvent.click(screen.getByRole("button", { name: "Retry" }))
    expect(await screen.findByRole("button", { name: "Open Fixture, revision 2" })).toBeTruthy()
    expect(controllerMocks.createNewLocalProject).not.toHaveBeenCalled()
  })

  it("recovers a failed startup before retrying the catalog without creating a document", async () => {
    controllerMocks.showProjectLibrary.mockResolvedValueOnce({ ok: false })
    const result = renderPage({ ...libraryController, status: "error" })
    expect(await screen.findByRole("alert")).toBeTruthy()
    await userEvent.click(screen.getByRole("button", { name: "Retry" }))
    expect(await screen.findByRole("alert")).toBeTruthy()
    expect(controllerMocks.showProjectLibrary).toHaveBeenCalledTimes(1)
    expect(controllerMocks.listLocalProjects).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole("button", { name: "Retry" }))
    await waitFor(() => expect(controllerMocks.showProjectLibrary).toHaveBeenCalledTimes(2))
    result.rerender(
      <ProjectPageProviders>
        <DocumentProjectPage controller={libraryController} />
      </ProjectPageProviders>,
    )
    expect(await screen.findByRole("button", { name: "Open Fixture, revision 2" })).toBeTruthy()
    expect(controllerMocks.createNewLocalProject).not.toHaveBeenCalled()
    expect(controllerMocks.activateLocalProject).not.toHaveBeenCalled()
  })

  it("rejects an import whose file read outlives the chooser", async () => {
    let finish!: (buffer: ArrayBuffer) => void
    const file = projectFile()
    Object.defineProperty(file, "arrayBuffer", {
      value: () =>
        new Promise<ArrayBuffer>((resolve) => {
          finish = resolve
        }),
    })
    const result = renderPage(libraryController)
    await userEvent.upload(screen.getByLabelText("Choose VibeShape project file"), file)
    result.unmount()
    finish(new ArrayBuffer(3))
    await Promise.resolve()
    expect(controllerMocks.importProjectBackup).not.toHaveBeenCalled()
  })
})

it("opens the file picker directly from the drop surface with pointer or keyboard", async () => {
  renderPage()
  const surface = screen.getByRole("button", { name: "Drop a .vshape project" })
  const input = screen.getByLabelText("Choose VibeShape project file")
  const choose = vi.spyOn(input, "click").mockImplementation(() => {})
  const user = userEvent.setup()
  await user.click(surface)
  expect(choose).toHaveBeenCalledTimes(1)
  surface.focus()
  await user.keyboard("{Enter}")
  expect(choose).toHaveBeenCalledTimes(2)
  expect(surface.querySelector("button")).toBeNull()
})
