import "../../../../tests/unit/support/dom"
import { afterEach, expect, it, mock } from "bun:test"
import {
  recoverableDraftsViewSchema,
  restoredDraftViewSchema,
} from "@vibeshape/automation-api/draft-recovery"
import {
  localConnectResponseSchema,
  localPollResponseSchema,
} from "@vibeshape/automation-api/local-session"
import type { LocalOperation } from "@vibeshape/automation-api/local-tools"
import { type DocumentSnapshot, documentSnapshotSchema } from "@vibeshape/domain/document"
import {
  recoveryFixture,
  recoveryGeometry,
} from "../../../../packages/automation-host/src/draft-recovery.test-fixtures"
import { vi } from "../../../../tests/unit/support/bun-test"
import { createBrowserBroker } from "../../../mcp-server/src/browser-broker"
import { automationReviews } from "./automation-review-controller"
import { createDraftRecoveryOwner } from "./draft-recovery-owner"
import { createLocalToolExecutor } from "./local-tool-executor"

const disposed = vi.fn()
mock.module("@vibeshape/application/disposable-document-preview", () => ({
  createDisposableDocumentPreview: () => ({
    cancel: vi.fn(),
    dispose: disposed,
    preview: async (snapshot: DocumentSnapshot) => ({
      ok: true,
      evidence: recoveryGeometry(snapshot),
      diagnostics: {
        schemaVersion: 1,
        documentId: snapshot.id,
        revision: snapshot.revision,
        generation: 1,
        status: "valid",
        truncated: false,
        entries: [],
      },
    }),
  }),
}))
const { createDocumentAutomationSession } = await import("./document-automation-session")
const closers: (() => void)[] = []
afterEach(() => {
  for (const close of closers.splice(0)) close()
  vi.clearAllMocks()
})

async function setup() {
  const f = recoveryFixture()
  const origin = "http://127.0.0.1:43114"
  const client = { name: "Recovery client", version: "1" }
  const broker = createBrowserBroker({ origin })
  broker.setClient(client)
  closers.push(() => broker.dispose())
  const owner = createDraftRecoveryOwner()
  closers.push(owner.clear)
  const request = (path: string, body: unknown, token?: string) =>
    new Request(`${origin}/__vibeshape/automation/${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin,
        host: "127.0.0.1:43114",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
    })
  const identity = () => ({ id: f.saved.id, revision: f.saved.revision, name: f.saved.name })
  const review = vi.fn(async () => "approved" as const)
  let sourcesAvailable = true
  const materialized: DocumentSnapshot[] = []
  function handle() {
    const session = createDocumentAutomationSession(
      {
        commands: f.commands,
        modules: f.modules,
        documents: f.documents,
        createDraftId: f.generate,
        materializeSourceAssets: async (input) => {
          const snapshot = documentSnapshotSchema.parse(input)
          materialized.push(snapshot)
          if (!sourcesAvailable) throw new Error("The source asset owner is unavailable.")
          return []
        },
      },
      { ...automationReviews, request: review },
    )
    if (!session.ok) throw new Error(session.diagnostic.message)
    closers.push(session.dispose)
    return {
      ...session,
      documentId: f.saved.id,
      get revision() {
        return f.saved.revision
      },
      readIdentity: identity,
      readInfo: () => null,
      readCad: () => ({
        ok: false as const,
        diagnostic: {
          code: "invalid-query" as const,
          message: "Not used by recovery.",
          retryable: false,
          issues: [],
        },
      }),
      exportRevisionBound: async () => ({
        ok: false as const,
        diagnostic: { code: "not-used", message: "Not used by recovery.", retryable: false },
      }),
    }
  }
  const credential = localConnectResponseSchema.parse(
    await (
      await broker.handle(request("connect", { protocolVersion: 1, document: identity() }))
    ).json(),
  )
  let sequence = 0
  let current = handle()
  let currentCredential = credential
  let generation = 0
  function executor() {
    const captured = current
    const at = generation
    return createLocalToolExecutor(
      current,
      currentCredential.actor,
      undefined,
      owner.bind(
        current,
        () => currentCredential,
        () => generation === at && current === captured,
      ),
    )
  }
  let activeExecutor = executor()
  async function roundTrip(operation: LocalOperation) {
    const pending = broker.invoke(operation)
    const polled = localPollResponseSchema.parse(
      await (
        await broker.handle(
          request(
            "poll",
            { protocolVersion: 1, sequence: ++sequence, document: identity(), progress: null },
            currentCredential.token,
          ),
        )
      ).json(),
    )
    if (!polled.work) throw new Error("The broker must deliver the requested operation.")
    const result = await activeExecutor.execute(polled.work.operation)
    expect(
      (
        await broker.handle(
          request(
            "result",
            { protocolVersion: 1, requestId: polled.work.requestId, tool: operation.tool, result },
            currentCredential.token,
          ),
        )
      ).status,
    ).toBe(200)
    return pending
  }
  async function reconnect() {
    const old = current
    const previous = currentCredential
    generation++
    old.cancel("request-cancelled")
    owner.retain(old, previous)
    old.dispose()
    expect((await broker.handle(request("suspend", {}, previous.token))).status).toBe(200)
    currentCredential = localConnectResponseSchema.parse(
      await (
        await broker.handle(
          request("resume", { protocolVersion: 1, document: identity() }, previous.token),
        )
      ).json(),
    )
    expect(currentCredential.actor).not.toEqual(previous.actor)
    current = handle()
    owner.authorize(previous.token, currentCredential, identity())
    sequence = 0
    activeExecutor = executor()
    return { old, previous, current, credential: currentCredential }
  }
  return {
    f,
    broker,
    owner,
    credential,
    request,
    identity,
    roundTrip,
    reconnect,
    get current() {
      return current
    },
    review,
    materialized,
    denySources: () => {
      sourcesAvailable = false
    },
  }
}

it("survives handle disposal and authenticated broker rotation, then explicitly restores and commits under the new actor", async () => {
  const s = await setup()
  const staged = await s.f.stage(s.current.host, s.credential.actor)
  expect(s.f.saved.features).toHaveLength(0)
  const next = await s.reconnect()
  expect(
    (
      await s.broker.handle(
        s.request(
          "poll",
          { protocolVersion: 1, sequence: 1, document: s.identity(), progress: null },
          next.previous.token,
        ),
      )
    ).status,
  ).toBe(401)
  expect(disposed).toHaveBeenCalled()
  expect(await next.old.host.restoreDraft(next.previous.actor, {})).toMatchObject({
    ok: false,
    diagnostic: { code: "document-write-unavailable" },
  })
  const listed = await s.roundTrip({ tool: "list_recoverable_drafts", arguments: {} })
  if (!listed.ok) throw new Error(listed.diagnostic.message)
  const view = recoverableDraftsViewSchema.parse(listed.value)
  expect(view.items).toHaveLength(1)
  expect(view.items[0]?.intent[0]?.kind).toBe("org.vibeshape.feature.add")
  expect(JSON.stringify(view)).not.toContain("sessionId")
  expect(JSON.stringify(view)).not.toContain(next.previous.token)
  expect(s.f.saved.revision).toBe(1)
  const restored = await s.roundTrip({
    tool: "restore_draft",
    arguments: { recoveryId: staged.draft.draftId, baseRevision: 1 },
  })
  if (!restored.ok) throw new Error(restored.diagnostic.message)
  const adopted = restoredDraftViewSchema.parse(restored.value)
  expect(adopted.attribution.actor).toEqual(next.credential.actor)
  expect(adopted.draft.draftId).not.toBe(staged.draft.draftId)
  expect(s.f.commits).toHaveLength(0)
  expect(
    await next.current.host.previewDraft(next.previous.actor, {
      schemaVersion: 1,
      draftId: adopted.draft.draftId,
    }),
  ).toMatchObject({ ok: false, diagnostic: { code: "draft-owner-mismatch" } })
  expect(
    await s.roundTrip({ tool: "preview_draft", arguments: { draftId: adopted.draft.draftId } }),
  ).toMatchObject({ ok: true })
  expect(
    await s.roundTrip({ tool: "commit_draft", arguments: { draftId: adopted.draft.draftId } }),
  ).toMatchObject({ ok: true })
  expect(s.review).toHaveBeenCalledTimes(1)
  expect(s.f.saved.features[0]?.id).toBe(staged.command.payload.feature.id)
  expect(s.f.commits[0]?.actor).toEqual(next.credential.actor)
  expect(s.f.commits[0]?.commandIds).not.toContain(staged.command.commandId)
  expect(
    await s.roundTrip({
      tool: "restore_draft",
      arguments: { recoveryId: staged.draft.draftId, baseRevision: 1 },
    }),
  ).toMatchObject({ ok: false, diagnostic: { code: "draft-not-found" } })
})

it("rejects complete restoration when the new session cannot materialize captured source ownership", async () => {
  const s = await setup()
  const staged = await s.f.stage(s.current.host, s.credential.actor)
  const next = await s.reconnect()
  s.denySources()
  expect(
    await s.roundTrip({
      tool: "restore_draft",
      arguments: { recoveryId: staged.draft.draftId, baseRevision: 1 },
    }),
  ).toMatchObject({ ok: false, diagnostic: { code: "draft-recovery-source-unavailable" } })
  expect(s.materialized[0]?.features[0]?.id).toBe(staged.command.payload.feature.id)
  expect(s.f.saved.features).toHaveLength(0)
  expect(s.f.commits).toHaveLength(0)
  expect(await s.current.host.captureDraftRecovery?.(next.credential.actor)).toMatchObject({
    ok: true,
    value: { journals: [] },
  })
  expect(await s.roundTrip({ tool: "list_recoverable_drafts", arguments: {} })).toMatchObject({
    ok: true,
    value: { items: [{ recoveryId: staged.draft.draftId }] },
  })
})

it("reconciles a saved transaction with a lost receipt instead of offering it for replay", async () => {
  const s = await setup()
  const staged = await s.f.stage(s.current.host, s.credential.actor)
  s.f.loseCommitReceipt()
  expect(
    await s.current.host.commitDraft(s.credential.actor, {
      schemaVersion: 1,
      draftId: staged.draft.draftId,
    }),
  ).toMatchObject({ ok: false, diagnostic: { code: "document-commit-failed" } })
  expect(s.f.saved.revision).toBe(2)
  await s.reconnect()
  expect(await s.roundTrip({ tool: "list_recoverable_drafts", arguments: {} })).toMatchObject({
    ok: true,
    value: { revision: 2, items: [] },
  })
  expect(s.f.commits).toHaveLength(1)
})
