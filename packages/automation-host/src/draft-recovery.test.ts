import { expect, it } from "bun:test"
import { canonicalJson } from "@vibeshape/domain/canonical-json"
import { recoveryActor, recoveryFixture } from "./draft-recovery.test-fixtures"
import type { AutomationHost } from "./host"

function recoveryHost(host: AutomationHost) {
  const { captureDraftRecovery, restoreDraft } = host
  if (!captureDraftRecovery || !restoreDraft)
    throw new Error("Trusted recovery methods are required.")
  return { captureDraftRecovery, restoreDraft }
}

it("captures detached accepted CAD intent and explicitly rebuilds a new caller's private draft before ordinary commit", async () => {
  const f = recoveryFixture()
  const staged = await f.stage()
  const capture = await recoveryHost(staged.host).captureDraftRecovery(f.actor)
  if (!capture.ok) throw new Error("Capture must succeed.")
  const journal = capture.value.journals[0]
  if (!journal) throw new Error("Accepted intent must be retained.")
  expect(journal.commands).toHaveLength(1)
  expect(journal.originalActor).toEqual(f.actor)
  expect(f.saved.revision).toBe(1)
  expect(f.saved.features).toHaveLength(0)
  const actor = recoveryActor(9)
  const host = f.host()
  const restored = await recoveryHost(host).restoreDraft(actor, journal)
  if (!restored.ok) throw new Error("Restoration must succeed.")
  expect(restored.value.draftId).not.toBe(staged.draft.draftId)
  expect(f.commits).toHaveLength(0)
  expect(
    await host.previewDraft(f.actor, { schemaVersion: 1, draftId: restored.value.draftId }),
  ).toMatchObject({ ok: false, diagnostic: { code: "draft-owner-mismatch" } })
  expect(
    await host.previewDraft(actor, { schemaVersion: 1, draftId: restored.value.draftId }),
  ).toMatchObject({ ok: true, value: { geometry: { status: "valid" } } })
  expect(
    await host.commitDraft(actor, { schemaVersion: 1, draftId: restored.value.draftId }),
  ).toMatchObject({ ok: true })
  expect(f.saved.revision).toBe(2)
  expect(f.saved.features[0]?.id).toBe(staged.command.payload.feature.id)
  const committed = f.commits[0]
  if (!committed) throw new Error("The explicit commit must produce a receipt.")
  expect(committed.actor).toEqual(actor)
  expect(committed.events[0]?.actor).toEqual(actor)
  expect(committed.commandIds).not.toContain(staged.command.commandId)
  expect(journal.originalActor).toEqual(f.actor)
})

it("exports only after accepted persistence settles and omits already committed intent", async () => {
  const f = recoveryFixture()
  const staged = await f.stage()
  let release!: () => void
  f.holdCommit(
    new Promise((resolve) => {
      release = resolve
    }),
  )
  const committing = staged.host.commitDraft(f.actor, {
    schemaVersion: 1,
    draftId: staged.draft.draftId,
  })
  const captured = staged.host.captureDraftRecovery?.(f.actor)
  release()
  expect(await committing).toMatchObject({ ok: true })
  expect(await captured).toMatchObject({ ok: true, value: { journals: [] } })
  expect(f.saved.features).toHaveLength(1)
})

it("fails closed for expired intent and missing source authority without partial drafts", async () => {
  const f = recoveryFixture()
  const staged = await f.stage()
  const capture = await staged.host.captureDraftRecovery?.(f.actor)
  if (!capture?.ok || !capture.value.journals[0]) throw new Error("Capture must succeed.")
  const journal = capture.value.journals[0]
  const actor = recoveryActor(9)
  const host = f.host()
  f.rejectSourceAssets()
  expect(await host.restoreDraft?.(actor, journal)).toMatchObject({
    ok: false,
    diagnostic: { code: "draft-commit-preflight-failed" },
  })
  expect(await host.captureDraftRecovery?.(actor)).toMatchObject({
    ok: true,
    value: { journals: [] },
  })
  expect(f.saved.features).toHaveLength(0)
  f.advance(300_001)
  expect(await host.restoreDraft?.(actor, journal)).toMatchObject({
    ok: false,
    diagnostic: { code: "draft-expired" },
  })
  expect(f.commits).toHaveLength(0)
  expect(canonicalJson(journal.commands[0]?.actor)).toBe(canonicalJson(f.actor))
})

it("rejects the original journal after its saved base has advanced", async () => {
  const f = recoveryFixture()
  const staged = await f.stage()
  const capture = await recoveryHost(staged.host).captureDraftRecovery(f.actor)
  if (!capture.ok || !capture.value.journals[0]) throw new Error("Capture must succeed.")
  expect(
    await staged.host.commitDraft(f.actor, { schemaVersion: 1, draftId: staged.draft.draftId }),
  ).toMatchObject({ ok: true })
  expect(
    await recoveryHost(f.host()).restoreDraft(recoveryActor(9), capture.value.journals[0]),
  ).toMatchObject({ ok: false, diagnostic: { code: "stale-revision" } })
  expect(f.saved.features).toHaveLength(1)
  expect(f.commits).toHaveLength(1)
})
