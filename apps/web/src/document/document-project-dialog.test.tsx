// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { I18nProvider } from "@vibeshape/i18n/provider"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { i18n } from "../i18n"
import type { DocumentControllerState } from "./document-controller"
import { DocumentProjectDialog } from "./document-project-dialog"
import { downloadProjectBackup } from "./document-project-file"

const activeDocumentId = "0195b5ac-b220-7a2c-8c33-67a36a7f21ac"
const otherDocumentId = "0195b5ac-b220-7a2c-8c33-67a36a7f21ad"
const controller = {
  status: "ready",
  report: { snapshot: { id: activeDocumentId } },
} as DocumentControllerState

const controllerMocks = vi.hoisted(() => ({
  activateLocalProject: vi.fn(),
  createNewLocalProject: vi.fn(),
  deleteLocalProject: vi.fn(),
  exportActiveProjectBackup: vi.fn(),
  importProjectBackup: vi.fn(),
  listLocalProjects: vi.fn(),
}))

vi.mock("./document-controller", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./document-controller")>()),
  ...controllerMocks,
}))

vi.mock("./document-project-file", () => ({
  downloadProjectBackup: vi.fn(),
}))

function renderDialog() {
  render(
    <I18nProvider i18n={i18n} initialLocale="en">
      <DocumentProjectDialog controller={controller} />
    </I18nProvider>,
  )
}

beforeEach(() => {
  controllerMocks.activateLocalProject.mockResolvedValue({ ok: true })
  controllerMocks.createNewLocalProject.mockResolvedValue({ ok: true })
  controllerMocks.deleteLocalProject.mockResolvedValue({ ok: true })
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
      },
      {
        documentId: otherDocumentId,
        name: "Fixture",
        headRevision: 2,
        createdAt: "2026-08-08T00:00:00Z",
        updatedAt: "2026-08-08T00:02:00Z",
        lastExternalBackupAt: null,
      },
    ],
  })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe("DocumentProjectDialog", () => {
  it("guards an asynchronous backup against double activation and exposes loading", async () => {
    const user = userEvent.setup()
    let finish: ((value: unknown) => void) | undefined
    controllerMocks.exportActiveProjectBackup.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve
      }),
    )
    renderDialog()
    await user.click(screen.getByRole("button", { name: "Project…" }))
    const backup = screen.getByRole("button", { name: "Download .vshape" })

    await user.dblClick(backup)

    expect(controllerMocks.exportActiveProjectBackup).toHaveBeenCalledOnce()
    expect(backup.getAttribute("aria-busy")).toBe("true")
    finish?.({
      ok: true,
      documentName: "Bracket",
      file: new Uint8Array([1, 2, 3]),
    })
    await waitFor(() => expect(downloadProjectBackup).toHaveBeenCalledOnce())
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
    await user.click(screen.getByRole("button", { name: "Project…" }))
    expect(await screen.findByText(/Revision 3/)).toBeTruthy()
    expect(screen.getByText("Current")).toBeTruthy()
    const open = screen.getByRole("button", { name: "Open Fixture, revision 2" })

    await user.dblClick(open)

    expect(controllerMocks.activateLocalProject).toHaveBeenCalledOnce()
    expect(controllerMocks.activateLocalProject).toHaveBeenCalledWith(otherDocumentId)
    expect(open.getAttribute("aria-busy")).toBe("true")
    finish?.({ ok: true })
    await waitFor(() => expect(open.getAttribute("aria-busy")).not.toBe("true"))
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
    await user.click(screen.getByRole("button", { name: "Project…" }))
    const currentDelete = await screen.findByRole("button", {
      name: "Delete Bracket, revision 3",
    })
    expect((currentDelete as HTMLButtonElement).disabled).toBe(true)
    await user.click(screen.getByRole("button", { name: "Delete Fixture, revision 2" }))
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Keep project" }))
    const confirm = screen.getByRole("button", { name: "Delete project" })

    await user.dblClick(confirm)

    expect(controllerMocks.deleteLocalProject).toHaveBeenCalledOnce()
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
    await user.click(screen.getByRole("button", { name: "Project…" }))
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
    await user.click(screen.getByRole("button", { name: "Project…" }))
    const input = screen.getByLabelText("Choose VibeShape project file") as HTMLInputElement
    const file = new File([new Uint8Array([1, 2, 3])], "Bracket.vshape", {
      type: "application/vnd.vibeshape.project+zip",
    })
    Object.defineProperty(file, "arrayBuffer", {
      value: async () => new Uint8Array([1, 2, 3]).buffer,
    })

    await user.upload(input, file)

    expect((await screen.findByRole("alert")).textContent).toContain(
      "This exact project already exists in this browser.",
    )
    expect(input.value).toBe("")
    await user.upload(input, file)
    expect(controllerMocks.importProjectBackup).toHaveBeenCalledTimes(2)
  })
})
