import { z } from "zod"
import { canonicalJson } from "./canonical-json"
import { type DomainDiagnostic, domainDiagnostic } from "./command-support"
import {
  commandActorSchema,
  type DocumentEvent,
  documentEventSchema,
  replayDocumentEvents,
} from "./commands"
import { type DocumentSnapshotV1, documentNameSchema, documentSnapshotV1Schema } from "./document"
import { migrateDocumentSnapshot } from "./document-migration"
import type { DocumentAuthoritySnapshot } from "./document-v2"
import {
  type DocumentSnapshotV2,
  type DocumentSnapshotV3,
  documentSnapshotV2Schema,
  documentSnapshotV3Schema,
} from "./document-v2"
import {
  type DocumentAuthorityEvent,
  documentAuthorityEventSchema,
} from "./document-v2-command-schemas"
import { applyDocumentV2Command } from "./document-v2-commands"
import { replayDocumentAuthorityEvents } from "./document-v2-replay"
import { applyDocumentV3Command } from "./document-v3-commands"
import { type DocumentSnapshotV4, documentSnapshotV4Schema } from "./document-v4"
import { applyDocumentV4AuthoredCommand } from "./document-v4-commands"
import { type DocumentSnapshotV5, documentSnapshotV5Schema } from "./document-v5"
import { applyDocumentV5AuthoredCommand } from "./document-v5-commands"
import {
  type DocumentSnapshotV6,
  documentSnapshotV6Schema,
  projectDocumentSnapshotV6ToV5,
} from "./document-v6"
import { wrapDocumentV6AuthoredResult } from "./document-v6-commands"
import { commandIdSchema, documentIdSchema, draftIdSchema, timestampSchema } from "./identifiers"

const copyInputObjectSchema = z
  .object({
    sourceLegacyEvents: z.array(documentEventSchema).max(99_999),
    sourceSeed: documentSnapshotV1Schema.nullable(),
    sourceSnapshot: z.union([
      documentSnapshotV2Schema,
      documentSnapshotV3Schema,
      documentSnapshotV4Schema,
      documentSnapshotV5Schema,
      documentSnapshotV6Schema,
    ]),
    sourceEvents: z.array(documentAuthorityEventSchema).max(99_999),
    documentId: documentIdSchema,
    commandIds: z.array(commandIdSchema).min(1).max(100_000),
    transactionIds: z
      .array(z.object({ source: draftIdSchema, target: draftIdSchema }).strict())
      .max(99_999),
    name: documentNameSchema,
    issuedAt: timestampSchema,
    actor: commandActorSchema,
  })
  .strict()

type CopyInput = z.infer<typeof copyInputObjectSchema>

function freshCommandIdentities(input: CopyInput) {
  const events = [...input.sourceLegacyEvents, ...input.sourceEvents]
  const sources = new Set(events.map((event) => event.commandId))
  return (
    events.length <= 99_999 &&
    input.commandIds.length === events.length + 1 &&
    sources.size === events.length &&
    new Set(input.commandIds).size === input.commandIds.length &&
    !input.commandIds.some((id) => sources.has(id))
  )
}

function freshTransactionIdentities(input: CopyInput) {
  const transactions = new Set(
    [...input.sourceLegacyEvents, ...input.sourceEvents].flatMap((event) =>
      event.transactionId === null ? [] : [event.transactionId],
    ),
  )
  const sources = input.transactionIds.map((mapping) => mapping.source)
  const targets = input.transactionIds.map((mapping) => mapping.target)
  return (
    sources.length === transactions.size &&
    new Set(sources).size === sources.length &&
    sources.every((id) => transactions.has(id)) &&
    new Set(targets).size === targets.length &&
    !targets.some((id) => transactions.has(id))
  )
}

const copyInputSchema = copyInputObjectSchema.superRefine((input, context) => {
  const completePrefix =
    input.sourceSeed === null
      ? input.sourceLegacyEvents.length === 0
      : input.sourceLegacyEvents.length === input.sourceSeed.revision
  const valid =
    input.documentId !== input.sourceSnapshot.id &&
    input.name !== input.sourceSnapshot.name &&
    completePrefix &&
    freshCommandIdentities(input) &&
    freshTransactionIdentities(input)
  if (!valid)
    context.addIssue({
      code: "custom",
      message:
        "A complete copy requires replayable history and fresh document, command and transaction identities.",
    })
})

export type CompleteDocumentAuthorityCopyResult =
  | Readonly<{
      ok: true
      legacyEvents: readonly DocumentEvent[]
      seed: DocumentSnapshotV1 | null
      snapshot:
        | DocumentSnapshotV2
        | DocumentSnapshotV3
        | DocumentSnapshotV4
        | DocumentSnapshotV5
        | DocumentSnapshotV6
      versionedEvents: readonly DocumentAuthorityEvent[]
    }>
  | Readonly<{ ok: false; diagnostic: DomainDiagnostic }>

function invalidCopy(message: string): Extract<CompleteDocumentAuthorityCopyResult, { ok: false }> {
  return { ok: false, diagnostic: domainDiagnostic("invalid-event", message) }
}

function verifyLegacySeed(
  seed: DocumentSnapshotV1 | null,
  events: readonly DocumentEvent[],
): boolean {
  if (seed === null) return events.length === 0
  const replayed = replayDocumentEvents(events)
  if (!replayed.ok) return false
  const migrated = migrateDocumentSnapshot(replayed.snapshot, events)
  return (
    migrated.ok &&
    migrated.provenance === "journal-derived" &&
    canonicalJson(migrated.snapshot) === canonicalJson(seed)
  )
}

/** Copies complete native or legacy-promoted journals, preserving local entities and actor provenance. */
export function copyCompleteDocumentAuthorityHistory(
  inputValue: unknown,
): CompleteDocumentAuthorityCopyResult {
  const parsed = copyInputSchema.safeParse(inputValue)
  if (!parsed.success) return invalidCopy("The complete authority copy input is invalid.")
  const input = parsed.data
  if (!verifyLegacySeed(input.sourceSeed, input.sourceLegacyEvents))
    return invalidCopy("The legacy prefix does not reproduce its V1 migration seed.")
  const source = replayDocumentAuthorityEvents(input.sourceSeed, input.sourceEvents)
  if (!source.ok || canonicalJson(source.snapshot) !== canonicalJson(input.sourceSnapshot))
    return invalidCopy("The source journal does not reproduce its authority snapshot.")
  const transactionIds = new Map(
    input.transactionIds.map((mapping) => [mapping.source, mapping.target]),
  )
  const identities = (
    event: { transactionId: z.infer<typeof draftIdSchema> | null },
    index: number,
  ) => ({
    documentId: input.documentId,
    commandId: input.commandIds[index],
    transactionId: event.transactionId === null ? null : transactionIds.get(event.transactionId),
  })
  const legacyEvents = input.sourceLegacyEvents.map((event, index) =>
    documentEventSchema.parse({ ...event, ...identities(event, index) }),
  )
  const seed = input.sourceSeed
    ? documentSnapshotV1Schema.parse({ ...input.sourceSeed, id: input.documentId })
    : null
  if (!verifyLegacySeed(seed, legacyEvents))
    return invalidCopy("The copied legacy prefix does not reproduce its seed.")
  const events = input.sourceEvents.map((event, index) => {
    const envelope = identities(event, index + legacyEvents.length)
    return remapAuthorityEvent(event, envelope)
  })
  const copied = replayDocumentAuthorityEvents(seed, events)
  if (
    !copied.ok ||
    copied.snapshot.schemaVersion !== input.sourceSnapshot.schemaVersion ||
    canonicalJson(copied.snapshot) !==
      canonicalJson({ ...input.sourceSnapshot, id: input.documentId })
  )
    return invalidCopy("The copied authority journal does not reproduce the expected snapshot.")
  const renamed = renameCopiedAuthority(copied.snapshot, input)
  return renamed.ok
    ? {
        ok: true,
        legacyEvents,
        seed,
        snapshot: renamed.snapshot,
        versionedEvents: [...events, renamed.event],
      }
    : renamed
}
function renameCopiedAuthority(snapshot: DocumentAuthoritySnapshot, input: CopyInput) {
  const command = {
    kind: "org.vibeshape.document.rename",
    schemaVersion: 1,
    commandId: input.commandIds.at(-1),
    documentId: input.documentId,
    baseRevision: snapshot.revision,
    issuedAt: input.issuedAt,
    actor: input.actor,
    payload: { name: input.name },
  }
  const authored = {
    ...command,
    kind: "org.vibeshape.document.model-command",
    schemaVersion: snapshot.schemaVersion === 2 ? 2 : 3,
    payload: { command, partAllocations: [] },
  }
  if (snapshot.schemaVersion === 6)
    return wrapDocumentV6AuthoredResult(
      snapshot,
      applyDocumentV5AuthoredCommand(projectDocumentSnapshotV6ToV5(snapshot), authored),
    )
  if (snapshot.schemaVersion === 5) return applyDocumentV5AuthoredCommand(snapshot, authored)
  if (snapshot.schemaVersion === 4) return applyDocumentV4AuthoredCommand(snapshot, authored)
  return snapshot.schemaVersion === 3
    ? applyDocumentV3Command(snapshot, authored)
    : applyDocumentV2Command(snapshot, authored)
}

function remapAuthorityEvent(
  event: DocumentAuthorityEvent,
  envelope: {
    documentId: string
    commandId: string | undefined
    transactionId: string | null | undefined
  },
): DocumentAuthorityEvent {
  if (event.type === "org.vibeshape.document.authored-changed")
    return documentAuthorityEventSchema.parse({
      ...event,
      ...envelope,
      authoredEvent: remapAuthorityEvent(event.authoredEvent, envelope),
    })
  if (event.type === "org.vibeshape.document.model-changed")
    return documentAuthorityEventSchema.parse({
      ...event,
      ...envelope,
      modelEvent: { ...event.modelEvent, ...envelope },
    })
  return documentAuthorityEventSchema.parse({ ...event, ...envelope })
}
