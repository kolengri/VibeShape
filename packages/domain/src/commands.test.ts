import { describe, expect, it } from "vitest"
import {
  applyDocumentCommand,
  commandActorSchema,
  commandActorsEqual,
  parseDocumentCommand,
  reduceDocumentEvent,
  replayDocumentEvents,
} from "./commands"
import { documentSnapshotSchema } from "./document"

const documentId = "0195b5ac-b213-7f2c-9c33-67a36a7f21ac"
const firstCommandId = "0195b5ac-b214-7a2c-8c33-67a36a7f21ac"
const secondCommandId = "0195b5ac-b215-7a2c-ac33-67a36a7f21ac"
const issuedAt = "2026-08-08T12:00:00Z"
const renamedAt = "2026-08-08T12:01:00Z"
const userActor = { type: "user", userId: "org.vibeshape.user.alice" } as const

function createCommand(overrides: Record<string, unknown> = {}) {
  return {
    kind: "org.vibeshape.document.create",
    schemaVersion: 1,
    commandId: firstCommandId,
    documentId,
    baseRevision: 0,
    issuedAt,
    actor: userActor,
    payload: { name: "  Enclosure  " },
    ...overrides,
  }
}

function renameCommand(overrides: Record<string, unknown> = {}) {
  return {
    kind: "org.vibeshape.document.rename",
    schemaVersion: 1,
    commandId: secondCommandId,
    documentId,
    baseRevision: 1,
    issuedAt: renamedAt,
    actor: userActor,
    payload: { name: "Enclosure v2" },
    ...overrides,
  }
}

function createDocument() {
  const result = applyDocumentCommand(null, createCommand())

  if (!result.ok) {
    throw new Error(result.diagnostic.message)
  }

  return result
}

describe("document commands", () => {
  it("compares complete actor identities without conflating sessions or actor kinds", () => {
    const mcpActor = commandActorSchema.parse({
      type: "mcp",
      clientId: "org.example.model-client",
      sessionId: "0195b5ac-b217-7a2c-8c33-67a36a7f21ac",
    })

    expect(commandActorsEqual(mcpActor, { ...mcpActor })).toBe(true)
    expect(
      commandActorsEqual(
        mcpActor,
        commandActorSchema.parse({
          ...mcpActor,
          sessionId: "0195b5ac-b218-7a2c-8c33-67a36a7f21ac",
        }),
      ),
    ).toBe(false)
    expect(commandActorsEqual(mcpActor, userActor)).toBe(false)
  })

  it("normalizes a create command and emits a deterministic first revision", () => {
    const result = createDocument()

    expect(result.snapshot).toEqual({
      schemaVersion: 0,
      id: documentId,
      revision: 1,
      name: "Enclosure",
      createdAt: issuedAt,
      updatedAt: issuedAt,
    })
    expect(result.event).toEqual({
      schemaVersion: 1,
      type: "org.vibeshape.document.created",
      commandId: firstCommandId,
      transactionId: null,
      documentId,
      baseRevision: 0,
      revision: 1,
      issuedAt,
      actor: userActor,
      name: "Enclosure",
    })
  })

  it("preserves MCP actor provenance without coupling the command to transport prompts", () => {
    const actor = {
      type: "mcp",
      clientId: "org.example.model-client",
      sessionId: "0195b5ac-b217-7a2c-8c33-67a36a7f21ac",
    } as const
    const result = applyDocumentCommand(null, createCommand({ actor }))

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.event.actor).toEqual(actor)
      expect(result.event).not.toHaveProperty("prompt")
    }
  })

  it("renames a document by advancing exactly one revision", () => {
    const created = createDocument()
    const result = applyDocumentCommand(created.snapshot, renameCommand())

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.snapshot).toEqual({
        ...created.snapshot,
        revision: 2,
        name: "Enclosure v2",
        updatedAt: renamedAt,
      })
      expect(result.event).toMatchObject({
        type: "org.vibeshape.document.renamed",
        baseRevision: 1,
        revision: 2,
        previousName: "Enclosure",
        name: "Enclosure v2",
      })
    }
  })

  it.each([
    null,
    {},
    createCommand({ kind: "org.vibeshape.document.remove" }),
    createCommand({ schemaVersion: 2 }),
    createCommand({ payload: { name: "   " } }),
    createCommand({ extra: true }),
    createCommand({ baseRevision: Number.POSITIVE_INFINITY }),
  ])("rejects malformed or unsupported commands", (input) => {
    const result = parseDocumentCommand(input)

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.diagnostic.code).toBe("invalid-command")
    }
  })

  it("rejects creation over an existing document", () => {
    const created = createDocument()
    const result = applyDocumentCommand(created.snapshot, createCommand())

    expect(result).toMatchObject({
      ok: false,
      diagnostic: { code: "document-already-exists" },
    })
  })

  it("rejects stale, cross-document, and no-op rename commands", () => {
    const created = createDocument()

    expect(
      applyDocumentCommand(created.snapshot, renameCommand({ baseRevision: 0 })),
    ).toMatchObject({
      ok: false,
      diagnostic: { code: "stale-revision", retryable: true },
    })
    expect(
      applyDocumentCommand(
        created.snapshot,
        renameCommand({ documentId: "0195b5ac-b218-7a2c-8c33-67a36a7f21ac" }),
      ),
    ).toMatchObject({ ok: false, diagnostic: { code: "document-id-mismatch" } })
    expect(
      applyDocumentCommand(created.snapshot, renameCommand({ payload: { name: "Enclosure" } })),
    ).toMatchObject({ ok: false, diagnostic: { code: "command-no-op" } })
  })

  it("rejects revisions that cannot advance safely", () => {
    const snapshot = documentSnapshotSchema.parse({
      schemaVersion: 0,
      id: documentId,
      revision: Number.MAX_SAFE_INTEGER,
      name: "Enclosure",
      createdAt: issuedAt,
      updatedAt: issuedAt,
    })
    const result = applyDocumentCommand(
      snapshot,
      renameCommand({ baseRevision: Number.MAX_SAFE_INTEGER }),
    )

    expect(result).toMatchObject({ ok: false, diagnostic: { code: "revision-exhausted" } })
    expect(
      reduceDocumentEvent(snapshot, {
        schemaVersion: 1,
        type: "org.vibeshape.document.renamed",
        commandId: secondCommandId,
        transactionId: null,
        documentId,
        baseRevision: Number.MAX_SAFE_INTEGER,
        revision: Number.MAX_SAFE_INTEGER,
        issuedAt: renamedAt,
        actor: userActor,
        previousName: "Enclosure",
        name: "Enclosure v2",
      }),
    ).toMatchObject({ ok: false, diagnostic: { code: "revision-exhausted" } })
  })

  it("replays emitted events to the same canonical snapshot", () => {
    const created = createDocument()
    const renamed = applyDocumentCommand(created.snapshot, renameCommand())

    expect(renamed.ok).toBe(true)
    if (renamed.ok) {
      expect(replayDocumentEvents([created.event, renamed.event])).toEqual({
        ok: true,
        snapshot: renamed.snapshot,
      })
    }
  })

  it("rejects malformed, stale, or tampered events", () => {
    const created = createDocument()
    const renamed = applyDocumentCommand(created.snapshot, renameCommand())

    expect(reduceDocumentEvent(null, { ...created.event, extra: true })).toMatchObject({
      ok: false,
      diagnostic: { code: "invalid-event" },
    })
    expect(reduceDocumentEvent(created.snapshot, created.event)).toMatchObject({
      ok: false,
      diagnostic: { code: "document-already-exists" },
    })

    if (renamed.ok && renamed.event.type === "org.vibeshape.document.renamed") {
      expect(
        reduceDocumentEvent(created.snapshot, { ...renamed.event, previousName: "Tampered" }),
      ).toMatchObject({ ok: false, diagnostic: { code: "invalid-event" } })
      expect(
        reduceDocumentEvent(created.snapshot, { ...renamed.event, revision: 3 }),
      ).toMatchObject({ ok: false, diagnostic: { code: "stale-revision" } })
    }
  })

  it("reports an empty event stream explicitly", () => {
    expect(replayDocumentEvents([])).toMatchObject({
      ok: false,
      diagnostic: { code: "document-not-found" },
    })
  })
})
