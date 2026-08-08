import { describe, expect, it } from "vitest"
import { applyDocumentCommand } from "./commands"
import { applyCommandToDraft, commitDocumentDraft, createDocumentDraft } from "./drafts"

const documentId = "0195b5ac-b213-7f2c-9c33-67a36a7f21ac"
const draftId = "0195b5ac-b216-7a2c-bc33-67a36a7f21ac"
const userActor = { type: "user", userId: "org.vibeshape.user.alice" } as const

function command(
  kind: "org.vibeshape.document.create" | "org.vibeshape.document.rename",
  baseRevision: number,
  name: string,
  commandId: string,
) {
  return {
    kind,
    schemaVersion: 1,
    commandId,
    documentId,
    baseRevision,
    issuedAt: baseRevision === 0 ? "2026-08-08T12:00:00Z" : "2026-08-08T12:01:00Z",
    actor: userActor,
    payload: { name },
  }
}

function emptyDraft() {
  const result = createDocumentDraft({ draftId, documentId, actor: userActor, snapshot: null })

  if (!result.ok) {
    throw new Error(result.diagnostic.message)
  }

  return result.draft
}

describe("document drafts", () => {
  it("groups commands into one atomic transaction and preserves replayable events", () => {
    const initial = emptyDraft()
    const created = applyCommandToDraft(
      initial,
      command(
        "org.vibeshape.document.create",
        0,
        "Enclosure",
        "0195b5ac-b214-7a2c-8c33-67a36a7f21ac",
      ),
    )

    expect(created.ok).toBe(true)
    if (!created.ok) {
      return
    }

    const renamed = applyCommandToDraft(
      created.draft,
      command(
        "org.vibeshape.document.rename",
        1,
        "Enclosure v2",
        "0195b5ac-b215-7a2c-ac33-67a36a7f21ac",
      ),
    )

    expect(renamed.ok).toBe(true)
    if (!renamed.ok) {
      return
    }

    const result = commitDocumentDraft(null, renamed.draft)

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.commit).toMatchObject({
        transactionId: draftId,
        documentId,
        baseRevision: 0,
        revision: 2,
        actor: userActor,
      })
      expect(result.commit.commandIds).toEqual([
        "0195b5ac-b214-7a2c-8c33-67a36a7f21ac",
        "0195b5ac-b215-7a2c-ac33-67a36a7f21ac",
      ])
      expect(result.commit.events).toHaveLength(2)
      expect(result.commit.events.every((event) => event.transactionId === draftId)).toBe(true)
      expect(result.commit.snapshot.name).toBe("Enclosure v2")
    }
  })

  it("binds a draft to one actor and one document", () => {
    const draft = emptyDraft()
    const base = command(
      "org.vibeshape.document.create",
      0,
      "Enclosure",
      "0195b5ac-b214-7a2c-8c33-67a36a7f21ac",
    )

    expect(
      applyCommandToDraft(draft, {
        ...base,
        actor: { type: "system", source: "org.vibeshape.importer" },
      }),
    ).toMatchObject({ ok: false, diagnostic: { code: "draft-actor-mismatch" } })
    expect(
      applyCommandToDraft(draft, {
        ...base,
        documentId: "0195b5ac-b218-7a2c-8c33-67a36a7f21ac",
      }),
    ).toMatchObject({ ok: false, diagnostic: { code: "draft-document-mismatch" } })
  })

  it("keeps feature mutations isolated until the document draft commits", () => {
    const current = applyDocumentCommand(
      null,
      command(
        "org.vibeshape.document.create",
        0,
        "Enclosure",
        "0195b5ac-b214-7a2c-8c33-67a36a7f21ac",
      ),
    )

    expect(current.ok).toBe(true)
    if (!current.ok) return

    const draft = createDocumentDraft({
      draftId,
      documentId,
      actor: userActor,
      snapshot: current.snapshot,
    })

    expect(draft.ok).toBe(true)
    if (!draft.ok) return

    const applied = applyCommandToDraft(draft.draft, {
      kind: "org.vibeshape.feature.add",
      schemaVersion: 1,
      commandId: "0195b5ac-b215-7a2c-ac33-67a36a7f21ac",
      documentId,
      baseRevision: 1,
      issuedAt: "2026-08-08T12:01:00Z",
      actor: userActor,
      payload: {
        feature: {
          schemaVersion: 0,
          id: "0195b5ac-b220-7a2c-8c33-67a36a7f3101",
          type: {
            moduleId: "org.vibeshape.core.part-design",
            moduleVersion: "0.1.0",
            typeId: "org.vibeshape.feature.test",
            schemaVersion: 1,
          },
          parameters: { length: 10 },
          dependencies: [],
          references: [],
          suppressed: false,
        },
      },
    })

    expect(applied).toMatchObject({
      ok: true,
      draft: { snapshot: { revision: 2, features: [{ id: expect.any(String) }] } },
    })
    expect(current.snapshot.features).toEqual([])
    if (applied.ok) {
      expect(commitDocumentDraft(current.snapshot, applied.draft)).toMatchObject({
        ok: true,
        commit: {
          baseRevision: 1,
          revision: 2,
          events: [{ type: "org.vibeshape.feature.added", transactionId: draftId }],
        },
      })
    }
  })

  it("does not mutate a draft when a command is rejected", () => {
    const draft = emptyDraft()
    const before = { ...draft, events: [...draft.events] }
    const result = applyCommandToDraft(draft, { invalid: true })

    expect(result).toMatchObject({ ok: false, diagnostic: { code: "invalid-command" } })
    expect(draft).toEqual(before)
  })

  it("rejects empty and stale draft commits", () => {
    const draft = emptyDraft()

    expect(commitDocumentDraft(null, draft)).toMatchObject({
      ok: false,
      diagnostic: { code: "draft-empty" },
    })

    const currentResult = applyDocumentCommand(
      null,
      command(
        "org.vibeshape.document.create",
        0,
        "Concurrent document",
        "0195b5ac-b219-7a2c-8c33-67a36a7f21ac",
      ),
    )

    expect(currentResult.ok).toBe(true)
    if (currentResult.ok) {
      expect(commitDocumentDraft(currentResult.snapshot, draft)).toMatchObject({
        ok: false,
        diagnostic: { code: "stale-revision", retryable: true },
      })
    }
  })

  it("rejects malformed draft identity and cross-document snapshots", () => {
    expect(
      createDocumentDraft({ draftId: "invalid", documentId, actor: userActor, snapshot: null }),
    ).toMatchObject({ ok: false, diagnostic: { code: "invalid-draft" } })

    const snapshotResult = applyDocumentCommand(
      null,
      command(
        "org.vibeshape.document.create",
        0,
        "Enclosure",
        "0195b5ac-b214-7a2c-8c33-67a36a7f21ac",
      ),
    )

    expect(snapshotResult.ok).toBe(true)
    if (snapshotResult.ok) {
      expect(
        createDocumentDraft({
          draftId,
          documentId: "0195b5ac-b218-7a2c-8c33-67a36a7f21ac",
          actor: userActor,
          snapshot: snapshotResult.snapshot,
        }),
      ).toMatchObject({ ok: false, diagnostic: { code: "draft-document-mismatch" } })
    }
  })
})
