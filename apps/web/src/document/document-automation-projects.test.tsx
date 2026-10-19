import "../../../../tests/unit/support/dom"

import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test"
import type { PersistentDocumentSessionOpenResult } from "@vibeshape/application/persistent-document-session"
import type { DocumentSnapshot } from "@vibeshape/domain"
import { vi } from "../../../../tests/unit/support/bun-test"

const ports = (() => ({
  initializeRepository: vi.fn(),
  create: vi.fn(),
  open: vi.fn(),
  list: vi.fn(),
  delete: vi.fn(),
  copy: vi.fn(),
  export: vi.fn(),
  thumbnail: vi.fn(),
  review: vi.fn(),
  createAutomation: vi.fn(),
  disposeAutomation: vi.fn(),
}))()
mock.module("@vibeshape/application/authority-document-session", () => ({
  openAuthorityDocumentSession: ports.open,
}))
const originalModule1 = { ...(await import("@vibeshape/application/persistent-document-session")) }
mock.module("@vibeshape/application/persistent-document-session", () => ({
  ...originalModule1,
  createPersistentDocumentSession: ports.create,
}))
const originalModule2 = { ...(await import("./authored-document-session")) }
mock.module("./authored-document-session", () => ({
  ...originalModule2,
  enableAuthoredDocument: (result: unknown) => result,
}))
mock.module("./browser-project-repository", () => ({
  BrowserProjectRepository: class {
    constructor() {
      ports.initializeRepository()
    }
    legacy = {}
    versioned = {}
    listProjects = ports.list
    deleteProject = ports.delete
    copyPortableProject = ports.copy
    exportPortableProject = ports.export
    copyProjectThumbnail = ports.thumbnail
  },
}))
const originalModule3 = { ...(await import("../automation/automation-review-controller")) }
mock.module("../automation/automation-review-controller", () => {
  const actual = originalModule3
  return {
    ...actual,
    automationReviews: { ...actual.automationReviews, getSnapshot: ports.review },
  }
})
mock.module("../automation/document-automation-session", () => ({
  createDocumentAutomationSession: ports.createAutomation,
}))
mock.module("../automation/history-automation-session", () => ({
  createBrowserHistoryAutomationSession: () => ({ cancel: vi.fn(), dispose: vi.fn() }),
}))

const { cleanup, renderHook, waitFor } = await import("@testing-library/react")
const { boxFeatureType, createLengthQuantity, documentSnapshotSchema, featureRecordSchema } =
  await import("@vibeshape/domain")
const { applyDocumentCommand, commandActorSchema } = await import("@vibeshape/domain/commands")
const { createTestBrowserStorage } = await import("../test-support/browser-storage")

const initialId = "0195b5ac-b250-7a2c-8c33-000000000101"
const targetId = "0195b5ac-b250-7a2c-8c33-000000000102"
const featureId = "0195b5ac-b250-7a2c-8c33-000000000103"
const storageKey = "vibeshape-active-document-id"

function snapshot(
  id = initialId,
  name = "Initial project",
  features: DocumentSnapshot["features"] = [],
) {
  return documentSnapshotSchema.parse({
    schemaVersion: 0,
    id,
    name,
    revision: features.length ? 2 : 1,
    features,
    variables: [],
    sketches: [],
    createdAt: "2026-10-04T00:00:00.000Z",
    updatedAt: "2026-10-04T00:00:00.000Z",
  })
}

function openResult(document: DocumentSnapshot, mode: "read-write" | "read-only" = "read-write") {
  const session = {
    snapshot: document,
    mode,
    history: { canUndo: false, canRedo: false },
    close: vi.fn().mockResolvedValue({ ok: true, value: undefined }),
    commit: vi.fn(),
    commitDraft: vi.fn(),
    validateDraft: vi.fn().mockResolvedValue({ ok: true }),
  }
  return {
    ok: true as const,
    session,
    report: {
      status: "clean" as const,
      snapshot: document,
      mode,
      historyItems: null,
      writeAccessDiagnostic:
        mode === "read-only"
          ? {
              code: "write-access-unavailable",
              message: "The project has another writer.",
              retryable: true,
              sourceCode: "lease-held",
            }
          : null,
      rebuild: {
        ok: false as const,
        diagnostic: {
          code: "rebuild-failed",
          message: "Geometry is outside this controller test.",
          retryable: true,
          sourceCode: null,
        },
      },
      lostRevisionCount: 0,
      corruptRecords: [],
      migration: null,
    },
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((finish) => {
    resolve = finish
  })
  return { promise, resolve }
}

let moduleRevision = 0
beforeEach(() => {
  moduleRevision += 1
  vi.clearAllMocks()
  ports.initializeRepository.mockImplementation(() => {})
  vi.stubGlobal("localStorage", createTestBrowserStorage())
  vi.stubGlobal("sessionStorage", createTestBrowserStorage())
  localStorage.setItem(storageKey, initialId)
  ports.review.mockReturnValue(null)
  ports.createAutomation.mockImplementation(() => ({
    ok: true,
    host: {},
    dispose: ports.disposeAutomation,
    cancel: vi.fn(),
    enableAutoApply: vi.fn(),
  }))
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

async function ready(
  document = snapshot(),
  library = false,
  startup?: { url: string; status: "error" },
) {
  window.history.replaceState(
    null,
    "",
    startup?.url ?? (library ? "/" : `/?project=${document.id}`),
  )
  const projects = new Map<string, DocumentSnapshot>([
    [document.id, document],
    [targetId, snapshot(targetId, "Existing project")],
  ])
  function persistedSession(stored: DocumentSnapshot) {
    const opened = openResult(stored)
    opened.session.commit.mockImplementation(async (command: unknown) => {
      const committed = applyDocumentCommand(opened.session.snapshot, command)
      if (!committed.ok) throw new Error(committed.diagnostic.message)
      projects.set(stored.id, committed.snapshot)
      opened.session.snapshot = committed.snapshot
      return { ...committed, rebuild: opened.report.rebuild }
    })
    return opened
  }
  const source = persistedSession(document)
  ports.open.mockImplementation(async (_dependencies, { documentId }) => {
    const stored = projects.get(documentId)
    if (!stored) throw new Error("Unexpected project open.")
    return persistedSession(stored)
  })
  if (!library) ports.open.mockResolvedValueOnce(source)
  ports.list.mockImplementation(async () => ({
    ok: true,
    value: [...projects.values()].map(({ id, name, revision }) => ({
      documentId: id,
      name,
      headRevision: revision,
    })),
  }))
  ports.create.mockImplementation(async (_dependencies, { command }) => {
    const created = applyDocumentCommand(null, command)
    if (!created.ok) throw new Error(created.diagnostic.message)
    projects.set(created.snapshot.id, created.snapshot)
    return persistedSession(created.snapshot)
  })
  ports.delete.mockImplementation(async ({ documentId, expectedHeadRevision }) => {
    const current = projects.get(documentId)
    if (!current || current.revision !== expectedHeadRevision)
      return { ok: false, diagnostic: { code: "stale-revision", message: "Project changed." } }
    projects.delete(documentId)
    return { ok: true }
  })
  ports.copy.mockImplementation(async (copied) => {
    const document = copied.project.snapshot
    projects.set(document.id, {
      ...snapshot(document.id, document.name),
      revision: document.revision,
    })
    return { ok: true, value: { documentId: document.id, revision: document.revision } }
  })
  const controller = (await import(
    `./document-controller?test=${moduleRevision}`
  )) as typeof import("./document-controller")
  const hook = renderHook(() => controller.useDocumentController("Untitled"))
  await waitFor(() =>
    expect(hook.result.current.status).toBe(startup?.status ?? (library ? "library" : "ready")),
  )
  const expected = () => {
    const current = controller.getDocumentControllerState().report?.snapshot
    if (!current) throw new Error("Expected the current project.")
    return { documentId: current.id, revision: current.revision }
  }
  return { controller, source, projects, expected }
}

describe("in-place automation project management", () => {
  it("validates captured draft authority without saving or requesting a review", async () => {
    const { controller, source } = await ready()
    const factory = controller.createActiveDocumentAutomationSession()
    expect(factory.ok).toBe(true)
    const port = ports.createAutomation.mock.lastCall?.[0].documents
    expect(port).toBeDefined()
    const message = "Command 2: invalid-event: A History dependency follows its consumer."
    source.session.validateDraft.mockResolvedValue({
      ok: false,
      diagnostic: {
        code: "invalid-draft-commit",
        sourceCode: "invalid-event",
        message,
        retryable: false,
      },
    })
    const draft = {
      id: targetId,
      documentId: initialId,
      baseRevision: source.session.snapshot.revision,
      snapshot: source.session.snapshot,
    }
    const result = await port.validateDraft(draft, [])
    expect(result).toMatchObject({
      ok: false,
      diagnostic: { code: "draft-commit-preflight-failed", message },
    })
    expect(source.session.validateDraft).toHaveBeenCalledWith({
      draftId: targetId,
      commands: [],
      expectedSnapshot: draft.snapshot,
    })
    expect(source.session.commitDraft).not.toHaveBeenCalled()
    expect(ports.review).not.toHaveBeenCalled()
    expect(controller.getDocumentControllerState().saveStatus).toBe("saved")
  })

  it("persists the trusted MCP create actor and retains the manual default actor", async () => {
    const { controller, expected } = await ready()
    const actor = commandActorSchema.parse({
      type: "mcp",
      clientId: "org.vibeshape.project-agent",
      sessionId: initialId,
    })
    expect(
      await controller.createAutomationProject("Agent project", expected(), undefined, actor),
    ).toMatchObject({ ok: true })
    expect(ports.create.mock.lastCall?.[1].command.actor).toEqual(actor)
    expect(await controller.createNewLocalProject()).toMatchObject({ ok: true })
    expect(ports.create.mock.lastCall?.[1].command).toMatchObject({
      actor: { type: "user", userId: null },
      payload: { name: "Untitled" },
    })
  })

  it("creates named projects and revisits saved feature records without replacing the browser page", async () => {
    const box = featureRecordSchema.parse({
      schemaVersion: 0,
      id: featureId,
      type: boxFeatureType.type,
      parameters: {
        width: createLengthQuantity(10),
        depth: createLengthQuantity(8),
        height: createLengthQuantity(4),
        centered: false,
      },
      dependencies: [],
      references: [],
      suppressed: false,
    })
    const { controller, source, expected } = await ready(
      snapshot(initialId, "Initial project", [box]),
    )
    const oldHandle = controller.createActiveDocumentAutomationSession()
    if (!oldHandle.ok) throw new Error("Expected an initial automation handle.")
    const sentinel = document.createElement("div")
    document.body.append(sentinel)
    const first = await controller.createAutomationProject("  Project A  ", expected())
    expect(first).toMatchObject({ ok: true, value: { name: "Project A", revision: 1 } })
    if (!first.ok) throw new Error("Expected project A.")
    expect(localStorage.getItem(storageKey)).toBe(first.value.projectId)
    expect(source.session.close).toHaveBeenCalledTimes(1)
    expect(oldHandle.readIdentity()).toBeNull()
    expect(ports.disposeAutomation).toHaveBeenCalledTimes(1)
    expect(await controller.addFeature(1, box)).toMatchObject({ ok: true })
    const second = await controller.createAutomationProject("Project B", expected())
    expect(second).toMatchObject({ ok: true, value: { name: "Project B" } })
    expect(await controller.openAutomationProject(first.value.projectId, expected())).toMatchObject(
      { ok: true, value: { name: "Project A", revision: 2 } },
    )
    expect(controller.getDocumentControllerState().report?.snapshot.features).toEqual([box])
    expect(await controller.openAutomationProject(initialId, expected())).toMatchObject({
      ok: true,
      value: { name: "Initial project", revision: 2 },
    })
    expect(controller.getDocumentControllerState().report?.snapshot.features).toEqual([box])
    expect(document.body.contains(sentinel)).toBe(true)
    sentinel.remove()
  })

  it("rejects stale identity, stale revisions, invalid names, and missing targets before closing the source", async () => {
    const { controller, source, expected } = await ready()
    expect(
      await controller.createAutomationProject("Valid", { documentId: targetId, revision: 1 }),
    ).toMatchObject({ ok: false, diagnostic: { code: "stale-revision", retryable: true } })
    expect(
      await controller.openAutomationProject(targetId, { documentId: initialId, revision: 0 }),
    ).toMatchObject({ ok: false, diagnostic: { code: "stale-revision" } })
    expect(await controller.createAutomationProject(" ", expected())).toMatchObject({
      ok: false,
      diagnostic: { code: "invalid-input", retryable: false },
    })
    expect(await controller.openAutomationProject(featureId, expected())).toMatchObject({
      ok: false,
      diagnostic: { code: "document-not-found", retryable: false },
    })
    expect(source.session.close).not.toHaveBeenCalled()
    expect(ports.create).not.toHaveBeenCalled()
    expect(controller.getDocumentControllerState().report?.snapshot.id).toBe<unknown>(initialId)
  })

  it("blocks owner drafts and active manual review", async () => {
    const { controller, source, expected } = await ready()
    const release = controller.registerProjectActionGuard(() => "editor-draft")
    expect(await controller.createAutomationProject("Blocked", expected())).toMatchObject({
      ok: false,
      diagnostic: { code: "project-action-blocked" },
    })
    release()
    ports.review.mockReturnValue({ status: "ready" })
    expect(await controller.openAutomationProject(targetId, expected())).toMatchObject({
      ok: false,
      diagnostic: { code: "project-action-blocked" },
    })
    expect(source.session.close).not.toHaveBeenCalled()
  })

  it("reserves the source against concurrent MCP, manual switches, and ordinary mutations", async () => {
    const { controller, source, expected } = await ready()
    const creating = deferred<ReturnType<typeof openResult>>()
    ports.create.mockReturnValueOnce(creating.promise)
    const pending = controller.createAutomationProject("Pending", expected())
    expect(controller.getProjectActionBlock()).toBe("saving")
    expect(await controller.openAutomationProject(targetId, expected())).toMatchObject({
      ok: false,
      diagnostic: { code: "project-action-blocked" },
    })
    expect(await controller.createNewLocalProject()).toMatchObject({ ok: false })
    expect(await controller.activateLocalProject(targetId)).toMatchObject({ ok: false })
    expect(await controller.renameActiveProject(1, "Race")).toMatchObject({ ok: false })
    expect(await controller.applyVariableTable(1, [])).toMatchObject({ ok: false })
    expect(source.session.commit).not.toHaveBeenCalled()
    expect(source.session.commitDraft).not.toHaveBeenCalled()
    creating.resolve(openResult(snapshot(targetId, "Pending")))
    expect(await pending).toMatchObject({ ok: true })
  })

  it("keeps the source active when target persistence, writer access, or browser storage fails", async () => {
    const { controller, source, expected } = await ready()
    ports.open.mockResolvedValueOnce({
      ok: false,
      diagnostic: {
        code: "persistence-failed",
        message: "Quota exceeded.",
        retryable: false,
        sourceCode: "quota-exceeded",
      },
    })
    expect(await controller.openAutomationProject(targetId, expected())).toMatchObject({
      ok: false,
      diagnostic: { code: "quota-exceeded", retryable: false },
    })
    const readOnly = openResult(snapshot(targetId), "read-only")
    ports.open.mockResolvedValueOnce(readOnly)
    expect(await controller.openAutomationProject(targetId, expected())).toMatchObject({
      ok: false,
      diagnostic: { code: "lease-held", retryable: true },
    })
    expect(readOnly.session.close).toHaveBeenCalledTimes(1)
    const target = openResult(snapshot(targetId))
    ports.open.mockResolvedValueOnce(target)
    vi.spyOn(localStorage, "setItem").mockImplementation(() => {
      throw new Error("Storage is unavailable.")
    })
    expect(await controller.openAutomationProject(targetId, expected())).toMatchObject({
      ok: false,
      diagnostic: { code: "storage-unavailable" },
    })
    expect(target.session.close).toHaveBeenCalledTimes(1)
    expect(source.session.close).not.toHaveBeenCalled()
    expect(controller.getDocumentControllerState()).toMatchObject({
      status: "ready",
      saveStatus: "saved",
      report: { snapshot: { id: initialId } },
    })
  })

  it("allows manual read-only viewing and leaving while MCP open retains its writer requirement", async () => {
    const { controller, source, expected } = await ready()
    const blockedTarget = openResult(snapshot(targetId, "Other tab's project"), "read-only")
    ports.open.mockResolvedValueOnce(blockedTarget)
    expect(await controller.openAutomationProject(targetId, expected())).toMatchObject({
      ok: false,
      diagnostic: { code: "lease-held", retryable: true },
    })
    expect(blockedTarget.session.close).toHaveBeenCalledTimes(1)
    expect(source.session.close).not.toHaveBeenCalled()
    expect(controller.getDocumentControllerState().report?.snapshot.id).toBe<unknown>(initialId)
    expect(localStorage.getItem(storageKey)).toBe(initialId)

    const viewingTarget = openResult(snapshot(targetId, "Other tab's project"), "read-only")
    ports.open.mockResolvedValueOnce(viewingTarget)
    expect(await controller.activateLocalProject(targetId, expected())).toEqual({ ok: true })
    expect(controller.getDocumentControllerState()).toMatchObject({
      status: "ready",
      saveStatus: "saved",
      report: { mode: "read-only", snapshot: { id: targetId } },
      diagnostic: { code: "write-access-unavailable", sourceCode: "lease-held" },
    })
    expect(source.session.close).toHaveBeenCalledTimes(1)
    expect(viewingTarget.session.close).not.toHaveBeenCalled()
    expect(localStorage.getItem(storageKey)).toBe(targetId)
    expect(await controller.openAutomationProject(targetId, expected())).toMatchObject({
      ok: false,
      diagnostic: { code: "lease-held", retryable: true },
    })
    expect(await controller.activateLocalProject(initialId, expected())).toEqual({ ok: true })
    expect(viewingTarget.session.close).toHaveBeenCalledTimes(1)
    expect(controller.getDocumentControllerState().report).toMatchObject({
      mode: "read-write",
      snapshot: { id: initialId },
    })
    expect(localStorage.getItem(storageKey)).toBe(initialId)
  })

  it("reopens the saved source when close fails and disposes its old automation handle", async () => {
    const { controller, source, expected } = await ready()
    const oldHandle = controller.createActiveDocumentAutomationSession()
    if (!oldHandle.ok) throw new Error("Expected an initial automation handle.")
    source.session.close.mockResolvedValueOnce({
      ok: false,
      diagnostic: {
        code: "close-failed",
        message: "Clean marker failed.",
        retryable: true,
        sourceCode: "storage-unavailable",
      },
    })
    expect(await controller.openAutomationProject(targetId, expected())).toMatchObject({
      ok: false,
      diagnostic: { code: "close-failed", retryable: true },
    })
    expect(localStorage.getItem(storageKey)).toBe(initialId)
    expect(controller.getDocumentControllerState()).toMatchObject({
      status: "ready",
      saveStatus: "saved",
      report: { snapshot: { id: initialId } },
    })
    expect(ports.open.mock.lastCall?.[1].documentId).toBe(initialId)
    expect(oldHandle.readIdentity()).toBeNull()
    const replacement = controller.createActiveDocumentAutomationSession()
    if (!replacement.ok) throw new Error("Expected a recovered automation handle.")
    expect(replacement.readIdentity()?.id).toBe<unknown>(initialId)
    replacement.dispose()
  })

  it("cancels before activation and restores the source after cancellation during close", async () => {
    const { controller, source, expected } = await ready()
    const cancelled = new AbortController()
    cancelled.abort()
    expect(
      await controller.createAutomationProject("Cancelled", expected(), cancelled.signal),
    ).toMatchObject({ ok: false, diagnostic: { code: "cancelled" } })
    expect(ports.create).not.toHaveBeenCalled()
    const target = openResult(snapshot(targetId))
    const preparation = deferred<ReturnType<typeof openResult>>()
    ports.open.mockReturnValueOnce(preparation.promise)
    const duringPreparation = new AbortController()
    const pending = controller.openAutomationProject(targetId, expected(), duringPreparation.signal)
    await waitFor(() => expect(ports.open).toHaveBeenCalledTimes(2))
    duringPreparation.abort()
    preparation.resolve(target)
    expect(await pending).toMatchObject({ ok: false, diagnostic: { code: "cancelled" } })
    expect(target.session.close).toHaveBeenCalledTimes(1)
    expect(source.session.close).not.toHaveBeenCalled()
    const closing = deferred<{ ok: true; value: undefined }>()
    source.session.close.mockReturnValueOnce(closing.promise)
    const duringClose = new AbortController()
    const switching = controller.openAutomationProject(targetId, expected(), duringClose.signal)
    await waitFor(() => expect(source.session.close).toHaveBeenCalledTimes(1))
    duringClose.abort()
    closing.resolve({ ok: true, value: undefined })
    expect(await switching).toMatchObject({ ok: false, diagnostic: { code: "cancelled" } })
    expect(controller.getDocumentControllerState().report?.snapshot.id).toBe<unknown>(initialId)
    expect(localStorage.getItem(storageKey)).toBe(initialId)
  })

  it("reports recovery failure without claiming the terminated source is writable", async () => {
    const { controller, source, expected } = await ready()
    const target = openResult(snapshot(targetId))
    ports.open.mockResolvedValueOnce(target)
    source.session.close.mockResolvedValueOnce({
      ok: false,
      diagnostic: {
        code: "close-failed",
        message: "Close failed.",
        retryable: true,
        sourceCode: null,
      },
    })
    ports.open.mockResolvedValueOnce({
      ok: false,
      diagnostic: {
        code: "persistence-failed",
        message: "Recovery unavailable.",
        retryable: true,
        sourceCode: "storage-unavailable",
      },
    } satisfies PersistentDocumentSessionOpenResult)
    expect(await controller.openAutomationProject(targetId, expected())).toMatchObject({
      ok: false,
      diagnostic: { code: "project-recovery-failed", retryable: true },
    })
    expect(controller.getDocumentControllerState().status).toBe("error")
    expect(controller.createActiveDocumentAutomationSession()).toMatchObject({ ok: false })
    expect(localStorage.getItem(storageKey)).toBe(initialId)
  })

  it("restores source identity and selection when an old automation disposal subscriber throws", async () => {
    const { controller, expected } = await ready()
    const target = openResult(snapshot(targetId))
    ports.open.mockResolvedValueOnce(target)
    const oldHandle = controller.createActiveDocumentAutomationSession()
    if (!oldHandle.ok) throw new Error("Expected an initial automation handle.")
    ports.disposeAutomation.mockImplementationOnce(() => {
      throw new Error("Disposal failed.")
    })
    expect(await controller.openAutomationProject(targetId, expected())).toMatchObject({
      ok: false,
      diagnostic: { code: "persistence-failed" },
    })
    expect(target.session.close).toHaveBeenCalledTimes(1)
    expect(controller.getDocumentControllerState()).toMatchObject({
      status: "ready",
      saveStatus: "saved",
      report: { snapshot: { id: initialId } },
    })
    expect(localStorage.getItem(storageKey)).toBe(initialId)
    expect(oldHandle.readIdentity()).toBeNull()
  })
})

describe("sessionless project library", () => {
  it("recovers an invalid deep link to the catalog only after explicit library recovery", async () => {
    const { controller } = await ready(snapshot(), true, {
      url: "/?project=invalid&theme=dark#library",
      status: "error",
    })
    expect(controller.getDocumentControllerState().projectNavigationError).toBe(
      "invalid-project-url",
    )
    expect(await controller.showProjectLibrary()).toEqual({ ok: true })
    expect(controller.getDocumentControllerState()).toMatchObject({
      status: "library",
      projectNavigationError: null,
      report: null,
    })
    expect(`${window.location.search}${window.location.hash}`).toBe("?theme=dark#library")
    expect(await controller.listLocalProjects()).toMatchObject({ ok: true })
    expect(ports.create).not.toHaveBeenCalled()
    expect(ports.open).not.toHaveBeenCalled()
  })

  it("retries failed sessionless repository initialization without opening or creating a model", async () => {
    ports.initializeRepository.mockImplementationOnce(() => {
      throw new Error("Repository unavailable.")
    })
    const { controller } = await ready(snapshot(), true, { url: "/", status: "error" })
    ports.initializeRepository.mockImplementationOnce(() => {
      throw new Error("Repository still unavailable.")
    })
    expect(await controller.showProjectLibrary()).toMatchObject({
      ok: false,
      diagnostic: { code: "persistence-failed", retryable: true },
    })
    expect(controller.getDocumentControllerState().status).toBe("error")
    expect(await controller.showProjectLibrary()).toEqual({ ok: true })
    expect(controller.getDocumentControllerState().status).toBe("library")
    expect(await controller.listLocalProjects()).toMatchObject({ ok: true })
    expect(ports.initializeRepository).toHaveBeenCalledTimes(3)
    expect(ports.create).not.toHaveBeenCalled()
    expect(ports.open).not.toHaveBeenCalled()
  })

  it("ignores the last project on bare startup and exposes the existing catalog without creating a document", async () => {
    const { controller, projects } = await ready(snapshot(), true)
    expect(controller.getDocumentControllerState()).toMatchObject({
      status: "library",
      report: null,
      authoredSnapshot: null,
    })
    expect(ports.create).not.toHaveBeenCalled()
    expect(ports.open).not.toHaveBeenCalled()
    expect(projects.size).toBe(2)
    expect(controller.createActiveDocumentAutomationSession()).toMatchObject({ ok: false })
    expect(await controller.listLocalProjects()).toMatchObject({
      ok: true,
      projects: [{ documentId: initialId }, { documentId: targetId }],
    })
    ports.list.mockResolvedValueOnce({
      ok: false,
      diagnostic: { code: "storage-unavailable", message: "Unavailable." },
    })
    expect(await controller.listLocalProjects()).toMatchObject({
      ok: false,
      diagnostic: { code: "storage-unavailable" },
    })
    expect(await controller.listLocalProjects()).toMatchObject({ ok: true })
    expect(controller.getDocumentControllerState().status).toBe("library")
  })
  it("starts an empty browser in the library and creates a project only on explicit New", async () => {
    localStorage.removeItem(storageKey)
    const { controller, projects } = await ready(snapshot(), true)
    expect(ports.create).not.toHaveBeenCalled()
    expect(ports.open).not.toHaveBeenCalled()
    expect(await controller.createNewLocalProject()).toEqual({ ok: true })
    expect(ports.create).toHaveBeenCalledTimes(1)
    const state = controller.getDocumentControllerState()
    expect(state.status).toBe("ready")
    expect(state.report?.snapshot.name).toBe("Untitled")
    expect(projects.size).toBe(3)
    expect(new URL(window.location.href).searchParams.get("project")).toBe(
      state.report?.snapshot.id ?? null,
    )
    expect(await controller.showProjectLibrary()).toEqual({ ok: true })
    expect(ports.create).toHaveBeenCalledTimes(1)
    expect(controller.getDocumentControllerState().report).toBeNull()
    expect(new URL(window.location.href).searchParams.has("project")).toBe(false)
    expect(await controller.activateLocalProject(targetId)).toEqual({ ok: true })
    expect(controller.getDocumentControllerState().report?.snapshot.id).toBe<unknown>(targetId)
  })
  it("opens an explicit project link while preserving guards before returning to the library", async () => {
    const { controller, source, expected } = await ready()
    expect(ports.open).toHaveBeenCalledTimes(1)
    expect(ports.create).not.toHaveBeenCalled()
    const captured = expected()
    const factory = controller.createActiveDocumentAutomationSession()
    if (!factory.ok) throw new Error("Expected active automation.")
    const release = controller.registerProjectActionGuard(() => "editor-draft")
    expect(await controller.showProjectLibrary()).toMatchObject({
      ok: false,
      diagnostic: { code: "project-action-blocked" },
    })
    release()
    ports.review.mockReturnValue({ status: "ready" })
    expect(await controller.showProjectLibrary()).toMatchObject({ ok: false })
    expect(source.session.close).not.toHaveBeenCalled()
    expect(ports.disposeAutomation).not.toHaveBeenCalled()
    ports.review.mockReturnValue(null)
    const cancelled = new AbortController()
    cancelled.abort()
    expect(await controller.showProjectLibrary(cancelled.signal)).toMatchObject({
      ok: false,
      diagnostic: { code: "cancelled" },
    })
    expect(source.session.close).not.toHaveBeenCalled()
    const closing = deferred<{ ok: true; value: undefined }>()
    source.session.close.mockReturnValueOnce(closing.promise)
    const pending = controller.showProjectLibrary()
    expect(controller.getDocumentControllerState().saveStatus).toBe("saving")
    expect(await controller.showProjectLibrary()).toMatchObject({ ok: false })
    expect(ports.disposeAutomation).not.toHaveBeenCalled()
    closing.resolve({ ok: true, value: undefined })
    expect(await pending).toEqual({ ok: true })
    expect(controller.getDocumentControllerState()).toMatchObject({
      status: "library",
      report: null,
    })
    expect(source.session.close).toHaveBeenCalledTimes(1)
    expect(ports.disposeAutomation).toHaveBeenCalledTimes(1)
    factory.dispose()
    expect(ports.disposeAutomation).toHaveBeenCalledTimes(1)
    expect(ports.create).not.toHaveBeenCalled()
    expect(await controller.activateLocalProject(targetId, captured)).toMatchObject({
      ok: false,
      diagnostic: { code: "stale-revision" },
    })
  })
  it("cancels a pending deep-link open from the library before publishing destination authority", async () => {
    const { controller } = await ready(snapshot(), true)
    const destination = openResult(snapshot(targetId))
    const opening = deferred<ReturnType<typeof openResult>>()
    ports.open.mockReturnValueOnce(opening.promise)
    window.history.pushState(null, "", `/?project=${targetId}`)
    window.dispatchEvent(new PopStateEvent("popstate"))
    await waitFor(() => expect(ports.open).toHaveBeenCalledTimes(1))
    window.history.pushState(null, "", "/")
    window.dispatchEvent(new PopStateEvent("popstate"))
    opening.resolve(destination)
    await waitFor(() =>
      expect(controller.getDocumentControllerState()).toMatchObject({
        status: "library",
        saveStatus: "saved",
        report: null,
      }),
    )
    expect(destination.session.close).toHaveBeenCalledTimes(1)
    expect(ports.create).not.toHaveBeenCalled()
    expect(new URL(window.location.href).searchParams.has("project")).toBe(false)
  })

  it("recovers the saved editor if close or URL clearing fails", async () => {
    const { controller, source, projects } = await ready()
    source.session.close.mockResolvedValueOnce({
      ok: false,
      diagnostic: {
        code: "close-failed",
        message: "Could not write clean marker.",
        retryable: true,
        sourceCode: "storage-unavailable",
      },
    })
    expect(await controller.showProjectLibrary()).toMatchObject({
      ok: false,
      diagnostic: { code: "storage-unavailable" },
    })
    expect(controller.getDocumentControllerState()).toMatchObject({
      status: "ready",
      report: { snapshot: { id: initialId } },
    })
    const sourceAfterRecovery = ports.open.mock.results.at(-1)?.value
    const opened = await sourceAfterRecovery
    expect(opened.ok).toBe(true)
    const write = vi.spyOn(window.history, "pushState").mockImplementation(() => {
      throw new Error("History unavailable.")
    })
    expect(await controller.showProjectLibrary()).toMatchObject({
      ok: false,
      diagnostic: { code: "project-url-unavailable" },
    })
    write.mockRestore()
    expect(controller.getDocumentControllerState().report?.snapshot.id).toBe<unknown>(initialId)
    expect(new URL(window.location.href).searchParams.get("project")).toBe(initialId)
    expect(projects.size).toBe(2)
    expect(ports.create).not.toHaveBeenCalled()
  })
  it("imports and duplicates a replay-proven native backup in the library before explicitly opening it", async () => {
    const { controller, projects } = await ready(snapshot(), true)
    const { writeVShape } = await import("@vibeshape/formats/vshape")
    const issuedAt = "2026-10-19T00:00:00.000Z"
    const created = applyDocumentCommand(null, {
      kind: "org.vibeshape.document.create",
      schemaVersion: 1,
      commandId: featureId,
      documentId: targetId,
      baseRevision: 0,
      issuedAt,
      actor: { type: "user", userId: null },
      payload: { name: "Portable source" },
    })
    if (!created.ok) throw new Error(created.diagnostic.message)
    const archive = await writeVShape({
      snapshot: created.snapshot,
      events: [created.event],
      exportedAt: issuedAt,
      createdBy: { application: "VibeShape", version: "test", build: null },
      engine: null,
    })
    if (!archive.ok) throw new Error(archive.diagnostic.message)
    const imported = await controller.importProjectBackup(
      archive.value,
      (name) => `${name} imported`,
    )
    if (!imported.ok) throw new Error(imported.diagnostic.message)
    expect(imported.documentId).not.toBe<unknown>(targetId)
    expect(projects.get(imported.documentId)?.name).toBe("Portable source imported")
    expect(controller.getDocumentControllerState()).toMatchObject({
      status: "library",
      report: null,
    })
    expect(ports.open).not.toHaveBeenCalled()
    expect(ports.create).not.toHaveBeenCalled()
    const portable = ports.copy.mock.lastCall?.[0]
    ports.export.mockResolvedValue({ ok: true, value: portable })
    ports.thumbnail.mockResolvedValue({ ok: true })
    expect(
      await controller.duplicateLocalProject(imported.documentId, 2, "Independent copy"),
    ).toMatchObject({ ok: true, name: "Independent copy" })
    expect(ports.copy).toHaveBeenCalledTimes(2)
    expect(projects.size).toBe(4)
    expect(await controller.activateLocalProject(imported.documentId)).toEqual({ ok: true })
    expect(controller.getDocumentControllerState().report?.snapshot.id).toBe(imported.documentId)
    expect(ports.open).toHaveBeenCalledTimes(1)
  })

  it("deletes only the selected stored revision from the library", async () => {
    const { controller, projects } = await ready(snapshot(), true)
    expect(await controller.deleteLocalProject(targetId, 9)).toMatchObject({
      ok: false,
      diagnostic: { code: "stale-revision" },
    })
    expect(projects.has(targetId)).toBe(true)
    expect(await controller.deleteLocalProject(targetId, 1)).toEqual({ ok: true })
    expect(projects.has(targetId)).toBe(false)
    expect(projects.has(initialId)).toBe(true)
    expect(controller.getDocumentControllerState().status).toBe("library")
    expect(ports.open).not.toHaveBeenCalled()
    expect(ports.create).not.toHaveBeenCalled()
  })
})
