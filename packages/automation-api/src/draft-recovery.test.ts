import { expect, it } from "bun:test"
import {
  recoverableDraftsViewSchema,
  recoverySemanticPayload,
  restoreDraftArgumentsSchema,
} from "./draft-recovery"
import { localOperationSchema, localToolOutputs } from "./local-tools"
import { localToolAnnotations, localToolDescriptions } from "./tool-metadata"

it("exposes explicit bounded local recovery tools without accepting actor, journal or credential arguments", () => {
  const recoveryId = "0195b5ac-b220-7a2c-8c33-000000000001"
  expect(
    localOperationSchema.safeParse({ tool: "list_recoverable_drafts", arguments: {} }).success,
  ).toBe(true)
  expect(
    localOperationSchema.safeParse({
      tool: "restore_draft",
      arguments: { recoveryId, baseRevision: 1 },
    }).success,
  ).toBe(true)
  for (const extra of [
    { actor: {} },
    { token: "secret" },
    { journal: {} },
    { sessionId: recoveryId },
  ])
    expect(
      restoreDraftArgumentsSchema.safeParse({ recoveryId, baseRevision: 1, ...extra }).success,
    ).toBe(false)
  expect(localToolAnnotations("list_recoverable_drafts").readOnlyHint).toBe(true)
  expect(localToolDescriptions.restore_draft).toContain("current caller")
  expect(localToolOutputs.restore_draft.safeParse({ ok: true, value: {} }).success).toBe(false)
})

it("returns only schema-validated semantic payload with nested authority fields removed", () => {
  const payload = recoverySemanticPayload({
    feature: {
      parameters: {
        width: 20,
        token: "secret",
        nested: [{ actor: { sessionId: "old" }, count: 2, bearerToken: "secret" }],
      },
      actor: {},
    },
    session_token: "secret",
    authorization: "secret",
  })
  expect(payload).toEqual({ feature: { parameters: { width: 20, nested: [{ count: 2 }] } } })
  const item = {
    recoveryId: "0195b5ac-b220-7a2c-8c33-000000000001",
    originalDraftId: "0195b5ac-b220-7a2c-8c33-000000000001",
    baseRevision: 1,
    privateRevision: 2,
    commandCount: 1,
    expiresAt: "2026-10-20T00:05:00Z",
    intent: [
      {
        kind: "org.vibeshape.document.rename",
        schemaVersion: 1,
        payload: { name: "Recovered project" },
      },
    ],
  }
  const view = {
    schemaVersion: 1,
    documentId: "0195b5ac-b220-7a2c-8c33-000000000002",
    revision: 1,
    items: [item],
  }
  expect(recoverableDraftsViewSchema.safeParse(view).success).toBe(true)
  expect(
    recoverableDraftsViewSchema.safeParse({
      ...view,
      items: [
        { ...item, intent: [{ ...item.intent[0], payload: { nested: { credential: "secret" } } }] },
      ],
    }).success,
  ).toBe(false)
  expect(
    recoverableDraftsViewSchema.safeParse({
      ...view,
      items: [
        { ...item, intent: [{ ...item.intent[0], payload: { text: "x".repeat(128 * 1024) } }] },
      ],
    }).success,
  ).toBe(false)
})
