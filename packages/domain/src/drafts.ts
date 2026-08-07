import { z } from "zod"
import {
  applyDocumentCommand,
  type CommandActor,
  commandActorSchema,
  type DocumentEvent,
  type DomainDiagnostic,
  parseDocumentCommand,
} from "./commands"
import { type DocumentSnapshot, documentSnapshotSchema } from "./document"
import { documentIdSchema, draftIdSchema } from "./identifiers"

export type DocumentDraft = Readonly<{
  schemaVersion: 1
  id: z.infer<typeof draftIdSchema>
  documentId: z.infer<typeof documentIdSchema>
  baseRevision: number
  actor: CommandActor
  snapshot: DocumentSnapshot | null
  events: readonly DocumentEvent[]
}>

export type DraftDiagnosticCode =
  | DomainDiagnostic["code"]
  | "invalid-draft"
  | "draft-actor-mismatch"
  | "draft-document-mismatch"
  | "draft-empty"

export type DraftDiagnostic = Readonly<{
  code: DraftDiagnosticCode
  message: string
  retryable: boolean
  issues: DomainDiagnostic["issues"]
}>

export type DraftResult =
  | { ok: true; draft: DocumentDraft }
  | { ok: false; diagnostic: DraftDiagnostic }

export type DraftCommit = Readonly<{
  transactionId: z.infer<typeof draftIdSchema>
  documentId: z.infer<typeof documentIdSchema>
  baseRevision: number
  revision: number
  actor: CommandActor
  commandIds: readonly DocumentEvent["commandId"][]
  events: readonly DocumentEvent[]
  snapshot: DocumentSnapshot
}>

export type DraftCommitResult =
  | { ok: true; commit: DraftCommit }
  | { ok: false; diagnostic: DraftDiagnostic }

function draftDiagnostic(
  code: DraftDiagnosticCode,
  message: string,
  retryable = false,
): DraftDiagnostic {
  return { code, message, retryable, issues: [] }
}

function invalidDraftDiagnostic(error: z.ZodError): DraftDiagnostic {
  return {
    code: "invalid-draft",
    message: "The draft identity is invalid.",
    retryable: false,
    issues: error.issues.slice(0, 8).map((issue) => ({
      path: issue.path.map(String).join("."),
      message: issue.message,
    })),
  }
}

function actorIdentity(actor: CommandActor) {
  switch (actor.type) {
    case "user":
      return `${actor.type}:${actor.userId ?? "anonymous"}`
    case "mcp":
      return `${actor.type}:${actor.clientId}:${actor.sessionId}`
    case "extension":
      return `${actor.type}:${actor.extensionId}:${actor.integrity}`
    case "system":
      return `${actor.type}:${actor.source}`
  }
}

function actorsEqual(left: CommandActor, right: CommandActor) {
  return actorIdentity(left) === actorIdentity(right)
}

export function createDocumentDraft(input: {
  draftId: unknown
  documentId: unknown
  actor: unknown
  snapshot: unknown
}): DraftResult {
  const parsed = z
    .object({
      draftId: draftIdSchema,
      documentId: documentIdSchema,
      actor: commandActorSchema,
      snapshot: documentSnapshotSchema.nullable(),
    })
    .strict()
    .safeParse(input)

  if (!parsed.success) {
    return {
      ok: false,
      diagnostic: invalidDraftDiagnostic(parsed.error),
    }
  }

  if (parsed.data.snapshot && parsed.data.snapshot.id !== parsed.data.documentId) {
    return {
      ok: false,
      diagnostic: draftDiagnostic(
        "draft-document-mismatch",
        "The draft snapshot belongs to another document.",
      ),
    }
  }

  return {
    ok: true,
    draft: {
      schemaVersion: 1,
      id: parsed.data.draftId,
      documentId: parsed.data.documentId,
      baseRevision: parsed.data.snapshot?.revision ?? 0,
      actor: parsed.data.actor,
      snapshot: parsed.data.snapshot,
      events: [],
    },
  }
}

export function applyCommandToDraft(draft: DocumentDraft, input: unknown): DraftResult {
  const parsed = parseDocumentCommand(input)

  if (!parsed.ok) {
    return parsed
  }

  if (parsed.command.documentId !== draft.documentId) {
    return {
      ok: false,
      diagnostic: draftDiagnostic(
        "draft-document-mismatch",
        "The command targets another document.",
      ),
    }
  }

  if (!actorsEqual(parsed.command.actor, draft.actor)) {
    return {
      ok: false,
      diagnostic: draftDiagnostic(
        "draft-actor-mismatch",
        "The command actor does not own this draft.",
      ),
    }
  }

  const result = applyDocumentCommand(draft.snapshot, parsed.command, { transactionId: draft.id })

  return result.ok
    ? {
        ok: true,
        draft: {
          ...draft,
          snapshot: result.snapshot,
          events: [...draft.events, result.event],
        },
      }
    : result
}

function currentRevision(snapshot: DocumentSnapshot | null) {
  return snapshot?.revision ?? 0
}

export function commitDocumentDraft(
  current: DocumentSnapshot | null,
  draft: DocumentDraft,
): DraftCommitResult {
  if (current && current.id !== draft.documentId) {
    return {
      ok: false,
      diagnostic: draftDiagnostic("draft-document-mismatch", "The draft targets another document."),
    }
  }

  if (currentRevision(current) !== draft.baseRevision) {
    return {
      ok: false,
      diagnostic: draftDiagnostic(
        "stale-revision",
        "The committed document changed after the draft was created.",
        true,
      ),
    }
  }

  if (draft.events.length === 0 || !draft.snapshot) {
    return {
      ok: false,
      diagnostic: draftDiagnostic("draft-empty", "The draft has no commands to commit."),
    }
  }

  return {
    ok: true,
    commit: {
      transactionId: draft.id,
      documentId: draft.documentId,
      baseRevision: draft.baseRevision,
      revision: draft.snapshot.revision,
      actor: draft.actor,
      commandIds: draft.events.map((event) => event.commandId),
      events: draft.events,
      snapshot: draft.snapshot,
    },
  }
}
