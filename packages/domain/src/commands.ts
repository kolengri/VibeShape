import { z } from "zod"
import { type DocumentSnapshot, documentNameInputSchema, documentNameSchema } from "./document"
import {
  commandIdSchema,
  documentIdSchema,
  draftIdSchema,
  revisionSchema,
  sessionIdSchema,
  technicalIdentifierSchema,
  timestampSchema,
} from "./identifiers"

const sha256Pattern = /^[0-9a-f]{64}$/

const userActorSchema = z
  .object({
    type: z.literal("user"),
    userId: technicalIdentifierSchema.nullable(),
  })
  .strict()

const mcpActorSchema = z
  .object({
    type: z.literal("mcp"),
    clientId: technicalIdentifierSchema,
    sessionId: sessionIdSchema,
  })
  .strict()

const extensionActorSchema = z
  .object({
    type: z.literal("extension"),
    extensionId: technicalIdentifierSchema,
    integrity: z.string().regex(sha256Pattern, "Extension integrity must be a SHA-256 digest."),
  })
  .strict()

const systemActorSchema = z
  .object({
    type: z.literal("system"),
    source: technicalIdentifierSchema,
  })
  .strict()

export const commandActorSchema = z.discriminatedUnion("type", [
  userActorSchema,
  mcpActorSchema,
  extensionActorSchema,
  systemActorSchema,
])

const commandEnvelopeSchema = z
  .object({
    commandId: commandIdSchema,
    documentId: documentIdSchema,
    baseRevision: revisionSchema,
    issuedAt: timestampSchema,
    actor: commandActorSchema,
  })
  .strict()

const createDocumentCommandSchema = commandEnvelopeSchema.extend({
  kind: z.literal("org.vibeshape.document.create"),
  schemaVersion: z.literal(1),
  payload: z.object({ name: documentNameInputSchema }).strict(),
})

const renameDocumentCommandSchema = commandEnvelopeSchema.extend({
  kind: z.literal("org.vibeshape.document.rename"),
  schemaVersion: z.literal(1),
  payload: z.object({ name: documentNameInputSchema }).strict(),
})

export const documentCommandSchema = z.discriminatedUnion("kind", [
  createDocumentCommandSchema,
  renameDocumentCommandSchema,
])

const eventEnvelopeSchema = z
  .object({
    schemaVersion: z.literal(1),
    commandId: commandIdSchema,
    transactionId: draftIdSchema.nullable(),
    documentId: documentIdSchema,
    baseRevision: revisionSchema,
    revision: revisionSchema,
    issuedAt: timestampSchema,
    actor: commandActorSchema,
  })
  .strict()

const documentCreatedEventSchema = eventEnvelopeSchema.extend({
  type: z.literal("org.vibeshape.document.created"),
  name: documentNameSchema,
})

const documentRenamedEventSchema = eventEnvelopeSchema.extend({
  type: z.literal("org.vibeshape.document.renamed"),
  previousName: documentNameSchema,
  name: documentNameSchema,
})

export const documentEventSchema = z.discriminatedUnion("type", [
  documentCreatedEventSchema,
  documentRenamedEventSchema,
])

export const domainDiagnosticCodeSchema = z.enum([
  "invalid-command",
  "invalid-event",
  "document-already-exists",
  "document-not-found",
  "document-id-mismatch",
  "stale-revision",
  "revision-exhausted",
  "command-no-op",
])

const domainDiagnosticSchema = z
  .object({
    code: domainDiagnosticCodeSchema,
    message: z.string().min(1),
    retryable: z.boolean(),
    issues: z.array(z.object({ path: z.string(), message: z.string().min(1) }).strict()).max(8),
  })
  .strict()

export type CommandActor = Readonly<z.infer<typeof commandActorSchema>>
export type DocumentCommand = Readonly<z.infer<typeof documentCommandSchema>>
export type DocumentEvent = Readonly<z.infer<typeof documentEventSchema>>
export type DomainDiagnostic = Readonly<z.infer<typeof domainDiagnosticSchema>>

type DocumentCreatedEvent = Extract<DocumentEvent, { type: "org.vibeshape.document.created" }>
type DocumentRenamedEvent = Extract<DocumentEvent, { type: "org.vibeshape.document.renamed" }>

export type DocumentCommandResult =
  | { ok: true; snapshot: DocumentSnapshot; event: DocumentEvent }
  | { ok: false; diagnostic: DomainDiagnostic }

export type DocumentCommandOptions = Readonly<{
  transactionId?: z.infer<typeof draftIdSchema> | null
}>

export type DocumentEventResult =
  | { ok: true; snapshot: DocumentSnapshot }
  | { ok: false; diagnostic: DomainDiagnostic }

export function commandActorsEqual(left: CommandActor, right: CommandActor) {
  if (left.type !== right.type) {
    return false
  }

  switch (left.type) {
    case "user":
      return right.type === "user" && left.userId === right.userId
    case "mcp":
      return (
        right.type === "mcp" &&
        left.clientId === right.clientId &&
        left.sessionId === right.sessionId
      )
    case "extension":
      return (
        right.type === "extension" &&
        left.extensionId === right.extensionId &&
        left.integrity === right.integrity
      )
    case "system":
      return right.type === "system" && left.source === right.source
  }
}

function diagnostic(
  code: z.infer<typeof domainDiagnosticCodeSchema>,
  message: string,
  retryable = false,
): DomainDiagnostic {
  return { code, message, retryable, issues: [] }
}

function invalidInputDiagnostic(
  code: "invalid-command" | "invalid-event",
  error: z.ZodError,
): DomainDiagnostic {
  return {
    code,
    message:
      code === "invalid-command"
        ? "The document command is invalid."
        : "The document event is invalid.",
    retryable: false,
    issues: error.issues.slice(0, 8).map((issue) => ({
      path: issue.path.map(String).join("."),
      message: issue.message,
    })),
  }
}

function requireNextRevision(baseRevision: number, revision: number) {
  return revision === baseRevision + 1
}

function reduceCreatedEvent(
  snapshot: DocumentSnapshot | null,
  event: DocumentCreatedEvent,
): DocumentEventResult {
  if (snapshot) {
    return {
      ok: false,
      diagnostic: diagnostic("document-already-exists", "The document already exists."),
    }
  }

  if (event.baseRevision !== 0 || event.revision !== 1) {
    return {
      ok: false,
      diagnostic: diagnostic(
        "stale-revision",
        "Document creation must advance revision 0 to revision 1.",
        true,
      ),
    }
  }

  return {
    ok: true,
    snapshot: {
      schemaVersion: 0,
      id: event.documentId,
      revision: event.revision,
      name: event.name,
      createdAt: event.issuedAt,
      updatedAt: event.issuedAt,
    },
  }
}

function reduceRenamedEvent(
  snapshot: DocumentSnapshot | null,
  event: DocumentRenamedEvent,
): DocumentEventResult {
  if (!snapshot) {
    return {
      ok: false,
      diagnostic: diagnostic("document-not-found", "The document does not exist."),
    }
  }

  if (snapshot.id !== event.documentId) {
    return {
      ok: false,
      diagnostic: diagnostic("document-id-mismatch", "The event targets a different document."),
    }
  }

  if (event.baseRevision === Number.MAX_SAFE_INTEGER) {
    return {
      ok: false,
      diagnostic: diagnostic("revision-exhausted", "The document revision cannot advance safely."),
    }
  }

  if (
    snapshot.revision !== event.baseRevision ||
    !requireNextRevision(event.baseRevision, event.revision)
  ) {
    return {
      ok: false,
      diagnostic: diagnostic(
        "stale-revision",
        "The event does not extend the current document revision.",
        true,
      ),
    }
  }

  if (snapshot.name !== event.previousName) {
    return {
      ok: false,
      diagnostic: diagnostic(
        "invalid-event",
        "The rename event does not match the current document name.",
      ),
    }
  }

  return {
    ok: true,
    snapshot: {
      ...snapshot,
      revision: event.revision,
      name: event.name,
      updatedAt: event.issuedAt,
    },
  }
}

function reduceParsedEvent(
  snapshot: DocumentSnapshot | null,
  event: DocumentEvent,
): DocumentEventResult {
  return event.type === "org.vibeshape.document.created"
    ? reduceCreatedEvent(snapshot, event)
    : reduceRenamedEvent(snapshot, event)
}

function createDocumentCreatedEvent(
  snapshot: DocumentSnapshot | null,
  command: Extract<DocumentCommand, { kind: "org.vibeshape.document.create" }>,
  transactionId: z.infer<typeof draftIdSchema> | null,
): DocumentEvent | DomainDiagnostic {
  if (snapshot) {
    return diagnostic("document-already-exists", "The document already exists.")
  }

  if (command.baseRevision !== 0) {
    return diagnostic("stale-revision", "Document creation requires base revision 0.", true)
  }

  return {
    schemaVersion: 1,
    type: "org.vibeshape.document.created",
    commandId: command.commandId,
    transactionId,
    documentId: command.documentId,
    baseRevision: command.baseRevision,
    revision: 1,
    issuedAt: command.issuedAt,
    actor: command.actor,
    name: command.payload.name,
  }
}

function createDocumentRenamedEvent(
  snapshot: DocumentSnapshot | null,
  command: Extract<DocumentCommand, { kind: "org.vibeshape.document.rename" }>,
  transactionId: z.infer<typeof draftIdSchema> | null,
): DocumentEvent | DomainDiagnostic {
  if (!snapshot) {
    return diagnostic("document-not-found", "The document does not exist.")
  }

  if (snapshot.id !== command.documentId) {
    return diagnostic("document-id-mismatch", "The command targets a different document.")
  }

  if (snapshot.revision !== command.baseRevision) {
    return diagnostic("stale-revision", "The command base revision is stale.", true)
  }

  if (command.baseRevision === Number.MAX_SAFE_INTEGER) {
    return diagnostic("revision-exhausted", "The document revision cannot advance safely.")
  }

  if (snapshot.name === command.payload.name) {
    return diagnostic("command-no-op", "The document already has the requested name.")
  }

  return {
    schemaVersion: 1,
    type: "org.vibeshape.document.renamed",
    commandId: command.commandId,
    transactionId,
    documentId: command.documentId,
    baseRevision: command.baseRevision,
    revision: command.baseRevision + 1,
    issuedAt: command.issuedAt,
    actor: command.actor,
    previousName: snapshot.name,
    name: command.payload.name,
  }
}

function createEvent(
  snapshot: DocumentSnapshot | null,
  command: DocumentCommand,
  transactionId: z.infer<typeof draftIdSchema> | null,
): DocumentEvent | DomainDiagnostic {
  return command.kind === "org.vibeshape.document.create"
    ? createDocumentCreatedEvent(snapshot, command, transactionId)
    : createDocumentRenamedEvent(snapshot, command, transactionId)
}

export function parseDocumentCommand(input: unknown) {
  const parsed = documentCommandSchema.safeParse(input)

  return parsed.success
    ? ({ ok: true, command: parsed.data } as const)
    : ({ ok: false, diagnostic: invalidInputDiagnostic("invalid-command", parsed.error) } as const)
}

export function applyDocumentCommand(
  snapshot: DocumentSnapshot | null,
  input: unknown,
  options: DocumentCommandOptions = {},
): DocumentCommandResult {
  const parsed = parseDocumentCommand(input)

  if (!parsed.ok) {
    return parsed
  }

  const event = createEvent(snapshot, parsed.command, options.transactionId ?? null)

  if ("code" in event) {
    return { ok: false, diagnostic: event }
  }

  const reduced = reduceParsedEvent(snapshot, event)
  return reduced.ok ? { ok: true, snapshot: reduced.snapshot, event } : reduced
}

export function reduceDocumentEvent(
  snapshot: DocumentSnapshot | null,
  input: unknown,
): DocumentEventResult {
  const parsed = documentEventSchema.safeParse(input)

  return parsed.success
    ? reduceParsedEvent(snapshot, parsed.data)
    : { ok: false, diagnostic: invalidInputDiagnostic("invalid-event", parsed.error) }
}

export function replayDocumentEvents(inputs: readonly unknown[]): DocumentEventResult {
  let snapshot: DocumentSnapshot | null = null

  for (const input of inputs) {
    const result = reduceDocumentEvent(snapshot, input)

    if (!result.ok) {
      return result
    }

    snapshot = result.snapshot
  }

  return snapshot
    ? { ok: true, snapshot }
    : { ok: false, diagnostic: diagnostic("document-not-found", "The event sequence is empty.") }
}
