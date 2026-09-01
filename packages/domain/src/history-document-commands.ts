import { z } from "zod"
import {
  type DomainDiagnostic,
  documentGraphDiagnostic,
  domainDiagnostic,
  unavailableDependencyModelDiagnostic,
  zodDiagnosticIssues,
} from "./command-support"
import { commandActorSchema } from "./commands"
import { type DocumentSnapshotV1, documentSnapshotV1Schema } from "./document"
import { createDocumentDependencyGraph } from "./document-graph"
import { type HistoryItemRef, historyItemRefSchema } from "./document-node"
import {
  commandIdSchema,
  documentIdSchema,
  draftIdSchema,
  revisionSchema,
  timestampSchema,
} from "./identifiers"
import { isOrphanedModelReference, type SketchRecord, sketchRecordSchema } from "./sketch"

const historyCommandEnvelopeSchema = z
  .object({
    schemaVersion: z.literal(1),
    commandId: commandIdSchema,
    documentId: documentIdSchema,
    baseRevision: revisionSchema,
    issuedAt: timestampSchema,
    actor: commandActorSchema,
  })
  .strict()

export const insertSketchInHistoryCommandSchema = historyCommandEnvelopeSchema.extend({
  kind: z.literal("org.vibeshape.history.insert-sketch"),
  payload: z
    .object({
      sketch: sketchRecordSchema,
      historyAfter: historyItemRefSchema.nullable(),
    })
    .strict(),
})

const historyEventEnvelopeSchema = z
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

const historyDocumentCommandOptionsSchema = z
  .object({ transactionId: draftIdSchema.nullable().optional() })
  .strict()

export const sketchInsertedInHistoryEventSchema = historyEventEnvelopeSchema.extend({
  type: z.literal("org.vibeshape.history.sketch-inserted"),
  sketch: sketchRecordSchema,
  historyAfter: historyItemRefSchema.nullable(),
})

export type InsertSketchInHistoryCommand = Readonly<
  z.infer<typeof insertSketchInHistoryCommandSchema>
>
export type SketchInsertedInHistoryEvent = Readonly<
  z.infer<typeof sketchInsertedInHistoryEventSchema>
>

export type HistoryDocumentCommandResult =
  | Readonly<{
      ok: true
      snapshot: DocumentSnapshotV1
      event: SketchInsertedInHistoryEvent
    }>
  | Readonly<{ ok: false; diagnostic: DomainDiagnostic }>

export type HistoryDocumentEventResult =
  | Readonly<{ ok: true; snapshot: DocumentSnapshotV1 }>
  | Readonly<{ ok: false; diagnostic: DomainDiagnostic }>

function invalidInputDiagnostic(kind: "command" | "event", error: z.ZodError): DomainDiagnostic {
  return {
    code: kind === "command" ? "invalid-command" : "invalid-event",
    message: `The History ${kind} is invalid.`,
    retryable: false,
    issues: zodDiagnosticIssues(error),
  }
}

function revisionDiagnostic(
  snapshot: DocumentSnapshotV1,
  input: Readonly<{ baseRevision: number; documentId: string; revision?: number }>,
): DomainDiagnostic | null {
  if (snapshot.id !== input.documentId) {
    return domainDiagnostic("document-id-mismatch", "The operation targets a different document.")
  }
  if (input.baseRevision === Number.MAX_SAFE_INTEGER) {
    return domainDiagnostic("revision-exhausted", "The document revision cannot advance safely.")
  }
  if (
    snapshot.revision !== input.baseRevision ||
    (input.revision !== undefined && input.revision !== input.baseRevision + 1)
  ) {
    return domainDiagnostic(
      "stale-revision",
      "The operation does not extend the current document revision.",
      true,
    )
  }
  return null
}

function historyRefsEqual(left: HistoryItemRef, right: HistoryItemRef) {
  return left.kind === right.kind && left.id === right.id
}

function insertAfter(
  history: readonly HistoryItemRef[],
  item: HistoryItemRef,
  anchor: HistoryItemRef | null,
): readonly HistoryItemRef[] | null {
  if (anchor === null) return [item, ...history]
  const anchorIndex = history.findIndex((candidate) => historyRefsEqual(candidate, anchor))
  if (anchorIndex < 0) return null
  return [...history.slice(0, anchorIndex + 1), item, ...history.slice(anchorIndex + 1)]
}

function sketchIntroducesOrphanedIntent(sketch: SketchRecord) {
  return (sketch.externalReferences ?? []).some(isOrphanedModelReference)
}

function validateHistoryMutationAuthority(
  snapshot: DocumentSnapshotV1,
  invalidEvent: boolean,
): DomainDiagnostic | null {
  const graph = createDocumentDependencyGraph(snapshot)
  if (!graph.ok) return documentGraphDiagnostic(graph.diagnostic, invalidEvent)
  return graph.graph.dependencyModelIssues.length > 0
    ? unavailableDependencyModelDiagnostic(graph.graph.dependencyModelIssues, invalidEvent)
    : null
}

function missingAnchorDiagnostic(invalidEvent: boolean): DomainDiagnostic {
  return {
    code: invalidEvent ? "invalid-event" : "invalid-command",
    message: "The History insertion anchor does not exist.",
    retryable: false,
    issues: [
      {
        path: invalidEvent ? "historyAfter" : "payload.historyAfter",
        message: "The referenced History item does not exist in this document.",
      },
    ],
  }
}

function insertionCandidateDiagnostic(
  snapshot: DocumentSnapshotV1,
  sketch: SketchRecord,
  invalidEvent: boolean,
): DomainDiagnostic | null {
  const authority = validateHistoryMutationAuthority(snapshot, invalidEvent)
  if (authority) return authority
  if (snapshot.sketches.some(({ id }) => id === sketch.id)) {
    return domainDiagnostic(
      invalidEvent ? "invalid-event" : "sketch-already-exists",
      invalidEvent
        ? "The History event adds an existing sketch."
        : `Sketch ${sketch.id} already exists in the document.`,
    )
  }
  if (!sketchIntroducesOrphanedIntent(sketch)) return null
  return domainDiagnostic(
    invalidEvent ? "invalid-event" : "invalid-sketch",
    invalidEvent
      ? "The History event introduces orphaned model-reference intent."
      : "Orphaned model references may only be introduced by atomic feature removal.",
  )
}

function reduceParsedHistoryEvent(
  snapshot: DocumentSnapshotV1,
  event: SketchInsertedInHistoryEvent,
  invalidEvent: boolean,
): HistoryDocumentEventResult {
  const revision = revisionDiagnostic(snapshot, event)
  if (revision) return { ok: false, diagnostic: revision }
  const candidate = insertionCandidateDiagnostic(snapshot, event.sketch, invalidEvent)
  if (candidate) return { ok: false, diagnostic: candidate }
  const history = insertAfter(
    snapshot.history,
    { kind: "sketch", id: event.sketch.id },
    event.historyAfter,
  )
  if (!history) {
    return { ok: false, diagnostic: missingAnchorDiagnostic(invalidEvent) }
  }
  const parsed = documentSnapshotV1Schema.safeParse({
    ...snapshot,
    revision: event.revision,
    sketches: [...snapshot.sketches, event.sketch],
    history,
    updatedAt: event.issuedAt,
  })
  if (parsed.success) return { ok: true, snapshot: parsed.data }
  return {
    ok: false,
    diagnostic: {
      code: invalidEvent ? "invalid-event" : "invalid-command",
      message: `The History ${invalidEvent ? "event" : "command"} produces an invalid document.`,
      retryable: false,
      issues: zodDiagnosticIssues(parsed.error),
    },
  }
}

export type HistoryDocumentCommandOptions = Readonly<
  z.infer<typeof historyDocumentCommandOptionsSchema>
>

export function applyInsertSketchInHistoryCommand(
  snapshot: DocumentSnapshotV1,
  input: unknown,
  options?: HistoryDocumentCommandOptions,
): HistoryDocumentCommandResult
export function applyInsertSketchInHistoryCommand(
  snapshot: DocumentSnapshotV1,
  input: unknown,
  options: unknown = {},
): HistoryDocumentCommandResult {
  const parsed = insertSketchInHistoryCommandSchema.safeParse(input)
  if (!parsed.success)
    return { ok: false, diagnostic: invalidInputDiagnostic("command", parsed.error) }
  const revision = revisionDiagnostic(snapshot, parsed.data)
  if (revision) return { ok: false, diagnostic: revision }
  const parsedOptions = historyDocumentCommandOptionsSchema.safeParse(options)
  if (!parsedOptions.success) {
    const diagnostic = invalidInputDiagnostic("command", parsedOptions.error)
    return {
      ok: false,
      diagnostic: {
        ...diagnostic,
        issues: diagnostic.issues.map((issue) => ({
          ...issue,
          path: issue.path ? `options.${issue.path}` : "options",
        })),
      },
    }
  }
  const event = sketchInsertedInHistoryEventSchema.parse({
    schemaVersion: 1,
    type: "org.vibeshape.history.sketch-inserted",
    commandId: parsed.data.commandId,
    transactionId: parsedOptions.data.transactionId ?? null,
    documentId: parsed.data.documentId,
    baseRevision: parsed.data.baseRevision,
    revision: parsed.data.baseRevision + 1,
    issuedAt: parsed.data.issuedAt,
    actor: parsed.data.actor,
    sketch: parsed.data.payload.sketch,
    historyAfter: parsed.data.payload.historyAfter,
  })
  const reduced = reduceParsedHistoryEvent(snapshot, event, false)
  return reduced.ok ? { ...reduced, event } : reduced
}

export function reduceHistoryDocumentEvent(
  snapshot: DocumentSnapshotV1,
  input: unknown,
): HistoryDocumentEventResult {
  const parsed = sketchInsertedInHistoryEventSchema.safeParse(input)
  return parsed.success
    ? reduceParsedHistoryEvent(snapshot, parsed.data, true)
    : { ok: false, diagnostic: invalidInputDiagnostic("event", parsed.error) }
}

export function replayHistoryDocumentEvents(
  seed: DocumentSnapshotV1,
  inputs: readonly unknown[],
): HistoryDocumentEventResult {
  let snapshot = seed
  for (const input of inputs) {
    const result = reduceHistoryDocumentEvent(snapshot, input)
    if (!result.ok) return result
    snapshot = result.snapshot
  }
  return { ok: true, snapshot }
}
