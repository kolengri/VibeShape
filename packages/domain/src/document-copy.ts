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
import {
  type DocumentSnapshot,
  type DocumentSnapshotV1,
  documentNameSchema,
  documentSnapshotSchema,
  documentSnapshotV1Schema,
} from "./document"
import { migrateDocumentSnapshot } from "./document-migration"
import {
  commandIdSchema,
  type DraftId,
  documentIdSchema,
  draftIdSchema,
  timestampSchema,
} from "./identifiers"
import {
  applyVersionedDocumentCommand,
  replayVersionedDocumentEvents,
  type VersionedDocumentEvent,
  versionedDocumentEventSchema,
} from "./versioned-document-commands"

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

const transactionIdMappingSchema = z
  .object({ source: draftIdSchema, target: draftIdSchema })
  .strict()

type VersionedCopyIdentityInput = Readonly<{
  sourceSnapshot: { id: string; name: string }
  sourceEvents: readonly { commandId: string; transactionId: string | null }[]
  documentId: string
  commandIds: readonly string[]
  transactionIds: readonly { source: string; target: string }[]
  name: string
}>

function versionedCopyCommandIdsAreValid(input: VersionedCopyIdentityInput) {
  const sourceCommandIds = new Set(input.sourceEvents.map(({ commandId }) => commandId))
  return [
    input.commandIds.length === input.sourceEvents.length + 1,
    new Set(input.commandIds).size === input.commandIds.length,
    !input.commandIds.some((commandId) => sourceCommandIds.has(commandId)),
  ].every(Boolean)
}

function versionedCopyTransactionIdsAreValid(input: VersionedCopyIdentityInput) {
  const sourceIds = new Set(
    input.sourceEvents.flatMap(({ transactionId }) =>
      transactionId === null ? [] : [transactionId],
    ),
  )
  const mappedSources = input.transactionIds.map(({ source }) => source)
  const mappedTargets = input.transactionIds.map(({ target }) => target)
  return [
    new Set(mappedSources).size === mappedSources.length,
    new Set(mappedTargets).size === mappedTargets.length,
    !mappedTargets.some((target) => sourceIds.has(target)),
    mappedSources.length === sourceIds.size,
    !mappedSources.some((source) => !sourceIds.has(source)),
  ].every(Boolean)
}

function copyIdentityIssue(context: z.RefinementCtx, path: string, message: string) {
  context.addIssue({ code: "custom", message, path: [path] })
}

function validateVersionedCopyIdentities(
  input: VersionedCopyIdentityInput,
  context: z.RefinementCtx,
) {
  if (input.documentId === input.sourceSnapshot.id)
    copyIdentityIssue(
      context,
      "documentId",
      "A versioned document copy requires a new document ID.",
    )
  if (input.name === input.sourceSnapshot.name)
    copyIdentityIssue(context, "name", "A versioned document copy requires a distinct name.")
  if (!versionedCopyCommandIdsAreValid(input))
    copyIdentityIssue(
      context,
      "commandIds",
      "Versioned copy command IDs must be fresh, unique, and include the final rename.",
    )
  if (!versionedCopyTransactionIdsAreValid(input))
    copyIdentityIssue(
      context,
      "transactionIds",
      "Versioned copy transaction IDs must map every source group to one fresh group.",
    )
}

const versionedDocumentHistoryCopyInputSchema = z
  .object({
    sourceSeed: documentSnapshotV1Schema.nullable(),
    sourceSnapshot: documentSnapshotV1Schema,
    sourceEvents: z.array(versionedDocumentEventSchema).max(99_999),
    documentId: documentIdSchema,
    commandIds: z.array(commandIdSchema).min(1).max(100_000),
    transactionIds: z.array(transactionIdMappingSchema).max(99_999),
    name: documentNameSchema,
    issuedAt: timestampSchema,
    actor: commandActorSchema,
  })
  .strict()
  .superRefine(validateVersionedCopyIdentities)

export type VersionedDocumentHistoryCopyResult =
  | Readonly<{
      ok: true
      seed: DocumentSnapshotV1 | null
      snapshot: DocumentSnapshotV1
      events: readonly VersionedDocumentEvent[]
    }>
  | Readonly<{ ok: false; diagnostic: DomainDiagnostic }>

type VersionedCopyFailure = Extract<VersionedDocumentHistoryCopyResult, { ok: false }>

function invalidVersionedCopy(message: string): VersionedCopyFailure {
  return { ok: false, diagnostic: domainDiagnostic("invalid-event", message) }
}

/** Copies a replay-proven v1 seed and suffix without changing History or entity identities. */
export function copyVersionedDocumentHistory(
  inputValue: unknown,
): VersionedDocumentHistoryCopyResult {
  const input = versionedDocumentHistoryCopyInputSchema.safeParse(inputValue)
  if (!input.success) return invalidVersionedCopy("The versioned document copy input is invalid.")

  const replayedSource = replayVersionedDocumentEvents(
    input.data.sourceSeed,
    input.data.sourceEvents,
  )
  if (
    !replayedSource.ok ||
    canonicalJson(replayedSource.snapshot) !== canonicalJson(input.data.sourceSnapshot)
  )
    return invalidVersionedCopy("The source versioned history does not reproduce its snapshot.")

  const transactionIds = new Map(
    input.data.transactionIds.map(({ source, target }) => [source, target]),
  )
  const seed = input.data.sourceSeed
    ? documentSnapshotV1Schema.parse({ ...input.data.sourceSeed, id: input.data.documentId })
    : null
  const events = input.data.sourceEvents.map((event, index) =>
    versionedDocumentEventSchema.parse({
      ...event,
      commandId: input.data.commandIds[index],
      documentId: input.data.documentId,
      transactionId: event.transactionId ? transactionIds.get(event.transactionId) : null,
    }),
  )
  const replayedCopy = replayVersionedDocumentEvents(seed, events)
  const expectedCopy = documentSnapshotV1Schema.parse({
    ...input.data.sourceSnapshot,
    id: input.data.documentId,
  })
  if (!replayedCopy.ok || canonicalJson(replayedCopy.snapshot) !== canonicalJson(expectedCopy))
    return invalidVersionedCopy("The copied versioned history does not reproduce its snapshot.")

  const renameCommandId = input.data.commandIds.at(-1)
  if (!renameCommandId)
    return invalidVersionedCopy("The versioned copy rename identity is missing.")
  const renamed = applyVersionedDocumentCommand(replayedCopy.snapshot, {
    kind: "org.vibeshape.document.rename",
    schemaVersion: 1,
    commandId: renameCommandId,
    documentId: input.data.documentId,
    baseRevision: replayedCopy.snapshot.revision,
    issuedAt: input.data.issuedAt,
    actor: input.data.actor,
    payload: { name: input.data.name },
  })
  return renamed.ok
    ? { ok: true, seed, snapshot: renamed.snapshot, events: [...events, renamed.event] }
    : renamed
}

const completeVersionedDocumentHistoryCopyInputSchema = z
  .object({
    sourceLegacyEvents: z.array(documentEventSchema).max(99_999),
    sourceSeed: documentSnapshotV1Schema.nullable(),
    sourceSnapshot: documentSnapshotV1Schema,
    sourceEvents: z.array(versionedDocumentEventSchema).max(99_999),
    documentId: documentIdSchema,
    commandIds: z.array(commandIdSchema).min(1).max(100_000),
    transactionIds: z.array(transactionIdMappingSchema).max(99_999),
    name: documentNameSchema,
    issuedAt: timestampSchema,
    actor: commandActorSchema,
  })
  .strict()
  .superRefine((input, context) => {
    validateVersionedCopyIdentities(
      { ...input, sourceEvents: [...input.sourceLegacyEvents, ...input.sourceEvents] },
      context,
    )
    const native = input.sourceSeed === null && input.sourceLegacyEvents.length === 0
    const promoted =
      input.sourceSeed !== null && input.sourceLegacyEvents.length === input.sourceSeed.revision
    if (!native && !promoted)
      copyIdentityIssue(
        context,
        "sourceLegacyEvents",
        "A complete versioned copy requires either native history or a complete promotion prefix.",
      )
    if (input.sourceLegacyEvents.length + input.sourceEvents.length > 99_999)
      copyIdentityIssue(
        context,
        "sourceEvents",
        "The complete versioned copy exceeds its aggregate event limit.",
      )
  })

export type CompleteVersionedDocumentHistoryCopyResult =
  | Readonly<{
      ok: true
      legacyEvents: readonly DocumentEvent[]
      seed: DocumentSnapshotV1 | null
      snapshot: DocumentSnapshotV1
      versionedEvents: readonly VersionedDocumentEvent[]
    }>
  | Readonly<{ ok: false; diagnostic: DomainDiagnostic }>

function sourceSuffixTransactionMappings(
  events: readonly VersionedDocumentEvent[],
  mappings: readonly { source: DraftId; target: DraftId }[],
) {
  const sourceIds = new Set(
    events.flatMap(({ transactionId }) => (transactionId === null ? [] : [transactionId])),
  )
  return mappings.filter(({ source }) => sourceIds.has(source))
}

function copyLegacyPrefix(
  events: readonly DocumentEvent[],
  documentId: string,
  commandIds: readonly string[],
  transactionIds: ReadonlyMap<DraftId, DraftId>,
) {
  return events.map((event, index) =>
    documentEventSchema.parse({
      ...event,
      documentId,
      commandId: commandIds[index],
      transactionId: event.transactionId ? transactionIds.get(event.transactionId) : null,
    }),
  )
}

/** Copies a complete native or promoted history while preserving semantic and History identities. */
export function copyCompleteVersionedDocumentHistory(
  inputValue: unknown,
): CompleteVersionedDocumentHistoryCopyResult {
  const input = completeVersionedDocumentHistoryCopyInputSchema.safeParse(inputValue)
  if (!input.success) return invalidVersionedCopy("The complete versioned copy input is invalid.")
  const transactionIds = new Map(
    input.data.transactionIds.map(({ source, target }) => [source, target]),
  )
  const legacyCount = input.data.sourceLegacyEvents.length
  const legacyEvents = copyLegacyPrefix(
    input.data.sourceLegacyEvents,
    input.data.documentId,
    input.data.commandIds.slice(0, legacyCount),
    transactionIds,
  )
  const migratedSeed = migratedCopySeed(input.data, legacyEvents)
  if (!migratedSeed.ok) return migratedSeed
  const copied = copyVersionedDocumentHistory({
    sourceSeed: input.data.sourceSeed,
    sourceSnapshot: input.data.sourceSnapshot,
    sourceEvents: input.data.sourceEvents,
    documentId: input.data.documentId,
    commandIds: input.data.commandIds.slice(legacyCount),
    transactionIds: sourceSuffixTransactionMappings(
      input.data.sourceEvents,
      input.data.transactionIds,
    ),
    name: input.data.name,
    issuedAt: input.data.issuedAt,
    actor: input.data.actor,
  })
  if (!copied.ok) return copied
  if (canonicalJson(copied.seed) !== canonicalJson(migratedSeed.seed))
    return invalidVersionedCopy("The copied legacy prefix does not reproduce its promotion seed.")
  return {
    ok: true,
    legacyEvents,
    seed: copied.seed,
    snapshot: copied.snapshot,
    versionedEvents: copied.events,
  }
}

function migratedCopySeed(
  input: z.output<typeof completeVersionedDocumentHistoryCopyInputSchema>,
  copiedLegacyEvents: readonly DocumentEvent[],
): Readonly<{ ok: true; seed: DocumentSnapshotV1 | null }> | VersionedCopyFailure {
  if (!input.sourceSeed) return { ok: true, seed: null }
  const sourceLegacy = replayDocumentEvents(input.sourceLegacyEvents)
  if (!sourceLegacy.ok) return invalidVersionedCopy("The source legacy prefix is invalid.")
  const sourceMigration = migrateDocumentSnapshot(sourceLegacy.snapshot, input.sourceLegacyEvents)
  if (
    !sourceMigration.ok ||
    canonicalJson(sourceMigration.snapshot) !== canonicalJson(input.sourceSeed)
  )
    return invalidVersionedCopy("The source legacy prefix does not reproduce its promotion seed.")
  const copiedLegacy = replayDocumentEvents(copiedLegacyEvents)
  if (!copiedLegacy.ok) return invalidVersionedCopy("The copied legacy prefix is invalid.")
  const copiedMigration = migrateDocumentSnapshot(copiedLegacy.snapshot, copiedLegacyEvents)
  return copiedMigration.ok
    ? { ok: true, seed: copiedMigration.snapshot }
    : invalidVersionedCopy("The copied legacy prefix cannot be migrated.")
}
