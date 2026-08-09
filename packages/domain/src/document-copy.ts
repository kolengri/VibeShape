import { z } from "zod"
import { canonicalJson } from "./canonical-json"
import { type DomainDiagnostic, domainDiagnostic } from "./command-support"
import {
  applyDocumentCommand,
  commandActorSchema,
  type DocumentEvent,
  documentEventSchema,
  replayDocumentEvents,
} from "./commands"
import { type DocumentSnapshot, documentNameSchema, documentSnapshotSchema } from "./document"
import { commandIdSchema, documentIdSchema, timestampSchema } from "./identifiers"

const documentHistoryCopyInputSchema = z
  .object({
    sourceSnapshot: documentSnapshotSchema,
    sourceEvents: z.array(documentEventSchema).min(1).max(99_999),
    documentId: documentIdSchema,
    commandIds: z.array(commandIdSchema).min(2).max(100_000),
    name: documentNameSchema,
    issuedAt: timestampSchema,
    actor: commandActorSchema,
  })
  .strict()
  .superRefine((input, context) => {
    if (input.documentId === input.sourceSnapshot.id) {
      context.addIssue({
        code: "custom",
        message: "A document copy requires a new document ID.",
        path: ["documentId"],
      })
    }
    if (input.name === input.sourceSnapshot.name) {
      context.addIssue({
        code: "custom",
        message: "A document copy requires a distinct name.",
        path: ["name"],
      })
    }
    if (input.commandIds.length !== input.sourceEvents.length + 1) {
      context.addIssue({
        code: "custom",
        message: "A document copy requires one new command ID per copied event and rename.",
        path: ["commandIds"],
      })
    }
    if (new Set(input.commandIds).size !== input.commandIds.length) {
      context.addIssue({
        code: "custom",
        message: "Document copy command IDs must be unique.",
        path: ["commandIds"],
      })
    }
    const sourceCommandIds = new Set(input.sourceEvents.map((event) => event.commandId))
    if (input.commandIds.some((commandId) => sourceCommandIds.has(commandId))) {
      context.addIssue({
        code: "custom",
        message: "Document copy command IDs must not reuse source command IDs.",
        path: ["commandIds"],
      })
    }
  })

export type DocumentHistoryCopyResult =
  | { ok: true; snapshot: DocumentSnapshot; events: readonly DocumentEvent[] }
  | { ok: false; diagnostic: DomainDiagnostic }

function invalidCopy(message: string): DocumentHistoryCopyResult {
  return { ok: false, diagnostic: domainDiagnostic("invalid-event", message) }
}

export function copyDocumentHistory(inputValue: unknown): DocumentHistoryCopyResult {
  const input = documentHistoryCopyInputSchema.safeParse(inputValue)
  if (!input.success) return invalidCopy("The document copy input is invalid.")

  const copiedEvents = input.data.sourceEvents.map((event, index) =>
    documentEventSchema.parse({
      ...event,
      commandId: input.data.commandIds[index],
      documentId: input.data.documentId,
    }),
  )
  const replayed = replayDocumentEvents(copiedEvents)
  if (!replayed.ok) return replayed

  const expectedSnapshot = documentSnapshotSchema.parse({
    ...input.data.sourceSnapshot,
    id: input.data.documentId,
  })
  if (canonicalJson(replayed.snapshot) !== canonicalJson(expectedSnapshot)) {
    return invalidCopy("The source event history does not reproduce its document snapshot.")
  }

  const renameCommandId = input.data.commandIds.at(-1)
  if (!renameCommandId) return invalidCopy("The document copy rename identity is missing.")
  const renamed = applyDocumentCommand(replayed.snapshot, {
    kind: "org.vibeshape.document.rename",
    schemaVersion: 1,
    commandId: renameCommandId,
    documentId: input.data.documentId,
    baseRevision: replayed.snapshot.revision,
    issuedAt: input.data.issuedAt,
    actor: input.data.actor,
    payload: { name: input.data.name },
  })
  return renamed.ok
    ? { ok: true, snapshot: renamed.snapshot, events: [...copiedEvents, renamed.event] }
    : renamed
}
