import { z } from "zod"
import { type DomainDiagnostic, domainDiagnostic } from "./command-support"
import { documentSnapshotV2Schema } from "./document-v2-schema"
import { sameOperationEnvelope } from "./document-v2-support"
import { documentSnapshotV3Schema } from "./document-v3-schema"
import { documentSnapshotV4Schema } from "./document-v4"
import { documentSnapshotV5Schema } from "./document-v5"
import {
  applyDocumentV5AuthoredCommand,
  type DocumentV5CommandResult,
  reduceDocumentV5Event,
} from "./document-v5-commands"
import {
  type DocumentSnapshotV6,
  documentSnapshotV6Schema,
  projectDocumentSnapshotV6ToV5,
  promoteDocumentSnapshotV6,
} from "./document-v6"
import {
  type DocumentV6Event,
  documentV6EventSchema,
  documentV6MetadataCommandSchema,
} from "./document-v6-command-schemas"
import { draftIdSchema } from "./identifiers"

const sourceSchema = z.union([
  documentSnapshotV2Schema,
  documentSnapshotV3Schema,
  documentSnapshotV4Schema,
  documentSnapshotV5Schema,
  documentSnapshotV6Schema,
])
export type DocumentV6Result =
  | Readonly<{ ok: true; snapshot: DocumentSnapshotV6 }>
  | Readonly<{ ok: false; diagnostic: DomainDiagnostic }>
export type DocumentV6CommandResult =
  | (Extract<DocumentV6Result, { ok: true }> & { event: DocumentV6Event })
  | Extract<DocumentV6Result, { ok: false }>
function invalid(message: string, code: DomainDiagnostic["code"] = "invalid-event") {
  return {
    ok: false as const,
    diagnostic: domainDiagnostic(code, message, code === "stale-revision"),
  }
}

export function reduceDocumentV6Event(
  sourceInput: unknown,
  eventInput: unknown,
  targetInput?: unknown,
): DocumentV6Result {
  const event = documentV6EventSchema.safeParse(eventInput)
  const source = sourceSchema.safeParse(sourceInput)
  if (!event.success || !source.success) return invalid("The V6 source or event is invalid.")
  const current = promoteDocumentSnapshotV6(source.data)
  const value = event.data
  if (value.documentId !== current.id) return invalid("The event belongs to a different document.")
  if (value.baseRevision !== current.revision || value.revision !== current.revision + 1)
    return invalid("The authored base revision changed.", "stale-revision")
  if (source.data.schemaVersion !== 6 && value.type !== "org.vibeshape.document.metadata-changed")
    return invalid("Only an appearance command can adopt V6 authority.")
  const reduced = reduceContent(current, value, targetInput)
  if (!reduced.ok) return reduced
  const parsed = documentSnapshotV6Schema.safeParse({
    ...reduced.snapshot,
    revision: value.revision,
    updatedAt: value.issuedAt,
  })
  return parsed.success
    ? { ok: true, snapshot: parsed.data }
    : invalid("The V6 event violates authored appearance invariants.")
}

function reduceContent(
  current: DocumentSnapshotV6,
  event: DocumentV6Event,
  target: unknown,
): DocumentV6Result {
  switch (event.type) {
    case "org.vibeshape.document.metadata-changed":
      return reduceAppearance(current, event.change)
    case "org.vibeshape.document.authored-changed":
      return reduceAuthored(current, event)
    case "org.vibeshape.document.restored":
      return reduceRestore(current, event, target)
  }
}
function reduceAppearance(
  current: DocumentSnapshotV6,
  change: Extract<DocumentV6Event, { type: "org.vibeshape.document.metadata-changed" }>["change"],
): DocumentV6Result {
  if (![...current.parts, ...current.suspendedParts].some((part) => part.id === change.partId))
    return invalid("The authored part does not exist.")
  const partAppearances = current.partAppearances.filter((part) => part.partId !== change.partId)
  if (change.appearance !== null)
    partAppearances.push({ partId: change.partId, appearance: change.appearance })
  return { ok: true, snapshot: { ...current, partAppearances } }
}
function reduceAuthored(
  current: DocumentSnapshotV6,
  event: Extract<DocumentV6Event, { type: "org.vibeshape.document.authored-changed" }>,
): DocumentV6Result {
  if (
    event.authoredEvent.type === "org.vibeshape.document.restored" ||
    !sameOperationEnvelope(event, event.authoredEvent) ||
    event.transactionId !== event.authoredEvent.transactionId ||
    event.revision !== event.authoredEvent.revision
  )
    return invalid("A V6 authored wrapper requires matching provenance.")
  const reduced = reduceDocumentV5Event(projectDocumentSnapshotV6ToV5(current), event.authoredEvent)
  if (!reduced.ok) return reduced
  const retained = new Set(
    [...reduced.snapshot.parts, ...reduced.snapshot.suspendedParts].map((part) => part.id),
  )
  return {
    ok: true,
    snapshot: {
      ...promoteDocumentSnapshotV6(reduced.snapshot),
      partAppearances: current.partAppearances.filter((part) => retained.has(part.partId)),
    },
  }
}
function reduceRestore(
  current: DocumentSnapshotV6,
  event: Extract<DocumentV6Event, { type: "org.vibeshape.document.restored" }>,
  input: unknown,
): DocumentV6Result {
  const target = sourceSchema.safeParse(input)
  if (!target.success) return invalid("The V6 restore target is invalid.")
  if (
    target.data.id !== current.id ||
    target.data.createdAt !== current.createdAt ||
    target.data.revision !== event.targetRevision ||
    target.data.revision >= current.revision
  )
    return invalid("The V6 restore target is unavailable or belongs to another document.")
  return { ok: true, snapshot: promoteDocumentSnapshotV6(target.data) }
}

export function applyDocumentV6MetadataCommand(
  source: unknown,
  input: unknown,
  optionsInput: unknown = {},
): DocumentV6CommandResult {
  const command = documentV6MetadataCommandSchema.safeParse(input)
  const options = z
    .object({ transactionId: draftIdSchema.nullable().optional() })
    .strict()
    .safeParse(optionsInput)
  if (!command.success || !options.success)
    return invalid("The appearance command is invalid.", "invalid-command")
  const { kind: _kind, payload, ...envelope } = command.data
  const event = documentV6EventSchema.safeParse({
    ...envelope,
    type: "org.vibeshape.document.metadata-changed",
    change: payload,
    transactionId: options.data.transactionId ?? null,
    revision: envelope.baseRevision + 1,
  })
  if (!event.success)
    return invalid("The command cannot advance its revision safely.", "revision-exhausted")
  const reduced = reduceDocumentV6Event(source, event.data)
  return reduced.ok ? { ...reduced, event: event.data } : reduced
}

export function wrapDocumentV6AuthoredResult(
  current: DocumentSnapshotV6,
  result: DocumentV5CommandResult,
): DocumentV6CommandResult {
  if (!result.ok) return result
  const { commandId, documentId, baseRevision, revision, issuedAt, actor, transactionId } =
    result.event
  const event = documentV6EventSchema.parse({
    schemaVersion: 6,
    commandId,
    documentId,
    baseRevision,
    revision,
    issuedAt,
    actor,
    transactionId,
    type: "org.vibeshape.document.authored-changed",
    authoredEvent: result.event,
  })
  const reduced = reduceDocumentV6Event(current, event)
  return reduced.ok ? { ...reduced, event } : reduced
}

export function applyDocumentV6AuthoredCommand(
  snapshot: DocumentSnapshotV6,
  command: unknown,
  options: unknown = {},
) {
  return wrapDocumentV6AuthoredResult(
    snapshot,
    applyDocumentV5AuthoredCommand(projectDocumentSnapshotV6ToV5(snapshot), command, options),
  )
}
