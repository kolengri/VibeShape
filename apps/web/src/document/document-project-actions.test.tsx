import "../../../../tests/unit/support/dom"

import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test"
import type { AuthoredDocumentSnapshot } from "@vibeshape/domain/document-v2"
import { vi } from "../../../../tests/unit/support/bun-test"
import type { ProjectBackupRequest } from "./project-backup-contract"
import { registerProjectRuntimeResource } from "./project-runtime-resources"

const mocks = (() => ({
  open: vi.fn(),
  exportProject: vi.fn(),
  copyProject: vi.fn(),
  close: vi.fn(),
  readArchive: vi.fn(),
  list: vi.fn(),
  review: vi.fn(),
}))()
mock.module("@vibeshape/application/authority-document-session", () => ({
  openAuthorityDocumentSession: mocks.open,
}))
mock.module("./browser-project-repository", () => ({
  BrowserProjectRepository: class {
    versioned = {}
    legacy = {}
    exportPortableProject = mocks.exportProject
    copyPortableProject = mocks.copyProject
    listProjects = mocks.list
  },
}))
mock.module("./project-backup-client", () => ({
  exportProjectBackup: async (expected: Omit<ProjectBackupRequest, "schemaVersion">) => {
    const { exportSavedProjectBackup } = await import("./project-backup-service")
    return exportSavedProjectBackup({ ...expected, schemaVersion: 0 })
  },
}))
const originalModule1 = { ...(await import("@vibeshape/formats/vshape")) }
mock.module("@vibeshape/formats/vshape", () => {
  const actual = originalModule1
  return { ...actual, readAuthoredVShape: mocks.readArchive }
})

const originalModule2 = { ...(await import("../automation/automation-review-controller")) }
mock.module("../automation/automation-review-controller", () => {
  const actual = originalModule2
  return {
    ...actual,
    automationReviews: { ...actual.automationReviews, getSnapshot: mocks.review },
    getActiveAutomationReviews: () => ({
      ...actual.getActiveAutomationReviews(),
      getSnapshot: mocks.review,
    }),
  }
})

const { act, cleanup, renderHook, waitFor } = await import("@testing-library/react")
const { applyVersionedDocumentCommand } = await import("@vibeshape/domain")
const { projectAuthoredDocumentSnapshotToV1 } = await import("@vibeshape/domain/document-v2")
const { applyHistoryRemoveRetainingDependentsCommand } = await import(
  "@vibeshape/domain/document-v5-commands"
)
const { writeVShapeV2 } = await import("@vibeshape/formats/vshape")
const { historyRepairFixture, repairRemovalCommand } = await import(
  "../../../../packages/domain/src/history-repair.test-fixture"
)
const { createTestBrowserStorage } = await import("../test-support/browser-storage")

const id = "0195b5ac-b250-7a2c-8c33-000000000101"
const issuedAt = "2026-09-01T12:00:00.000Z"
function sourceProject(documentId = id) {
  const result = applyVersionedDocumentCommand(null, {
    kind: "org.vibeshape.document.create",
    schemaVersion: 1,
    commandId: "0195b5ac-b250-7a2c-8c33-000000000103",
    documentId,
    baseRevision: 0,
    issuedAt,
    actor: { type: "user", userId: null },
    payload: { name: "Source" },
  })
  if (!result.ok) throw new Error(result.diagnostic.message)
  return {
    snapshot: result.snapshot,
    seed: null,
    legacyEvents: [],
    versionedEvents: [result.event],
    historyMode: "complete" as const,
    promotionRevision: 0,
    migrationDiagnostic: null,
    unavailableRecords: [],
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
beforeEach(async () => {
  moduleRevision += 1
  for (const port of Object.values(mocks)) port.mockReset()
  vi.stubGlobal("localStorage", createTestBrowserStorage())
  localStorage.clear()
  vi.stubGlobal("sessionStorage", createTestBrowserStorage())
  sessionStorage.clear()
  localStorage.setItem("vibeshape-active-document-id", id)
  const actual = originalModule1
  mocks.readArchive.mockImplementation(actual.readAuthoredVShape)
  mocks.review.mockReturnValue(null)
  mocks.close.mockResolvedValue({ ok: true })
  mocks.list.mockResolvedValue({ ok: true, value: [{ documentId: id }] })
  mocks.copyProject.mockImplementation(async ({ project: { snapshot } }) => ({
    ok: true,
    value: { documentId: snapshot.id },
  }))
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

async function ready(authoredSnapshot?: AuthoredDocumentSnapshot) {
  window.history.replaceState(null, "", "/")
  const source = sourceProject()
  const session = {
    snapshot: authoredSnapshot
      ? projectAuthoredDocumentSnapshotToV1(authoredSnapshot)
      : source.snapshot,
    authoredSnapshot,
    mode: undefined as "read-write" | "read-only" | undefined,
    commitAuthored: vi.fn(),
    commitAuthoredTransaction: vi.fn(),
    history: { canUndo: false, canRedo: false },
    close: mocks.close,
    commitDraft: vi.fn(),
  }
  mocks.list.mockResolvedValue({ ok: true, value: [{ documentId: session.snapshot.id }] })
  mocks.open.mockResolvedValue({
    ok: true,
    session,
    report: { snapshot: session.snapshot, mode: "read-write", writeAccessDiagnostic: null },
  })
  mocks.exportProject.mockResolvedValue({ ok: true, value: { version: 2, project: source } })
  const controller = (await import(
    `./document-controller?test=${moduleRevision}`
  )) as typeof import("./document-controller")
  const hook = renderHook(() => controller.useDocumentController("Untitled"))
  await waitFor(() => expect(hook.result.current.status).toBe("library"))
  expect(mocks.open).not.toHaveBeenCalled()
  await act(async () => {
    expect(await controller.activateLocalProject(session.snapshot.id)).toEqual({ ok: true })
  })
  await waitFor(() => expect(hook.result.current.status).toBe("ready"))
  expect(hook.result.current.report?.snapshot.id).toBe(session.snapshot.id)
  const runtime = controller.getProjectRuntime(session.snapshot.id)
  if (!runtime) throw new Error("Expected scoped document runtime.")
  vi.spyOn(runtime.reviews, "getSnapshot").mockImplementation(mocks.review)
  return { controller, source, session }
}
async function archive(source: ReturnType<typeof sourceProject>) {
  const result = await writeVShapeV2({
    ...source,
    exportedAt: issuedAt,
    createdBy: { application: "VibeShape", version: "test", build: null },
    engine: null,
  })
  if (!result.ok) throw new Error(result.diagnostic.message)
  return result.value
}

describe("project file identity and active-work guards", () => {
  it("opens the same archive repeatedly as distinct replay-proven copies without overwriting the source", async () => {
    const { controller, source } = await ready()
    const bytes = await archive(source)
    const first = await controller.importProjectBackup(bytes, (name) => `${name} imported`)
    const second = await controller.importProjectBackup(bytes, (name) => `${name} imported`)
    expect(first.ok).toBe(true)
    expect(second.ok).toBe(true)
    if (!first.ok || !second.ok) throw new Error("Expected two new copies.")
    expect(first.documentId).not.toBe(id)
    expect(second.documentId).not.toBe(first.documentId)
    const copied = mocks.copyProject.mock.calls[0]?.[0].project
    expect(copied.snapshot.name).toBe("Source imported")
    expect(copied.versionedEvents[0].commandId).not.toBe(source.versionedEvents[0]?.commandId)
    expect(source.snapshot).toMatchObject({ id, name: "Source", revision: 1 })
    expect(mocks.close).not.toHaveBeenCalled()
  })

  it("blocks project files and switching for a live owner guard, but allows them after cleanup", async () => {
    const { controller, source } = await ready()
    const release = controller.registerProjectActionGuard(() => "editor-draft")
    expect(await controller.exportActiveProjectBackup()).toMatchObject({
      ok: false,
      diagnostic: { code: "project-action-blocked" },
    })
    expect(await controller.createNewLocalProject()).toMatchObject({ ok: false })
    expect(await controller.activateLocalProject(id)).toMatchObject({ ok: false })
    expect(mocks.close).not.toHaveBeenCalled()
    expect(mocks.exportProject).not.toHaveBeenCalled()
    release()
    expect(await controller.exportActiveProjectBackup()).toMatchObject({
      ok: true,
      documentId: id,
      revision: source.snapshot.revision,
    })
  })

  it("rejects a changed revision during archive decode and export before publishing or downloading", async () => {
    const { controller, source, session } = await ready()
    const bytes = await archive(source)
    const decoded = await mocks.readArchive(bytes)
    const extraction = deferred<typeof decoded>()
    mocks.readArchive.mockReturnValueOnce(extraction.promise)
    const importing = controller.importProjectBackup(bytes, (name) => `${name} imported`)
    session.snapshot = { ...session.snapshot, revision: 2 }
    extraction.resolve(decoded)
    expect(await importing).toMatchObject({
      ok: false,
      diagnostic: { code: "project-action-blocked" },
    })
    expect(mocks.copyProject).not.toHaveBeenCalled()
    const exporting = deferred<{ ok: true; value: { version: 2; project: typeof source } }>()
    mocks.exportProject.mockReturnValueOnce(exporting.promise)
    const backup = controller.exportActiveProjectBackup()
    session.snapshot = { ...session.snapshot, revision: 3 }
    exporting.resolve({ ok: true, value: { version: 2, project: source } })
    expect(await backup).toMatchObject({
      ok: false,
      diagnostic: { code: "project-action-blocked" },
    })
  })

  it("rejects corrupt files and stale activation contexts without touching storage or closing the session", async () => {
    const { controller } = await ready()
    expect(
      await controller.importProjectBackup(new Uint8Array([1, 2, 3]), (name) => `${name} imported`),
    ).toMatchObject({ ok: false })
    expect(
      await controller.activateLocalProject(id, { documentId: id, revision: 0 }),
    ).toMatchObject({ ok: false })
    expect(mocks.copyProject).not.toHaveBeenCalled()
    expect(mocks.close).not.toHaveBeenCalled()
  })
  it("selects the destination before recovery finishes and reuses retained project sessions", async () => {
    const { controller, session } = await ready()
    const secondId = "0195b5ac-b250-7a2c-8c33-000000000201"
    const destination = sourceProject(secondId).snapshot
    const recovery = deferred<Awaited<ReturnType<typeof mocks.open>>>()
    mocks.open.mockReturnValueOnce(recovery.promise)
    let switching!: Promise<unknown>
    act(() => {
      switching = controller.activateProjectTab(secondId, {
        documentId: id,
        revision: session.snapshot.revision,
      })
    })
    expect(controller.getDocumentControllerState()).toMatchObject({
      status: "loading",
      openingProjectId: secondId,
      report: null,
    })
    expect(new URL(window.location.href).searchParams.get("project")).toBe(secondId)
    expect(controller.getProjectActionBlock()).toBe("unavailable")
    expect(mocks.close).not.toHaveBeenCalled()
    await act(async () => {
      recovery.resolve({
        ok: true,
        session: { ...session, snapshot: destination },
        report: { snapshot: destination, mode: "read-write", writeAccessDiagnostic: null },
      })
      expect(await switching).toEqual({ ok: true })
    })
    expect(controller.getDocumentControllerState().report?.snapshot.id).toBe(destination.id)
    await act(async () => {
      expect(await controller.activateProjectTab(id)).toEqual({ ok: true })
      expect(await controller.activateProjectTab(secondId)).toEqual({ ok: true })
    })
    expect(mocks.open).toHaveBeenCalledTimes(2)
  })

  it("keeps a newer selection active when an earlier cold open completes later", async () => {
    const { controller, session } = await ready()
    const destination = sourceProject("0195b5ac-b250-7a2c-8c33-000000000203").snapshot
    const recovery = deferred<Awaited<ReturnType<typeof mocks.open>>>()
    const disposal = deferred<{ ok: true }>()
    const disposeResource = vi.fn().mockResolvedValue(undefined)
    const unregisterResource = registerProjectRuntimeResource(destination.id, {
      isBusy: () => false,
      dispose: disposeResource,
    })
    const closeDestination = vi.fn().mockImplementation(() => {
      expect(disposeResource).toHaveBeenCalledTimes(1)
      return disposal.promise
    })
    mocks.open.mockReturnValueOnce(recovery.promise)
    let earlier!: Promise<unknown>
    act(() => {
      earlier = controller.activateLocalProject(destination.id)
    })
    expect(controller.getDocumentControllerState().openingProjectId).toBe(destination.id)
    await act(async () => {
      expect(await controller.activateLocalProject(id)).toEqual({ ok: true })
    })
    expect(controller.getDocumentControllerState().report?.snapshot.id).toBe(session.snapshot.id)
    await act(async () => {
      recovery.resolve({
        ok: true,
        session: { ...session, snapshot: destination, close: closeDestination },
        report: { snapshot: destination, mode: "read-write", writeAccessDiagnostic: null },
      })
    })
    await waitFor(() => expect(closeDestination).toHaveBeenCalledTimes(1))
    await act(async () => {
      expect(await controller.activateLocalProject(destination.id)).toMatchObject({
        ok: false,
        diagnostic: { code: "project-action-blocked" },
      })
      disposal.resolve({ ok: true })
      expect(await earlier).toMatchObject({ ok: false, diagnostic: { code: "cancelled" } })
    })
    expect(controller.getDocumentControllerState().report?.snapshot.id).toBe(session.snapshot.id)
    expect(new URL(window.location.href).searchParams.get("project")).toBe(id)
    expect(closeDestination).toHaveBeenCalledTimes(1)
    expect(mocks.close).not.toHaveBeenCalled()
    unregisterResource()
  })

  it("returns to the project library while a cold open is still pending", async () => {
    const { controller, session } = await ready()
    const destination = sourceProject("0195b5ac-b250-7a2c-8c33-000000000204").snapshot
    const recovery = deferred<Awaited<ReturnType<typeof mocks.open>>>()
    mocks.open.mockReturnValueOnce(recovery.promise)
    let earlier!: Promise<unknown>
    act(() => {
      earlier = controller.activateLocalProject(destination.id)
    })
    await act(async () => {
      expect(await controller.showProjectLibrary()).toEqual({ ok: true })
    })
    expect(controller.getDocumentControllerState().status).toBe("library")
    await act(async () => {
      recovery.resolve({
        ok: true,
        session: { ...session, snapshot: destination },
        report: { snapshot: destination, mode: "read-write", writeAccessDiagnostic: null },
      })
      expect(await earlier).toMatchObject({ ok: false, diagnostic: { code: "cancelled" } })
    })
    expect(controller.getDocumentControllerState().status).toBe("library")
    expect(new URL(window.location.href).searchParams.has("project")).toBe(false)
  })

  it("restores the source project and reports a failed destination without closing the source", async () => {
    const { controller } = await ready()
    const recovery = deferred<Awaited<ReturnType<typeof mocks.open>>>()
    mocks.open.mockReturnValueOnce(recovery.promise)
    let switching!: Promise<unknown>
    act(() => {
      switching = controller.activateLocalProject("0195b5ac-b250-7a2c-8c33-000000000202")
    })
    expect(controller.getDocumentControllerState().status).toBe("loading")
    await act(async () => {
      recovery.resolve({
        ok: false,
        diagnostic: { code: "document-not-found", message: "Missing project.", retryable: false },
      })
      expect(await switching).toMatchObject({ ok: false })
    })
    expect(controller.getDocumentControllerState()).toMatchObject({
      status: "ready",
      report: { snapshot: { id } },
      projectNavigationError: "project-open-failed",
    })
    expect(new URL(window.location.href).searchParams.get("project")).toBe(id)
    expect(localStorage.getItem("vibeshape-active-document-id")).toBe(id)
    expect(mocks.close).not.toHaveBeenCalled()
  })

  it("blocks downloads while manual AI review is ready or applying and allows tab navigation", async () => {
    const { controller } = await ready()
    for (const status of ["ready", "applying"]) {
      mocks.review.mockReturnValue({ status })
      expect(controller.getProjectActionBlock()).toBe("automation-busy")
      expect(await controller.exportActiveProjectBackup()).toMatchObject({ ok: false })
      expect(await controller.activateProjectTab(id)).toEqual({ ok: true })
    }
    expect(mocks.close).not.toHaveBeenCalled()
    expect(mocks.exportProject).not.toHaveBeenCalled()
    mocks.review.mockReturnValue(null)
    expect(controller.getProjectActionBlock()).toBeNull()
  })

  it("blocks both pending persistence and save-error state", async () => {
    const { controller, session } = await ready()
    const commit = deferred<{
      ok: false
      diagnostic: {
        code: "persistence-failed"
        message: string
        retryable: boolean
        sourceCode: null
      }
    }>()
    session.commitDraft.mockReturnValue(commit.promise)
    const saving = controller.applyVariableTable(1, [])
    expect(controller.getProjectActionBlock()).toBe("saving")
    expect(await controller.exportActiveProjectBackup()).toMatchObject({ ok: false })
    commit.resolve({
      ok: false,
      diagnostic: {
        code: "persistence-failed",
        message: "Storage unavailable.",
        retryable: true,
        sourceCode: null,
      },
    })
    await saving
    expect(controller.getProjectActionBlock()).toBe("save-error")
    expect(controller.getProjectActiveWorkBlock()).toBeNull()
    mocks.review.mockReturnValue({ status: "ready" })
    expect(controller.getProjectActiveWorkBlock()).toBe("automation-busy")
    mocks.review.mockReturnValue(null)
    const release = controller.registerProjectActionGuard(() => "editor-draft")
    expect(controller.getProjectActiveWorkBlock()).toBe("editor-draft")
    release()
    expect(await controller.exportActiveProjectBackup()).toMatchObject({ ok: false })
  })
})

describe("atomic History selection removal", () => {
  it("commits deduplicated mixed items once in reverse History order with one transaction identity", async () => {
    const authority = historyRepairFixture()
    const { controller, session } = await ready(authority)
    session.mode = "read-write"
    const { prepareAuthorityTransaction } = await import(
      "../../../../packages/application/src/authority-transaction"
    )
    session.commitAuthoredTransaction.mockResolvedValue({
      ok: false,
      diagnostic: {
        code: "persistence-failed",
        message: "Fixture storage failure",
        retryable: true,
        sourceCode: null,
      },
    })
    const sketch = authority.history[0]
    const feature = authority.history[2]
    if (!sketch || !feature) throw new Error("Mixed History fixture unavailable")
    await act(async () => {
      expect(
        await controller.removeHistoryItems(
          authority.revision,
          [sketch, feature, feature],
          authority.id,
        ),
      ).toMatchObject({ ok: false })
    })
    expect(session.commitAuthoredTransaction).toHaveBeenCalledTimes(1)
    expect(session.commitAuthored).not.toHaveBeenCalled()
    const input = session.commitAuthoredTransaction.mock.calls[0]?.[0]
    const prepared = prepareAuthorityTransaction(authority, input, () => {
      throw new Error("Removal must not allocate new parts")
    })
    expect(prepared.ok).toBe(true)
    if (!prepared.ok) throw new Error(prepared.diagnostic.message)
    expect(prepared.events).toHaveLength(2)
    expect(new Set(prepared.events.map((event) => event.transactionId)).size).toBe(1)
    expect(prepared.snapshot.features.some((item) => item.id === authority.features[0]?.id)).toBe(
      false,
    )
    expect(prepared.snapshot.sketches.some((item) => item.id === authority.sketches[0]?.id)).toBe(
      false,
    )
    expect(
      input.commands.map((command: { baseRevision: number; payload: { target: unknown } }) => [
        command.baseRevision,
        command.payload.target,
      ]),
    ).toEqual([
      [authority.revision, feature],
      [authority.revision + 1, sketch],
    ])
    expect(controller.getDocumentControllerState().report?.snapshot.revision).toBe(
      authority.revision,
    )
  })

  it("rejects stale, wrong-document, unsupported, oversized, and task-owned selections without a transaction", async () => {
    const authority = historyRepairFixture()
    const { controller, session } = await ready(authority)
    session.mode = "read-write"
    const target = authority.history[0]
    if (!target) throw new Error("History fixture unavailable")
    expect(
      await controller.removeHistoryItems(authority.revision - 1, [target], authority.id),
    ).toMatchObject({ ok: false })
    expect(
      await controller.removeHistoryItems(
        authority.revision,
        [target],
        sourceProject().snapshot.id,
      ),
    ).toMatchObject({ ok: false })
    expect(await controller.removeHistoryItems(authority.revision, [], authority.id)).toMatchObject(
      { ok: false },
    )
    expect(
      await controller.removeHistoryItems(
        authority.revision,
        Array.from({ length: 257 }, () => target),
        authority.id,
      ),
    ).toMatchObject({ ok: false })
    expect(
      await controller.removeHistoryItems(
        authority.revision,
        [
          {
            kind: "feature",
            id: "0195b5ac-b250-7a2c-8c33-000000000110" as import("@vibeshape/domain").FeatureId,
          },
        ],
        authority.id,
      ),
    ).toMatchObject({ ok: false })
    const release = controller.registerProjectActionGuard(() => "editor-draft")
    expect(
      await controller.removeHistoryItems(authority.revision, [target], authority.id),
    ).toMatchObject({ ok: false })
    release()
    session.mode = undefined
    expect(
      await controller.removeHistoryItems(authority.revision, [target], authority.id),
    ).toMatchObject({ ok: false })
    expect(session.commitAuthoredTransaction).not.toHaveBeenCalled()
  })

  it("releases saving state after an unexpectedly rejected transaction without advancing authority", async () => {
    const authority = historyRepairFixture()
    const { controller, session } = await ready(authority)
    session.mode = "read-write"
    session.commitAuthoredTransaction.mockRejectedValue(new Error("Fixture transport failure"))
    const target = authority.history[0]
    if (!target) throw new Error("History fixture unavailable")
    await act(async () => {
      expect(
        await controller.removeHistoryItems(authority.revision, [target], authority.id),
      ).toMatchObject({ ok: false })
    })
    expect(controller.getDocumentControllerState().saveStatus).toBe("save-error")
    expect(controller.getDocumentControllerState().report?.snapshot.revision).toBe(
      authority.revision,
    )
  })

  it("locks competing removals synchronously while an atomic transaction is pending", async () => {
    const authority = historyRepairFixture()
    const { controller, session } = await ready(authority)
    session.mode = "read-write"
    const pending = deferred<{
      ok: false
      diagnostic: { code: string; message: string; retryable: boolean; sourceCode: null }
    }>()
    session.commitAuthoredTransaction.mockReturnValue(pending.promise)
    const target = authority.history[0]
    if (!target) throw new Error("History fixture unavailable")
    const first = controller.removeHistoryItems(authority.revision, [target], authority.id)
    expect(
      await controller.removeHistoryItems(authority.revision, [target], authority.id),
    ).toMatchObject({ ok: false })
    expect(session.commitAuthoredTransaction).toHaveBeenCalledTimes(1)
    pending.resolve({
      ok: false,
      diagnostic: {
        code: "persistence-failed",
        message: "Fixture storage failure",
        retryable: true,
        sourceCode: null,
      },
    })
    await first
    expect(controller.getDocumentControllerState().report?.snapshot.revision).toBe(
      authority.revision,
    )
  })
})

describe("History removal during an owning editor task", () => {
  it("allows the confirmed removal through an editor draft while retaining failures", async () => {
    const { controller, session } = await ready()
    session.mode = "read-write"
    const diagnostic = {
      code: "command-rejected",
      message: "Validation failed",
      retryable: false,
      sourceCode: "invalid-input",
    }
    session.commitAuthored.mockResolvedValue({ ok: false, diagnostic })
    const release = controller.registerProjectActionGuard(() => "editor-draft")
    const target = "0195b5ac-b250-7a2c-8c33-000000000110" as import("@vibeshape/domain").FeatureId
    expect(await controller.removeFeature(session.snapshot.revision, target)).toEqual<unknown>({
      ok: false,
      diagnostic,
    })
    expect(session.commitAuthored).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "org.vibeshape.history.remove-retaining-dependents",
        payload: { target: { kind: "feature", id: target } },
      }),
    )
    release()
  })
  it("routes editor repair through its explicit command and retains a failed save", async () => {
    const base = historyRepairFixture()
    const removed = applyHistoryRemoveRetainingDependentsCommand(
      base,
      repairRemovalCommand(base.revision),
    )
    if (!removed.ok) throw new Error(removed.diagnostic.message)
    const { controller, session } = await ready(removed.snapshot)
    session.mode = "read-write"
    const intent = removed.snapshot.repairIntents.find((item) => item.kind === "feature")
    if (intent?.kind !== "feature") throw new Error("A retained feature recipe is required.")
    const { semanticInputs: _inputs, ...authored } = intent.authored
    const feature = { ...authored, schemaVersion: 0 as const }
    const diagnostic = {
      code: "command-rejected",
      message: "Missing input",
      retryable: false,
      sourceCode: "invalid-input",
    }
    session.commitAuthored.mockResolvedValue({ ok: false, diagnostic })
    const release = controller.registerProjectActionGuard(() => "editor-draft")
    expect(await controller.saveFeatureEdits(session.snapshot.revision, feature)).toEqual<unknown>({
      ok: false,
      diagnostic,
    })
    expect(session.commitAuthored).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "org.vibeshape.history.repair",
        schemaVersion: 5,
        payload: { item: { kind: "feature", feature } },
      }),
    )
    release()
  })
  it("blocks removal while automation owns the document", async () => {
    const { controller, session } = await ready()
    session.mode = "read-write"
    const release = controller.registerProjectActionGuard(() => "automation-busy")
    const target = "0195b5ac-b250-7a2c-8c33-000000000110" as import("@vibeshape/domain").FeatureId
    expect((await controller.removeFeature(session.snapshot.revision, target)).ok).toBe(false)
    expect(session.commitAuthored).not.toHaveBeenCalled()
    release()
  })
})
