import { commandActorSchema } from "@vibeshape/domain/commands"
import { describe, expect, it } from "vitest"
import {
  applyAutomationDraftCommandRequestSchema,
  automationDraftCommitViewSchema,
  automationDraftDiscardViewSchema,
  automationDraftOperationRequestSchema,
  automationDraftPreviewSchema,
  automationDraftStateSchema,
  createAutomationDraftRequestSchema,
} from "./drafts"

const documentId = "0195b5ac-b213-7f2c-9c33-67a36a7f21ac"
const draftId = "0195b5ac-b216-7a2c-bc33-67a36a7f21ac"
const actor = commandActorSchema.parse({
  type: "mcp",
  clientId: "org.example.model-client",
  sessionId: "0195b5ac-b218-7a2c-8c33-67a36a7f21ac",
})

const command = {
  kind: "org.vibeshape.document.rename",
  schemaVersion: 1,
  commandId: "0195b5ac-b21b-7a2c-9c33-67a36a7f21ac",
  documentId,
  baseRevision: 1,
  issuedAt: "2026-08-08T12:00:01.000Z",
  actor,
  payload: { name: "Enclosure v2" },
}

const draft = {
  schemaVersion: 1,
  draftId,
  documentId,
  baseRevision: 1,
  revision: 2,
  commandCount: 1,
  expiresAt: "2026-08-08T12:05:00.000Z",
}

describe("automation draft contracts", () => {
  it("accepts strict lifecycle requests and an open command payload envelope", () => {
    expect(
      createAutomationDraftRequestSchema.safeParse({
        schemaVersion: 1,
        documentId,
        baseRevision: 1,
      }).success,
    ).toBe(true)
    expect(
      automationDraftOperationRequestSchema.safeParse({ schemaVersion: 1, draftId }).success,
    ).toBe(true)
    expect(
      applyAutomationDraftCommandRequestSchema.safeParse({
        schemaVersion: 1,
        draftId,
        command,
      }).success,
    ).toBe(true)
  })

  it.each([
    { schema: createAutomationDraftRequestSchema, input: { documentId, baseRevision: 1 } },
    {
      schema: createAutomationDraftRequestSchema,
      input: { schemaVersion: 1, documentId, baseRevision: 1, hiddenState: true },
    },
    { schema: automationDraftOperationRequestSchema, input: { schemaVersion: 1, draftId: "bad" } },
    {
      schema: applyAutomationDraftCommandRequestSchema,
      input: { schemaVersion: 1, draftId, command: { ...command, actor: { type: "mcp" } } },
    },
    {
      schema: applyAutomationDraftCommandRequestSchema,
      input: { schemaVersion: 1, draftId, command, hiddenState: true },
    },
  ])("rejects malformed and open-ended lifecycle wrappers", ({ schema, input }) => {
    expect(schema.safeParse(input).success).toBe(false)
  })

  it("validates bounded draft state, preview, commit, and discard views", () => {
    const summary = {
      kind: "org.vibeshape.document.summary",
      schemaVersion: 1,
      documentId,
      revision: 2,
      classification: "semantic",
      truncated: false,
      data: {
        name: "Enclosure v2",
        createdAt: "2026-08-08T12:00:00.000Z",
        updatedAt: "2026-08-08T12:00:01.000Z",
      },
    }

    expect(automationDraftStateSchema.safeParse(draft).success).toBe(true)
    expect(
      automationDraftPreviewSchema.safeParse({ schemaVersion: 1, draft, summary }).success,
    ).toBe(true)
    expect(
      automationDraftCommitViewSchema.safeParse({
        schemaVersion: 1,
        draftId,
        documentId,
        baseRevision: 1,
        revision: 2,
        commandCount: 1,
      }).success,
    ).toBe(true)
    expect(
      automationDraftDiscardViewSchema.safeParse({
        schemaVersion: 1,
        draftId,
        discarded: true,
      }).success,
    ).toBe(true)
    expect(automationDraftStateSchema.safeParse({ ...draft, actor }).success).toBe(false)
  })
})
