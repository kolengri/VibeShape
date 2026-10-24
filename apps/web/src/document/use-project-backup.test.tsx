import "../../../../tests/unit/support/dom"
import { afterEach, beforeEach, expect, it, mock } from "bun:test"
import { vi } from "../../../../tests/unit/support/bun-test"
import type { ActiveProjectBackupResult, DocumentControllerState } from "./document-controller"
import type { ProjectBackupStage } from "./project-backup-contract"

const initial = {
  status: "ready",
  saveStatus: "saved",
  report: {
    mode: "read-write",
    snapshot: { id: "0195b5ac-b220-7a2c-8c33-67a36a7f21ac", name: "Bracket", revision: 3 },
  },
} as unknown as DocumentControllerState
let current = initial
let blocked: string | null = null
const write =
  vi.fn<(onProgress?: (stage: ProjectBackupStage) => void) => Promise<ActiveProjectBackupResult>>()
const download = vi.fn()
const original = { ...(await import("./document-controller")) }
mock.module("./document-controller", () => ({
  ...original,
  exportActiveProjectBackup: write,
  getDocumentControllerState: () => current,
  getProjectActionBlock: () => blocked,
}))
mock.module("./document-project-file", () => ({ downloadProjectBackup: download }))
const { act, cleanup, render, screen, waitFor } = await import("@testing-library/react")
const { default: userEvent } = await import("@testing-library/user-event")
const { I18nProvider } = await import("@vibeshape/i18n/provider")
const { Button } = await import("@vibeshape/ui/components/button")
const { i18n } = await import("../i18n")
const { useProjectBackup } = await import("./use-project-backup")
const { ProjectBackupFeedback } = await import("../shell/project-backup-progress")
function Harness() {
  const backup = useProjectBackup(initial)
  return (
    <>
      <Button disabled={backup.pending} onClick={backup.save}>
        Save project
      </Button>
      <ProjectBackupFeedback pending={backup.pending} stage={backup.stage} error={backup.error} />
    </>
  )
}
function setup() {
  return render(
    <I18nProvider i18n={i18n}>
      <Harness />
    </I18nProvider>,
  )
}
const success = {
  ok: true,
  documentId: initial.report?.snapshot.id,
  revision: 3,
  documentName: "Bracket",
  file: new Uint8Array([1, 2, 3]),
} as ActiveProjectBackupResult
beforeEach(() => {
  current = initial
  blocked = null
  write.mockReset()
  download.mockReset()
})
afterEach(cleanup)

it("guards asynchronous backup activation and downloads exactly once", async () => {
  let settle: (result: ActiveProjectBackupResult) => void = () => undefined
  write.mockImplementation(
    () =>
      new Promise((resolve) => {
        settle = resolve
      }),
  )
  setup()
  const user = userEvent.setup()
  const button = screen.getByRole("button", { name: "Save project" }) as HTMLButtonElement
  await user.dblClick(button)
  expect(write).toHaveBeenCalledTimes(1)
  expect(button.disabled).toBe(true)
  const bar = screen.getByRole("progressbar", { name: "Saving project (.vshape)" })
  expect(bar.hasAttribute("aria-valuenow")).toBe(false)
  expect(screen.getByRole("status").textContent).toBe("Reading project history and assets…")
  act(() => write.mock.calls[0]?.[0]?.("building-archive"))
  expect(bar.getAttribute("aria-valuetext")).toBe("Building project archive…")
  expect(screen.getByRole("status").textContent).toBe("Building project archive…")
  settle(success)
  await waitFor(() => expect(button.disabled).toBe(false))
  expect(download).toHaveBeenCalledTimes(1)
  expect(screen.queryByRole("progressbar")).toBeNull()
})

it("refuses a late backup after the active revision changes", async () => {
  let settle: (result: ActiveProjectBackupResult) => void = () => undefined
  write.mockImplementation(
    () =>
      new Promise((resolve) => {
        settle = resolve
      }),
  )
  setup()
  await userEvent.click(screen.getByRole("button", { name: "Save project" }))
  current = {
    ...initial,
    report: { ...initial.report, snapshot: { ...initial.report?.snapshot, revision: 4 } },
  } as DocumentControllerState
  settle(success)
  await screen.findByRole("alert")
  expect(download).not.toHaveBeenCalled()
})

it("blocks active work and releases a rejected attempt for retry", async () => {
  setup()
  blocked = "editor-draft"
  await userEvent.click(screen.getByRole("button", { name: "Save project" }))
  expect(write).not.toHaveBeenCalled()
  blocked = null
  write.mockRejectedValueOnce(new Error("Storage unavailable"))
  await userEvent.click(screen.getByRole("button", { name: "Save project" }))
  await waitFor(() =>
    expect(
      (screen.getByRole("button", { name: "Save project" }) as HTMLButtonElement).disabled,
    ).toBe(false),
  )
  expect(screen.queryByRole("progressbar")).toBeNull()
  write.mockResolvedValueOnce(success)
  await userEvent.click(screen.getByRole("button", { name: "Save project" }))
  await waitFor(() => expect(download).toHaveBeenCalledTimes(1))
})
