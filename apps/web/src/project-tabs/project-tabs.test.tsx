import "../../../../tests/unit/support/dom"
import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test"
import { documentIdSchema } from "@vibeshape/domain/identifiers"
import { useSyncExternalStore } from "react"
import { vi } from "../../../../tests/unit/support/bun-test"
import type { DocumentControllerState, ProjectSwitchResult } from "../document/document-controller"

const firstId = "0195b5ac-b250-7a2c-8c33-000000000101"
const secondId = "0195b5ac-b250-7a2c-8c33-000000000102"
const thirdId = "0195b5ac-b250-7a2c-8c33-000000000103"
const names: Record<string, string> = {
  [firstId]: "Bracket",
  [secondId]: "Enclosure",
  [thirdId]: "Reference plate",
}
const listeners = new Set<() => void>()
function state(documentId = firstId, name = names[documentId]) {
  return {
    status: "ready",
    saveStatus: "saved",
    report: { mode: "read-write", snapshot: { id: documentId, name, revision: 3 } },
  } as unknown as DocumentControllerState
}
let current = state()
let blocked: string | null = null
const actions = {
  activate: vi.fn(),
  create: vi.fn(),
  list: vi.fn(),
}
const original = { ...(await import("../document/document-controller")) }
mock.module("../document/document-controller", () => ({
  ...original,
  getDocumentControllerState: () => current,
  getProjectActionBlock: () => blocked,
  activateLocalProject: actions.activate,
  createNewLocalProject: actions.create,
  listLocalProjects: actions.list,
}))
const { act, cleanup, render, screen, waitFor } = await import("@testing-library/react")
const { default: userEvent } = await import("@testing-library/user-event")
const { I18nProvider } = await import("@vibeshape/i18n/provider")
const { TooltipProvider } = await import("@vibeshape/ui/components/tooltip")
const { i18n } = await import("../i18n")
const { createTestBrowserStorage } = await import("../test-support/browser-storage")
const { ProjectTabsProvider } = await import("./project-tabs-provider")
const { ProjectTabs, PROJECT_EDITOR_PANEL_ID, projectTabId } = await import("./project-tabs")
const copy = {
  label: "Open projects",
  newProject: "New project tab",
  openProjects: "Open project tab",
  closeProject: (name: string) => `Close ${name}`,
  blocked: "Finish or cancel the current edit, save, or AI operation before switching projects.",
  switchFailed: "Could not open the project. The current project remains open.",
  listFailed: "Could not refresh open projects.",
  storageFailed: "Open project tabs could not be remembered on this device.",
}
function publish(next: DocumentControllerState) {
  current = next
  for (const listener of listeners) listener()
}
function Shell({ onOpenProjects }: { onOpenProjects?: () => Promise<ProjectSwitchResult> }) {
  const controller = useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => current,
  )
  const id = controller.report?.snapshot.id
  if (controller.status === "library") return <main aria-label="Projects" />
  return (
    <div key={id}>
      <ProjectTabs
        controller={controller}
        copy={copy}
        {...(onOpenProjects ? { onOpenProjects } : {})}
      />
      <section
        id={PROJECT_EDITOR_PANEL_ID}
        role="tabpanel"
        aria-labelledby={id ? projectTabId(id) : undefined}
      />
    </div>
  )
}
function setup(open = [firstId, secondId], onOpenProjects?: () => Promise<ProjectSwitchResult>) {
  localStorage.setItem(
    "vibeshape.open-project-tabs.v1",
    JSON.stringify({
      version: 1,
      tabs: open.map((documentId) => ({ documentId, name: names[documentId] })),
    }),
  )
  return render(
    <I18nProvider i18n={i18n} initialLocale="en">
      <TooltipProvider>
        <ProjectTabsProvider>
          <Shell {...(onOpenProjects ? { onOpenProjects } : {})} />
        </ProjectTabsProvider>
      </TooltipProvider>
    </I18nProvider>,
  )
}
function projectList() {
  return Object.entries(names).map(([documentId, name]) => ({
    documentId,
    name,
    headRevision: 3,
    createdAt: "2026-10-01T00:00:00Z",
    updatedAt: "2026-10-01T00:00:00Z",
    lastExternalBackupAt: null,
    thumbnail: null,
  }))
}
beforeEach(() => {
  current = state()
  blocked = null
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
  actions.activate.mockReset().mockImplementation(async (documentId: string) => {
    publish(state(documentId))
    return { ok: true }
  })
  actions.create.mockReset().mockImplementation(async () => {
    publish(state(thirdId))
    return { ok: true }
  })
  actions.list.mockReset().mockResolvedValue({ ok: true, projects: projectList() })
})
afterEach(() => {
  cleanup()
  listeners.clear()
  vi.unstubAllGlobals()
})

describe("project tabs", () => {
  it("uses manual arrow-key activation and the revision-guarded existing project action", async () => {
    setup()
    const first = await screen.findByRole("tab", { name: "Bracket" })
    first.focus()
    await userEvent.keyboard("{ArrowRight}")
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole("tab", { name: "Enclosure" })),
    )
    expect(actions.activate).not.toHaveBeenCalled()
    await userEvent.keyboard("{Enter}")
    await waitFor(() =>
      expect(screen.getByRole("tab", { name: "Enclosure" }).getAttribute("aria-selected")).toBe(
        "true",
      ),
    )
    expect(actions.activate).toHaveBeenCalledWith(secondId, { documentId: firstId, revision: 3 })
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole("tab", { name: "Enclosure" })),
    )
    expect(screen.getByRole("tabpanel", { name: "Enclosure" })).toBeTruthy()
  })

  it("closes an inactive tab without changing the current model", async () => {
    setup()
    const inactive = await screen.findByRole("tab", { name: "Enclosure" })
    inactive.focus()
    await userEvent.keyboard("{Delete}")
    expect(screen.queryByRole("tab", { name: "Enclosure" })).toBeNull()
    expect(actions.activate).not.toHaveBeenCalled()
    expect(current.report?.snapshot.id).toBe(documentIdSchema.parse(firstId))
  })

  it("removes the active tab only after its adjacent project opens successfully", async () => {
    setup()
    actions.activate.mockResolvedValueOnce({
      ok: false,
      diagnostic: { code: "project-open-failed" },
    })
    await userEvent.click(await screen.findByRole("button", { name: "Close Bracket" }))
    expect((await screen.findByRole("alert")).textContent).toBe(copy.switchFailed)
    expect(screen.getByRole("tab", { name: "Bracket" })).toBeTruthy()
    await userEvent.click(screen.getByRole("button", { name: "Close Bracket" }))
    await waitFor(() => expect(screen.queryByRole("tab", { name: "Bracket" })).toBeNull())
    expect(screen.getByRole("tab", { name: "Enclosure" }).getAttribute("aria-selected")).toBe(
      "true",
    )
  })

  it("retains the final tab when the project picker is canceled and replaces it after choosing another project", async () => {
    setup([firstId])
    await userEvent.click(await screen.findByRole("button", { name: "Close Bracket" }))
    expect(await screen.findByRole("dialog", { name: "Projects" })).toBeTruthy()
    await userEvent.keyboard("{Escape}")
    expect(screen.getByRole("tab", { name: "Bracket" })).toBeTruthy()
    expect(actions.create).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole("button", { name: "Close Bracket" }))
    await userEvent.click(await screen.findByRole("button", { name: "Open Enclosure, revision 3" }))
    await waitFor(() => expect(screen.queryByRole("tab", { name: "Bracket" })).toBeNull())
    expect(screen.getByRole("tab", { name: "Enclosure" })).toBeTruthy()
  })

  it("guards current drafts and failed saves without losing either project tab", async () => {
    setup()
    blocked = "editor-draft"
    await userEvent.click(await screen.findByRole("tab", { name: "Enclosure" }))
    expect((await screen.findByRole("alert")).textContent).toBe(copy.blocked)
    expect(actions.activate).not.toHaveBeenCalled()
    act(() => publish({ ...current, saveStatus: "save-error" }))
    blocked = "save-error"
    await userEvent.click(screen.getByRole("button", { name: "Close Bracket" }))
    expect(screen.getAllByRole("tab")).toHaveLength(2)
    expect(actions.activate).not.toHaveBeenCalled()
  })

  it("locks duplicate project switches and recovers after a rejected operation", async () => {
    setup()
    let reject!: (reason: Error) => void
    actions.activate.mockImplementationOnce(
      () =>
        new Promise((_resolve, rejectPromise) => {
          reject = rejectPromise
        }),
    )
    const target = await screen.findByRole("tab", { name: "Enclosure" })
    await userEvent.click(target)
    await userEvent.click(target)
    expect(actions.activate).toHaveBeenCalledTimes(1)
    expect((target as HTMLButtonElement).disabled).toBe(true)
    act(() => reject(new Error("fixture transport failure")))
    await screen.findByRole("alert")
    await userEvent.click(target)
    await waitFor(() => expect(actions.activate).toHaveBeenCalledTimes(2))
  })

  it("adds projects created through the existing action and refreshes renamed labels", async () => {
    setup()
    await userEvent.click(await screen.findByRole("button", { name: copy.newProject }))
    await screen.findByRole("tab", { name: "Reference plate" })
    expect(actions.create).toHaveBeenCalledTimes(1)
    act(() => publish(state(thirdId, "Reference plate v2")))
    await screen.findByRole("tab", { name: "Reference plate v2" })
    expect(screen.getAllByRole("tab")).toHaveLength(3)
  })

  it("keeps cached tabs when listing fails and preserves external URL-driven activation", async () => {
    actions.list.mockRejectedValue(new Error("fixture library failure"))
    setup()
    expect((await screen.findByRole("alert")).textContent).toBe(copy.listFailed)
    act(() => publish(state(secondId)))
    await waitFor(() =>
      expect(screen.getByRole("tab", { name: "Enclosure" }).getAttribute("aria-selected")).toBe(
        "true",
      ),
    )
    expect(screen.getAllByRole("tab")).toHaveLength(2)
    expect(actions.activate).not.toHaveBeenCalled()
  })
  it("routes header Open to the shared chooser without closing cached project tabs", async () => {
    const openProjects = vi.fn(async () => {
      publish({ ...current, status: "library", report: null })
      return { ok: true as const }
    })
    setup([firstId, secondId], openProjects)
    await userEvent.click(await screen.findByRole("button", { name: copy.openProjects }))
    await screen.findByRole("main", { name: "Projects" })
    expect(openProjects).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole("dialog")).toBeNull()
    const remembered = JSON.parse(localStorage.getItem("vibeshape.open-project-tabs.v1") ?? "null")
    expect(remembered.tabs).toHaveLength(2)
  })

  it("removes the last tab only after the full chooser transition succeeds", async () => {
    const openProjects = vi.fn<() => Promise<ProjectSwitchResult>>()
    openProjects.mockResolvedValueOnce({
      ok: false,
      diagnostic: { code: "project-action-blocked", message: "blocked" },
    })
    openProjects.mockImplementationOnce(async () => {
      publish({ ...current, status: "library", report: null })
      return { ok: true }
    })
    setup([firstId], openProjects)
    await userEvent.click(await screen.findByRole("button", { name: "Close Bracket" }))
    expect((await screen.findByRole("alert")).textContent).toBe(copy.blocked)
    expect(screen.getByRole("tab", { name: "Bracket" })).toBeTruthy()
    await userEvent.click(screen.getByRole("button", { name: "Close Bracket" }))
    await screen.findByRole("main", { name: "Projects" })
    await waitFor(() => {
      const remembered = JSON.parse(
        localStorage.getItem("vibeshape.open-project-tabs.v1") ?? "null",
      )
      expect(remembered.tabs).toEqual([])
    })
    expect(actions.create).not.toHaveBeenCalled()
  })
})
