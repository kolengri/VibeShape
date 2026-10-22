import "../../../../tests/unit/support/dom"
import { afterEach, beforeAll, expect, it, mock } from "bun:test"
import { cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import {
  type AuthorityCommitInput,
  type AuthorityDocumentRepositoryPort,
  createAuthorityPersistenceAdapter,
} from "@vibeshape/application/authority-persistence-adapter"
import { runtimeProjection } from "@vibeshape/application/authority-persistence-operations"
import {
  type DocumentRebuildPort,
  PersistentDocumentSession,
} from "@vibeshape/application/persistent-document-session"
import { canonicalJson } from "@vibeshape/domain/canonical-json"
import type { AuthoredDocumentSnapshot } from "@vibeshape/domain/document-v2"
import { sessionIdSchema } from "@vibeshape/domain/identifiers"
import { I18nProvider } from "@vibeshape/i18n/provider"
import { DOCUMENT_PROTOCOL_VERSION } from "@vibeshape/protocol"
import { TooltipProvider } from "@vibeshape/ui/components/tooltip"
import { useSyncExternalStore } from "react"
import { vi } from "../../../../tests/unit/support/bun-test"
import { EditorSessionProvider, useEditorSession } from "../editor-session/editor-session-provider"
import { i18n } from "../i18n"
import { ApplicationNoticesProvider } from "../shell/application-notices"
import { AuthoredPartsGroup } from "../shell/authored-parts-group"
import { authoredTestId, authoredTreeFixture } from "../test-support/authored-tree-fixture"

const open = vi.fn()
const sessions = { ...(await import("@vibeshape/application/persistent-document-session")) }
mock.module("@vibeshape/application/persistent-document-session", () => ({
  ...sessions,
  createPersistentDocumentSession: open,
}))
mock.module("./browser-project-repository", () => ({
  BrowserProjectRepository: class {
    legacy = {}
    versioned = {}
  },
}))
const { createDocumentControllerRuntime } = await import("./document-controller-runtime")
const runtimes: ReturnType<typeof createDocumentControllerRuntime>[] = []
beforeAll(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  )
  HTMLElement.prototype.hasPointerCapture = () => false
  HTMLElement.prototype.setPointerCapture = () => {}
  HTMLElement.prototype.releasePointerCapture = () => {}
})
afterEach(async () => {
  cleanup()
  for (const runtime of runtimes.splice(0)) await runtime.closeRuntime()
})

async function fixture(readOnly = false) {
  const seed = authoredTreeFixture().authority
  let stored: AuthoredDocumentSnapshot = seed
  let writeFailure: { code: string; message: string; retryable: boolean } | null = null
  let pendingWrite: Promise<void> | undefined
  let leaseAvailable = true
  const writes = vi.fn(async (input: AuthorityCommitInput) => {
    if (pendingWrite) await pendingWrite
    if (writeFailure) return { ok: false as const, diagnostic: writeFailure }
    if (input.snapshot.schemaVersion === 1)
      throw new Error("Metadata must retain authored authority.")
    stored = input.snapshot
    return { ok: true as const, value: undefined }
  })
  const unexpected = async () => {
    throw new Error("Unexpected metadata fixture operation.")
  }
  const repository: AuthorityDocumentRepositoryPort = {
    commit: unexpected,
    commitDraft: unexpected,
    recover: unexpected,
    closeCleanly: async () => ({ ok: true, value: undefined }),
    commitAuthority: writes,
    commitAuthorityDraft: unexpected,
    recoverAuthority: unexpected,
    closeAuthorityCleanly: async () => ({ ok: true, value: undefined }),
  }
  const adapter = createAuthorityPersistenceAdapter(
    repository,
    () => {
      throw new Error("Metadata must not allocate a part.")
    },
    seed,
  )
  const projected = runtimeProjection(seed)
  if (!projected.ok) throw new Error(projected.diagnostic.message)
  const rebuild: DocumentRebuildPort["rebuild"] = async ({ document }) => ({
    protocolVersion: DOCUMENT_PROTOCOL_VERSION,
    type: "documentRebuilt",
    requestId: authoredTestId(9000),
    documentId: document.id,
    revision: document.revision,
    generation: 1,
    evaluation: { records: [], dirtyFeatureIds: [], evaluatedFeatureIds: [], reusedFeatureIds: [] },
    geometry: [],
    sketches: [],
    modelReferenceEvidence: [],
  })
  const rebuildPort: DocumentRebuildPort = {
    rebuild,
    exportDocument: unexpected,
    solveSketch: unexpected,
    dispose: async () => {},
    terminate: () => {},
  }
  const lease = { epoch: 1, expiresAt: Date.now() + 30000 }
  const active = new PersistentDocumentSession({
    snapshot: projected.snapshot,
    sessionId: sessionIdSchema.parse(authoredTestId(9001)),
    mesh: { chordTolerance: 0.05, angularTolerance: 0.1 },
    leaseDurationMs: 30000,
    lease: readOnly ? null : lease,
    rebuildPort,
    dependencies: {
      repository: adapter,
      now: () => Date.now(),
      commandDispatcher: {
        dispatch: () => {
          throw new Error("Metadata must not dispatch a model command.")
        },
      },
      leases: {
        acquire: async () =>
          leaseAvailable
            ? { ok: true, value: { lease } }
            : {
                ok: false,
                diagnostic: {
                  code: "lease-held",
                  message: "Another tab owns the writer lease.",
                  retryable: true,
                },
              },
        release: async () => ({ ok: true, value: undefined }),
      },
      createRebuildPort: () => rebuildPort,
    },
  })
  open.mockResolvedValue({
    ok: true,
    session: active,
    report: {
      status: "clean",
      snapshot: active.snapshot,
      mode: active.mode,
      historyItems: active.historyItems,
      rebuild: {
        ok: true,
        response: await rebuild({
          document: active.snapshot,
          mesh: { chordTolerance: 0.05, angularTolerance: 0.1 },
        }),
      },
      lostRevisionCount: 0,
      corruptRecords: [],
      migration: null,
      writeAccessDiagnostic: null,
    },
  })
  const runtime = createDocumentControllerRuntime({
    initialProject: { documentId: seed.id, create: true },
  })
  runtimes.push(runtime)
  await runtime.startDocumentController("Authored metadata")
  expect(runtime.getDocumentControllerState().status).toBe("ready")
  const part = seed.parts[0]
  if (!part) throw new Error("The metadata fixture must contain a part.")
  return {
    runtime,
    active,
    part,
    writes,
    get stored() {
      return stored
    },
    failWrite(value: NonNullable<typeof writeFailure>) {
      writeFailure = value
    },
    holdWrite(value: Promise<void>) {
      pendingWrite = value
    },
    loseLease() {
      leaseAvailable = false
    },
    change: { kind: "part.set-visibility" as const, partId: part.id, visible: false },
  }
}

it("persists visibility through the real controller, session and authority adapter with one Undo entry", async () => {
  const f = await fixture()
  const before = canonicalJson(f.stored.features)
  const revision = f.active.snapshot.revision
  expect(await f.runtime.commitAuthoredMetadata(revision, f.change)).toEqual({ ok: true })
  expect(f.writes).toHaveBeenCalledTimes(1)
  expect(f.stored.parts.find(({ id }) => id === f.part.id)?.visible).toBe(false)
  expect(f.active.snapshot.revision).toBe(revision + 1)
  expect(canonicalJson(f.stored.features)).toBe(before)
  expect(f.runtime.getDocumentControllerState().history).toEqual({ canUndo: true, canRedo: false })
  expect(await f.runtime.undoDocument(revision + 1)).toMatchObject({ ok: true })
  expect(f.stored.parts.find(({ id }) => id === f.part.id)?.visible).toBe(true)
  expect(f.active.snapshot.revision).toBe(revision + 2)
})

it.each(["automation-busy", "editor-draft", "surface-texture-draft"] as const)(
  "names the %s guard without attempting persistence or changing authority",
  async (block) => {
    const f = await fixture()
    const before = canonicalJson(f.stored)
    const release = f.runtime.registerProjectActionGuard(() => block)
    try {
      expect(
        await f.runtime.commitAuthoredMetadata(f.active.snapshot.revision, f.change),
      ).toMatchObject({ ok: false, diagnostic: { code: "command-rejected", sourceCode: block } })
      expect(f.writes).not.toHaveBeenCalled()
      expect(canonicalJson(f.stored)).toBe(before)
      expect(f.runtime.getDocumentControllerState().saveStatus).toBe("saved")
    } finally {
      release()
    }
    expect(await f.runtime.commitAuthoredMetadata(f.active.snapshot.revision, f.change)).toEqual({
      ok: true,
    })
    expect(f.writes).toHaveBeenCalledTimes(1)
  },
)

it("distinguishes read-only and unavailable documents from storage failures", async () => {
  const f = await fixture(true)
  expect(
    await f.runtime.commitAuthoredMetadata(f.active.snapshot.revision, f.change),
  ).toMatchObject({ ok: false, diagnostic: { sourceCode: "read-only" } })
  expect(f.writes).not.toHaveBeenCalled()
  await f.runtime.closeRuntime()
  expect(
    await f.runtime.commitAuthoredMetadata(f.active.snapshot.revision, f.change),
  ).toMatchObject({ ok: false, diagnostic: { sourceCode: "document-unavailable" } })
})

it("identifies an in-progress save without queuing another visibility mutation", async () => {
  const f = await fixture()
  let release!: () => void
  f.holdWrite(
    new Promise<void>((resolve) => {
      release = resolve
    }),
  )
  const revision = f.active.snapshot.revision
  const pending = f.runtime.commitAuthoredMetadata(revision, f.change)
  try {
    expect(await f.runtime.commitAuthoredMetadata(revision, f.change)).toMatchObject({
      ok: false,
      diagnostic: { sourceCode: "save-in-progress" },
    })
  } finally {
    release()
  }
  expect(await pending).toEqual({ ok: true })
  expect(f.writes).toHaveBeenCalledTimes(1)
})

it.each(["quota", "stale-revision"])(
  "preserves an actual %s persistence rejection and its source code",
  async (code) => {
    const f = await fixture()
    const before = canonicalJson(f.stored)
    f.failWrite({ code, message: "Synthetic storage rejection.", retryable: true })
    expect(
      await f.runtime.commitAuthoredMetadata(f.active.snapshot.revision, f.change),
    ).toMatchObject({ ok: false, diagnostic: { code: "persistence-failed", sourceCode: code } })
    expect(f.writes).toHaveBeenCalledTimes(1)
    expect(canonicalJson(f.stored)).toBe(before)
  },
)

it("retains a lost writer lease diagnostic without applying metadata", async () => {
  const f = await fixture()
  f.loseLease()
  expect(
    await f.runtime.commitAuthoredMetadata(f.active.snapshot.revision, f.change),
  ).toMatchObject({
    ok: false,
    diagnostic: { code: "write-access-unavailable", sourceCode: "lease-held" },
  })
  expect(f.writes).not.toHaveBeenCalled()
})

function RuntimeParts({
  runtime,
}: {
  runtime: ReturnType<typeof createDocumentControllerRuntime>
}) {
  const state = useSyncExternalStore(
    runtime.subscribeDocumentController,
    runtime.getDocumentControllerState,
  )
  const overrides = useEditorSession((session) => session.partVisibilityOverrides)
  const actions = useEditorSession((session) => session.actions)
  const authority = state.authoredSnapshot
  if (!authority || authority.schemaVersion === 1)
    throw new Error("An authored authority is required.")
  const part = authority.parts[0]
  if (!part) throw new Error("A part is required.")
  return (
    <>
      <output aria-label="Temporary visibility override">
        {overrides[part.id] === undefined ? "none" : String(overrides[part.id])}
      </output>
      <AuthoredPartsGroup
        parts={[{ part, body: null, status: "unavailable" }]}
        revision={authority.revision}
        selectedPartId={null}
        disabled={false}
        onSelect={() => {}}
        onCommit={runtime.commitAuthoredMetadata}
        visibility={{
          overrides,
          setOverride: actions.setPartVisibilityOverride,
          clearOverride: actions.clearPartVisibilityOverride,
        }}
      />
    </>
  )
}

function renderRuntimeParts(runtime: ReturnType<typeof createDocumentControllerRuntime>) {
  render(
    <I18nProvider i18n={i18n} initialLocale="en">
      <TooltipProvider>
        <EditorSessionProvider>
          <ApplicationNoticesProvider>
            <RuntimeParts runtime={runtime} />
          </ApplicationNoticesProvider>
        </EditorSessionProvider>
      </TooltipProvider>
    </I18nProvider>,
  )
}

it.each([false, true])(
  "allows explicit view-only inspection while AI is busy and normal durable saving afterward (restore while busy: %s)",
  async (restoreWhileBusy) => {
    const f = await fixture()
    const revision = f.active.snapshot.revision
    const before = canonicalJson(f.stored)
    const release = f.runtime.registerProjectActionGuard(() => "automation-busy")
    renderRuntimeParts(f.runtime)
    await userEvent.click(screen.getByRole("button", { name: "Hide part Part 1" }))
    expect(screen.getByRole("button", { name: "Show part Part 1" })).toBeTruthy()
    expect(
      screen
        .getAllByRole("status")
        .some((notice) => notice.textContent?.includes("changed only in this view")),
    ).toBe(true)
    expect(
      screen
        .getAllByRole("status")
        .some((notice) => notice.textContent?.includes("This change was not saved.")),
    ).toBe(true)
    expect(screen.queryByRole("alert")).toBeNull()
    expect(screen.getByLabelText("Temporary visibility override").textContent).toBe("false")
    expect(f.active.snapshot.revision).toBe(revision)
    expect(canonicalJson(f.stored)).toBe(before)
    expect(f.writes).not.toHaveBeenCalled()
    expect(f.runtime.getDocumentControllerState().history).toEqual({
      canUndo: false,
      canRedo: false,
    })
    if (!restoreWhileBusy) release()
    await userEvent.click(screen.getByRole("button", { name: "Show part Part 1" }))
    expect(screen.getByRole("button", { name: "Hide part Part 1" })).toBeTruthy()
    expect(screen.getByLabelText("Temporary visibility override").textContent).toBe("none")
    expect(
      screen
        .getAllByRole("status")
        .some((notice) => notice.textContent?.includes("now matches the saved part visibility")),
    ).toBe(true)
    expect(f.writes).not.toHaveBeenCalled()
    expect(f.active.snapshot.revision).toBe(revision)
    if (restoreWhileBusy) release()
    await userEvent.click(screen.getByRole("button", { name: "Hide part Part 1" }))
    await waitFor(() => expect(f.writes).toHaveBeenCalledTimes(1))
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Show part Part 1" }).getAttribute("aria-busy"),
      ).toBeNull(),
    )
    expect(f.active.snapshot.revision).toBe(revision + 1)
    expect(f.stored.parts[0]?.visible).toBe(false)
    expect(screen.getByLabelText("Temporary visibility override").textContent).toBe("none")
    expect(f.runtime.getDocumentControllerState().saveStatus).toBe("saved")
    expect(f.runtime.getDocumentControllerState().history).toEqual({
      canUndo: true,
      canRedo: false,
    })
    expect(screen.queryByRole("alert")).toBeNull()
  },
)

it("commits a preset and custom color through the controller as one saved V6 change and undoes across adoption", async () => {
  const f = await fixture()
  const before = canonicalJson(f.stored.features)
  const revision = f.active.snapshot.revision
  expect(
    await f.runtime.commitAuthoredMetadata(revision, {
      kind: "part.set-appearance",
      partId: f.part.id,
      appearance: {
        presetId: "copper",
        color: (await import("@vibeshape/domain/part-appearance")).appearanceColorSchema.parse(
          "#4499aa",
        ),
      },
    }),
  ).toEqual({ ok: true })
  expect(f.writes).toHaveBeenCalledTimes(1)
  expect(f.stored).toMatchObject({
    schemaVersion: 6,
    partAppearances: [{ partId: f.part.id, appearance: { presetId: "copper", color: "#4499aa" } }],
  })
  expect(f.active.snapshot.revision).toBe(revision + 1)
  expect(canonicalJson(f.stored.features)).toBe(before)
  expect(await f.runtime.undoDocument(revision + 1)).toMatchObject({ ok: true })
  expect(f.stored).toMatchObject({ schemaVersion: 6, partAppearances: [] })
  expect(await f.runtime.redoDocument(revision + 2)).toMatchObject({ ok: true })
  expect(f.stored).toMatchObject({
    partAppearances: [{ partId: f.part.id, appearance: { presetId: "copper", color: "#4499aa" } }],
  })
})
