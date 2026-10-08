import "../../../../tests/unit/support/dom"

import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test"
import type { DocumentSnapshotV5 } from "@vibeshape/domain/document-v5"
import { vi } from "../../../../tests/unit/support/bun-test"

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
  }
})

const { cleanup, renderHook, waitFor } = await import("@testing-library/react")
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
function sourceProject() {
  const result = applyVersionedDocumentCommand(null, {
    kind: "org.vibeshape.document.create",
    schemaVersion: 1,
    commandId: "0195b5ac-b250-7a2c-8c33-000000000103",
    documentId: id,
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
  vi.clearAllMocks()
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

async function ready(authoredSnapshot?: DocumentSnapshotV5) {
  const source = sourceProject()
  const session = {
    snapshot: authoredSnapshot
      ? projectAuthoredDocumentSnapshotToV1(authoredSnapshot)
      : source.snapshot,
    authoredSnapshot,
    mode: undefined as "read-write" | undefined,
    commitAuthored: vi.fn(),
    history: { canUndo: false, canRedo: false },
    close: mocks.close,
    commitDraft: vi.fn(),
  }
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
  await waitFor(() => expect(hook.result.current.status).toBe("ready"))
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
  it("blocks project replacement and downloads while manual AI review is ready or applying", async () => {
    const { controller } = await ready()
    for (const status of ["ready", "applying"]) {
      mocks.review.mockReturnValue({ status })
      expect(controller.getProjectActionBlock()).toBe("automation-busy")
      expect(await controller.exportActiveProjectBackup()).toMatchObject({ ok: false })
      expect(await controller.createNewLocalProject()).toMatchObject({ ok: false })
      expect(await controller.activateLocalProject(id)).toMatchObject({ ok: false })
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
