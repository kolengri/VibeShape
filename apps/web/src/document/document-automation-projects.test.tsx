// @vitest-environment jsdom

import { cleanup, renderHook, waitFor } from "@testing-library/react"
import type { PersistentDocumentSessionOpenResult } from "@vibeshape/application/persistent-document-session"
import {
  boxFeatureType,
  createLengthQuantity,
  type DocumentSnapshot,
  documentSnapshotSchema,
  featureRecordSchema,
} from "@vibeshape/domain"
import { applyDocumentCommand, commandActorSchema } from "@vibeshape/domain/commands"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createTestBrowserStorage } from "../test-support/browser-storage"

const ports = vi.hoisted(() => ({
  create: vi.fn(),
  open: vi.fn(),
  list: vi.fn(),
  review: vi.fn(),
  createAutomation: vi.fn(),
  disposeAutomation: vi.fn(),
}))
vi.mock("@vibeshape/application/authority-document-session", () => ({
  openAuthorityDocumentSession: ports.open,
}))
vi.mock("@vibeshape/application/persistent-document-session", async (original) => ({
  ...(await original<typeof import("@vibeshape/application/persistent-document-session")>()),
  createPersistentDocumentSession: ports.create,
}))
vi.mock("./authored-document-session", async (original) => ({
  ...(await original<typeof import("./authored-document-session")>()),
  enableAuthoredDocument: (result: unknown) => result,
}))
vi.mock("./browser-project-repository", () => ({
  BrowserProjectRepository: class {
    legacy = {}
    versioned = {}
    listProjects = ports.list
  },
}))
vi.mock("../automation/automation-review-controller", async (original) => {
  const actual = await original<typeof import("../automation/automation-review-controller")>()
  return {
    ...actual,
    automationReviews: { ...actual.automationReviews, getSnapshot: ports.review },
  }
})
vi.mock("../automation/document-automation-session", () => ({
  createDocumentAutomationSession: ports.createAutomation,
}))
vi.mock("../automation/history-automation-session", () => ({
  createBrowserHistoryAutomationSession: () => ({ cancel: vi.fn(), dispose: vi.fn() }),
}))

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

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
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

async function ready(document = snapshot()) {
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
  ports.open.mockResolvedValueOnce(source)
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
  const controller = await import("./document-controller")
  const hook = renderHook(() => controller.useDocumentController("Untitled"))
  await waitFor(() => expect(hook.result.current.status).toBe("ready"))
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
    expect(source.session.close).toHaveBeenCalledOnce()
    expect(oldHandle.readIdentity()).toBeNull()
    expect(ports.disposeAutomation).toHaveBeenCalledOnce()
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
    expect(controller.getDocumentControllerState().report?.snapshot.id).toBe(initialId)
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
    expect(readOnly.session.close).toHaveBeenCalledOnce()
    const target = openResult(snapshot(targetId))
    ports.open.mockResolvedValueOnce(target)
    vi.spyOn(localStorage, "setItem").mockImplementation(() => {
      throw new Error("Storage is unavailable.")
    })
    expect(await controller.openAutomationProject(targetId, expected())).toMatchObject({
      ok: false,
      diagnostic: { code: "storage-unavailable" },
    })
    expect(target.session.close).toHaveBeenCalledOnce()
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
    expect(blockedTarget.session.close).toHaveBeenCalledOnce()
    expect(source.session.close).not.toHaveBeenCalled()
    expect(controller.getDocumentControllerState().report?.snapshot.id).toBe(initialId)
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
    expect(source.session.close).toHaveBeenCalledOnce()
    expect(viewingTarget.session.close).not.toHaveBeenCalled()
    expect(localStorage.getItem(storageKey)).toBe(targetId)
    expect(await controller.openAutomationProject(targetId, expected())).toMatchObject({
      ok: false,
      diagnostic: { code: "lease-held", retryable: true },
    })
    expect(await controller.activateLocalProject(initialId, expected())).toEqual({ ok: true })
    expect(viewingTarget.session.close).toHaveBeenCalledOnce()
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
    expect(replacement.readIdentity()?.id).toBe(initialId)
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
    expect(target.session.close).toHaveBeenCalledOnce()
    expect(source.session.close).not.toHaveBeenCalled()
    const closing = deferred<{ ok: true; value: undefined }>()
    source.session.close.mockReturnValueOnce(closing.promise)
    const duringClose = new AbortController()
    const switching = controller.openAutomationProject(targetId, expected(), duringClose.signal)
    await waitFor(() => expect(source.session.close).toHaveBeenCalledOnce())
    duringClose.abort()
    closing.resolve({ ok: true, value: undefined })
    expect(await switching).toMatchObject({ ok: false, diagnostic: { code: "cancelled" } })
    expect(controller.getDocumentControllerState().report?.snapshot.id).toBe(initialId)
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
    expect(target.session.close).toHaveBeenCalledOnce()
    expect(controller.getDocumentControllerState()).toMatchObject({
      status: "ready",
      saveStatus: "saved",
      report: { snapshot: { id: initialId } },
    })
    expect(localStorage.getItem(storageKey)).toBe(initialId)
    expect(oldHandle.readIdentity()).toBeNull()
  })
})
