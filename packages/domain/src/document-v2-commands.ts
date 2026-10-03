import { z } from "zod"
import { canonicalJson } from "./canonical-json"
import { createDocumentDependencyGraph } from "./document-graph"
import {
  type DocumentSnapshotV2,
  documentSnapshotV2Schema,
  projectDocumentSnapshotV2ToV1,
} from "./document-v2"
import {
  type DocumentV2Command,
  type DocumentV2Event,
  type DocumentV2MetadataChange,
  documentV2CommandSchema,
  documentV2EventSchema,
  documentV2ModelEventSchema,
} from "./document-v2-command-schemas"
import { applyDocumentUpgradeV2Command } from "./document-v2-migration"
import {
  allocationsFromEffects,
  type DocumentV2CommandResult,
  type DocumentV2Result,
  invalidV2,
  sameOperationEnvelope,
  validateV2Envelope,
} from "./document-v2-support"
import { historyItemKey } from "./history-folders"
import { draftIdSchema } from "./identifiers"
import { planPartEffects } from "./part-effects"
import { partAllocationsSchema } from "./parts"
import {
  applyVersionedDocumentCommand,
  reduceVersionedDocumentEvent,
  versionedDocumentEventSchema,
} from "./versioned-document-commands"

const commandOptionsSchema = z
  .object({ transactionId: draftIdSchema.nullable().optional() })
  .strict()

function reduceMetadata(
  snapshot: DocumentSnapshotV2,
  change: DocumentV2MetadataChange,
): DocumentV2Result {
  if (change.kind === "part.rename" || change.kind === "part.set-visibility") {
    if (!snapshot.parts.some((part) => part.id === change.partId))
      return invalidV2("The part does not exist.")
    const parts = snapshot.parts.map((part) =>
      part.id !== change.partId
        ? part
        : change.kind === "part.rename"
          ? { ...part, name: change.name }
          : { ...part, visible: change.visible },
    )
    return { ok: true, snapshot: { ...snapshot, parts } }
  }
  if (change.kind === "folder.create") {
    if (snapshot.folders.some((folder) => folder.id === change.folder.id))
      return invalidV2("The History folder already exists.")
    return { ok: true, snapshot: { ...snapshot, folders: [...snapshot.folders, change.folder] } }
  }
  if (!snapshot.folders.some((folder) => folder.id === change.folderId))
    return invalidV2("The History folder does not exist.")
  const folders =
    change.kind === "folder.remove"
      ? snapshot.folders.filter((folder) => folder.id !== change.folderId)
      : snapshot.folders.map((folder) =>
          folder.id !== change.folderId
            ? folder
            : change.kind === "folder.rename"
              ? { ...folder, name: change.name }
              : { ...folder, items: change.items },
        )
  return { ok: true, snapshot: { ...snapshot, folders } }
}

function reduceModel(
  snapshot: DocumentSnapshotV2,
  event: Extract<DocumentV2Event, { type: "org.vibeshape.document.model-changed" }>,
): DocumentV2Result {
  if (
    !sameOperationEnvelope(event, event.modelEvent) ||
    event.transactionId !== event.modelEvent.transactionId ||
    event.revision !== event.modelEvent.revision
  )
    return invalidV2(
      "The model event and V2 envelope must have identical provenance and revisions.",
    )
  if (event.modelEvent.type === "org.vibeshape.document.restored")
    return invalidV2("A V2 restore must restore authored metadata together with the model.")
  const before = projectDocumentSnapshotV2ToV1(snapshot)
  const reduced = reduceVersionedDocumentEvent(before, event.modelEvent)
  if (!reduced.ok) return reduced
  const planned = planPartEffects({
    after: reduced.snapshot,
    parts: snapshot.parts,
    allocations: allocationsFromEffects(event.partEffects),
  })
  if (!planned.ok) return invalidV2(planned.message)
  if (canonicalJson(planned.effects) !== canonicalJson(event.partEffects))
    return invalidV2("The captured part effects do not match the trusted model operation.")
  const retained = new Set(reduced.snapshot.history.map(historyItemKey))
  const folders = snapshot.folders.flatMap((folder) => {
    const items = folder.items.filter((item) => retained.has(historyItemKey(item)))
    return items.length ? [{ ...folder, items }] : []
  })
  return {
    ok: true,
    snapshot: { ...reduced.snapshot, schemaVersion: 2, parts: planned.parts, folders },
  }
}

function withoutRevision(snapshot: DocumentSnapshotV2) {
  const { revision: _revision, updatedAt: _updatedAt, ...content } = snapshot
  return content
}

function restorableModel(snapshot: DocumentSnapshotV2): boolean {
  const graph = createDocumentDependencyGraph(snapshot)
  return graph.ok && graph.graph.dependencyModelIssues.length === 0
}

function isHistoricalRestoreTarget(
  current: DocumentSnapshotV2,
  target: DocumentSnapshotV2,
  revision: number,
): boolean {
  return (
    target.id === current.id &&
    target.revision === revision &&
    target.revision >= 1 &&
    target.revision < current.revision &&
    target.createdAt === current.createdAt
  )
}

function reduceRestore(
  snapshot: DocumentSnapshotV2,
  event: Extract<DocumentV2Event, { type: "org.vibeshape.document.restored" }>,
  targetInput: unknown,
): DocumentV2Result {
  const target = documentSnapshotV2Schema.safeParse(targetInput)
  if (!target.success || !isHistoricalRestoreTarget(snapshot, target.data, event.targetRevision))
    return invalidV2(
      "The V2 restore target must be an earlier validated V2 revision of the same document.",
    )
  if (!restorableModel(snapshot) || !restorableModel(target.data))
    return invalidV2("Restore requires available feature dependency declarations.")
  if (canonicalJson(withoutRevision(snapshot)) === canonicalJson(withoutRevision(target.data)))
    return invalidV2("The restore is a semantic no-op.", "command-no-op")
  return {
    ok: true,
    snapshot: { ...target.data, revision: event.revision, updatedAt: event.issuedAt },
  }
}

/** Replays one atomic model+metadata event. No caller-supplied effect can bypass semantic validation. */
export function reduceDocumentV2Event(
  snapshotInput: unknown,
  eventInput: unknown,
  restoreTarget?: unknown,
): DocumentV2Result {
  const snapshot = documentSnapshotV2Schema.safeParse(snapshotInput)
  const event = documentV2EventSchema.safeParse(eventInput)
  if (!snapshot.success || !event.success)
    return invalidV2("The V2 document snapshot or event is invalid.")
  const envelopeIssue = validateV2Envelope(snapshot.data, event.data)
  if (envelopeIssue) return envelopeIssue
  let reduced: DocumentV2Result
  switch (event.data.type) {
    case "org.vibeshape.document.upgraded-v2":
      return invalidV2("An already upgraded document cannot be upgraded again.")
    case "org.vibeshape.document.model-changed":
      reduced = reduceModel(snapshot.data, event.data)
      break
    case "org.vibeshape.document.metadata-changed":
      reduced = reduceMetadata(snapshot.data, event.data.change)
      break
    case "org.vibeshape.document.restored":
      reduced = reduceRestore(snapshot.data, event.data, restoreTarget)
      break
  }
  if (!reduced.ok) return reduced
  if (
    canonicalJson(withoutRevision(reduced.snapshot)) ===
    canonicalJson(withoutRevision(snapshot.data))
  )
    return invalidV2("The V2 operation is a semantic no-op.", "command-no-op")
  const next = documentSnapshotV2Schema.safeParse({
    ...reduced.snapshot,
    revision: event.data.revision,
    updatedAt: event.data.issuedAt,
  })
  return next.success
    ? { ok: true, snapshot: next.data }
    : invalidV2("The operation violates authored part or contiguous folder invariants.")
}

type EventCreationResult =
  | Readonly<{ ok: true; event: DocumentV2Event }>
  | Extract<DocumentV2Result, { ok: false }>

function eventEnvelope(
  command: DocumentV2Command,
  transactionId: z.infer<typeof draftIdSchema> | null,
) {
  const { kind: _kind, payload: _payload, ...envelope } = command
  return { ...envelope, transactionId, revision: envelope.baseRevision + 1 }
}

/** Lifts a translated V1 event without inventing a second command, actor, revision or transaction. */
export function applyDocumentV2ModelEvent(
  snapshotInput: unknown,
  eventInput: unknown,
  allocationInput: unknown = [],
): DocumentV2CommandResult {
  const snapshot = documentSnapshotV2Schema.safeParse(snapshotInput)
  const modelEvent = versionedDocumentEventSchema.safeParse(eventInput)
  const allocations = partAllocationsSchema.safeParse(allocationInput)
  if (!snapshot.success || !modelEvent.success || !allocations.success)
    return invalidV2("The translated V2 model operation is invalid.", "invalid-command")
  if (modelEvent.data.type === "org.vibeshape.document.restored")
    return invalidV2("V2 restore must include authored metadata.", "invalid-command")
  const reduced = reduceVersionedDocumentEvent(
    projectDocumentSnapshotV2ToV1(snapshot.data),
    modelEvent.data,
  )
  if (!reduced.ok) return reduced
  const planned = planPartEffects({
    after: reduced.snapshot,
    parts: snapshot.data.parts,
    allocations: allocations.data,
  })
  if (!planned.ok) return invalidV2(planned.message, "invalid-command")
  const source = modelEvent.data
  const event = documentV2ModelEventSchema.parse({
    schemaVersion: 2,
    type: "org.vibeshape.document.model-changed",
    commandId: source.commandId,
    documentId: source.documentId,
    baseRevision: source.baseRevision,
    revision: source.revision,
    issuedAt: source.issuedAt,
    actor: source.actor,
    transactionId: source.transactionId,
    modelEvent: source,
    partEffects: planned.effects,
  })
  const applied = reduceDocumentV2Event(snapshot.data, event)
  return applied.ok ? { ...applied, event } : applied
}

function applyModelCommand(
  snapshot: DocumentSnapshotV2,
  command: Extract<DocumentV2Command, { kind: "org.vibeshape.document.model-command" }>,
  transactionId: z.infer<typeof draftIdSchema> | null,
): DocumentV2CommandResult {
  if (!sameOperationEnvelope(command, command.payload.command))
    return invalidV2(
      "The nested model command must share the V2 command's provenance and base revision.",
      "invalid-command",
    )
  const applied = applyVersionedDocumentCommand(
    projectDocumentSnapshotV2ToV1(snapshot),
    command.payload.command,
    { transactionId },
  )
  return applied.ok
    ? applyDocumentV2ModelEvent(snapshot, applied.event, command.payload.partAllocations)
    : applied
}

function createMetadataEvent(
  command: Extract<DocumentV2Command, { kind: "org.vibeshape.document.metadata-command" }>,
  transactionId: z.infer<typeof draftIdSchema> | null,
): EventCreationResult {
  const parsed = documentV2EventSchema.safeParse({
    ...eventEnvelope(command, transactionId),
    type: "org.vibeshape.document.metadata-changed",
    change: command.payload,
  })
  return parsed.success
    ? { ok: true, event: parsed.data }
    : invalidV2("The document revision cannot advance safely.", "revision-exhausted")
}

export function applyDocumentV2Command(
  snapshotInput: unknown,
  commandInput: unknown,
  optionsInput: unknown = {},
): DocumentV2CommandResult {
  const command = documentV2CommandSchema.safeParse(commandInput)
  const options = commandOptionsSchema.safeParse(optionsInput)
  if (!command.success || !options.success)
    return invalidV2("The V2 command or options are invalid.", "invalid-command")
  if (command.data.kind === "org.vibeshape.document.upgrade-v2")
    return applyDocumentUpgradeV2Command(snapshotInput, command.data, options.data)
  const snapshot = documentSnapshotV2Schema.safeParse(snapshotInput)
  if (!snapshot.success)
    return invalidV2("A V2 command requires a validated V2 snapshot.", "invalid-command")
  const transactionId = options.data.transactionId ?? null
  if (command.data.kind === "org.vibeshape.document.model-command")
    return applyModelCommand(snapshot.data, command.data, transactionId)
  const created = createMetadataEvent(command.data, transactionId)
  if (!created.ok) return created
  const reduced = reduceDocumentV2Event(snapshot.data, created.event)
  return reduced.ok ? { ...reduced, event: created.event } : reduced
}

export type { DocumentV2CommandResult, DocumentV2Result } from "./document-v2-support"
