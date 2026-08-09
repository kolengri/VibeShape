// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { I18nProvider } from "@vibeshape/i18n/provider"
import { afterEach, describe, expect, it, vi } from "vitest"
import { i18n } from "../i18n"
import type { DocumentControllerState } from "./document-controller"
import { DocumentProjectDialog } from "./document-project-dialog"
import { downloadProjectBackup } from "./document-project-file"

const controller = { status: "ready" } as DocumentControllerState

const controllerMocks = vi.hoisted(() => ({
  activateImportedProject: vi.fn(),
  exportActiveProjectBackup: vi.fn(),
  importProjectBackup: vi.fn(),
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
