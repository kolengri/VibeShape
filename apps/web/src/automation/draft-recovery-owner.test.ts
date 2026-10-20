import { expect, it } from "bun:test"
import { draftRecoveryCaptureSchema } from "@vibeshape/automation-api/draft-recovery"
import { localConnectResponseSchema } from "@vibeshape/automation-api/local-session"
import { localToolOutputs } from "@vibeshape/automation-api/local-tools"
import type { AutomationHost } from "@vibeshape/automation-host/host"
import type { CommandActor } from "@vibeshape/domain/commands"
import { documentIdSchema } from "@vibeshape/domain/identifiers"
import {
  recoveryActor,
  recoveryFixture,
  recoveryTestId,
} from "../../../../packages/automation-host/src/draft-recovery.test-fixtures"
import { createDraftRecoveryOwner } from "./draft-recovery-owner"

async function captureIntent(host: AutomationHost, actor: CommandActor) {
  if (!host.captureDraftRecovery) throw new Error("Trusted capture is required.")
  const result = await host.captureDraftRecovery(actor)
  if (!result.ok) throw new Error(result.diagnostic.message)
  return result.value
}

async function fixture() {
  const f = recoveryFixture()
  const staged = await f.stage()
  const owner = createDraftRecoveryOwner(f.now)
  const identity = () => ({ id: f.saved.id, revision: f.saved.revision })
  const previous = localConnectResponseSchema.parse({
    protocolVersion: 1,
    token: "A".repeat(43),
    actor: f.actor,
    expiresAt: f.now() + 3_600_000,
    client: { name: "Recovery client", version: "1" },
  })
  const credential = { ...previous, token: "B".repeat(43), actor: recoveryActor(9) }
  const handle = { host: f.host(), readIdentity: identity }
  owner.retain({ host: staged.host, readIdentity: identity }, previous)
  return { f, staged, owner, previous, credential, handle, identity }
}

it.each(["token", "client", "project", "expiry"])(
  "rejects recovery across a changed %s authority boundary",
  async (changed) => {
    const f = await fixture()
    const credential = {
      ...f.credential,
      ...(changed === "client" ? { client: { name: "Other client", version: "1" } } : {}),
      ...(changed === "expiry" ? { expiresAt: f.f.now() } : {}),
    }
    const identity =
      changed === "project"
        ? { ...f.identity(), id: documentIdSchema.parse(recoveryTestId(333)) }
        : f.identity()
    f.owner.authorize(changed === "token" ? "C".repeat(43) : f.previous.token, credential, identity)
    const port = f.owner.bind(
      f.handle,
      () => credential,
      () => true,
    )
    const listed = await port.execute({ tool: "list_recoverable_drafts", arguments: {} })
    if (changed === "expiry")
      expect(listed).toMatchObject({ ok: false, diagnostic: { code: "request-cancelled" } })
    else expect(listed).toMatchObject({ ok: true, value: { items: [] } })
    expect(f.f.commits).toHaveLength(0)
  },
)

it("keeps unapplied intent through a second authenticated reconnect without extending its original expiry", async () => {
  const f = await fixture()
  f.owner.authorize(f.previous.token, f.credential, f.identity())
  const first = f.owner.bind(
    f.handle,
    () => f.credential,
    () => true,
  )
  const listed = await first.execute({ tool: "list_recoverable_drafts", arguments: {} })
  expect(listed).toMatchObject({
    ok: true,
    value: { items: [{ recoveryId: f.staged.draft.draftId }] },
  })
  f.owner.retain(f.handle, f.credential)
  const credential = { ...f.credential, token: "C".repeat(43), actor: recoveryActor(11) }
  f.owner.authorize(f.credential.token, credential, f.identity())
  const port = f.owner.bind(
    { host: f.f.host(), readIdentity: f.identity },
    () => credential,
    () => true,
  )
  expect(await port.execute({ tool: "list_recoverable_drafts", arguments: {} })).toEqual(listed)
  f.f.advance(300_001)
  expect(
    await port.execute({
      tool: "restore_draft",
      arguments: { recoveryId: f.staged.draft.draftId, baseRevision: 1 },
    }),
  ).toMatchObject({ ok: false, diagnostic: { code: "draft-expired" } })
  expect(f.f.saved.revision).toBe(1)
})

it("deduplicates the original journal when an adoption response is lost and retains its private origin", async () => {
  const f = await fixture()
  f.owner.authorize(f.previous.token, f.credential, f.identity())
  const captured = await captureIntent(f.staged.host, f.previous.actor)
  const journal = captured.journals[0]
  if (!journal) throw new Error("A captured journal is required.")
  const adopted = await f.handle.host.restoreDraft?.(f.credential.actor, journal)
  if (!adopted?.ok) throw new Error("Adoption must succeed before its response is lost.")
  f.owner.retain(f.handle, f.credential)
  const credential = { ...f.credential, token: "C".repeat(43), actor: recoveryActor(11) }
  f.owner.authorize(f.credential.token, credential, f.identity())
  const port = f.owner.bind(
    { host: f.f.host(), readIdentity: f.identity },
    () => credential,
    () => true,
  )
  const result = localToolOutputs.list_recoverable_drafts.parse(
    await port.execute({ tool: "list_recoverable_drafts", arguments: {} }),
  )
  if (!result.ok) throw new Error(result.diagnostic.message)
  const listed = result.value
  expect(listed.items).toHaveLength(1)
  expect(listed.items[0]?.recoveryId).toBe(adopted.value.draftId)
  const retained = await f.handle.host.captureDraftRecovery?.(f.credential.actor)
  expect(retained).toMatchObject({
    ok: true,
    value: {
      journals: [
        {
          originalActor: f.credential.actor,
          origin: { draftId: f.staged.draft.draftId, actor: f.previous.actor },
        },
      ],
    },
  })
  expect(f.f.commits).toHaveLength(0)
})

it("invalidates a late capture after explicit clear and never exposes it to a later pairing", async () => {
  const f = await fixture()
  let settle!: (
    result: Awaited<ReturnType<NonNullable<typeof f.staged.host.captureDraftRecovery>>>,
  ) => void
  const capture = await f.staged.host.captureDraftRecovery?.(f.previous.actor)
  if (!capture) throw new Error("Capture is required.")
  f.owner.retain(
    {
      ...f.handle,
      host: {
        ...f.staged.host,
        captureDraftRecovery: () =>
          new Promise((resolve) => {
            settle = resolve
          }),
      },
    },
    f.previous,
  )
  f.owner.clear()
  settle(capture)
  await Promise.resolve()
  f.owner.authorize(f.previous.token, f.credential, f.identity())
  const port = f.owner.bind(
    f.handle,
    () => f.credential,
    () => true,
  )
  expect(await port.execute({ tool: "list_recoverable_drafts", arguments: {} })).toMatchObject({
    ok: true,
    value: { items: [] },
  })
})

it("rejects stale bases and cancels a late restoration without saving or leaving a partial new draft", async () => {
  const f = await fixture()
  f.owner.authorize(f.previous.token, f.credential, f.identity())
  const port = f.owner.bind(
    f.handle,
    () => f.credential,
    () => true,
  )
  expect(
    await port.execute({
      tool: "restore_draft",
      arguments: { recoveryId: f.staged.draft.draftId, baseRevision: 2 },
    }),
  ).toMatchObject({ ok: false, diagnostic: { code: "stale-revision" } })
  let release!: () => void
  let entered!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  const started = new Promise<void>((resolve) => {
    entered = resolve
  })
  const restore = f.handle.host.restoreDraft
  if (!restore) throw new Error("Restoration is required.")
  const guarded = f.owner.bind(
    {
      ...f.handle,
      host: {
        ...f.handle.host,
        restoreDraft: async (...args) => {
          const result = await restore(...args)
          entered()
          await gate
          return result
        },
      },
    },
    () => f.credential,
    () => current,
  )
  let current = true
  const pending = guarded.execute({
    tool: "restore_draft",
    arguments: { recoveryId: f.staged.draft.draftId, baseRevision: 1 },
  })
  await started
  current = false
  f.owner.clear()
  release()
  expect(await pending).toMatchObject({ ok: false, diagnostic: { code: "request-cancelled" } })
  expect(await f.handle.host.captureDraftRecovery?.(f.credential.actor)).toMatchObject({
    ok: true,
    value: { journals: [] },
  })
  expect(f.f.commits).toHaveLength(0)
})

it("returns a clear failure for an over-budget complete journal and never retains a partial capture", async () => {
  const f = await fixture()
  const capture = await f.staged.host.captureDraftRecovery?.(f.previous.actor)
  if (!capture?.ok) throw new Error("Capture is required.")
  const oversized = JSON.parse(JSON.stringify(capture.value))
  oversized.journals[0].commands[0].payload.feature.parameters.extra = "x".repeat(128 * 1024)
  expect(draftRecoveryCaptureSchema.safeParse(oversized).success).toBe(false)
  f.owner.retain(
    {
      ...f.handle,
      host: {
        ...f.staged.host,
        captureDraftRecovery: async () => ({ ok: true, value: oversized }),
      },
    },
    f.previous,
  )
  f.owner.authorize(f.previous.token, f.credential, f.identity())
  const port = f.owner.bind(
    f.handle,
    () => f.credential,
    () => true,
  )
  expect(await port.execute({ tool: "list_recoverable_drafts", arguments: {} })).toMatchObject({
    ok: false,
    diagnostic: { code: "draft-recovery-too-large" },
  })
  expect(f.f.saved.features).toHaveLength(0)
})
